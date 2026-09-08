import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getPrisma } from '@/lib/db/client';
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
  const prisma = getPrisma();

  const guest = await prisma.guest.findUnique({
    where: { token },
    select: {
      id: true,
      locale: true,
      openedAt: true,
      event: { select: { versions: { select: { slug: true, locale: true } } } },
    },
  });
  if (guest === null) redirect('/');

  const versions = guest.event.versions;
  const version = versions.find((entry) => entry.locale === guest.locale) ?? versions[0];
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
