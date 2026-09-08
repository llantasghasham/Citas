import { randomBytes } from 'node:crypto';

import type { RsvpStatus } from '@/generated/prisma/enums';
import { getPrisma } from '@/lib/db/client';

export const RSVP_STATUSES = ['attending', 'declined', 'tentative'] as const;

export type SubmitOutcome =
  | 'ok'
  | 'closed'
  | 'not_found'
  | 'invalid'
  | 'rate_limited';

export interface SubmitRsvpInput {
  slug: string;
  name: string;
  status: string;
  party: string;
  message: string;
  /** Personal-link token, when the guest arrived through one. */
  token?: string;
  ip?: string | null;
}

export interface SubmitRsvpResult {
  outcome: SubmitOutcome;
  /** Returned so the caller can remember this guest in a cookie. */
  guestToken?: string;
  status?: RsvpStatus;
}

const MAX_NAME = 120;
const MAX_MESSAGE = 500;
const MAX_PARTY = 20;
/** Self-added guests one address may create in the window. */
const MAX_SELF_ADDED_PER_IP = 10;
const RATE_WINDOW_MINUTES = 10;

export function newGuestToken(): string {
  return randomBytes(24).toString('base64url');
}

function asStatus(value: string): RsvpStatus | undefined {
  return RSVP_STATUSES.find((candidate) => candidate === value);
}

/** A deadline of the 3rd means the whole of the 3rd is still in time. */
function isClosed(enabled: boolean, deadline: Date | null): boolean {
  if (!enabled) return true;
  if (deadline === null) return false;
  return Date.now() > deadline.getTime() + 24 * 60 * 60 * 1000;
}

/**
 * Records a guest's reply.
 *
 * The form is public on purpose: in Lebanon one link is forwarded to a whole
 * WhatsApp group, and asking each guest to sign in would cost more replies than
 * any spam it prevented. What the client sends is therefore treated as
 * untrusted — the event comes from the slug, never from the request, and a
 * personal token only counts when it belongs to that same event.
 */
export async function submitRsvp(input: SubmitRsvpInput): Promise<SubmitRsvpResult> {
  const status = asStatus(input.status);
  const name = input.name.trim().replace(/\s+/g, ' ');
  const message = input.message.trim().slice(0, MAX_MESSAGE);
  const party = Number.parseInt(input.party, 10);

  if (status === undefined) return { outcome: 'invalid' };
  if (name.length === 0 || name.length > MAX_NAME) return { outcome: 'invalid' };
  if (!Number.isInteger(party) || party < 1 || party > MAX_PARTY) return { outcome: 'invalid' };

  const prisma = getPrisma();
  const version = await prisma.invitationVersion.findUnique({
    where: { slug: input.slug },
    select: {
      locale: true,
      event: { select: { id: true, rsvpEnabled: true, rsvpDeadline: true } },
    },
  });
  if (version === null) return { outcome: 'not_found' };

  const { event } = version;
  if (isClosed(event.rsvpEnabled, event.rsvpDeadline)) return { outcome: 'closed' };

  let guest =
    input.token === undefined || input.token.length === 0
      ? null
      : await prisma.guest.findFirst({ where: { token: input.token, eventId: event.id } });

  if (guest === null && input.token !== undefined && input.token.length > 0) {
    // A token that does not belong to this event is not a guest of this event.
    return { outcome: 'not_found' };
  }

  if (guest === null) {
    const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000);
    const recent = await prisma.guest.count({
      where: { selfAdded: true, createdIp: input.ip ?? null, createdAt: { gte: since } },
    });
    if (recent >= MAX_SELF_ADDED_PER_IP) return { outcome: 'rate_limited' };

    // Someone re-sending the form updates their own reply instead of appearing twice.
    guest = await prisma.guest.findFirst({
      where: { eventId: event.id, name, createdIp: input.ip ?? null, selfAdded: true },
    });
  }

  if (guest === null) {
    guest = await prisma.guest.create({
      data: {
        eventId: event.id,
        name,
        // The guest replied on this version of the invitation, so this is the
        // language they read it in — and the one to write to them in later.
        locale: version.locale,
        token: newGuestToken(),
        maxParty: MAX_PARTY,
        createdIp: input.ip ?? null,
        selfAdded: true,
      },
    });
  }

  await prisma.rsvp.upsert({
    where: { guestId: guest.id },
    update: { status, party, message: message.length === 0 ? null : message },
    create: {
      guestId: guest.id,
      status,
      party,
      message: message.length === 0 ? null : message,
    },
  });

  return { outcome: 'ok', guestToken: guest.token, status };
}

export interface ExistingReply {
  name: string;
  status: RsvpStatus;
  party: number;
  message: string | null;
}

export interface GuestContext {
  /** The name the office has for them: the form should not ask again. */
  name: string;
  /** Their answer so far, when they have already given one. */
  reply: ExistingReply | null;
}

/**
 * Who this browser is on this invitation. Two different things at once: a guest
 * who arrived through their personal link is known by name before they answer,
 * and a guest who already replied gets their answer shown back to change.
 */
export async function findGuestByToken(
  slug: string,
  token: string,
): Promise<GuestContext | null> {
  const guest = await getPrisma().guest.findFirst({
    where: { token, event: { versions: { some: { slug } } } },
    include: { rsvp: true },
  });
  if (guest === null) return null;

  return {
    name: guest.name,
    reply:
      guest.rsvp === null
        ? null
        : {
            name: guest.name,
            status: guest.rsvp.status,
            party: guest.rsvp.party,
            message: guest.rsvp.message,
          },
  };
}
