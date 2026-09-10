import {
  listConnections,
  markFailed,
  markSent,
  nextQueued,
  readTunables,
  usedToday,
  type ConnectionRow,
} from './db.js';
import { isUp, socketFor, toJid } from './sessions.js';

/**
 * El que va soltando la cola, despacio.
 *
 * Aquí está el freno, y conviene decir por qué existe. Automatizar un número
 * personal de WhatsApp para mandar en volumen va CONTRA sus términos, y la
 * forma habitual de que un número acabe bloqueado es doscientos mensajes
 * idénticos en cinco minutos a gente que nunca escribió antes. El bloqueado no
 * sería un número nuestro: sería el del cliente, el que sus invitados conocen.
 *
 * Nada de esto lo hace permitido. Lo hace sobrevivible:
 *
 * - Un retardo AL AZAR entre mensajes, no fijo: un intervalo exacto es una
 *   firma de máquina. Se ajusta en /panel/configuracion, y se puede acortar
 *   pero no anular: el mínimo son tres segundos.
 * - Un tope diario por número, que la oficina puede bajar y no subir sin querer.
 * - Calentamiento: un número recién conectado manda mucho menos el primer día.
 * - De uno en uno por número. Nunca en paralelo.
 *
 * Y `wa.me` sigue existiendo: cuando no hay número conectado, la oficina manda
 * a mano como siempre. Esto añade una forma de enviar; no quita la de antes.
 */
const HALF_MINUTE = 30_000;

/** La fecha de hoy, en texto, para el contador diario. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cuánto puede mandar hoy este número, contando el calentamiento. */
export function capFor(connection: ConnectionRow, warmupCap: number): number {
  // Un número que todavía no ha mandado nunca es un número nuevo para
  // WhatsApp: el primer día va con el tope de calentamiento.
  const isNew = connection.sentDay === null;
  return isNew ? Math.min(warmupCap, connection.dailyCap) : connection.dailyCap;
}

async function drainOne(connection: ConnectionRow): Promise<boolean> {
  // Se relee en cada mensaje, no al arrancar: bajar el retardo desde la
  // pantalla surte efecto en menos de un minuto, sin reiniciar un servicio que
  // está sosteniendo sesiones abiertas.
  const tunables = await readTunables();
  const day = today();

  if (usedToday(connection, day) >= capFor(connection, tunables.warmupCap)) return false;
  if (!isUp(connection.id)) return false;

  const message = await nextQueued(connection.id);
  if (message === undefined) return false;

  const socket = socketFor(connection.id);
  if (socket === undefined) return false;

  try {
    // Comprobar que el número existe en WhatsApp antes de escribirle: mandar a
    // números muertos, uno detrás de otro, es otra de las señales que llevan a
    // un bloqueo.
    const found = (await socket.onWhatsApp(toJid(message.toPhone))) ?? [];
    const exists = found[0];
    if (exists?.exists !== true) {
      await markFailed(message.id, 'Ese número no tiene WhatsApp.');
      return true;
    }

    await socket.sendMessage(exists.jid, { text: message.body });
    await markSent(message.id, connection.id, day);
    console.log(`[wa] ${connection.name}: enviado a ${message.toPhone}`);
  } catch (error) {
    await markFailed(message.id, error instanceof Error ? error.message : String(error));
    console.error(`[wa] ${connection.name}: falló un envío: ${String(error)}`);
  }

  // El retardo va DESPUÉS del envío y es al azar dentro de la horquilla.
  const { delayMin, delayMax } = tunables;
  const seconds = delayMin + Math.random() * Math.max(0, delayMax - delayMin);
  await sleep(seconds * 1000);

  return true;
}

/**
 * El bucle. Recorre los números conectados y suelta uno de cada uno por vuelta,
 * así que dos oficinas con cola avanzan a la vez sin que una espere a la otra.
 */
export async function runSender(): Promise<never> {
  for (;;) {
    let sentAnything = false;

    try {
      for (const connection of await listConnections()) {
        if (connection.status !== 'connected') continue;
        sentAnything = (await drainOne(connection)) || sentAnything;
      }
    } catch (error) {
      console.error(`[wa] el repartidor tropezó: ${String(error)}`);
    }

    // Con la cola vacía no se consulta cada segundo.
    if (!sentAnything) await sleep(HALF_MINUTE);
  }
}
