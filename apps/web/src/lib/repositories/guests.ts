import { randomBytes } from 'node:crypto';

import type { Locale } from '@citas/core';

import { getPrisma } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import type { ImportedGuest } from '@/lib/guests/import';
import { versionForLocale, type EventVersion } from '@/lib/repositories/versions';
import type { RsvpStatus } from '@/generated/prisma/enums';

export interface GuestWithLink {
  id: string;
  name: string;
  phone: string | null;
  locale: Locale;
  token: string;
  openedAt: Date | null;
  status: RsvpStatus | null;
  party: number | null;
  /**
   * The invitation this guest actually opens. `locale` is the version's, not
   * the guest's: when it differs, nobody wrote their language and they are
   * being sent the original.
   */
  version: EventVersion | null;
}

export interface EventGuests {
  eventId: string;
  title: string;
  /** Every language this event was written in, the original first. */
  versions: EventVersion[];
  guests: GuestWithLink[];
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Adds a client's list to an event.
 *
 * Somebody re-pasting the same spreadsheet is the normal case, not the
 * exception, so a guest already on the list is left alone rather than
 * duplicated: matched by phone number when there is one, by name when there
 * is not.
 */
export async function importGuests(
  scope: TenantScope,
  eventId: string,
  incoming: ImportedGuest[],
): Promise<{ added: number } | null> {
  const prisma = getPrisma();
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  if (event === null) return null;

  const existing = await prisma.guest.findMany({
    where: { eventId },
    select: { name: true, phone: true },
  });
  const knownPhones = new Set(existing.map((guest) => guest.phone).filter((phone) => phone !== null));
  const knownNames = new Set(existing.map((guest) => guest.name));

  const fresh = incoming.filter((guest) => {
    if (guest.phone !== null) return !knownPhones.has(guest.phone);
    return !knownNames.has(guest.name);
  });

  if (fresh.length === 0) return { added: 0 };

  await prisma.guest.createMany({
    data: fresh.map((guest) => ({
      eventId,
      name: guest.name,
      phone: guest.phone,
      locale: guest.locale,
      token: newToken(),
      invitedAt: new Date(),
    })),
  });

  return { added: fresh.length };
}

export async function listGuestsWithLinks(
  scope: TenantScope,
  eventId: string,
): Promise<EventGuests | null> {
  const event = await getPrisma().event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    include: {
      honorees: { orderBy: { order: 'asc' }, select: { name: true } },
      versions: { orderBy: { createdAt: 'asc' }, select: { slug: true, locale: true } },
      guests: { orderBy: { createdAt: 'asc' }, include: { rsvp: true } },
    },
  });
  if (event === null) return null;

  return {
    eventId: event.id,
    title: event.honorees.map((honoree) => honoree.name).join(' · '),
    versions: event.versions,
    guests: event.guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      phone: guest.phone,
      locale: guest.locale,
      token: guest.token,
      openedAt: guest.openedAt,
      status: guest.rsvp?.status ?? null,
      party: guest.rsvp?.party ?? null,
      // Resolved with the same rule /g/[token] applies, so what the office is
      // shown here is what the guest will really open.
      version: versionForLocale(event.versions, guest.locale) ?? null,
    })),
  };
}
