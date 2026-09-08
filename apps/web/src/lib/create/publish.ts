import { randomBytes } from 'node:crypto';

import { recordAudit } from '@/lib/audit';
import { eventLimitReached } from '@/lib/billing/plans';
import type { AuthenticatedSession } from '@/lib/auth/session';
import { getPrisma } from '@/lib/db/client';

import { draftProblems, mapUrlFor, type InvitationDraft } from './draft';

/**
 * A readable stem when the names are in Latin script, plus a random tail so the
 * slug is unique without a retry loop and cannot be guessed from the couple's
 * names. Arabic names fall back to the neutral stem: transliterating them
 * automatically is exactly what the project forbids.
 */
function buildSlug(names: string[]): string {
  const stem = names
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 3)
    .join('-');

  const tail = randomBytes(4).toString('hex').slice(0, 6);
  return `${stem.length === 0 ? 'invitacion' : stem}-${tail}`;
}

export type PublishResult =
  | { ok: true; slug: string }
  | { ok: false; problems: string[] };

/**
 * Turns a draft into a real, public invitation. Publishing needs a session:
 * anonymous publishing would make this an open door for anyone to mint pages on
 * the platform's domain.
 */
export async function publishDraft(
  draft: InvitationDraft,
  session: AuthenticatedSession,
): Promise<PublishResult> {
  const problems = draftProblems(draft);
  if (problems.length > 0) return { ok: false, problems };

  const prisma = getPrisma();

  // Concierge work has no office of its own: it belongs to the platform.
  const tenantId =
    session.tenantId ??
    (await prisma.tenant.findFirst({ where: { isRoot: true }, select: { id: true } }))?.id;
  if (tenantId === undefined) return { ok: false, problems: ['tenant'] };

  // The plan is checked here, on the server, at the moment of publishing —
  // not by hiding a button.
  if (await eventLimitReached(tenantId)) return { ok: false, problems: ['planLimit'] };

  const honorees = draft.honorees.filter((name) => name.length > 0);
  const hosts = draft.hosts.filter((host) => host.name.length > 0);
  const slug = buildSlug(honorees);

  const event = await prisma.event.create({
    data: {
      tenantId,
      ownerId: session.userId,
      type: draft.eventType,
      status: 'published',
      channel: session.tenantId === null ? 'concierge' : 'licensed_office',
      date: draft.date,
      time: draft.time,
      timezone: draft.timeZone,
      venueName: draft.venueName,
      venueAddress: draft.venueAddress,
      venueMapUrl: mapUrlFor(draft),
      rsvpEnabled: draft.rsvpEnabled,
      rsvpDeadline:
        draft.rsvpDeadline.length === 0 ? null : new Date(`${draft.rsvpDeadline}T00:00:00Z`),
      honorees: { create: honorees.map((name, order) => ({ name, order })) },
      hosts: { create: hosts.map((host, order) => ({ name: host.name, role: host.role, order })) },
      versions: {
        create: [
          {
            slug,
            locale: draft.locale,
            direction: draft.locale === 'ar' ? 'rtl' : 'ltr',
            numeralSystem: draft.numeralSystem,
            templateId: 'classic-gold',
            message: draft.message,
            quoteId: draft.quoteId.length === 0 ? null : draft.quoteId,
            publishedAt: new Date(),
          },
        ],
      },
    },
    select: { id: true },
  });

  await recordAudit({
    tenantId,
    actorId: session.userId,
    action: 'event.publish',
    entity: 'Event',
    entityId: event.id,
    metadata: { slug, locale: draft.locale },
  });

  return { ok: true, slug };
}
