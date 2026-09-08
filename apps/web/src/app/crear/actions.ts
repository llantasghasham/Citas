'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSession, sessionCan } from '@/lib/auth/session';
import { DRAFT_COOKIE } from '@/lib/create/cookie';
import {
  MAX_HONOREES,
  MAX_HOSTS,
  parseDraft,
  serializeDraft,
  type InvitationDraft,
} from '@/lib/create/draft';
import { publishDraft } from '@/lib/create/publish';

const TOTAL_STEPS = 5;

async function readDraft(): Promise<InvitationDraft> {
  const store = await cookies();
  return parseDraft(store.get(DRAFT_COOKIE)?.value);
}

async function writeDraft(draft: InvitationDraft): Promise<void> {
  const store = await cookies();
  store.set(DRAFT_COOKIE, serializeDraft(draft), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/crear',
    maxAge: 60 * 60 * 24 * 7,
  });
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '');
}

/** Merges one step's answers into the draft and moves on. */
export async function saveStepAction(formData: FormData): Promise<void> {
  const draft = await readDraft();
  const step = Number.parseInt(field(formData, 'step'), 10);
  const direction = field(formData, 'direction') === 'back' ? -1 : 1;

  const merged: Record<string, unknown> = { ...draft };

  if (step === 1) {
    merged['locale'] = field(formData, 'locale');
    merged['eventType'] = field(formData, 'eventType');
    // Eastern numerals are the sensible default for Arabic and wrong elsewhere.
    merged['numeralSystem'] = field(formData, 'locale') === 'ar' ? 'arabic' : 'latin';
  }

  if (step === 2) {
    merged['honorees'] = Array.from({ length: MAX_HONOREES }, (_, index) =>
      field(formData, `honoree${index}`),
    );
    merged['hosts'] = Array.from({ length: MAX_HOSTS }, (_, index) => ({
      name: field(formData, `hostName${index}`),
      role: field(formData, `hostRole${index}`),
    }));
  }

  if (step === 3) {
    merged['date'] = field(formData, 'date');
    merged['time'] = field(formData, 'time');
    merged['timeZone'] = field(formData, 'timeZone');
    merged['venueName'] = field(formData, 'venueName');
    merged['venueAddress'] = field(formData, 'venueAddress');
    merged['mapUrl'] = field(formData, 'mapUrl');
  }

  if (step === 4) {
    merged['message'] = field(formData, 'message');
    merged['quoteId'] = field(formData, 'quoteId');
    merged['numeralSystem'] = field(formData, 'numeralSystem');
    merged['rsvpEnabled'] = formData.get('rsvpEnabled') === 'on';
    merged['rsvpDeadline'] = field(formData, 'rsvpDeadline');
  }

  await writeDraft(parseDraft(JSON.stringify(merged)));

  const next = Math.min(Math.max(step + direction, 1), TOTAL_STEPS);
  redirect(`/crear?step=${next}`);
}

/** Publishing needs a session: an open door here would mint pages for anyone. */
export async function publishDraftAction(): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write')) {
    redirect('/entrar');
  }

  const result = await publishDraft(await readDraft(), session);
  if (!result.ok) redirect('/crear?step=5&error=1');

  const store = await cookies();
  store.delete({ name: DRAFT_COOKIE, path: '/crear' });
  redirect(`/crear?published=${result.slug}`);
}

export async function resetDraftAction(): Promise<void> {
  const store = await cookies();
  store.delete({ name: DRAFT_COOKIE, path: '/crear' });
  redirect('/crear?step=1');
}
