import { bodyFont } from '@/lib/typography';

import type { InvitationPartProps } from './props';

/** The sentence that introduces the honorees. */
export function IntroLine({ invitation, dictionary }: InvitationPartProps) {
  const { locale, eventType } = invitation;
  return (
    <p
      className={`${bodyFont(locale)} max-w-[78cqw] text-[3.1cqw] leading-[1.7] text-[color:var(--inv-primary)] opacity-75`}
    >
      {dictionary.invite[eventType].intro}
    </p>
  );
}
