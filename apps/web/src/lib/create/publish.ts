import { templateFor, themeFor } from '@citas/core';

import { recordAudit } from '@/lib/audit';
import { defaultNumerals } from '@/lib/create/options';
import { buildSlug } from '@/lib/create/slug';
import { eventLimitReached } from '@/lib/billing/plans';
import type { AuthenticatedSession } from '@/lib/auth/session';
import { controlDb, db } from '@/lib/db/client';
import { registerSlugs } from '@/lib/db/directory';
import { tenantScope } from '@/lib/db/tenant';

import { draftProblems, draftVersions, mapUrlFor, type InvitationDraft } from './draft';

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

  // Concierge work has no office of its own: it belongs to the platform.
  const owner =
    session.tenantId === null
      ? await controlDb().tenant.findFirst({
          where: { isRoot: true },
          select: { id: true, databaseName: true },
        })
      : { id: session.tenantId, databaseName: session.tenantDatabase };
  if (owner === null) return { ok: false, problems: ['tenant'] };

  const tenantId = owner.id;
  const scope = tenantScope(tenantId, owner.databaseName);
  const prisma = db(scope);

  // The plan is checked here, on the server, at the moment of publishing —
  // not by hiding a button.
  if (await eventLimitReached(scope)) return { ok: false, problems: ['planLimit'] };

  const honorees = draft.honorees.filter((name) => name.length > 0);
  const hosts = draft.hosts.filter((host) => host.name.length > 0);

  // One row per language the organiser wrote, the invitation's own first. Each
  // gets its own public slug: a guest reading English must be able to be sent a
  // URL that is the English card, not the Arabic one with a language switch.
  const versions = draftVersions(draft).map((version) => ({
    slug: buildSlug(honorees),
    locale: version.locale,
    direction: version.locale === 'ar' ? ('rtl' as const) : ('ltr' as const),
    numeralSystem:
      version.locale === draft.locale ? draft.numeralSystem : defaultNumerals(version.locale),
    templateId: templateFor(draft.eventType),
    message: version.message,
    quoteId: version.quoteId.length === 0 ? null : version.quoteId,
    themePrimary: themeFor(draft.eventType).primary,
    themeAccent: themeFor(draft.eventType).accent,
    themeBackground: themeFor(draft.eventType).background,
    publishedAt: new Date(),
  }));
  const slug = versions[0]?.slug ?? buildSlug(honorees);

  // El directorio ANTES que la invitación, que es al revés de lo que parece.
  // Una entrada apuntando a una invitación que no llegó a crearse resuelve a una
  // base donde no hay nada: un 404, igual que si no existiera. Una invitación
  // sin entrada no se puede encontrar nunca, y de eso nadie se entera hasta que
  // un invitado abre su enlace.
  await registerSlugs(
    scope,
    versions.map((version) => version.slug),
  );

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
      versions: { create: versions },
    },
    select: { id: true },
  });

  await recordAudit({
    tenantId,
    actorId: session.userId,
    action: 'event.publish',
    entity: 'Event',
    entityId: event.id,
    metadata: { slug, locales: versions.map((version) => version.locale).join(',') },
  });

  return { ok: true, slug };
}
