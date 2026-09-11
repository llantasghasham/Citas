import { closeAllDatabases, controlDb, databaseByName } from '../src/lib/db/client';
import { createTenantDatabase, databaseExists, seedTenantRow } from '../src/lib/db/fleet';
import { databaseNameFor } from '../src/lib/db/naming';

/**
 * Mueve a cada oficina a SU base de datos.
 *
 *   npm run db:split -- copiar     copia y comprueba, sin borrar nada
 *   npm run db:split -- limpiar    borra de la base común lo ya copiado
 *
 * Son dos órdenes y no una, a propósito. Entre copiar y borrar tiene que caber
 * que alguien MIRE: que entre al panel de una oficina, abra una boda, vea sus
 * invitados y sus mesas. Una copia que se creyó buena y no lo era, con el
 * original ya borrado, no tiene arreglo — y esto son listas de invitados de
 * bodas que ya se pagaron.
 *
 * Por eso «copiar» deja las filas donde estaban. Entre las dos órdenes hay que
 * encender `TENANCY=fleet` y trabajar un rato: mientras esté copiado pero sin
 * encender, manda la base común y no ha cambiado nada; en cuanto se encienda,
 * manda la copia. Lo único que no se puede hacer es «limpiar» antes de haber
 * comprobado, y el guion se niega si los recuentos no cuadran.
 */

/**
 * Las tablas que se mudan, EN ESTE ORDEN.
 *
 * El orden es el de las claves foráneas y no es negociable: un invitado no se
 * puede escribir antes que su evento, ni un mensaje antes que su conexión. Las
 * mesas van antes que los invitados porque un invitado sentado apunta a la suya.
 */
const MOVED = [
  'event',
  'eventHost',
  'eventHonoree',
  'invitationVersion',
  'render',
  'table',
  'guest',
  'rsvp',
  'whatsappConnection',
  'whatsappMessage',
] as const;

type Moved = (typeof MOVED)[number];

/** Cómo se encuentran las filas de UNA oficina en cada tabla. */
function whereFor(table: Moved, tenantId: string): Record<string, unknown> {
  switch (table) {
    case 'event':
    case 'whatsappConnection':
    case 'whatsappMessage':
      return { tenantId };
    case 'eventHost':
    case 'eventHonoree':
    case 'invitationVersion':
    case 'table':
    case 'guest':
      return { event: { tenantId } };
    case 'render':
      return { version: { event: { tenantId } } };
    case 'rsvp':
      return { guest: { event: { tenantId } } };
  }
}

const CHUNK = 500;

/* eslint-disable @typescript-eslint/no-explicit-any -- el guion recorre tablas por nombre */
type AnyDelegate = {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  createMany: (args: unknown) => Promise<{ count: number }>;
  deleteMany: (args: unknown) => Promise<{ count: number }>;
  count: (args: unknown) => Promise<number>;
};

function delegate(client: unknown, table: Moved): AnyDelegate {
  return (client as Record<string, AnyDelegate>)[table] as AnyDelegate;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function copyTenant(
  tenantId: string,
  subdomain: string,
  name: string,
  status: string,
  defaultLocale: string,
): Promise<boolean> {
  const control = controlDb();
  const database = databaseNameFor(subdomain);

  if (!(await databaseExists(database))) await createTenantDatabase(database);
  await seedTenantRow(database, {
    id: tenantId,
    slug: subdomain,
    subdomain,
    name,
    status: status as never,
    defaultLocale: defaultLocale as never,
  });

  const target = databaseByName(database);
  let total = 0;

  for (const table of MOVED) {
    const where = whereFor(table, tenantId);
    const rows = await delegate(control, table).findMany({ where });
    if (rows.length === 0) continue;

    // Se escribe en trozos: una lista de dos mil invitados en una sola orden es
    // una orden que el servidor puede rechazar por tamaño.
    for (let index = 0; index < rows.length; index += CHUNK) {
      await delegate(target, table).createMany({
        data: rows.slice(index, index + CHUNK),
        skipDuplicates: true,
      });
    }

    // Y se cuenta lo escrito contra lo leído. Sin esto, «copiado» significa
    // «no dio error», que no es lo mismo.
    const written = await delegate(target, table).count({ where: {} });
    if (written < rows.length) {
      console.error(`  ✗ ${subdomain}/${table}: leídas ${rows.length}, escritas ${written}`);
      return false;
    }
    total += rows.length;
    console.log(`    ${table}: ${rows.length}`);
  }

  // El directorio de lo público, para que /i/<slug> y /g/<token> sepan dónde
  // mirar. Sin esto, encender la flota deja todas las invitaciones ya repartidas
  // sin poder encontrarse, que es la peor avería posible de este traslado.
  const slugs = await control.invitationVersion.findMany({
    where: { event: { tenantId } },
    select: { slug: true },
  });
  const tokens = await control.guest.findMany({
    where: { event: { tenantId } },
    select: { token: true },
  });
  await control.publicSlug.createMany({
    data: slugs.map((row) => ({ slug: row.slug, tenantId })),
    skipDuplicates: true,
  });
  await control.guestToken.createMany({
    data: tokens.map((row) => ({ token: row.token, tenantId })),
    skipDuplicates: true,
  });

  await control.tenant.update({ where: { id: tenantId }, data: { databaseName: database } });
  console.log(
    `  ✓ ${subdomain} → ${database} · ${total} filas, ` +
      `${slugs.length} invitaciones y ${tokens.length} invitados apuntados`,
  );
  return true;
}

async function copy(): Promise<void> {
  const offices = await controlDb().tenant.findMany({
    select: { id: true, subdomain: true, name: true, status: true, defaultLocale: true },
    orderBy: { createdAt: 'asc' },
  });

  let bad = 0;
  for (const office of offices) {
    console.log(`[split] ${office.subdomain}`);
    const ok = await copyTenant(
      office.id,
      office.subdomain,
      office.name,
      office.status,
      office.defaultLocale,
    );
    if (!ok) bad += 1;
  }

  if (bad > 0) {
    console.error(`\n[split] ${bad} oficina(s) sin copiar del todo. NO encienda TENANCY=fleet.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    '\n[split] copiado y comprobado. Nada se ha borrado todavía.\n' +
      '  1. Ponga TENANCY=fleet en apps/web/.env y reinicie.\n' +
      '  2. Entre y MIRE: una boda, sus invitados, sus mesas, una invitación pública.\n' +
      '  3. Solo entonces: npm run db:split -- limpiar',
  );
}

/**
 * Borra de la base común lo que ya está copiado.
 *
 * Se niega con cualquier oficina sin base propia: borrar sus filas dejaría a esa
 * oficina sin nada en ningún sitio.
 */
async function clean(): Promise<void> {
  const control = controlDb();
  const offices = await control.tenant.findMany({
    select: { id: true, subdomain: true, databaseName: true },
  });

  const pending = offices.filter((office) => office.databaseName === null);
  if (pending.length > 0) {
    console.error(
      `[split] ${pending.length} oficina(s) todavía sin base propia ` +
        `(${pending.map((office) => office.subdomain).join(', ')}). No se borra nada.`,
    );
    process.exitCode = 1;
    return;
  }

  for (const office of offices) {
    if (office.databaseName === null) continue;
    const target = databaseByName(office.databaseName);

    // Se vuelve a contar ANTES de borrar, no se da por bueno lo de la otra vez:
    // entre «copiar» y «limpiar» han pasado días y se ha seguido trabajando.
    for (const table of MOVED) {
      const where = whereFor(table, office.id);
      const here = await delegate(control, table).count({ where });
      const there = await delegate(target, table).count({ where: {} });
      if (there < here) {
        console.error(
          `[split] ${office.subdomain}/${table}: en la común hay ${here} y en la suya ${there}. ` +
            'No se borra nada de esta oficina.',
        );
        process.exitCode = 1;
        return;
      }
    }

    // Al revés que al copiar: primero lo que cuelga, al final el evento.
    for (const table of [...MOVED].reverse()) {
      const { count } = await delegate(control, table).deleteMany({
        where: whereFor(table, office.id),
      });
      if (count > 0) console.log(`    ${office.subdomain}/${table}: ${count} borradas`);
    }
    console.log(`  ✓ ${office.subdomain}`);
  }

  console.log('\n[split] la base común ya no guarda datos de ninguna oficina.');
}

async function main(): Promise<void> {
  if (process.env['DATABASE_URL'] === undefined) {
    console.error('DATABASE_URL no está puesta.');
    process.exitCode = 1;
    return;
  }

  const command = process.argv[2];
  if (command === 'copiar') return copy();
  if (command === 'limpiar') return clean();

  console.error('Uso: npm run db:split -- <copiar|limpiar>');
  process.exitCode = 1;
}

void main()
  .catch((error: unknown) => {
    console.error(`[split] ${String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllDatabases();
    process.exit(process.exitCode ?? 0);
  });
