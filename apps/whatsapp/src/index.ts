import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { readConfig } from './config.js';
import { getConnection, getPool, listConnections } from './db.js';
import { runSender, stopSender } from './sender.js';
import { closeAllSockets, isUp, logoutSession, resumeAll, startSession } from './sessions.js';

/**
 * La puerta de servicio del WhatsApp.
 *
 * Habla SOLO con la web, y solo por la red interna: este proceso no debe estar
 * publicado. Aun así pide un token en cada petición y lo compara en tiempo
 * constante, porque «está detrás del cortafuegos» es una frase que envejece mal
 * y lo que hay detrás es el WhatsApp de un cliente.
 *
 * Lo que NO hace: mandar mensajes directamente. La web encola filas y este
 * proceso las va soltando con su freno. Un extremo que manda al momento es un
 * extremo con el que se puede vaciar el cupo de un número en un bucle.
 */
const config = readConfig();
const expected = Buffer.from(config.token);

function authorized(request: IncomingMessage): boolean {
  const header = request.headers['authorization'] ?? '';
  const given = Buffer.from(String(header).replace(/^Bearer\s+/i, ''));
  // Longitudes distintas: `timingSafeEqual` revienta, así que se corta antes.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  void (async () => {
    if (!authorized(request)) {
      json(response, 401, { error: 'unauthorized' });
      return;
    }

    const url = new URL(request.url ?? '/', 'http://internal');
    const parts = url.pathname.split('/').filter((part) => part.length > 0);

    try {
      // GET /health — para /panel/sistema, sin tocar ninguna sesión.
      if (request.method === 'GET' && parts[0] === 'health') {
        const rows = await listConnections();
        json(response, 200, {
          ok: true,
          total: rows.length,
          up: rows.filter((row) => isUp(row.id)).length,
        });
        return;
      }

      // POST /connections/<id>/start — abre la sesión y pide el QR si hace falta
      if (request.method === 'POST' && parts[0] === 'connections' && parts[2] === 'start') {
        const id = parts[1] ?? '';
        if ((await getConnection(id)) === undefined) {
          json(response, 404, { error: 'not_found' });
          return;
        }
        try {
          await startSession(id);
        } catch (error) {
          // El motivo viaja hasta la pantalla: «no pasó nada» es la peor
          // respuesta posible cuando alguien acaba de pulsar un botón.
          json(response, 502, {
            error: 'gateway',
            reason: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        json(response, 200, { started: true });
        return;
      }

      // POST /connections/<id>/logout
      if (request.method === 'POST' && parts[0] === 'connections' && parts[2] === 'logout') {
        await logoutSession(parts[1] ?? '');
        json(response, 200, { loggedOut: true });
        return;
      }

      json(response, 404, { error: 'unknown_route' });
    } catch (error) {
      console.error(`[wa] ${request.method} ${url.pathname}: ${String(error)}`);
      json(response, 500, { error: 'internal' });
    }
  })();
});

server.listen(config.port, '127.0.0.1', () => {
  // Atado a la interfaz local a propósito: se llega por el proxy de la máquina,
  // no desde fuera.
  console.log(`[wa] escuchando en 127.0.0.1:${config.port}`);
  void (async () => {
    await resumeAll(await listConnections());
    await runSender();
  })();
});

/**
 * Apagarse sin dejar nada a medias.
 *
 * Era `process.exit(0)` en la misma línea que `server.close()`: se mataba el
 * proceso con el envío en curso todavía en el aire y, peor, con la escritura de
 * las credenciales de Baileys posiblemente a medio hacer — y esas credenciales
 * son el secreto más caro del proyecto.
 *
 * Ahora, en orden: se deja de repartir, se espera al envío en curso, se cierran
 * los sockets, se deja de escuchar y se suelta la base. Con un tope de diez
 * segundos, porque un apagado que no termina es un servidor que hay que matar a
 * mano y ahí no se ha ganado nada.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[wa] ${signal}: cerrando con orden`);

  const forced = setTimeout(() => {
    console.warn('[wa] el cierre tardó demasiado; se corta');
    process.exit(1);
  }, 10_000);
  // Que este temporizador no sea lo único que mantenga vivo el proceso.
  forced.unref();

  try {
    await stopSender();
    closeAllSockets();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await getPool().end();
    console.log('[wa] cerrado');
  } catch (error) {
    console.error(`[wa] al cerrar: ${String(error)}`);
  }
  clearTimeout(forced);
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
