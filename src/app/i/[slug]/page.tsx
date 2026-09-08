import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { CalendarLink } from '@/components/invitation/CalendarLink';
import { InvitationCard } from '@/components/invitation/InvitationCard';
import { RsvpForm } from '@/components/rsvp/RsvpForm';
import { getDictionary, interpolate } from '@/lib/dictionary';
import { getInvitationRepository } from '@/lib/repositories';
import { guestCookieName } from '@/lib/rsvp/cookie';
import { findReplyByToken } from '@/lib/rsvp/service';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ r?: string }>;
}

/**
 * Pre-renders the invitations only while the JSON file is the data source.
 * Against the database they are rendered on demand, so publishing an invitation
 * does not require a rebuild.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  if (process.env['DATA_SOURCE'] === 'database') return [];
  const invitations = await getInvitationRepository().listAll();
  return invitations.map((invitation) => ({ slug: invitation.slug }));
}

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
  const guestToken = (await cookies()).get(guestCookieName(slug))?.value;
  const reply =
    !canCollectReplies || guestToken === undefined
      ? null
      : await findReplyByToken(slug, guestToken);

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
        {canCollectReplies ? (
          <div className="w-full">
            <RsvpForm
              invitation={invitation}
              dictionary={dictionary}
              reply={reply}
              outcome={outcome}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
