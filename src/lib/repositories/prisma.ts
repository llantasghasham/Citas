import { getPrisma } from '@/lib/db/client';
import type { Invitation } from '@/lib/types';
import { findVerse } from '@/lib/verses';

import type { InvitationRepository } from './types';

/** Everything needed to compose one invitation, in a single round trip. */
const INCLUDE = {
  event: {
    include: {
      hosts: { orderBy: { order: 'asc' } },
      honorees: { orderBy: { order: 'asc' } },
    },
  },
} as const;

type VersionRow = Awaited<
  ReturnType<ReturnType<typeof getPrisma>['invitationVersion']['findFirst']>
>;

/** ISO calendar date, without the time part a wall-clock date never had. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toInvitation(row: NonNullable<VersionRow>): Invitation {
  // The include above guarantees these, but the generated type is conservative.
  const version = row as NonNullable<VersionRow> & {
    event: {
      type: Invitation['eventType'];
      date: string;
      time: string;
      hijriDate: string | null;
      venueName: string;
      venueAddress: string;
      venueMapUrl: string;
      venueLat: number;
      venueLng: number;
      rsvpEnabled: boolean;
      rsvpDeadline: Date | null;
      hosts: { name: string; role: Invitation['hosts'][number]['role'] }[];
      honorees: { name: string }[];
    };
  };
  const { event } = version;
  const quoteId = version.quoteId ?? undefined;
  const verse = quoteId === undefined ? undefined : findVerse(quoteId);

  return {
    id: version.id,
    slug: version.slug,
    eventType: event.type,
    locale: version.locale,
    direction: version.direction,
    templateId: version.templateId as Invitation['templateId'],
    numeralSystem: version.numeralSystem,
    hosts: event.hosts.map((host) => ({ name: host.name, role: host.role })),
    honorees: event.honorees.map((honoree) => ({ name: honoree.name })),
    date: event.date,
    time: event.time,
    hijriDate: event.hijriDate ?? undefined,
    venue: {
      name: event.venueName,
      address: event.venueAddress,
      mapUrl: event.venueMapUrl,
      lat: event.venueLat,
      lng: event.venueLng,
    },
    message: version.message,
    quote: verse === undefined ? undefined : { text: verse.text, source: verse.source },
    quoteId,
    theme: {
      primary: version.themePrimary,
      accent: version.themeAccent,
      background: version.themeBackground,
    },
    rsvp: {
      enabled: event.rsvpEnabled,
      deadline: event.rsvpDeadline === null ? null : isoDate(event.rsvpDeadline),
    },
  };
}

/**
 * Reads from PostgreSQL. `findBySlug` is the product's one deliberate
 * tenant-free query: the invitation page is public and the slug is global.
 */
export const prismaInvitationRepository: InvitationRepository = {
  async findBySlug(slug) {
    const row = await getPrisma().invitationVersion.findUnique({
      where: { slug },
      include: INCLUDE,
    });
    return row === null ? undefined : toInvitation(row);
  },

  async listAll() {
    const rows = await getPrisma().invitationVersion.findMany({
      include: INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toInvitation);
  },
};
