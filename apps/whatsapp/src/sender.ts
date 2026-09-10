import { randomBytes } from 'node:crypto';

import {
  claimNext,
  listConnections,
  markFailed,
  markSent,
  reclaimExpired,
  readTunables,
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

/**
 * Quién es este proceso. Se genera al arrancar y viaja en cada reclamo: es lo
 * que permite decir «esta fila es mía» y, sobre todo, «ya no lo es».
 */
const WORKER = `${process.pid}-${randomBytes(4).toString('hex')}`;

/**
 * La fecha de hoy para el contador diario, en UTC y a propósito.
 *
 * No es la zona de la oficina, y conviene que se sepa: una oficina en Beirut ve
 * el contador reiniciarse a las tres de la madrugada. La alternativa —un día
 * por oficina— haría que el mismo número compartido entre dos zonas tuviera dos
 * medianoches, que es peor. Un solo reloj, dicho.
 */
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

  if (!isUp(connection.id)) return false;

  // Reclamar la fila y reservar el cupo, juntos y en una transacción. Antes se
  // miraba el contador aquí, en memoria, y se incrementaba después del envío:
  // dos repartidores leían «van 199 de 200» y los dos mandaban.
  const message = await claimNext(connection.id, WORKER, day, capFor(connection, tunables.warmupCap));
  if (message === undefined) return false;

  const socket = socketFor(connection.id);
  if (socket === undefined) {
    await markFailed(message.id, WORKER, connection.id, day, 'La sesión se cerró antes de enviar.');
    return false;
  }

  try {
    // Comprobar que el número existe en WhatsApp antes de escribirle: mandar a
    // números muertos, uno detrás de otro, es otra de las señales que llevan a
    // un bloqueo.
    const found = (await socket.onWhatsApp(toJid(message.toPhone))) ?? [];
    const exists = found[0];
    if (exists?.exists !== true) {
      await markFailed(message.id, WORKER, connection.id, day, 'Ese número no tiene WhatsApp.');
      return true;
    }

    const sent = await socket.sendMessage(exists.jid, { text: message.body });
    // El identificador de WhatsApp, cuando lo da: es el único asa para
    // averiguar después si un mensaje dudoso llegó de verdad.
    const wrote = await markSent(message.id, WORKER, sent?.key?.id ?? null);
    if (!wrote) {
      // El arriendo venció mientras se enviaba y otro proceso ya dio la fila
      // por dudosa. No se pisa: esa duda es información.
      console.warn(`[wa] ${connection.name}: se envió con el arriendo vencido (${message.id})`);
    }
    console.log(`[wa] ${connection.name}: enviado a ${message.toPhone}`);
  } catch (error) {
    await markFailed(
      message.id,
      WORKER,
      connection.id,
      day,
      error instanceof Error ? error.message : String(error),
    );
    console.error(`[wa] ${connection.name}: falló un envío: ${String(error)}`);
  }

  // El retardo va DESPUÉS del envío y es al azar dentro de la horquilla.
  const { delayMin, delayMax } = tunables;
  const seconds = delayMin + Math.random() * Math.max(0, delayMax - delayMin);
  await sleep(seconds * 1000);

  return true;
}

/**
 * Que pare, y que se sepa CUÁNDO ha parado.
 *
 * Un apagado que mata el proceso a mitad de un envío deja la fila reclamada y
 * el mensaje en el aire: recuperable —para eso está el arriendo— pero dudoso.
 * Esperar a que termine el que está en curso convierte casi todos los apagados
 * en limpios.
 */
let stopping = false;
let idle: (() => void) | null = null;

export function stopSender(): Promise<void> {
  stopping = true;
  return new Promise((resolve) => {
    idle = resolve;
  });
}

/**
 * El bucle. Recorre los números conectados y suelta uno de cada uno por vuelta,
 * así que dos oficinas con cola avanzan a la vez sin que una espere a la otra.
 */
export async function runSender(): Promise<void> {
  for (;;) {
    if (stopping) {
      idle?.();
      return;
    }

    let sentAnything = false;

    try {
      // Las filas que alguien cogió y nunca soltó, antes de nada: son de un
      // proceso muerto, y hasta que se recuperan nadie sabe qué pasó con ellas.
      const rescued = await reclaimExpired();
      if (rescued > 0) console.warn(`[wa] ${rescued} envío(s) quedaron en duda tras un corte`);

      for (const connection of await listConnections()) {
        if (connection.status !== 'connected') continue;
        sentAnything = (await drainOne(connection)) || sentAnything;
      }
    } catch (error) {
      console.error(`[wa] el repartidor tropezó: ${String(error)}`);
    }

    // Con la cola vacía no se consulta cada segundo. Se trocea el descanso
    // para que un apagado no tenga que esperar medio minuto a que despierte.
    if (!sentAnything) {
      for (let waited = 0; waited < HALF_MINUTE && !stopping; waited += 1000) {
        await sleep(1000);
      }
    }
  }
}
