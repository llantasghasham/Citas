import { getPrisma } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import type { RsvpStatus } from '@/generated/prisma/enums';
import type { EventType } from '@/lib/types';

export interface EventSummary {
  id: string;
  type: EventType;
  date: string;
  title: string;
  guests: number;
  attending: number;
  declined: number;
  tentative: number;
}

export interface GuestRow {
  name: string;
  locale: string;
  status: RsvpStatus | null;
  party: number | null;
  message: string | null;
  respondedAt: Date | null;
  selfAdded: boolean;
}

/**
 * Every query here takes a TenantScope, so an office can only ever reach its own
 * events. There is no variant of these functions without one.
 */
export async function listEvents(scope: TenantScope): Promise<EventSummary[]> {
  const events = await getPrisma().event.findMany({
    where: scopedWhere(scope),
    orderBy: { date: 'asc' },
    include: {
      honorees: { orderBy: { order: 'asc' }, select: { name: true } },
      guests: { select: { rsvp: { select: { status: true, party: true } } } },
    },
  });

  return events.map((event) => {
    const replies = event.guests.map((guest) => guest.rsvp);
    const countOf = (status: RsvpStatus): number =>
      replies.reduce(
        (total, reply) => (reply?.status === status ? total + reply.party : total),
        0,
      );

    return {
      id: event.id,
      type: event.type,
      date: event.date,
      title: event.honorees.map((honoree) => honoree.name).join(' · '),
      guests: event.guests.length,
      attending: countOf('attending'),
      declined: countOf('declined'),
      tentative: countOf('tentative'),
    };
  });
}

export async function listGuests(scope: TenantScope, eventId: string): Promise<GuestRow[] | null> {
  const event = await getPrisma().event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    include: {
      guests: {
        orderBy: { createdAt: 'asc' },
        include: { rsvp: true },
      },
    },
  });
  if (event === null) return null;

  return event.guests.map((guest) => ({
    name: guest.name,
    locale: guest.locale,
    status: guest.rsvp?.status ?? null,
    party: guest.rsvp?.party ?? null,
    message: guest.rsvp?.message ?? null,
    respondedAt: guest.rsvp?.respondedAt ?? null,
    selfAdded: guest.selfAdded,
  }));
}
