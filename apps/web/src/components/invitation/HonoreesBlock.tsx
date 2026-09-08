import { NameSeparator } from '@/components/templates/classic-gold/NameSeparator';
import { displayFont } from '@/lib/typography';

import type { InvitationPartProps } from './props';

/** The names the invitation is about — the typographic centre of the card. */
export function HonoreesBlock({ invitation }: InvitationPartProps) {
  const { locale, honorees } = invitation;
  const size = honorees.length > 1 ? 'text-[7.6cqw]' : 'text-[8.6cqw]';

  return (
    <h1 className={`${displayFont(locale)} flex flex-col items-center gap-[1.4cqw] ${size} leading-[1.25] text-[color:var(--inv-primary)]`}>
      {honorees.map((honoree, index) => (
        <span key={honoree.name} className="flex flex-col items-center gap-[1.4cqw]">
          {index > 0 ? (
            <NameSeparator className="h-[3.4cqw] w-[3.4cqw] text-[color:var(--inv-accent)]" />
          ) : null}
          {honoree.name}
        </span>
      ))}
    </h1>
  );
}
