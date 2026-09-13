import { canonicalOriginOrNull } from '@/lib/admin/context';
import { DIRECTORY_LOCALES } from '@citas/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El índice de mapas del sitio: uno por idioma.
 *
 * Cinco idiomas en un solo archivo obligaría a un buscador a leerlo entero para
 * encontrar lo suyo, y con mil fichas son cinco mil direcciones. Partido por
 * idioma, cada uno lee el que le toca.
 *
 * Se escribe a mano y no con el ayudante de Next porque ese genera UN mapa, no
 * un índice.
 */
export async function GET(request: Request): Promise<Response> {
  const origin = await canonicalOriginOrNull(request.headers);
  // Sin dirección configurada no se inventa una: un mapa del sitio con enlaces a
  // otro dominio es peor que no tenerlo.
  if (origin === null) return new Response(null, { status: 404 });

  const cuerpo = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...DIRECTORY_LOCALES.map(
      (locale) => `  <sitemap><loc>${origin}/d/${locale}/sitemap.xml</loc></sitemap>`,
    ),
    '</sitemapindex>',
  ].join('\n');

  return new Response(cuerpo, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // Una hora: un buscador no necesita el minuto exacto en que se publicó una
      // ficha, y sin caché esto es una consulta por cada visita de un robot.
      'cache-control': 'public, max-age=3600',
    },
  });
}
