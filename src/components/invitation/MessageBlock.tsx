import { bodyFont } from '@/lib/typography';

import type { InvitationPartProps } from './props';

/** Free text authored by the host, already written in the invitation's locale. */
export function MessageBlock({ invitation }: InvitationPartProps) {
  const { locale, message } = invitation;
  if (message.length === 0) return null;

  return (
    <p
      className={`${bodyFont(locale)} max-w-[72cqw] text-[2.9cqw] leading-[2] text-[color:var(--inv-primary)] opacity-80`}
    >
      {message}
    </p>
  );
}
