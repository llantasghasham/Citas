import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { readConfig } from './config.js';
import { getConnection, getPool, listConnections } from './db.js';
import { runSender } from './sender.js';
import { isUp, logoutSession, resumeAll, startSession } from './sessions.js';

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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[wa] ${signal}: cerrando`);
    server.close();
    void getPool().end();
    process.exit(0);
  });
}
