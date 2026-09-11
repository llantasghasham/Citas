import { getPrisma } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /readyz — ¿puede este proceso ATENDER?
 *
 * Vivo y listo no son lo mismo, y confundirlos cuesta caro en las dos
 * direcciones: un proxy que quite de rotación un proceso sano porque la base
 * tarda deja el sitio sin servidores, y uno que mande tráfico a un proceso que
 * no puede leer nada devuelve errores a los invitados.
 *
 * Aquí solo se comprueba lo que hace falta para responder una invitación: que la
 * base contesta. Ni el correo ni la pasarela ni WhatsApp — un fallo de cualquiera
 * de esos no hace que esta página deje de poder servirse, y esas comprobaciones
 * ya están, con su detalle, en `/panel/sistema`.
 *
 * Sin datos en la respuesta: la consulta un proxy, y decirle a cualquiera qué
 * versión de qué corre aquí no le hace falta a nadie de fuera.
 */
const TIMEOUT_MS = 2000;

export async function GET(): Promise<Response> {
  const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

  if (process.env['DATA_SOURCE'] !== 'database') {
    // Sin base de datos configurada, lo que se sirve son los ejemplos del
    // archivo: eso está listo por definición.
    return new Response('ok', { status: 200, headers });
  }

  try {
    // Con tope: una base que acepta la conexión y no contesta dejaría esta
    // comprobación colgada, y un proxy esperando es un proxy que no decide.
    await Promise.race([
      getPrisma().$queryRawUnsafe('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    return new Response('ok', { status: 200, headers });
  } catch {
    return new Response('database', { status: 503, headers });
  }
}
