import { NextResponse, type NextRequest } from 'next/server';

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

  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything a person reads. Static assets and the API carry no document.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|api/).*)'],
};
