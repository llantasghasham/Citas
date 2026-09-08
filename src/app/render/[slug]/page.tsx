import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { InvitationCard } from '@/components/invitation/InvitationCard';
import { getAllInvitations, getInvitationBySlug } from '@/lib/invitations';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Internal capture surface — never indexed, never linked to guests. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export function generateStaticParams(): { slug: string }[] {
  return getAllInvitations().map((invitation) => ({ slug: invitation.slug }));
}

/**
 * The exact 1080×1920 canvas that /api/render/[slug] screenshots. It reuses the
 * same InvitationCard as the web page, so the PNG and the page can never drift.
 */
export default async function RenderPage({ params }: PageProps) {
  const { slug } = await params;
  const invitation = getInvitationBySlug(slug);
  if (invitation === undefined) notFound();

  return (
    <div className="h-[1920px] w-[1080px] overflow-hidden">
      <InvitationCard invitation={invitation} />
    </div>
  );
}
