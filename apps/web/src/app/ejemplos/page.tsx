import type { Metadata } from 'next';
import Link from 'next/link';

import { InvitationCard } from '@/components/invitation/InvitationCard';
import { loadShowcase } from '@/lib/home/showcase';
import { loadSite } from '@/lib/home/site';

// Reads whatever the data source holds right now, so `npm run build` does not
// need a reachable database to compile.
export const dynamic = 'force-dynamic';
// A working index, not a page to rank: the public face of the site is `/`.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The sample invitations, for anyone who wants to see one before creating it.
 *
 * Deliberately the same allow-list the home page draws from, and never a
 * listing of the database: an unfiltered one would show every office's real
 * clients — their names, their date and their address — to anyone who opened
 * the page.
 *
 * It carries no prose of its own: every label here is data (slug, locale,
 * route), so the page needs no locale dictionary.
 */
export default async function ExamplesPage() {
  const invitations = await loadShowcase((await loadSite()).showcase);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 p-8">
      {/* latin-only-ok: la marca se escribe igual en los cuatro idiomas. */}
      <h1 className="font-display text-3xl tracking-[0.3em] uppercase">Citas</h1>

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-8">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="flex flex-col gap-3">
            <Link href={`/i/${invitation.slug}`} className="block">
              <InvitationCard
                invitation={invitation}
                className="overflow-hidden rounded-md shadow-[0_10px_30px_-12px_rgba(59,50,38,0.5)]"
              />
            </Link>
            <p className="font-mono text-xs opacity-70">
              {invitation.slug} · {invitation.locale} · {invitation.direction} ·{' '}
              {invitation.numeralSystem}
            </p>
            <p className="flex gap-4 font-mono text-xs">
              <Link href={`/i/${invitation.slug}`} className="underline">
                /i/{invitation.slug}
              </Link>
              <a href={`/api/render/${invitation.slug}`} className="underline">
                /api/render/{invitation.slug}
              </a>
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
