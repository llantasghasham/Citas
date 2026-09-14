import { canonicalOriginOrNull } from '@/lib/admin/context';
import { DIRECTORY_LOCALES } from '@citas/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El índice de mapas del sitio: uno por idioma.
 *
 * Cuatro idiomas en un solo archivo obligaría a un buscador a leerlo entero
 * para encontrar lo suyo, y con mil fichas son cuatro mil direcciones. Partido
 * por idioma, cada uno lee el que le toca.
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
      // SIN caché, y la razón por la que la tuvo una hora no valía aquí: esto
      // son cuatro cadenas salidas de una lista fija, ni una consulta. Lo que
      // la hora ahorraba era nada y lo que costaba fue esto — al quitar el
      // francés, el proxy siguió sirviendo el índice viejo durante una hora, y
      // tres despliegues seguidos se pusieron en rojo comprobando la CACHÉ en
      // vez del programa. Un buscador no necesita el minuto exacto, pero
      // tampoco necesita que se lo guarden.
      'cache-control': 'no-store',
    },
  });
}
