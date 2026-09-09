import { templateFor, themeFor, type Locale } from '@citas/core';

import { buildSlug } from '@/lib/create/slug';
import { defaultNumerals } from '@/lib/create/options';
import { getPrisma } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { findVerse } from '@/lib/verses';

export interface EventVersion {
  slug: string;
  locale: Locale;
}

/**
 * The version a reader of this language should be given.
 *
 * When their language was never written, they get the first one — the language
 * the invitation was created in — rather than nothing. Callers that care about
 * the difference compare the result's locale with the one they asked for.
 */
export function versionForLocale<T extends EventVersion>(
  versions: readonly T[],
  locale: Locale,
): T | undefined {
  return versions.find((version) => version.locale === locale) ?? versions[0];
}

/** Every language this event has been written in, the original first. */
export async function listEventVersions(
  scope: TenantScope,
  eventId: string,
): Promise<EventVersion[] | null> {
  const event = await getPrisma().event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: {
      versions: {
        orderBy: { createdAt: 'asc' },
        select: { slug: true, locale: true },
      },
    },
  });
  return event === null ? null : event.versions;
}

export type AddVersionResult =
  | { ok: true; slug: string }
  | { ok: false; reason: 'notFound' | 'duplicate' };

export interface NewVersion {
  locale: Locale;
  message: string;
  quoteId: string;
}

/**
 * Writes the same event out in one more language.
 *
 * Only the wording is new: names, date and venue stay on the event, so the two
 * cards can never drift apart. The template and the palette come from the event
 * type, never from whoever fills this in — a memorial does not become a
 * celebration by being translated.
 */
export async function addEventVersion(
  scope: TenantScope,
  eventId: string,
  input: NewVersion,
): Promise<AddVersionResult> {
  const prisma = getPrisma();
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: {
      id: true,
      type: true,
      honorees: { orderBy: { order: 'asc' }, select: { name: true } },
      versions: { select: { locale: true } },
    },
  });
  if (event === null) return { ok: false, reason: 'notFound' };
  if (event.versions.some((version) => version.locale === input.locale)) {
    return { ok: false, reason: 'duplicate' };
  }

  // The verse list is closed per language: an id from another language would
  // put the wrong script on the card, so it is dropped rather than trusted.
  const quoteId = findVerse(input.quoteId)?.locale === input.locale ? input.quoteId : null;
  const theme = themeFor(event.type);
  const slug = buildSlug(event.honorees.map((honoree) => honoree.name));

  await prisma.invitationVersion.create({
    data: {
      eventId: event.id,
      slug,
      locale: input.locale,
      direction: input.locale === 'ar' ? 'rtl' : 'ltr',
      numeralSystem: defaultNumerals(input.locale),
      templateId: templateFor(event.type),
      message: input.message,
      quoteId,
      themePrimary: theme.primary,
      themeAccent: theme.accent,
      themeBackground: theme.background,
      publishedAt: new Date(),
    },
  });

  return { ok: true, slug };
}
