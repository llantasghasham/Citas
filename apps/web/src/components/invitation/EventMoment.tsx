import { formatEventDate, formatEventTime, machineDateTime } from '@/lib/datetime';
import { bodyFont, displayFont } from '@/lib/typography';

import type { InvitationPartProps } from './props';

/** Date, time and — when supplied — the pre-computed Hijri date. */
export function EventMoment({ invitation, dictionary }: InvitationPartProps) {
  const { locale, hijriDate } = invitation;

  return (
    <div className="flex flex-col items-center gap-[1.2cqw] text-[color:var(--inv-primary)]">
      <time
        dateTime={machineDateTime(invitation)}
        className={`${displayFont(locale)} text-[4.4cqw] leading-[1.5]`}
      >
        <span className="sr-only">{dictionary.labels.date}: </span>
        {formatEventDate(invitation)}
      </time>
      <p className={`${bodyFont(locale)} text-[3.6cqw] opacity-85`}>
        <span className="sr-only">{dictionary.labels.time}: </span>
        {formatEventTime(invitation)}
      </p>
      {hijriDate === undefined ? null : (
        <p className={`${bodyFont(locale)} text-[2.7cqw] opacity-60`}>
          <span className="sr-only">{dictionary.labels.hijriDate}: </span>
          {hijriDate}
        </p>
      )}
    </div>
  );
}
