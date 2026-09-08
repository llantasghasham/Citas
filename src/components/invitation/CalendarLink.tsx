import { bodyFont } from '@/lib/typography';

import type { InvitationPartProps } from './props';

/** Downloads the event as a calendar file. Web only — never on the exported PNG. */
export function CalendarLink({ invitation, dictionary }: InvitationPartProps) {
  const { locale, slug } = invitation;

  return (
    <a
      href={`/api/calendar/${slug}`}
      className={`${bodyFont(locale)} border border-[color:var(--inv-accent)] px-5 py-2 text-sm text-[color:var(--inv-primary)] transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--inv-accent)]`}
    >
      {dictionary.actions.addToCalendar}
    </a>
  );
}
