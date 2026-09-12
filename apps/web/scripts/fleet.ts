// `DATABASE_URL` vive en `apps/web/.env`, y esto se llama a mano y desde el
// instalador —no desde systemd, que sí le pasa el archivo con `EnvironmentFile`—
// así que el archivo hay que leerlo aquí. Sin esta línea, `npm run db:fleet --
// migrar` moría con «DATABASE_URL no está puesta» en un servidor donde está
// puesta, y se llevó por delante un despliegue entero. Es lo mismo que hace
// `prisma7.config.ts`, por lo mismo.
import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { closeAllDatabases, controlDb } from '../src/lib/db/client';
import {
  TEMPLATE_DB,
  createTenantDatabase,
  databaseExists,
  listFleetDatabases,
  migrationsOf,
} from '../src/lib/db/fleet';
import { databaseNameFor } from '../src/lib/db/naming';
import { urlForDatabase } from '../src/lib/db/routing';

/**
 * La flota de bases de datos: una por oficina.
 *
 *   npm run db:fleet -- migrar            pone al día la plantilla y todas
 *   npm run db:fleet -- estado            qué oficina va por dónde
 *   npm run db:fleet -- crear <subdominio>  le da base propia a una oficina
 *
 * `migrar` es el que hay que ejecutar en cada despliegue, y es el que hace falta
 * que exista: con una sola base, «aplicar las migraciones» era una orden; con
 * trescientas, es una orden por oficina y una que se salte deja a esa oficina
 * con el esquema viejo. Por eso `estado` enseña las que van atrasadas ARRIBA y
 * en rojo, igual que los buzones de SINPE caídos: es el mismo tipo de avería
 * —algo que desde fuera se ve igual que si no pasara nada— y se mira igual.
 */

/** Lo que dicen los archivos: la verdad contra la que se compara la flota. */
function expectedMigrations(): string[] {
  const dir = join(import.meta.dirname, '..', 'prisma', 'migrations');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function deployTo(database: string): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: urlForDatabase(database) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

async function migrate(): Promise<void> {
  // La plantilla primero: es de la que se copian las nuevas, así que una
  // plantilla atrasada fabrica oficinas atrasadas.
  const fleet = await listFleetDatabases();

  if (!(await databaseExists(TEMPLATE_DB))) {
    console.log(`[flota] creando la plantilla ${TEMPLATE_DB}`);
    try {
      await controlDb().$executeRawUnsafe(`CREATE DATABASE "${TEMPLATE_DB}"`);
    } catch (error) {
      // No poder crear la plantilla es grave si HAY oficinas con base propia:
      // significa que la próxima no se va a poder dar de alta y que estas no se
      // van a poder migrar. Pero si no hay ninguna —reparto `shared`, que es
      // como está hoy la instalación— es una preparación que todavía no hace
      // falta, y tumbar por eso el despliegue entero deja el sitio sin
      // actualizar por algo que no afecta a nadie. Se dice fuerte y se sigue.
      //
      // El permiso se concede con `ALTER ROLE <usuario> CREATEDB` y el
      // instalador ya lo hace; esto es la red por si se ejecuta en una máquina
      // donde no se hizo.
      const why = error instanceof Error ? error.message : String(error);
      if (fleet.length > 0) throw error;
      console.error(
        `[flota] AVISO: no se pudo crear la plantilla ${TEMPLATE_DB}.\n` +
          `        ${why.split('\n').slice(-1)[0]?.trim() ?? ''}\n` +
          '        Hoy no hay ninguna oficina con base propia, así que nada deja\n' +
          '        de funcionar — pero dar de alta una oficina fallará hasta que\n' +
          `        el usuario de la base pueda crear bases (ALTER ROLE … CREATEDB).`,
      );
      return;
    }
  }
  console.log(`[flota] migrando la plantilla`);
  deployTo(TEMPLATE_DB);

  if (fleet.length === 0) {
    console.log('[flota] todavía no hay ninguna oficina con base propia.');
    return;
  }

  let failed = 0;
  for (const database of fleet) {
    try {
      deployTo(database);
      console.log(`  ✓ ${database}`);
    } catch {
      failed += 1;
      console.log(`  ✗ ${database}`);
    }
  }
  console.log(`[flota] ${fleet.length - failed} al día, ${failed} con error.`);
  if (failed > 0) process.exitCode = 1;
}

async function status(): Promise<void> {
  const expected = expectedMigrations();
  const offices = await controlDb().tenant.findMany({
    select: { name: true, subdomain: true, databaseName: true },
    orderBy: { subdomain: 'asc' },
  });

  const rows: { label: string; state: string; behind: number }[] = [];
  for (const office of offices) {
    if (office.databaseName === null) {
      rows.push({ label: `${office.subdomain} (${office.name})`, state: 'SIN BASE PROPIA', behind: 999 });
      continue;
    }
    try {
      const applied = await migrationsOf(office.databaseName);
      const behind = expected.filter((name) => !applied.includes(name)).length;
      rows.push({
        label: `${office.subdomain} → ${office.databaseName}`,
        state: behind === 0 ? 'al día' : `le faltan ${behind}`,
        behind,
      });
    } catch (error) {
      rows.push({
        label: `${office.subdomain} → ${office.databaseName}`,
        state: `NO CONTESTA · ${error instanceof Error ? error.message : String(error)}`,
        behind: 998,
      });
    }
  }

  // Las averiadas arriba: en una lista larga, lo que está mal no puede estar
  // donde caiga.
  rows.sort((a, b) => b.behind - a.behind);
  console.log(`[flota] ${expected.length} migraciones escritas, ${rows.length} oficinas\n`);
  for (const row of rows) {
    console.log(`  ${row.behind === 0 ? '✓' : '✗'} ${row.label} — ${row.state}`);
  }
  if (rows.some((row) => row.behind > 0)) process.exitCode = 1;
}

async function create(subdomain: string): Promise<void> {
  const prisma = controlDb();
  const tenant = await prisma.tenant.findUnique({
    where: { subdomain },
    select: { id: true, databaseName: true },
  });
  if (tenant === null) {
    console.error(`[flota] no hay ninguna oficina con el subdominio «${subdomain}».`);
    process.exitCode = 1;
    return;
  }
  if (tenant.databaseName !== null) {
    console.log(`[flota] ${subdomain} ya tiene base propia: ${tenant.databaseName}`);
    return;
  }

  const name = databaseNameFor(subdomain);
  await createTenantDatabase(name);
  await prisma.tenant.update({ where: { id: tenant.id }, data: { databaseName: name } });
  console.log(`[flota] ${subdomain} → ${name}`);
}

async function main(): Promise<void> {
  if (process.env['DATABASE_URL'] === undefined) {
    console.error('DATABASE_URL no está puesta.');
    process.exitCode = 1;
    return;
  }

  const [command, argument] = process.argv.slice(2);
  if (command === 'migrar') return migrate();
  if (command === 'estado') return status();
  if (command === 'crear') {
    if (argument === undefined) {
      console.error('Uso: npm run db:fleet -- crear <subdominio>');
      process.exitCode = 1;
      return;
    }
    return create(argument);
  }

  console.error('Uso: npm run db:fleet -- <migrar|estado|crear <subdominio>>');
  process.exitCode = 1;
}

void main()
  .catch((error: unknown) => {
    console.error(`[flota] ${String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllDatabases();
    process.exit(process.exitCode ?? 0);
  });
