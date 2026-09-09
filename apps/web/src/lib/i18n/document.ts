import { cookies, headers } from 'next/headers';

import { getAdminContext } from '@/lib/admin/context';
import { getSession } from '@/lib/auth/session';
import { DRAFT_COOKIE } from '@/lib/create/cookie';
import { parseDraft } from '@/lib/create/draft';
import { resolveHomeLocale } from '@/lib/home/locale';
import { LANG_HINT_HEADER, PATH_HEADER } from '@/proxy';
import { loadInvitation } from '@/lib/repositories';
import type { Direction, Locale } from '@/lib/types';

export interface DocumentLanguage {
  locale: Locale;
  direction: Direction;
}

/**
 * The language of the page being served, for `<html lang>` and `<html dir>`.
 *
 * The root layout owns those two attributes and never sees a page's params, so
 * it is resolved here from the path the middleware wrote down, plus the same
 * cached lookups the pages themselves use — asking twice costs one query.
 *
 * Every branch fails soft: a wrong `lang` is a bad day for a screen reader, but
 * a shell that throws is a blank page for everyone.
 */
export async function documentLanguage(): Promise<DocumentLanguage> {
  const locale = await resolveLocale();
  return { locale, direction: locale === 'ar' ? 'rtl' : 'ltr' };
}

async function resolveLocale(): Promise<Locale> {
  const requestHeaders = await headers();
  const path = requestHeaders.get(PATH_HEADER) ?? '';

  try {
    // The invitation itself decides: it is the page guests actually open, and
    // the one most often in Arabic.
    const slug = slugAfter(path, '/i/') ?? slugAfter(path, '/render/');
    if (slug !== null) {
      const invitation = await loadInvitation(slug);
      if (invitation !== undefined) return invitation.locale;
    }

    // Staff screens speak the office's language, which comes from the session
    // once someone is signed in and from the host before that.
    if (path === '/panel' || path.startsWith('/panel/') || path.startsWith('/entrar')) {
      const session = await getSession();
      // The reader's own choice, exactly as the panel layout resolves it, or
      // the office's default before anyone has signed in.
      const context = await getAdminContext(session?.tenantId, session?.locale);
      return context.locale;
    }

    // The creation form is written in the language of the invitation being made.
    if (path.startsWith('/crear')) {
      const store = await cookies();
      return parseDraft(store.get(DRAFT_COOKIE)?.value).locale;
    }
  } catch {
    // Fall through to what the request itself says.
  }

  return resolveHomeLocale(
    requestHeaders.get(LANG_HINT_HEADER) ?? undefined,
    requestHeaders.get('accept-language') ?? '',
  );
}

/** The one path segment after `prefix`, or null when the path is not one. */
function slugAfter(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length).split('/')[0] ?? '';
  return rest.length === 0 ? null : decodeURIComponent(rest);
}
