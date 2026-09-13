import { canonicalOriginOrNull } from '@/lib/admin/context';
import { approvedSlugs } from '@/lib/directory/public';
import { DIRECTORY_LOCALES, isDirectoryLocale } from '@citas/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ locale: string }>;
}

/** Lo que hay que escapar en un XML. Cuatro caracteres, y los cuatro importan. */
function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * El mapa del sitio de un idioma.
 *
 * Sale de la BASE y no de una lista escrita a mano, y lleva `status: approved`
 * dentro —lo pone `approvedSlugs`— así que un negocio en revisión, rechazado o
 * suspendido no aparece aquí tampoco. Es el mismo filtro que el listado: si
 * viviera en cada sitio, este sería el sitio donde un día falta, y entonces un
 * buscador tendría la lista de lo que todavía no se ha publicado.
 *
 * Cada dirección lleva sus alternativas en los cinco idiomas, que es lo que
 * evita que un buscador tome cinco páginas por cinco contenidos distintos.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { locale } = await context.params;
  if (!isDirectoryLocale(locale)) return new Response(null, { status: 404 });

  const origin = await canonicalOriginOrNull(request.headers);
  if (origin === null) return new Response(null, { status: 404 });

  const providers = await approvedSlugs();

  const alternativas = (ruta: string): string =>
    DIRECTORY_LOCALES.map(
      (one) =>
        `    <xhtml:link rel="alternate" hreflang="${one}" href="${xml(`${origin}/d/${one}${ruta}`)}"/>`,
    ).join('\n');

  const entrada = (ruta: string, lastmod: Date | null): string =>
    [
      '  <url>',
      `    <loc>${xml(`${origin}/d/${locale}${ruta}`)}</loc>`,
      ...(lastmod === null ? [] : [`    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>`]),
      alternativas(ruta),
      '  </url>',
    ].join('\n');

  const cuerpo = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    entrada('', null),
    entrada('/proveedores', null),
    ...providers.map((one) => entrada(`/p/${one.slug}`, one.updatedAt)),
    '</urlset>',
  ].join('\n');

  return new Response(cuerpo, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
