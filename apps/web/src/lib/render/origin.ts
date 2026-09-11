/**
 * A qué dirección puede navegar Chromium para hacer la foto.
 *
 * Es UN origen interno, fijo, y no sale nunca de la petición. Antes se
 * construía con `new URL('/render/…', request.url)`, y `request.url` lo arma
 * Next con la cabecera `Host` — que la escribe quien llama. Detrás del proxy es
 * la de verdad; llegando directo al puerto de Node, es la que a uno le apetezca.
 *
 * El agujero no era teórico: bastaba una petición con `Host: atacante.example`
 * para que ESTE servidor abriera un navegador contra esa dirección, y el
 * resultado se guardaba en la tabla `Render` y se servía desde nuestro dominio
 * como si fuera la invitación. Con la máquina en una nube, el mismo truco llega
 * al servicio de metadatos y a cualquier panel interno que escuche en la red
 * privada.
 *
 * Así que el origen se declara: `RENDER_ORIGIN` si está puesto, y si no el
 * bucle local con el puerto en el que este proceso escucha. Nada más se acepta.
 */

const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];

/** El puerto en el que escucha este proceso. */
function listeningPort(): string {
  const port = process.env['PORT'];
  return port !== undefined && /^\d+$/.test(port) ? port : '3000';
}

/**
 * El origen interno. Solo `http://` al bucle local, o lo que declare
 * `RENDER_ORIGIN` en el ENTORNO — nunca el panel: quien puede editar un ajuste
 * no puede por eso decidir a qué se conecta el servidor.
 */
export function renderOrigin(): string {
  const declared = process.env['RENDER_ORIGIN'];
  if (declared !== undefined && declared.length > 0) {
    const url = new URL(declared);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('RENDER_ORIGIN tiene que ser http o https.');
    }
    return url.origin;
  }
  // `http` y no `https`: Node escucha en claro y el TLS lo pone el proxy. Pedir
  // `https://127.0.0.1:3000` da ERR_SSL_PROTOCOL_ERROR y cada invitación sin
  // caché responde 500 — ya pasó.
  return `http://127.0.0.1:${listeningPort()}`;
}

/** La dirección del lienzo de captura de una invitación. */
export function captureUrl(slug: string): string {
  return new URL(`/render/${encodeURIComponent(slug)}`, renderOrigin()).toString();
}

/**
 * Si Chromium puede pedir esta dirección.
 *
 * Se permite lo que cuelga del origen interno —la página, sus fuentes, su CSS—
 * y nada más. No es una lista de destinos prohibidos sino de permitidos: una
 * lista de prohibidos se salta con una redirección, con un nombre que resuelve
 * a una IP privada, o con cualquier cosa que aún no esté en ella.
 */
export function allowedForCapture(target: string, origin = renderOrigin()): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.origin === new URL(origin).origin;
}

/** Para las pruebas: qué se considera bucle local. */
export const LOOPBACK_HOSTS = LOOPBACK;
