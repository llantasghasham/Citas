import type { Locale, TenantStatus } from '@/generated/prisma/enums';

import { controlDb, databaseByName } from './client';
import { assertDatabaseName, isTenantDatabase, TENANT_DB_PREFIX } from './naming';
import { tenantScope, type TenantScope } from './tenant';

/**
 * La flota: crear, borrar y mirar las bases de datos de las oficinas.
 *
 * Una oficina nueva NO se migra al crearla. Se COPIA de una base plantilla que
 * ya está migrada (`CREATE DATABASE … TEMPLATE`), y eso resuelve de una vez dos
 * problemas que no tienen buena solución por separado:
 *
 *   - Aplicar migraciones exige la herramienta de Prisma, que es una dependencia
 *     de desarrollo y no está en la imagen de producción. Dar de alta una
 *     oficina desde el panel no puede depender de algo que allí no existe.
 *   - Una copia es una orden y tarda lo que tarda copiar unos megas; migrar son
 *     veintitantos pasos y un proceso aparte. Dar de alta una oficina tiene que
 *     ser instantáneo, no una barra de progreso.
 *
 * Y de regalo, el esquema de una oficina nueva es EXACTAMENTE el de una base
 * migrada de verdad, `_prisma_migrations` incluida: no hay un segundo camino
 * por el que el esquema pueda salir distinto.
 *
 * La plantilla la pone al día `npm run db:fleet -- migrar`, que es también quien
 * migra las oficinas que ya existen.
 */

/** La base de la que se copian las demás. No se conecta nadie a ella. */
export const TEMPLATE_DB = `${TENANT_DB_PREFIX}plantilla`;

/**
 * Crea la base de una oficina copiando la plantilla.
 *
 * `CREATE DATABASE` no admite parámetros, así que el nombre se incrusta — y por
 * eso pasa por `assertDatabaseName`, que es lo único que hay entre esta línea y
 * una orden escrita por otro.
 */
export async function createTenantDatabase(name: string): Promise<void> {
  assertDatabaseName(name);
  if (!isTenantDatabase(name)) {
    throw new Error(`«${name}» no es una base de oficina: falta el prefijo ${TENANT_DB_PREFIX}.`);
  }
  if (!(await templateExists())) {
    throw new Error(
      `La plantilla ${TEMPLATE_DB} no existe. Créela con «npm run db:fleet -- migrar».`,
    );
  }
  // La copia falla si alguien está conectado a la plantilla. Nadie debería
  // estarlo —solo se toca para migrarla— pero el mensaje de PostgreSQL para ese
  // caso no lo explica, y este sí.
  try {
    await controlDb().$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_DB}"`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes('being accessed by other users')) {
      throw new Error(
        `No se pudo copiar ${TEMPLATE_DB}: hay alguien conectado a la plantilla. ` +
          'Nadie debería estarlo; ciérrelo y reintente.',
      );
    }
    throw error;
  }
}

/**
 * Borra la base de una oficina, con todo lo que tiene dentro.
 *
 * Se echan primero las conexiones abiertas: una sola sesión viva —el pozo de
 * esta misma aplicación, sin ir más lejos— basta para que `DROP DATABASE` falle.
 */
export async function dropTenantDatabase(name: string): Promise<void> {
  assertDatabaseName(name);
  if (!isTenantDatabase(name)) {
    throw new Error(`«${name}» no es una base de oficina: no se borra desde aquí.`);
  }
  if (name === TEMPLATE_DB) throw new Error('La plantilla no se borra desde aquí.');

  const prisma = controlDb();
  await prisma.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  );
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
}

/** Si esa base existe en el servidor. */
export async function databaseExists(name: string): Promise<boolean> {
  assertDatabaseName(name);
  const rows = await controlDb().$queryRawUnsafe<{ ok: boolean }[]>(
    `SELECT true AS ok FROM pg_database WHERE datname = '${name}'`,
  );
  return rows.length > 0;
}

export async function templateExists(): Promise<boolean> {
  return databaseExists(TEMPLATE_DB);
}

/** Todas las bases de oficina que hay en el servidor, en orden. */
export async function listFleetDatabases(): Promise<string[]> {
  const rows = await controlDb().$queryRawUnsafe<{ datname: string }[]>(
    `SELECT datname FROM pg_database WHERE datname LIKE '${TENANT_DB_PREFIX}%' ORDER BY datname`,
  );
  return rows.map((row) => row.datname).filter((name) => name !== TEMPLATE_DB);
}

/**
 * Qué migraciones lleva aplicadas una base.
 *
 * Sirve para lo que de verdad importa de una flota: saber si alguna se quedó
 * atrás. Una oficina con el esquema viejo no falla al arrancar —falla la primera
 * vez que alguien usa lo nuevo, que es cuando peor viene enterarse.
 */
export async function migrationsOf(name: string): Promise<string[]> {
  const prisma = databaseByName(name);
  const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`,
  );
  return rows.map((row) => row.migration_name);
}

export interface TenantSeed {
  id: string;
  slug: string;
  subdomain: string;
  name: string;
  status: TenantStatus;
  defaultLocale: Locale;
}

/**
 * Escribe en la base de la oficina su propia fila de `Tenant`.
 *
 * Hace falta y no es un duplicado: todo dato de negocio cuelga de un `tenantId`
 * por clave foránea, así que una base de oficina sin su propia fila no admite ni
 * un evento. La base de CONTROL guarda el registro —dónde vive, qué plan tiene,
 * si está suspendida—; la de la oficina guarda lo que sus propias filas
 * necesitan para colgar de algo. El id es el MISMO en las dos, y por eso
 * `scopedWhere` vale igual a los dos lados.
 */
export async function seedTenantRow(databaseName: string, tenant: TenantSeed): Promise<void> {
  const prisma = databaseByName(databaseName);
  await prisma.tenant.upsert({
    where: { id: tenant.id },
    update: { name: tenant.name, status: tenant.status, defaultLocale: tenant.defaultLocale },
    create: { ...tenant, databaseName },
  });
}

/**
 * Un ámbito por cada oficina, para los trabajos que recorren la plataforma.
 *
 * Con todo en una base, un trabajo automático era UNA consulta con un `IN` y ya.
 * Repartidas, es una consulta por oficina, y no hay atajo: preguntarle a todas a
 * la vez es exactamente lo que una base por oficina impide.
 *
 * Funciona igual en los dos repartos, y a propósito: en `shared` devuelve
 * ámbitos sin base —que encaminan a la de control— así que el trabajo recorre
 * oficinas y consulta filtrando por oficina, que es lo mismo que hacía antes con
 * un `IN`, solo que en varias consultas. Un solo camino, no dos.
 */
export async function eachOffice(): Promise<TenantScope[]> {
  const offices = await controlDb().tenant.findMany({
    where: { status: { not: 'suspended' } },
    select: { id: true, databaseName: true },
    orderBy: { createdAt: 'asc' },
  });
  return offices.map((office) => tenantScope(office.id, office.databaseName));
}
