'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { clientIp } from '@/lib/admin/context';
import { guestCookieName } from '@/lib/rsvp/cookie';
import { submitRsvp } from '@/lib/rsvp/service';

const SLUG_SHAPE = /^[a-z0-9-]{1,80}$/i;

/**
 * Records a guest's reply. This is a public endpoint by design — the invitation
 * link gets forwarded around WhatsApp — so nothing here trusts the request
 * beyond the slug, and the service re-reads the event from it.
 */
export async function submitRsvpAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '');
  // Guards the redirect below as much as the lookup.
  if (!SLUG_SHAPE.test(slug)) redirect('/');

  const store = await cookies();
  const requestHeaders = await headers();
  const knownToken = store.get(guestCookieName(slug))?.value;

  const result = await submitRsvp({
    slug,
    name: String(formData.get('name') ?? ''),
    status: String(formData.get('status') ?? ''),
    party: String(formData.get('party') ?? '1'),
    message: String(formData.get('message') ?? ''),
    token: knownToken,
    ip: clientIp(requestHeaders),
  });

  if (result.outcome === 'ok' && result.guestToken !== undefined) {
    // Lets the same guest come back and change their answer, with no account.
    store.set(guestCookieName(slug), result.guestToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: `/i/${slug}`,
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  redirect(`/i/${slug}?r=${result.outcome}`);
}
