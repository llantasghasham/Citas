import { execFileSync } from 'node:child_process';

/**
 * Aplica TODAS las migraciones sobre una base creada desde cero y comprueba que
 * el esquema salió como dice el código.
 *
 * Existe porque «las migraciones están escritas» y «las migraciones funcionan»
 * no son lo mismo, y la diferencia solo se ve ejecutándolas. Dos de este
 * proyecto lo demostraron: la de las mesas reventaba al quitar una —`SET NULL`
 * sobre una clave compuesta pone a nulo TODAS sus columnas— y la de la cadena de
 * oficina impedía borrar una oficina entera hasta declararla `DEFERRABLE`.
 *
 *   npm run db:check --workspace @citas/web
 *
 * Usa una base temporal aparte, la crea, aplica, comprueba y la borra. No toca
 * la de trabajo.
 */
const TEMP_DB = `citas_check_${Date.now()}`;

interface Check {
  what: string;
  sql: string;
  expect: (rows: Record<string, unknown>[]) => boolean;
  why: string;
}

const CHECKS: Check[] = [
  {
    what: 'Guest → Table lleva el evento dentro',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname = 'Guest_tableId_eventId_fkey'`,
    expect: (rows) => String(rows[0]?.['def'] ?? '').includes('"tableId", "eventId"'),
    why: 'sin el evento en la clave se puede sentar a un invitado en la mesa de otra boda',
  },
  {
    what: 'WhatsappMessage → Event es compuesta Y diferida',
    sql: `SELECT condeferred AS d, pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname = 'WhatsappMessage_eventId_tenantId_fkey'`,
    expect: (rows) =>
      rows[0]?.['d'] === true && String(rows[0]?.['def'] ?? '').includes('"eventId", "tenantId"'),
    why: 'sin diferir, borrar una oficina falla; sin componer, un mensaje cuelga del evento de otra',
  },
  {
    what: 'WhatsappMessage → Guest lleva el evento dentro',
    sql: `SELECT condeferred AS d FROM pg_constraint
           WHERE conname = 'WhatsappMessage_guestId_eventId_fkey'`,
    expect: (rows) => rows[0]?.['d'] === true,
    why: 'el invitado no lleva oficina: la cadena se cierra por su evento',
  },
  {
    what: 'un solo mensaje vivo por invitado y tipo',
    sql: `SELECT indexdef FROM pg_indexes WHERE indexname = 'WhatsappMessage_live_guest_key'`,
    expect: (rows) => {
      const def = String(rows[0]?.['indexdef'] ?? '');
      return def.includes('UNIQUE') && def.includes('kind') && def.includes('WHERE');
    },
    why: 'dos «Enviar» a la vez mandaban dos mensajes a cada invitado',
  },
  {
    what: 'un solo cobro abierto por pedido',
    sql: `SELECT indexdef FROM pg_indexes WHERE tablename = 'Payment' AND indexdef LIKE '%WHERE%'`,
    expect: (rows) => rows.some((row) => String(row['indexdef']).includes('UNIQUE')),
    why: 'dos peticiones simultáneas abrían dos cobranzas de verdad',
  },
  {
    what: 'la sesión cuelga de su oficina',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname = 'Session_tenantId_fkey'`,
    expect: (rows) => String(rows[0]?.['def'] ?? '').includes('ON DELETE CASCADE'),
    why: 'sin esto no se puede saber si la oficina sigue abierta al resolver la sesión',
  },
  {
    what: 'cada oficina apunta a UNA base de datos y no a la de otra',
    sql: `SELECT indexdef FROM pg_indexes WHERE indexname = 'Tenant_databaseName_key'`,
    expect: (rows) => String(rows[0]?.['indexdef'] ?? '').includes('UNIQUE'),
    why: 'dos oficinas apuntando a la misma base es justo lo que el reparto evita',
  },
  {
    what: 'el directorio de lo público se va con su oficina',
    sql: `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname IN ('PublicSlug_tenantId_fkey', 'GuestToken_tenantId_fkey')`,
    expect: (rows) =>
      rows.length === 2 &&
      rows.every((row) => String(row['def']).includes('ON DELETE CASCADE')),
    why: 'un slug que sobrevive a su oficina apunta a una base que ya no existe',
  },
  {
    what: 'el comprobante del SINPE es único por cuenta',
    sql: `SELECT indexdef FROM pg_indexes
           WHERE indexname = 'SinpeMovement_accountId_reference_key'`,
    expect: (rows) => String(rows[0]?.['indexdef'] ?? '').includes('UNIQUE'),
    why: 'leer el mismo correo dos veces cobraría dos veces',
  },
];

function psql(database: string, sql: string): string {
  return execFileSync('psql', [adminUrl(database), '-tAX', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** La misma máquina y credenciales de `DATABASE_URL`, con otra base. */
function adminUrl(database: string): string {
  const raw = process.env['DATABASE_URL'];
  if (raw === undefined) throw new Error('DATABASE_URL no está puesta.');
  const url = new URL(raw);
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
}

function main(): void {
  const base = new URL(process.env['DATABASE_URL'] ?? '').pathname.slice(1) || 'postgres';
  console.log(`[migraciones] base temporal ${TEMP_DB}`);

  psql(base, `CREATE DATABASE "${TEMP_DB}"`);
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: adminUrl(TEMP_DB) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let bad = 0;
    for (const check of CHECKS) {
      const rows = psql(TEMP_DB, `SELECT row_to_json(t) FROM (${check.sql}) t`)
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      const ok = check.expect(rows);
      if (!ok) bad += 1;
      console.log(`  ${ok ? '✓' : '✗'} ${check.what}`);
      if (!ok) console.log(`      ${check.why}`);
    }

    if (bad > 0) {
      console.error(`\n[migraciones] ${bad} comprobación(es) sin pasar.`);
      process.exitCode = 1;
      return;
    }
    console.log('\n[migraciones] el esquema salió como dice el código.');
  } finally {
    psql(base, `DROP DATABASE IF EXISTS "${TEMP_DB}"`);
  }
}

main();
