export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /healthz — ¿está vivo este proceso?
 *
 * No mira la base ni ninguna otra cosa a propósito: si respondiera 503 porque
 * PostgreSQL está caído, un orquestador reiniciaría la aplicación en bucle
 * mientras el problema está en otro sitio. Eso es lo que responde `/readyz`.
 *
 * Sin sesión y sin datos: lo consulta un proxy, no una persona.
 */
export function GET(): Response {
  return new Response('ok', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
