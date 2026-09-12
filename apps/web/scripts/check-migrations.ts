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

/**
 * Los índices que deciden si un invitado recibe la invitación de su segundo
 * acto, y si entra dos veces por la puerta. Se imprimen enteros al final.
 */
const SHOW_INDEXES = `
  SELECT indexname, indexdef FROM pg_indexes
   WHERE indexname IN (
     'WhatsappMessage_live_guest_key',
     'WhatsappMessage_live_guest_whole_key',
     'CheckIn_actId_guestId_key'
   )
   ORDER BY indexname`;

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
    what: 'una baja total no se puede apuntar dos veces',
    sql: `SELECT indexdef FROM pg_indexes WHERE indexname = 'OptOut_all_key'`,
    expect: (rows) => String(rows[0]?.['indexdef'] ?? '').includes('IS NULL'),
    why: 'dos nulos no chocan en un índice único: sin el parcial, cien bajas del mismo contacto',
  },
  {
    what: 'no se encola dos veces el mismo acto al mismo invitado',
    sql: `SELECT indexdef FROM pg_indexes WHERE indexname = 'WhatsappMessage_live_guest_key'`,
    expect: (rows) => String(rows[0]?.['indexdef'] ?? '').includes('actId'),
    why: 'sin el acto, lo que evita el doble envío impediría la invitación del segundo acto',
  },
  {
    what: 'una entrada por invitado y acto',
    sql: `SELECT indexdef FROM pg_indexes WHERE indexname = 'CheckIn_actId_guestId_key'`,
    expect: (rows) => String(rows[0]?.['indexdef'] ?? '').includes('UNIQUE'),
    why: 'el segundo intento tiene que distinguirse de una entrada nueva',
  },
  {
    what: 'un solo acto principal por evento',
    sql: `SELECT indexdef FROM pg_indexes WHERE indexname = 'EventAct_main_key'`,
    expect: (rows) => {
      const def = String(rows[0]?.['indexdef'] ?? '');
      return def.includes('UNIQUE') && def.includes('WHERE');
    },
    why: 'dos principales serían dos respuestas globales distintas y ninguna mandaría',
  },
  {
    what: 'un invitado no puede responder al acto de otra boda',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname IN ('GuestActRsvp_actId_eventId_fkey', 'GuestActRsvp_guestId_eventId_fkey')`,
    expect: (rows) =>
      rows.length === 2 && rows.every((row) => String(row['def']).includes('"eventId"')),
    why: 'sin el evento en las dos claves, lo único que separa dos bodas es el cuidado de la consulta',
  },
  {
    what: 'un invitado no puede entrar en el grupo de otra boda',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname IN ('GuestSegment_guestId_eventId_fkey', 'GuestSegment_segmentId_eventId_fkey')`,
    expect: (rows) =>
      rows.length === 2 && rows.every((row) => String(row['def']).includes('"eventId"')),
    why: 'la misma razón, del otro lado: los grupos también son de UNA boda',
  },
  {
    what: 'quitar el número no se lleva el histórico de mensajes',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname = 'WhatsappMessage_connectionId_tenantId_fkey'`,
    expect: (rows) => !String(rows[0]?.['def'] ?? '').includes('ON DELETE CASCADE'),
    why: 'a un número lo cierran y la oficina conecta otro: con la cascada perdía a quién había escrito',
  },
  {
    what: 'pero cerrar la oficina sí se lo lleva',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname = 'WhatsappMessage_tenantId_fkey'`,
    expect: (rows) => String(rows[0]?.['def'] ?? '').includes('ON DELETE CASCADE'),
    why: 'sin esto, quitar la cascada del número dejaba una oficina sin poder borrarse',
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
    what: 'una sesión es de una oficina O de un proveedor, nunca de las dos',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname = 'Session_one_scope'`,
    expect: (rows) => String(rows[0]?.['def'] ?? '').includes('CHECK'),
    why: 'sin esto, quien administra un salón y trabaja en una oficina tendría una sesión que vale para los dos sitios',
  },
  {
    what: 'un proveedor tiene UNA categoría principal',
    sql: `SELECT indexdef FROM pg_indexes WHERE indexname = 'ProviderCategoryLink_one_primary'`,
    expect: (rows) => String(rows[0]?.['indexdef'] ?? '').includes('UNIQUE'),
    why: 'con dos, el listado lo enseñaría dos veces y nadie sabría en cuál buscarlo',
  },
  {
    what: 'una imagen tiene llave y un vídeo dirección, nunca las dos',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname = 'ProviderMedia_image_or_video'`,
    expect: (rows) => String(rows[0]?.['def'] ?? '').includes('CHECK'),
    why: 'una fila a medias es un hueco roto en el perfil de alguien',
  },
  {
    what: 'una imagen oculta tiene MOTIVO',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname = 'ProviderMedia_hidden_needs_reason'`,
    expect: (rows) => String(rows[0]?.['def'] ?? '').includes('CHECK'),
    why: 'una reclamación de derechos sin resolver y algo que escondió el proveedor se tratan distinto',
  },
  {
    what: 'una denuncia de copyright lleva el correo de quien la pone',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname = 'ProviderReport_copyright_needs_email'`,
    expect: (rows) => String(rows[0]?.['def'] ?? '').includes('CHECK'),
    why: 'sin alguien a quien responder no hay reclamación: hay un botón anónimo para tumbar las fotos de un competidor',
  },
  {
    what: 'el mapa de un proveedor exige dirección pública',
    sql: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname = 'Provider_map_needs_address'`,
    expect: (rows) => String(rows[0]?.['def'] ?? '').includes('CHECK'),
    why: 'publicar por descuido dónde vive quien hace pasteles en su cocina no se arregla después',
  },
  {
    /**
     * La que vale por todas: NINGUNA clave foránea del directorio llega a lo
     * privado de una boda.
     *
     * No es una precaución, es la arquitectura entera: una consulta pública no
     * puede alcanzar la lista de invitados de nadie porque no hay camino. Y se
     * comprueba contra el catálogo de PostgreSQL en cada despliegue, no leyendo
     * el esquema a ojo — que es exactamente lo que se deja de hacer el día que
     * hay prisa.
     */
    what: 'el directorio NO toca nada privado de una boda',
    sql: `SELECT count(*)::int AS n
            FROM pg_constraint c
            JOIN pg_class origen ON origen.oid = c.conrelid
            JOIN pg_class destino ON destino.oid = c.confrelid
           WHERE c.contype = 'f'
             AND origen.relname LIKE 'Provider%'
             AND destino.relname IN (
               'Guest', 'Rsvp', 'GuestPreference', 'CheckIn', 'Table',
               'GuestActRsvp', 'GuestActInvite', 'GuestSegment', 'Event',
               'EventAct', 'InvitationVersion', 'WhatsappMessage'
             )`,
    expect: (rows) => rows[0]?.['n'] === 0,
    why: 'una sola clave foránea ahí convierte el directorio público en un camino hasta la lista de invitados de una boda',
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

/**
 * `DATABASE_URL`, comprobada.
 *
 * Vacía es lo mismo que sin poner, y hay que decirlo igual: un `.env` con la
 * línea escrita y el valor en blanco reventaba con «Invalid URL» y diez líneas
 * de pila de Node, que no le dicen a nadie qué le falta.
 */
function databaseUrl(): string {
  const raw = process.env['DATABASE_URL'];
  if (raw === undefined || raw.length === 0) throw new Error('DATABASE_URL no está puesta.');
  return raw;
}

/** La misma máquina y credenciales de `DATABASE_URL`, con otra base. */
function adminUrl(database: string): string {
  const url = new URL(databaseUrl());
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
}

function main(): void {
  const base = new URL(databaseUrl()).pathname.slice(1) || 'postgres';
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
    // Y además se ENSEÑA el esquema final de lo que más se lee mal.
    //
    // Dos revisiones externas seguidas leyeron la migración donde el índice de
    // la cola todavía era `(eventId, guestId, kind)`, no vieron que una
    // posterior lo sustituye, y avisaron de un fallo que no existe. La culpa no
    // es suya: veintiséis migraciones leídas en orden son veintiséis
    // oportunidades de parar en la equivocada. Lo que falta es enseñar cómo
    // queda, no solo decir que está bien — así que la definición va al registro
    // y quien audite la lee en vez de reconstruirla.
    console.log('\n[migraciones] así queda el esquema de lo que más se lee mal:\n');
    const shown = psql(TEMP_DB, `SELECT row_to_json(t) FROM (${SHOW_INDEXES}) t`);
    for (const line of shown.split('\n').filter((l) => l.length > 0)) {
      const row = JSON.parse(line) as { indexname: string; indexdef: string };
      console.log(`  ${row.indexname}`);
      console.log(`      ${row.indexdef}\n`);
    }

    console.log('[migraciones] el esquema salió como dice el código.');
  } finally {
    psql(base, `DROP DATABASE IF EXISTS "${TEMP_DB}"`);
  }
}

main();
