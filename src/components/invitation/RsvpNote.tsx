import { formatDeadline } from '@/lib/datetime';
import { interpolate } from '@/lib/dictionary';
import { bodyFont, latinOnly } from '@/lib/typography';

import type { InvitationPartProps } from './props';

/** Phase 1 shows the RSVP request only; the response form arrives in phase 2. */
export function RsvpNote({ invitation, dictionary }: InvitationPartProps) {
  const { locale, rsvp } = invitation;
  if (!rsvp.enabled) return null;

  const text =
    rsvp.deadline === null
      ? dictionary.rsvp.withoutDeadline
      : interpolate(dictionary.rsvp.withDeadline, {
          deadline: formatDeadline(invitation, rsvp.deadline),
        });

  return (
    <p
      className={`${bodyFont(locale)} ${latinOnly(locale, 'tracking-[0.08em]')} max-w-[86cqw] text-[2.45cqw] leading-[1.8] text-[color:var(--inv-primary)] opacity-70`}
    >
      {text}
    </p>
  );
}
