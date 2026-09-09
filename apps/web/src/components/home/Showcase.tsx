import { InvitationCard } from '@/components/invitation/InvitationCard';
import type { Dictionary, Invitation, Locale } from '@/lib/types';

/**
 * Real published invitations, drawn with the very same `InvitationCard` the
 * guest and the PNG get. A separate marketing mock-up here would be free to
 * drift from the product, which is exactly what this project refuses.
 */
export function Showcase({
  invitations,
  dictionary,
}: {
  invitations: Invitation[];
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.home.showcase;

  if (invitations.length === 0) {
    return <p className="text-sm text-[#786F5D]">{copy.empty}</p>;
  }

  return (
    <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {invitations.map((invitation) => (
        <li key={invitation.id} className="flex flex-col gap-3">
          <a
            href={`/i/${invitation.slug}`}
            className="block overflow-hidden rounded-lg border border-[#2A2419] transition-opacity hover:opacity-90"
          >
            <InvitationCard invitation={invitation} />
          </a>
          <a href={`/i/${invitation.slug}`} className="text-xs text-[#A79C86] hover:text-[#F4EFE6]">
            {copy.open}
          </a>
        </li>
      ))}
    </ul>
  );
}
