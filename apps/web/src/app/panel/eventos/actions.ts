'use server';

import { redirect } from 'next/navigation';

import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';
import { parseGuestList } from '@/lib/guests/import';
import { COUNTRY_CODES } from '@/lib/guests/phone';
import { importGuests } from '@/lib/repositories/guests';
import { addEventVersion } from '@/lib/repositories/versions';
import { LOCALES, type Locale } from '@citas/core';

/** A client's list is not small: a wedding is two hundred lines, not five. */
const MAX_INPUT_BYTES = 512 * 1024;

export async function importGuestsAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }

  const eventId = String(formData.get('eventId') ?? '');
  const file = formData.get('file');
  const pasted = String(formData.get('list') ?? '');

  // A file wins over the box: someone who attached one meant to use it.
  const text = file instanceof File && file.size > 0 ? await file.text() : pasted;
  if (text.length === 0 || text.length > MAX_INPUT_BYTES) {
    redirect(`/panel/eventos/${eventId}?error=1`);
  }

  const country =
    COUNTRY_CODES.find((code) => code === String(formData.get('country'))) ?? '+961';
  const fallbackLocale =
    LOCALES.find((locale) => locale === String(formData.get('locale'))) ?? ('ar' as Locale);

  const { guests, skipped } = parseGuestList(text, country, fallbackLocale);
  const result = await importGuests(scopeOf(session), eventId, guests);
  if (result === null) redirect('/panel');

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'guests.import',
    entity: 'Event',
    entityId: eventId,
    metadata: { added: result.added, skipped },
  });

  redirect(`/panel/eventos/${eventId}?added=${result.added}&skipped=${skipped}`);
}

/**
 * Writes the event out in one more language.
 *
 * The office types it: nothing is machine-translated here, and the verse comes
 * from the same closed, human-verified list as everywhere else.
 */
export async function addVersionAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }

  const eventId = String(formData.get('eventId') ?? '');
  const locale = LOCALES.find((candidate) => candidate === String(formData.get('locale')));
  if (locale === undefined) redirect(`/panel/eventos/${eventId}?error=1`);

  const result = await addEventVersion(scopeOf(session), eventId, {
    locale,
    message: String(formData.get('message') ?? '').slice(0, 600),
    quoteId: String(formData.get('quoteId') ?? '').slice(0, 80),
  });
  if (!result.ok) {
    if (result.reason === 'notFound') redirect('/panel');
    redirect(`/panel/eventos/${eventId}?error=1`);
  }

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'event.version.add',
    entity: 'Event',
    entityId: eventId,
    metadata: { locale, slug: result.slug },
  });

  redirect(`/panel/eventos/${eventId}?version=${locale}`);
}
