import { randomBytes } from 'node:crypto';

import type { Locale } from '@citas/core';

import { guestAllowanceFor } from '@/lib/billing/packages';
import { db } from '@/lib/db/client';
import { registerGuestTokens } from '@/lib/db/directory';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import type { ImportedGuest } from '@/lib/guests/import';
import { versionForLocale, type EventVersion } from '@/lib/repositories/versions';
import type { AcquisitionChannel, RsvpStatus } from '@/generated/prisma/enums';

export interface GuestWithLink {
  id: string;
  name: string;
  phone: string | null;
  locale: Locale;
  token: string;
  openedAt: Date | null;
  status: RsvpStatus | null;
  party: number | null;
  /** La mesa en la que se sienta, cuando ya se ha repartido el salón. */
  table: string | null;
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
  /** De dónde vino el evento: decide el precio del paquete, no el formulario. */
  channel: AcquisitionChannel;
  /** Cuántos días antes se recuerda a quien no ha contestado. Nulo = nunca. */
  reminderDaysBefore: number | null;
  /** Every language this event was written in, the original first. */
  versions: EventVersion[];
  guests: GuestWithLink[];
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export type ImportOutcome =
  | { ok: true; added: number }
  | { ok: false; reason: 'notFound' }
  | { ok: false; reason: 'limit'; allowed: number; used: number; asked: number };

/**
 * Adds a client's list to an event.
 *
 * Somebody re-pasting the same spreadsheet is the normal case, not the
 * exception, so a guest already on the list is left alone rather than
 * duplicated: matched by phone number when there is one, by name when there
 * is not.
 *
 * The allowance is enforced HERE, on the server, at the moment guests are
 * written — the same rule the event limit follows. Until now `maxGuests` was
 * declared on all four plans and checked nowhere, so an office on the free
 * plan's fifty could import five thousand and a paid package meant nothing.
 * A package that does not refuse the guest after the last one is not a package.
 */
export async function importGuests(
  scope: TenantScope,
  eventId: string,
  incoming: ImportedGuest[],
): Promise<ImportOutcome> {
  const prisma = db(scope);
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  if (event === null) return { ok: false, reason: 'notFound' };

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

  if (fresh.length === 0) return { ok: true, added: 0 };

  // Comprobado contra los que YA hay, no contra los de esta importación: dos
  // pegadas de doscientos no pueden colarse por ser cada una menor del límite.
  const allowance = await guestAllowanceFor(scope, eventId);
  if (allowance.allowed !== null && allowance.used + fresh.length > allowance.allowed) {
    return {
      ok: false,
      reason: 'limit',
      allowed: allowance.allowed,
      used: allowance.used,
      asked: fresh.length,
    };
  }

  const rows = fresh.map((guest) => ({
    eventId,
    name: guest.name,
    phone: guest.phone,
    locale: guest.locale,
    token: newToken(),
    invitedAt: new Date(),
  }));

  // El directorio antes que los invitados, por lo mismo que con los slugs: un
  // token apuntado sin invitado detrás es un 404; un invitado sin token apuntado
  // tiene un enlace en el móvil que no lleva a ninguna parte.
  await registerGuestTokens(
    scope,
    rows.map((row) => row.token),
  );
  await prisma.guest.createMany({ data: rows });

  return { ok: true, added: fresh.length };
}

export async function listGuestsWithLinks(
  scope: TenantScope,
  eventId: string,
): Promise<EventGuests | null> {
  const event = await db(scope).event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    include: {
      honorees: { orderBy: { order: 'asc' }, select: { name: true } },
      versions: { orderBy: { createdAt: 'asc' }, select: { slug: true, locale: true } },
      guests: {
        orderBy: { createdAt: 'asc' },
        include: { rsvp: true, table: { select: { name: true } } },
      },
    },
  });
  if (event === null) return null;

  return {
    eventId: event.id,
    title: event.honorees.map((honoree) => honoree.name).join(' · '),
    channel: event.channel,
    reminderDaysBefore: event.reminderDaysBefore,
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
      table: guest.table?.name ?? null,
      // Resolved with the same rule /g/[token] applies, so what the office is
      // shown here is what the guest will really open.
      version: versionForLocale(event.versions, guest.locale) ?? null,
    })),
  };
}
