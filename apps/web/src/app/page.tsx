import Link from 'next/link';

import { InvitationCard } from '@/components/invitation/InvitationCard';
import { getInvitationRepository } from '@/lib/repositories';

// Reads whatever the data source holds right now, so `npm run build` does not
// need a reachable database to compile.
export const dynamic = 'force-dynamic';

/**
 * Internal index of the seeded invitations. It deliberately carries no prose:
 * every label here is data (slug, locale, route), so the page needs no locale
 * dictionary of its own.
 */
export default async function HomePage() {
  const invitations = await getInvitationRepository().listAll();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 p-8">
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
