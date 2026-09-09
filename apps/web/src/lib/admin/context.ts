import { headers } from 'next/headers';

import { getSession } from '@/lib/auth/session';
import { getDictionary } from '@/lib/dictionary';
import { getTenantById, getTenantByHost, type CurrentTenant } from '@/lib/tenancy/current';
import { LOCALES, type Dictionary, type Direction, type Locale } from '@/lib/types';

export interface AdminContext {
  locale: Locale;
  direction: Direction;
  dictionary: Dictionary;
  tenant: CurrentTenant | null;
  host: string;
  ip: string | null;
}

function asLocale(value: string | undefined): Locale {
  return LOCALES.find((candidate) => candidate === value) ?? 'es';
}

/**
 * The host the visitor actually asked for.
 *
 * `host` alone is not reliable: on the requests a Server Action triggers, Next
 * rewrites it to the bare origin and only `x-forwarded-host` still carries the
 * office's subdomain. This header is trusted, which means the origin server must
 * only be reachable through the proxy that sets it — never exposed directly.
 */
export function requestHost(requestHeaders: Headers): string {
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? '';
}

/** First hop in the forwarding chain, which is the client we can name. */
export function clientIp(requestHeaders: Headers): string | null {
  const forwarded = requestHeaders.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() ?? null;
}

/**
 * Staff screens speak the reader's language, falling back to the office's: an
 * office in Beirut sees its panel in Arabic, right to left, exactly like the
 * invitations it produces, and anyone who prefers another language switches it
 * for themselves without changing it for everybody.
 *
 * Once someone is signed in, the office comes from their session and not from
 * the host — an office is part of who you are, and must not change because a
 * header changed. The host only decides which office's sign-in page you land on.
 */
export async function getAdminContext(
  sessionTenantId?: string | null,
  readerLocale?: Locale,
): Promise<AdminContext> {
  const requestHeaders = await headers();
  const host = requestHost(requestHeaders);
  const tenant =
    sessionTenantId === undefined || sessionTenantId === null
      ? await getTenantByHost(host)
      : await getTenantById(sessionTenantId);
  // The person's own choice wins over the office's default. Two colleagues at
  // the same desk can read the panel in different languages, which in Beirut is
  // the normal case and not an edge one.
  //
  // Read from the session here rather than taken from each caller: seven panel
  // pages ask for this context, and one of them forgetting to pass it is a page
  // whose chrome is in Arabic and whose body is in Spanish. `getSession` is
  // cached per request, so asking costs nothing.
  const reader = readerLocale ?? (await getSession())?.locale;
  const locale = reader ?? asLocale(tenant?.defaultLocale);

  return {
    locale,
    direction: locale === 'ar' ? 'rtl' : 'ltr',
    dictionary: getDictionary(locale),
    tenant,
    host,
    ip: clientIp(requestHeaders),
  };
}
