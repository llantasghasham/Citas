import type { InvitationDraft } from '@/lib/create/draft';
import { TIME_ZONES } from '@/lib/create/options';
import type { Dictionary } from '@/lib/types';

import { Field, FIELD_CLASS } from './Field';

/** Date and time are the venue's wall clock; the zone turns them into an instant. */
export function WhenStep({
  draft,
  dictionary,
}: {
  draft: InvitationDraft;
  dictionary: Dictionary;
}) {
  const copy = dictionary.create;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="sm:flex-1">
          <Field label={dictionary.labels.date}>
            <input type="date" name="date" defaultValue={draft.date} required className={FIELD_CLASS} />
          </Field>
        </div>
        <div className="sm:flex-1">
          <Field label={dictionary.labels.time}>
            <input type="time" name="time" defaultValue={draft.time} required className={FIELD_CLASS} />
          </Field>
        </div>
      </div>

      <Field label={copy.timeZoneLabel}>
        <select name="timeZone" defaultValue={draft.timeZone} className={FIELD_CLASS}>
          {TIME_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </Field>

      <Field label={dictionary.labels.venue}>
        <input name="venueName" defaultValue={draft.venueName} maxLength={120} required className={FIELD_CLASS} />
      </Field>

      <Field label={dictionary.labels.address}>
        <input name="venueAddress" defaultValue={draft.venueAddress} maxLength={200} required className={FIELD_CLASS} />
      </Field>

      <Field label={copy.mapUrlLabel} hint={copy.optional}>
        <input type="url" name="mapUrl" defaultValue={draft.mapUrl} dir="ltr" className={FIELD_CLASS} />
      </Field>
    </div>
  );
}
