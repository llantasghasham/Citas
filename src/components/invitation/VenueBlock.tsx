import { bodyFont, displayFont, latinOnly } from '@/lib/typography';

import type { InvitationPartProps } from './props';

interface VenueBlockProps extends InvitationPartProps {
  /** The map link is for the web page only; the exported PNG has no links. */
  interactive: boolean;
}

export function VenueBlock({ invitation, dictionary, interactive }: VenueBlockProps) {
  const { locale, venue } = invitation;

  return (
    <address className="flex flex-col items-center gap-[1cqw] not-italic text-[color:var(--inv-primary)]">
      <p className={`${displayFont(locale)} text-[3.9cqw]`}>
        <span className="sr-only">{dictionary.labels.venue}: </span>
        {venue.name}
      </p>
      <p className={`${bodyFont(locale)} text-[2.9cqw] opacity-75`}>
        <span className="sr-only">{dictionary.labels.address}: </span>
        {venue.address}
      </p>
      {interactive ? (
        <a
          href={venue.mapUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={`${bodyFont(locale)} mt-[1cqw] border-b border-current pb-[0.4cqw] text-[2.6cqw] ${latinOnly(locale, 'tracking-[0.14em]')} text-[color:var(--inv-accent)] transition-opacity hover:opacity-70`}
        >
          {dictionary.actions.viewMap}
        </a>
      ) : null}
    </address>
  );
}
