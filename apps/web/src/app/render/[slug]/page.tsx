import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { InvitationCard } from '@/components/invitation/InvitationCard';
import { getAllInvitations } from '@/lib/invitations';
import { getInvitationRepository } from '@/lib/repositories';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Internal capture surface — never indexed, never linked to guests. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Pre-renders the demo canvases only. Reads data/invitations.json directly
 * rather than through the repository: with a database behind it, listing every
 * invitation would mean listing every office's, and this build step has no
 * office to scope itself to.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  if (process.env['DATA_SOURCE'] === 'database') return [];
  return Promise.resolve(getAllInvitations().map((invitation) => ({ slug: invitation.slug })));
}

/**
 * Rendered per request, like the guest page it mirrors.
 *
 * The root layout resolves `<html lang>` through `documentLanguage()`, which
 * reads cookies and headers. That makes every dynamic API a hard error in a
 * segment Next still treats as static — and `generateStaticParams` keeps this
 * one static even when it returns nothing. The symptom is not a broken page
 * here, because no guest opens this URL: it is `/api/render/[slug]` answering
 * 500, because Chromium captures this page and gets an error instead.
 */
export const dynamic = 'force-dynamic';

/**
 * The exact 1080×1920 canvas that /api/render/[slug] screenshots. It reuses the
 * same InvitationCard as the web page, so the PNG and the page can never drift.
 */
export default async function RenderPage({ params }: PageProps) {
  const { slug } = await params;
  const invitation = await getInvitationRepository().findBySlug(slug);
  if (invitation === undefined) notFound();

  return (
    <div className="h-[1920px] w-[1080px] overflow-hidden">
      <InvitationCard invitation={invitation} />
    </div>
  );
}
