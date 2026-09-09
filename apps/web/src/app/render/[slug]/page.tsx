import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { InvitationCard } from '@/components/invitation/InvitationCard';
import { getInvitationRepository } from '@/lib/repositories';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Internal capture surface — never indexed, never linked to guests. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Rendered per request, like the guest page it mirrors.
 *
 * The root layout resolves `<html lang>` through `documentLanguage()`, which
 * reads cookies and headers, so nothing here can be prerendered. The
 * `generateStaticParams` that used to sit above is gone with it: it kept this
 * segment static even while returning nothing, and left the build output
 * claiming a prerendered route that could only ever fail. The symptom was not a
 * broken page here — no guest opens this URL — but `/api/render/[slug]`
 * answering 500, because Chromium captures this page and got an error instead.
 *
 * Kept as a declaration of intent even though the root layout now says the same:
 * this is the segment that got it wrong once.
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
