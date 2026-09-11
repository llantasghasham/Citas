import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { db } from '@/lib/db/client';
import { scopeForGuestToken } from '@/lib/db/directory';
import { versionForLocale } from '@/lib/repositories/versions';
import { guestCookieName } from '@/lib/rsvp/cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * GET /g/[token] — a guest's own way in.
 *
 * Short and impersonal on purpose: the link carries no name and no slug, so
 * forwarding it does not leak whose wedding it is. Opening it records that this
 * guest looked, remembers who they are, and sends them to the version of the
 * invitation in their own language.
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;

  // El directorio primero: dice de qué oficina es este enlace. El token sigue
  // sin adivinarse y sigue resolviendo a UN invitado, nunca a una lista.
  const scope = await scopeForGuestToken(token);
  if (scope === null) redirect('/');
  const prisma = db(scope);

  const guest = await prisma.guest.findUnique({
    where: { token },
    select: {
      id: true,
      locale: true,
      openedAt: true,
      event: {
        select: {
          // Oldest first: when this guest's language was never written, the
          // fallback has to be the language the invitation was created in, not
          // whichever row the database happened to return first.
          versions: { orderBy: { createdAt: 'asc' }, select: { slug: true, locale: true } },
        },
      },
    },
  });
  if (guest === null) redirect('/');

  const version = versionForLocale(guest.event.versions, guest.locale);
  if (version === undefined) redirect('/');

  if (guest.openedAt === null) {
    await prisma.guest
      .update({ where: { id: guest.id }, data: { openedAt: new Date() } })
      .catch(() => undefined);
  }

  const store = await cookies();
  store.set(guestCookieName(version.slug), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/i/${version.slug}`,
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect(`/i/${version.slug}`);
}
