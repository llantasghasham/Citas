import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { CalendarLink } from '@/components/invitation/CalendarLink';
import { InvitationCard } from '@/components/invitation/InvitationCard';
import { ActAgenda } from '@/components/rsvp/ActAgenda';
import { GuestPreferences } from '@/components/rsvp/GuestPreferences';
import { RsvpForm } from '@/components/rsvp/RsvpForm';
import { getDictionary, interpolate } from '@/lib/dictionary';
import { getInvitationRepository } from '@/lib/repositories';
import { guestCookieName } from '@/lib/rsvp/cookie';
import { readPreferences } from '@/lib/checkin/preferences';
import { visitorAgenda } from '@/lib/rsvp/agenda';
import { findGuestByToken } from '@/lib/rsvp/service';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ r?: string }>;
}

/**
 * Rendered per request, never prerendered: the page greets a guest who already
 * replied by reading their cookie, and that is per visitor by definition.
 *
 * This has to be said out loud. Leaving it to `generateStaticParams` — even
 * returning an empty list — keeps the segment in static mode, where Next
 * renders an unlisted slug on demand *as if it were prerendering it* and the
 * cookie read throws DYNAMIC_SERVER_USAGE: every invitation answered with a
 * 500. The value must be a literal string; Next parses it at compile time and
 * refuses to build if it is computed.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const invitation = await getInvitationRepository().findBySlug(slug);
  if (invitation === undefined) return {};

  const dictionary = getDictionary(invitation.locale);
  const values = {
    event: dictionary.eventTypes[invitation.eventType],
    honorees: invitation.honorees.map((honoree) => honoree.name).join(' · '),
  };

  return {
    title: interpolate(dictionary.meta.pageTitle, values),
    description: interpolate(dictionary.meta.pageDescription, values),
    openGraph: {
      title: interpolate(dictionary.meta.pageTitle, values),
      description: interpolate(dictionary.meta.pageDescription, values),
      images: [{ url: `/api/render/${invitation.slug}`, width: 1080, height: 1920 }],
    },
  };
}

/** The page a guest opens. */
export default async function InvitationPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { r: outcome } = await searchParams;
  const invitation = await getInvitationRepository().findBySlug(slug);
  if (invitation === undefined) notFound();

  const dictionary = getDictionary(invitation.locale);
  // Replies are stored in PostgreSQL, so the form is only offered when the
  // database is the data source. Showing a form that cannot save is worse than
  // showing none.
  const canCollectReplies = process.env['DATA_SOURCE'] === 'database';
  // Read the cookie only when there is a form to fill: touching it in JSON mode
  // would make a page that has nothing per-visitor on it impossible to prerender.
  const guestToken = canCollectReplies
    ? (await cookies()).get(guestCookieName(slug))?.value
    : undefined;
  const guest = guestToken === undefined ? null : await findGuestByToken(slug, guestToken);

  // El programa: lo público para quien llega por un reenvío, y la agenda suya
  // para quien abrió su enlace personal. Lo decide el servidor de una vez.
  const agenda = canCollectReplies ? await visitorAgenda(slug, guestToken) : null;

  // Lo que necesita: solo para quien trae enlace personal, porque cuelga de un
  // invitado concreto. Quien llega por un reenvío no tiene a quién colgárselo.
  const preferences =
    agenda === null || agenda.guest === null
      ? null
      : await readPreferences(agenda.scope, agenda.eventId, agenda.guest.id);

  return (
    <main
      dir={invitation.direction}
      lang={invitation.locale}
      className="flex min-h-[100dvh] flex-col items-center gap-10 bg-[#f4efe6] p-[4vw]"
      style={{
        ['--inv-primary' as string]: invitation.theme.primary,
        ['--inv-accent' as string]: invitation.theme.accent,
        ['--inv-background' as string]: invitation.theme.background,
      }}
    >
      <InvitationCard
        invitation={invitation}
        interactive
        className="w-[min(92vw,560px,51.7dvh)] overflow-hidden rounded-[1.5cqw] shadow-[0_24px_60px_-20px_rgba(59,50,38,0.45)]"
      />

      <div className="flex w-[min(92vw,560px)] flex-col items-center gap-8 pb-8">
        <CalendarLink invitation={invitation} dictionary={dictionary} />
        {agenda !== null && (
          <ActAgenda
            slug={slug}
            acts={agenda.acts}
            personal={agenda.guest !== null}
            dictionary={dictionary}
            scope={agenda.scope}
            locale={invitation.locale}
          />
        )}
        {agenda !== null && preferences !== null && (
          <GuestPreferences
            slug={slug}
            acts={agenda.acts}
            saved={preferences}
            dictionary={dictionary}
            scope={agenda.scope}
            locale={invitation.locale}
          />
        )}
        {canCollectReplies ? (
          <div className="w-full">
            <RsvpForm
              invitation={invitation}
              dictionary={dictionary}
              guest={guest}
              outcome={outcome}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
