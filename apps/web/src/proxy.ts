import { NextResponse, type NextRequest } from 'next/server';

import { guestCookieName } from '@/lib/rsvp/cookie';

/**
 * Runs before every document request. Named `proxy` because Next 16 deprecated
 * `middleware`; the runtime is Node, and it cannot be configured.
 *
 * Tells the root layout which page is being served and, when the language can
 * be known from the request alone, which language that is.
 *
 * `<html lang>` and `<html dir>` live in the root layout, which never sees a
 * page's params or search params. Without this the whole site would keep
 * declaring itself English and left-to-right — including an Arabic invitation,
 * which is wrong for a screen reader and wrong for a search engine.
 *
 * Only what the request itself carries is resolved here. Anything that needs
 * the database — whose invitation this is, which office a session belongs to —
 * is finished in the layout, where a query is allowed.
 */
export const PATH_HEADER = 'x-citas-pathname';
export const LANG_HINT_HEADER = 'x-citas-lang-hint';

export function proxy(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);

  // Deleted before anything is written. These two names are invented here and
  // must only ever mean what this function decided: a visitor who sends one
  // himself would otherwise be choosing the document's language, and the same
  // pattern with a header that carried more weight is how trusted-header bugs
  // get in. `x-forwarded-host` is trusted in this codebase precisely because a
  // proxy sets it and the origin is not reachable around that proxy; nothing
  // sets these but this line.
  headers.delete(PATH_HEADER);
  headers.delete(LANG_HINT_HEADER);

  headers.set(PATH_HEADER, request.nextUrl.pathname);

  const requested = request.nextUrl.searchParams.get('lang');
  if (requested !== null && requested.length > 0) headers.set(LANG_HINT_HEADER, requested);

  const response = NextResponse.next({ request: { headers } });
  cacheInvitation(request, response);
  return response;
}

/**
 * QUE LA INVITACIÓN SIGA VIVA AUNQUE ESTO NO LO ESTÉ.
 *
 * Una boda ocurre una vez. Si la invitación no abre la tarde que se manda el
 * WhatsApp, no hay disculpa que lo arregle — y el patrón real no es tráfico
 * constante: son trescientas aperturas en dos horas, todas en el minuto
 * siguiente a que alguien reenvíe el enlace al grupo de la familia.
 *
 * Para casi todas esas trescientas, la página es LA MISMA: llegan por un
 * reenvío, sin enlace personal y sin cookie. Eso es lo que se puede guardar
 * fuera —en nginx, en un CDN— y lo que hace que el sitio siga sirviendo la
 * invitación aunque la aplicación se haya caído: `stale-if-error`.
 *
 * QUIEN TRAE COOKIE NO SE GUARDA, y por eso esto mira la cookie en vez de poner
 * una cabecera fija. Esa persona ya contestó, y su página la saluda por su
 * nombre y le enseña su mesa: guardarla sería servírsela al siguiente. `private,
 * no-store`, como la foto de perfil y por lo mismo.
 *
 * NO SE PUEDE PONER `Vary: cookie` DESDE AQUÍ, y queda escrito para que nadie
 * lo vuelva a intentar: Next REESCRIBE esa cabecera con la suya —`rsc`,
 * `next-router-*`, `Accept-Encoding`— y se lleva por delante lo que ponga el
 * proxy Y lo que ponga `headers()` en `next.config.mjs`. Comprobado contra el
 * servidor compilado, las dos formas.
 *
 * Así que quien tiene que distinguir es la caché de delante, y hay que
 * configurarla: nginx no guarda nada cuando viene la cookie del invitado. El
 * trozo exacto está en `docs/DESPLIEGUE-VPS.md`. Da igual de todos modos para
 * un CDN como Cloudflare, que ignora `Vary` salvo `accept-encoding`: allí la
 * regla hay que escribirla igualmente.
 *
 * El minuto de `s-maxage` es corto a propósito: corregir una invitación y que
 * siga saliendo la anterior durante una hora es peor que consultar de más. Lo
 * que dura de verdad es `stale-if-error`: un día entero sirviendo la última
 * copia buena si el origen deja de contestar.
 */
function cacheInvitation(request: NextRequest, response: NextResponse): void {
  const path = request.nextUrl.pathname;
  if (!path.startsWith('/i/')) return;

  const slug = path.slice('/i/'.length).split('/')[0] ?? '';
  if (slug.length === 0) return;

  const personal = request.cookies.get(guestCookieName(slug)) !== undefined;

  response.headers.set(
    'cache-control',
    personal
      ? 'private, no-store'
      : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400',
  );
}

export const config = {
  // Everything a person reads. Static assets and the API carry no document.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|api/).*)'],
};
