import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { InvitationCard } from '@/components/invitation/InvitationCard';
import { getDictionary, interpolate } from '@/lib/dictionary';
import { getAllInvitations, getInvitationBySlug } from '@/lib/invitations';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): { slug: string }[] {
  return getAllInvitations().map((invitation) => ({ slug: invitation.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const invitation = getInvitationBySlug(slug);
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
export default async function InvitationPage({ params }: PageProps) {
  const { slug } = await params;
  const invitation = getInvitationBySlug(slug);
  if (invitation === undefined) notFound();

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#f4efe6] p-[4vw]">
      <InvitationCard
        invitation={invitation}
        interactive
        className="w-[min(92vw,560px,51.7dvh)] overflow-hidden rounded-[1.5cqw] shadow-[0_24px_60px_-20px_rgba(59,50,38,0.45)]"
      />
    </main>
  );
}
