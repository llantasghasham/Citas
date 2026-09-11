import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

import { assertDatabaseName } from './naming';
import { controlDatabaseName, controlUrl, urlForDatabase } from './routing';
import type { TenantScope } from './tenant';

/**
 * A qué base de datos va cada consulta.
 *
 * Hay DOS planos y no se mezclan:
 *
 *   - El de CONTROL (`controlDb`) es la base de la plataforma: el registro de
 *     oficinas, los planes, los pedidos y cobros de las oficinas al dueño, los
 *     buzones de SINPE de la plataforma y el superadministrador. Es del
 *     ARRENDADOR, no de ningún inquilino.
 *   - El de la OFICINA (`db(scope)`) es una base de datos propia POR OFICINA:
 *     sus bodas, sus invitados, sus mesas, su equipo, su WhatsApp, su marca.
 *
 * Que sean bases distintas es la diferencia entre «el código siempre filtra por
 * oficina» y «el servidor no puede devolver la fila de otra». `TenantScope`
 * sigue estando y sigue filtrando: son dos redes, igual que el comprobante del
 * SINPE es único por proveedor Y por cuenta.
 *
 * El interruptor `TENANCY` decide cuál de los dos modos corre, y existe porque
 * una instalación con datos dentro no cambia de reparto sin mover esos datos:
 *
 *   - `shared` (por defecto): todo en la base de control, como hasta ahora.
 *   - `fleet`: cada oficina en la suya.
 *
 * `/panel/sistema` dice en cuál está, para que no se quede a medias sin que
 * nadie lo vea.
 */
export type TenancyMode = 'shared' | 'fleet';

/**
 * Si el traslado a una base por oficina está TERMINADO en el código.
 *
 * Es una constante y no una variable de entorno a propósito, y es el freno más
 * importante de este archivo. Encender `TENANCY=fleet` con el traslado a medias
 * no da un error: parte los datos en dos. Las consultas ya trasladadas escriben
 * en la base de la oficina y las que todavía no, en la de control — la misma
 * oficina con sus eventos en un sitio y sus invitados en otro, y nadie se entera
 * hasta que alguien abre una lista y le falta la mitad.
 *
 * Una variable de entorno la pone quien despliega, que no puede saber por dónde
 * va el código. Esto lo pone quien termina el traslado, que sí.
 */
const FLEET_READY = false;

export function tenancyMode(): TenancyMode {
  if (process.env['TENANCY'] !== 'fleet') return 'shared';
  if (!FLEET_READY) {
    throw new Error(
      'TENANCY=fleet pero el traslado a una base por oficina todavía no está ' +
        'terminado en el código: parte de las consultas seguirían escribiendo en ' +
        'la base de control y los datos de una misma oficina acabarían partidos ' +
        'en dos. Quítelo hasta que FLEET_READY sea verdadero.',
    );
  }
  return 'fleet';
}

/**
 * Cuántas bases se mantienen abiertas a la vez.
 *
 * Un cliente por oficina es un pozo de conexiones por oficina, y PostgreSQL
 * viene con cien en total: trescientas oficinas con un pozo de diez cada una son
 * tres mil conexiones contra un servidor que admite cien. Así que se guardan las
 * que se están usando y se cierra la más vieja — una oficina cuyo cliente se
 * cerró vuelve a abrirlo en la siguiente petición, que cuesta una conexión, no
 * un error.
 */
const MAX_OPEN = positiveEnv('TENANT_DB_MAX_OPEN', 24);
/** Y cada una con un pozo pequeño, por la misma cuenta de arriba. */
const POOL_MAX = positiveEnv('TENANT_DB_POOL_MAX', 3);

function positiveEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Los clientes vivos, del más viejo al más reciente.
 *
 * En `globalThis` porque el servidor de desarrollo de Next recarga el módulo en
 * cada cambio, y sin esto cada recarga abriría un pozo nuevo y dejaría el
 * anterior colgando hasta agotar el servidor.
 */
const registry = ((): Map<string, PrismaClient> => {
  const store = globalThis as unknown as { citasDbRegistry?: Map<string, PrismaClient> };
  store.citasDbRegistry ??= new Map<string, PrismaClient>();
  return store.citasDbRegistry;
})();

function clientFor(database: string, connectionString: string, poolMax?: number): PrismaClient {
  const existing = registry.get(database);
  if (existing !== undefined) {
    // Tocada: vuelve al final, así la que se cierra es la que lleva más tiempo
    // sin usarse y no la que se abrió antes.
    registry.delete(database);
    registry.set(database, existing);
    return existing;
  }

  const client = new PrismaClient({
    adapter: new PrismaPg(
      poolMax === undefined ? { connectionString } : { connectionString, max: poolMax },
    ),
  });
  registry.set(database, client);
  evictOverflow();
  return client;
}

function evictOverflow(): void {
  while (registry.size > MAX_OPEN) {
    const oldest = registry.keys().next();
    if (oldest.done === true) return;
    // La base de control no se cierra nunca: la toca cada petición para resolver
    // la oficina, y cerrarla sería reabrirla acto seguido.
    if (oldest.value === controlDatabaseName()) {
      const client = registry.get(oldest.value);
      registry.delete(oldest.value);
      if (client !== undefined) registry.set(oldest.value, client);
      return;
    }
    const client = registry.get(oldest.value);
    registry.delete(oldest.value);
    // Se suelta sin esperar: la petición que provocó el desalojo no tiene por
    // qué pagar el cierre de un pozo ajeno.
    void client?.$disconnect().catch(() => undefined);
  }
}

/** La base de la plataforma: oficinas, planes, cobro y superadministrador. */
export function controlDb(): PrismaClient {
  return clientFor(controlDatabaseName(), controlUrl());
}

/**
 * La base de una oficina.
 *
 * En `fleet` exige que la oficina tenga base propia. Falla CERRADO y a
 * propósito: una oficina sin base aprovisionada leyendo de la de control vería
 * los datos de todas las demás, que es justo lo que este reparto existe para
 * impedir. Aprovisionarla es `npm run db:fleet -- crear <subdominio>`.
 */
export function db(scope: TenantScope): PrismaClient {
  if (tenancyMode() === 'shared') return controlDb();

  const name = scope.databaseName;
  if (name === null) {
    throw new Error(
      `La oficina ${scope.tenantId} no tiene base de datos propia y el reparto es por flota. ` +
        'Aprovisiónela con «npm run db:fleet -- crear <subdominio>».',
    );
  }
  return clientFor(assertDatabaseName(name), urlForDatabase(name), POOL_MAX);
}

/**
 * Una base por su nombre, para las herramientas: migrar la flota, comprobarla,
 * copiarla. No vale para servir una petición — para eso está `db(scope)`, que
 * pasa por el ámbito y no admite un nombre suelto.
 */
export function databaseByName(name: string): PrismaClient {
  return clientFor(assertDatabaseName(name), urlForDatabase(name), POOL_MAX);
}

/** Cierra todo. Lo usan las pruebas y el apagado ordenado de los guiones. */
export async function closeAllDatabases(): Promise<void> {
  const clients = [...registry.values()];
  registry.clear();
  await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
}

/**
 * Compatibilidad: sigue siendo la base de control.
 *
 * Todas las consultas del proyecto entraban por aquí. Las que son de una oficina
 * van pasando a `db(scope)`; mientras tanto esto las deja donde estaban, que en
 * modo `shared` es exactamente donde tienen que estar.
 */
export function getPrisma(): PrismaClient {
  return controlDb();
}
