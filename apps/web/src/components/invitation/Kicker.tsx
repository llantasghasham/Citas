import { bodyFont, latinOnly } from '@/lib/typography';

import type { InvitationPartProps } from './props';

/** The small line that announces the kind of event. */
export function Kicker({ invitation, dictionary }: InvitationPartProps) {
  const { locale, eventType } = invitation;
  return (
    <p
      className={`${bodyFont(locale)} ${latinOnly(locale, 'uppercase tracking-[0.42em]')} text-[2.7cqw] text-[color:var(--inv-primary)] opacity-80`}
    >
      {dictionary.invite[eventType].kicker}
    </p>
  );
}
