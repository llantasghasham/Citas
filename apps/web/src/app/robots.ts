import { headers } from 'next/headers';
import type { MetadataRoute } from 'next';

import { canonicalOriginOrNull } from '@/lib/admin/context';

/**
 * Qué puede recorrer un buscador.
 *
 * La lista es de PROHIBIDOS y no de permitidos porque lo público de este sitio
 * es casi todo: la portada y el directorio. Lo que se cierra es lo que no tiene
 * sentido indexar o directamente no debe salir:
 *
 *   · `/panel`, `/crear` y `/entrar` — el trabajo de dentro.
 *   · `/g/` — el enlace PERSONAL de un invitado. Que un buscador lo recorriera
 *     marcaría `openedAt` de gente que no ha abierto nada, y el enlace de una
 *     boda acabaría en un índice.
 *   · `/pagar/` — el enlace de cobro de una pareja. Por lo mismo, y peor.
 *   · `/i/` NO está: la invitación es una página pública que se comparte. Lo que
 *     no se indexa de ahí son los ejemplos, que ya llevan su propio `noindex`.
 *   · `/api/` y `/render/` — no son documentos.
 *
 * Es DINÁMICO a propósito: la dirección del mapa del sitio sale de
 * `canonicalOrigin()`, que manda lo configurado en el panel y no la cabecera de
 * quien pregunta. Un `sitemap` apuntando a un dominio ajeno es regalarle a otro
 * el rastreo de este.
 */
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await canonicalOriginOrNull(await headers());

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/panel', '/crear', '/entrar', '/g/', '/pagar/', '/api/', '/render/'],
      },
    ],
    // Sin dirección configurada no se escribe el enlace, en vez de escribirlo
    // mal: la misma regla que el `.ics` y que los enlaces de pago.
    ...(origin === null ? {} : { sitemap: `${origin}/d/sitemap.xml` }),
  };
}
