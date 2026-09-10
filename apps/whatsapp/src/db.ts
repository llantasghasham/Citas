import { Pool } from 'pg';

import { clamp, fromEnv, LIMITS, readConfig, type Tunables } from './config.js';

/**
 * Acceso a la base, con SQL a secas.
 *
 * Sin Prisma a propósito: este servicio comparte TABLAS con la web, no código.
 * Arrastrar el cliente generado de la web hasta aquí ataría un proceso de larga
 * vida al ciclo de construcción de Next, y lo que hace falta son ocho consultas.
 * Todas parametrizadas; en este archivo no se concatena nada.
 */
let pool: Pool | undefined;

export function getPool(): Pool {
  pool ??= new Pool({ connectionString: readConfig().databaseUrl, max: 4 });
  return pool;
}

export type Status = 'pending' | 'qr' | 'connected' | 'disconnected';

export interface ConnectionRow {
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  status: Status;
  authEnc: string | null;
  dailyCap: number;
  sentToday: number;
  sentDay: string | null;
}

const CONNECTION_COLUMNS =
  'id, "tenantId", name, phone, status, "authEnc", "dailyCap", "sentToday", "sentDay"';

export async function listConnections(): Promise<ConnectionRow[]> {
  const { rows } = await getPool().query<ConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS} FROM "WhatsappConnection"`,
  );
  return rows;
}

export async function getConnection(id: string): Promise<ConnectionRow | undefined> {
  const { rows } = await getPool().query<ConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS} FROM "WhatsappConnection" WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function setStatus(
  id: string,
  status: Status,
  extra: { qrCode?: string | null; phone?: string | null; lastError?: string | null } = {},
): Promise<void> {
  await getPool().query(
    `UPDATE "WhatsappConnection"
        SET status = $2::"WhatsappStatus",
            "qrCode" = COALESCE($3, "qrCode"),
            phone = COALESCE($4, phone),
            "lastError" = $5,
            "lastSeenAt" = CASE WHEN $2 = 'connected' THEN now() ELSE "lastSeenAt" END,
            "updatedAt" = now()
      WHERE id = $1`,
    [
      id,
      status,
      // `null` aquí significa «déjalo como está»; para borrarlo se manda ''.
      extra.qrCode === undefined ? null : extra.qrCode,
      extra.phone === undefined ? null : extra.phone,
      extra.lastError ?? null,
    ],
  );
}

export async function clearQr(id: string): Promise<void> {
  await getPool().query(`UPDATE "WhatsappConnection" SET "qrCode" = NULL WHERE id = $1`, [id]);
}

export async function saveAuth(id: string, authEnc: string): Promise<void> {
  await getPool().query(
    `UPDATE "WhatsappConnection" SET "authEnc" = $2, "updatedAt" = now() WHERE id = $1`,
    [id, authEnc],
  );
}

/** Cerrar sesión borra las credenciales: si no, se reconectaría solo. */
export async function forgetAuth(id: string): Promise<void> {
  await getPool().query(
    `UPDATE "WhatsappConnection"
        SET "authEnc" = NULL, "qrCode" = NULL, phone = NULL,
            status = 'disconnected'::"WhatsappStatus", "updatedAt" = now()
      WHERE id = $1`,
    [id],
  );
}

export interface QueuedMessage {
  id: string;
  connectionId: string;
  toPhone: string;
  body: string;
  tries: number;
}

/**
 * El siguiente mensaje de una conexión, y solo si le queda cupo hoy.
 *
 * El cupo se comprueba EN LA CONSULTA y no en memoria: si el proceso se
 * reinicia a mitad de una tanda, el contador que manda es el de la base.
 */
export async function nextQueued(connectionId: string): Promise<QueuedMessage | undefined> {
  const { rows } = await getPool().query<QueuedMessage>(
    `SELECT m.id, m."connectionId", m."toPhone", m.body, m.tries
       FROM "WhatsappMessage" m
      WHERE m."connectionId" = $1 AND m.status = 'queued' AND m.tries < 3
      ORDER BY m."createdAt" ASC
      LIMIT 1`,
    [connectionId],
  );
  return rows[0];
}

export async function markSent(messageId: string, connectionId: string, day: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE "WhatsappMessage" SET status = 'sent', "sentAt" = now(), error = NULL WHERE id = $1`,
      [messageId],
    );
    // El contador se reinicia solo al cambiar el día, sin tarea programada.
    await client.query(
      `UPDATE "WhatsappConnection"
          SET "sentToday" = CASE WHEN "sentDay" = $2 THEN "sentToday" + 1 ELSE 1 END,
              "sentDay" = $2,
              "updatedAt" = now()
        WHERE id = $1`,
      [connectionId, day],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function markFailed(messageId: string, reason: string): Promise<void> {
  await getPool().query(
    `UPDATE "WhatsappMessage"
        SET tries = tries + 1,
            error = $2,
            status = CASE WHEN tries + 1 >= 3 THEN 'failed' ELSE 'queued' END
      WHERE id = $1`,
    // El motivo se recorta: un error de la librería puede traer una traza
    // entera, y esto lo lee una persona en una tabla.
    [messageId, reason.slice(0, 300)],
  );
}

/** Cuánto lleva mandado hoy, ya contando el cambio de día. */
export function usedToday(connection: ConnectionRow, day: string): number {
  return connection.sentDay === day ? connection.sentToday : 0;
}


/**
 * El freno, leído de la misma tabla `Setting` que edita el panel.
 *
 * Se relee cada minuto en vez de al arrancar: cambiar el retardo desde la
 * pantalla tiene que surtir efecto sin reiniciar un servicio que está
 * sosteniendo sesiones de WhatsApp abiertas. Reiniciarlo para bajar un número
 * de segundos costaría que cada oficina volviera a escanear.
 *
 * El entorno sigue valiendo de respaldo, y todo se recorta contra `LIMITS`: una
 * fila escrita a mano no puede quitar el freno.
 */
const TUNABLES_TTL_MS = 60_000;

let cached: { at: number; value: Tunables } | undefined;

export async function readTunables(): Promise<Tunables> {
  if (cached !== undefined && Date.now() - cached.at < TUNABLES_TTL_MS) return cached.value;

  const fallback: Tunables = {
    delayMin: fromEnv('WHATSAPP_DELAY_MIN', LIMITS.delayMin.fallback),
    delayMax: fromEnv('WHATSAPP_DELAY_MAX', LIMITS.delayMax.fallback),
    warmupCap: fromEnv('WHATSAPP_WARMUP_CAP', LIMITS.warmupCap.fallback),
  };

  let stored = new Map<string, string>();
  try {
    const { rows } = await getPool().query<{ key: string; value: string | null }>(
      `SELECT key, value FROM "Setting" WHERE key = ANY($1::text[])`,
      [['WHATSAPP_DELAY_MIN', 'WHATSAPP_DELAY_MAX', 'WHATSAPP_WARMUP_CAP']],
    );
    stored = new Map(
      rows.flatMap((row) => (row.value === null ? [] : [[row.key, row.value] as const])),
    );
  } catch (error) {
    // Sin base de datos el envío ya no va a ninguna parte, pero el freno no es
    // el sitio donde reventar: se sigue con el respaldo del entorno.
    console.error(`[wa] no se pudo leer el freno: ${String(error)}`);
  }

  const pick = (key: string, bounds: { min: number; max: number }, previous: number): number => {
    const raw = stored.get(key);
    if (raw === undefined) return clamp(previous, bounds);
    const parsed = Number.parseInt(raw, 10);
    return clamp(Number.isFinite(parsed) ? parsed : previous, bounds);
  };

  const delayMin = pick('WHATSAPP_DELAY_MIN', LIMITS.delayMin, fallback.delayMin);
  const value: Tunables = {
    delayMin,
    // El máximo nunca por debajo del mínimo: al revés, la horquilla del azar
    // sale negativa y el retardo se queda en el mínimo sin que nadie lo note.
    delayMax: Math.max(delayMin, pick('WHATSAPP_DELAY_MAX', LIMITS.delayMax, fallback.delayMax)),
    warmupCap: pick('WHATSAPP_WARMUP_CAP', LIMITS.warmupCap, fallback.warmupCap),
  };

  cached = { at: Date.now(), value };
  return value;
}
