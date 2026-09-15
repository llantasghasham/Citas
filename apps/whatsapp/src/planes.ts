import { Pool } from 'pg';

// De la WEB, y no una copia. Es la única función que decide a qué servidor se
// conecta este proceso; escrita dos veces, el día que alguien cambiara una y no
// la otra el fallo no sería un error, sería escribir en la base equivocada. El
// camino relativo es el mismo trato que ya hay en la otra dirección:
// `apps/web/tests/cola.test.ts` importa el `db.ts` de aquí.
import { controlDatabaseName, controlUrl, urlForDatabase } from '../../web/src/lib/db/routing.js';

/**
 * A QUÉ BASE VA CADA CONSULTA, también aquí.
 *
 * Este servicio nació cuando todas las oficinas compartían una base: abría UN
 * pool y consultaba `WhatsappConnection` y `WhatsappMessage` a secas. Con
 * `TENANCY=fleet` eso deja de valer — esas dos tablas pasan a vivir en la base
 * de cada oficina— y lo que pasaba era peor que un error: la web encolaba allí,
 * este proceso miraba la común, no encontraba nada, y la cola se veía llena y
 * quieta. Sin un fallo, sin una línea en el registro, sin nada que mirar.
 *
 * LA IDEA QUE HACE QUE ESTO NO SEA UN CAMBIO GRANDE: el modo compartido se trata
 * como una flota de UNA base. Así hay un solo camino en el resto del código —se
 * recorren oficinas siempre— y el modo viejo no es un caso especial que se
 * pruebe menos.
 *
 * Y HAY DOS PLANOS, igual que en la web:
 *
 *   · `controlPool()` es la base del ARRENDADOR. Aquí se usa para dos cosas y
 *     solo dos: saber qué oficinas hay, y leer el freno de `Setting`.
 *   · `officePools()` son las bases de las oficinas: los números conectados y
 *     sus mensajes.
 */

let control: Pool | undefined;

/**
 * La base de control. En modo compartido es también la de todo lo demás.
 *
 * Lee `DATABASE_URL` directamente y NO por `readConfig()`, que además exige el
 * token de la puerta de servicio. Ese token no tiene nada que ver con a qué base
 * se conecta esto, y atarlos tenía un coste real: las pruebas de este módulo
 * salían «5 pruebas, 0 pasadas, 0 fallidas» cuando faltaba el token — ni verde
 * ni rojo, que es la peor de las tres.
 */
export function controlPool(): Pool {
  control ??= new Pool({ connectionString: controlUrl(), max: 4 });
  return control;
}

/** Si esta instalación reparte una base por oficina. */
export function isFleet(): boolean {
  return (process.env['TENANCY'] ?? '').trim().toLowerCase() === 'fleet';
}

export interface Office {
  /** El nombre de la base. En modo compartido, el de la base de control. */
  database: string;
  pool: Pool;
}

const pools = new Map<string, Pool>();

function poolForDatabase(database: string): Pool {
  const ya = pools.get(database);
  if (ya !== undefined) return ya;
  // `urlForDatabase` valida el nombre antes de incrustarlo. El nombre viene de
  // la base de control, no de una petición, pero se valida igual: la frontera
  // es la función, no la confianza en quien escribió la fila.
  const nuevo = new Pool({ connectionString: urlForDatabase(database), max: 2 });
  pools.set(database, nuevo);
  return nuevo;
}

/**
 * Las oficinas, releídas cada minuto.
 *
 * Cada minuto y no al arrancar, por la misma razón que el freno: dar de alta una
 * oficina no puede costar reiniciar un servicio que está sosteniendo sesiones de
 * WhatsApp abiertas — cada oficina tendría que volver a escanear su código QR.
 *
 * Se saltan las SUSPENDIDAS: una oficina suspendida no manda mensajes, y
 * dejarla fuera aquí es lo mismo que hace la web al resolver una sesión.
 */
const TTL_MS = 60_000;
let cache: { at: number; value: Office[] } | undefined;

export async function offices(): Promise<Office[]> {
  if (cache !== undefined && Date.now() - cache.at < TTL_MS) return cache.value;

  let value: Office[];

  if (!isFleet()) {
    // Una sola, la de siempre. El resto del código no distingue.
    value = [{ database: controlDatabaseName(), pool: controlPool() }];
  } else {
    const { rows } = await controlPool().query<{ databaseName: string | null }>(
      `SELECT "databaseName" FROM "Tenant"
        WHERE "databaseName" IS NOT NULL AND status <> 'suspended'`,
    );
    value = rows.flatMap((row) =>
      row.databaseName === null ? [] : [{ database: row.databaseName, pool: poolForDatabase(row.databaseName) }],
    );
  }

  cache = { at: Date.now(), value };
  return value;
}

/**
 * En qué base vive una conexión.
 *
 * Se recuerda: el id de una conexión no cambia de base nunca, así que buscarlo
 * una vez basta. Con la memoria vacía se recorren las oficinas — son pocas y
 * pasa una vez por conexión.
 *
 * Que este servicio acepte un id cualquiera con un token global ya era así
 * antes, y sigue estando cubierto donde toca: la WEB resuelve la conexión con el
 * ámbito de la oficina ANTES de llamar aquí. Esto no relaja eso; solo sabe
 * dónde mirar.
 */
const home = new Map<string, string>();

export function rememberHome(connectionId: string, database: string): void {
  home.set(connectionId, database);
}

export function forgetHome(connectionId: string): void {
  home.delete(connectionId);
}

export async function poolFor(connectionId: string): Promise<Pool> {
  const conocida = home.get(connectionId);
  if (conocida !== undefined) return poolOf(conocida);

  for (const office of await offices()) {
    const { rowCount } = await office.pool.query(
      `SELECT 1 FROM "WhatsappConnection" WHERE id = $1`,
      [connectionId],
    );
    if ((rowCount ?? 0) > 0) {
      home.set(connectionId, office.database);
      return office.pool;
    }
  }

  // Ni se inventa una base ni se cae a la de control: escribir el estado de una
  // conexión en la base equivocada es peor que no escribirlo.
  throw new Error(`La conexión ${connectionId} no está en ninguna base de oficina.`);
}

function poolOf(database: string): Pool {
  if (database === controlDatabaseName() && !isFleet()) return controlPool();
  return poolForDatabase(database);
}

/** Para el apagado ordenado: se cierran todas, la de control incluida. */
export async function closeAllPools(): Promise<void> {
  const todos = [...pools.values()];
  pools.clear();
  cache = undefined;
  if (control !== undefined) {
    todos.push(control);
    control = undefined;
  }
  await Promise.all(todos.map((p) => p.end().catch(() => undefined)));
}

/** Para las pruebas: olvidar lo recordado. */
export function forgetOffices(): void {
  cache = undefined;
  home.clear();
}
