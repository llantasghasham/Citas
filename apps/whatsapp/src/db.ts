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
 * Reclama el siguiente mensaje de una conexión, y de paso RESERVA su cupo.
 *
 * Las dos cosas juntas y en una transacción, porque las dos tenían el mismo
 * fallo: eran una lectura seguida de una escritura, con hueco en medio.
 *
 * - Sin reclamo, dos repartidores hacían el mismo `SELECT` y salían con la
 *   misma fila. El invitado recibía dos mensajes, que es justo lo que el freno
 *   existe para evitar.
 * - Sin reserva, los dos leían «van 199 de 200» y los dos mandaban. El tope
 *   diario no es un adorno: es lo que separa un número vivo de uno cerrado.
 *
 * `FOR UPDATE SKIP LOCKED` es lo que hace que dos repartidores cojan filas
 * DISTINTAS en vez de pelearse por la misma. Y el arriendo —dos minutos— es lo
 * que permite recuperar la fila de un proceso que se murió, sin adivinar si
 * llegó a mandarla.
 */
const LEASE_SECONDS = 120;

export async function claimNext(
  connectionId: string,
  worker: string,
  day: string,
  cap: number,
): Promise<QueuedMessage | undefined> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // 1. El cupo, con la condición DENTRO del UPDATE: si otro repartidor se
    //    llevó el último hueco, esto no afecta ninguna fila y se acabó.
    const { rows: reserved } = await client.query<{ sentToday: number }>(
      `UPDATE "WhatsappConnection"
          SET "sentToday" = CASE WHEN "sentDay" = $2 THEN "sentToday" + 1 ELSE 1 END,
              "sentDay" = $2,
              "updatedAt" = now()
        WHERE id = $1
          AND ("sentDay" IS DISTINCT FROM $2 OR "sentToday" < $3)
        RETURNING "sentToday"`,
      [connectionId, day, cap],
    );
    if (reserved.length === 0) {
      await client.query('ROLLBACK');
      return undefined;
    }

    // 2. La fila, reclamada de verdad.
    const { rows } = await client.query<QueuedMessage>(
      `UPDATE "WhatsappMessage" m
          SET status = 'processing',
              "claimedBy" = $2,
              "leaseUntil" = now() + ($3 || ' seconds')::interval
        WHERE m.id = (
          SELECT id FROM "WhatsappMessage"
           WHERE "connectionId" = $1
             AND status = 'queued'
             AND tries < 3
             AND ("scheduledAt" IS NULL OR "scheduledAt" <= now())
           ORDER BY COALESCE("scheduledAt", "createdAt") ASC, "createdAt" ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING m.id, m."connectionId", m."toPhone", m.body, m.tries`,
      [connectionId, worker, String(LEASE_SECONDS)],
    );

    // Sin nada que mandar se devuelve el hueco reservado: si no, una cola vacía
    // consumiría el cupo del día a base de mirarla.
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return undefined;
    }

    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Los arriendos vencidos: filas que alguien cogió y nunca soltó.
 *
 * NO se vuelven a poner en la cola, y esa es la decisión importante. Un
 * repartidor puede morir DESPUÉS de que WhatsApp aceptara el mensaje: reenviar
 * sería duplicar y dejarlo sería perderlo, y no hay forma de saber cuál de las
 * dos. Así que se dice —`sent_unknown`— y lo decide una persona, que es quien
 * puede mirar el teléfono y ver si llegó.
 */
export async function reclaimExpired(): Promise<number> {
  const { rowCount } = await getPool().query(
    `UPDATE "WhatsappMessage"
        SET status = 'sent_unknown',
            "claimedBy" = NULL,
            "leaseUntil" = NULL,
            error = COALESCE(error, 'El repartidor se detuvo a mitad del envío. No consta si llegó.')
      WHERE status = 'processing' AND "leaseUntil" < now()`,
  );
  return rowCount ?? 0;
}

/**
 * Enviado. El contador NO se toca aquí: el hueco se reservó al reclamar.
 *
 * Solo escribe si la fila sigue siendo suya. Un arriendo vencido significa que
 * otro proceso ya la dio por dudosa, y pisarlo sería borrar esa duda.
 */
export async function markSent(
  messageId: string,
  worker: string,
  providerMessageId: string | null,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE "WhatsappMessage"
        SET status = 'sent', "sentAt" = now(), error = NULL,
            "providerMessageId" = $3, "claimedBy" = NULL, "leaseUntil" = NULL
      WHERE id = $1 AND status = 'processing' AND "claimedBy" = $2`,
    [messageId, worker, providerMessageId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * No se pudo. Devuelve el hueco del cupo, porque no se gastó ningún mensaje.
 *
 * Como `markSent`, solo escribe si la fila sigue siendo suya.
 */
export async function markFailed(
  messageId: string,
  worker: string,
  connectionId: string,
  day: string,
  reason: string,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE "WhatsappMessage"
          SET tries = tries + 1,
              error = $3,
              "claimedBy" = NULL,
              "leaseUntil" = NULL,
              status = CASE WHEN tries + 1 >= 3 THEN 'failed' ELSE 'queued' END
        WHERE id = $1 AND status = 'processing' AND "claimedBy" = $2`,
      // El motivo se recorta: un error de la librería puede traer una traza
      // entera, y esto lo lee una persona en una tabla.
      [messageId, worker, reason.slice(0, 300)],
    );

    if ((rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE "WhatsappConnection"
            SET "sentToday" = GREATEST(0, "sentToday" - 1), "updatedAt" = now()
          WHERE id = $1 AND "sentDay" = $2`,
        [connectionId, day],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
