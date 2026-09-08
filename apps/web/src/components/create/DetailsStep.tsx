import type { InvitationDraft } from '@/lib/create/draft';
import { NUMERAL_SYSTEMS, type Dictionary } from '@/lib/types';
import { listVerses } from '@/lib/verses';

import { Field, FIELD_CLASS } from './Field';

/**
 * The quotation list is closed: only verses already in data/verses.json, checked
 * by a person, can be picked. There is no free-text field for a sacred text.
 */
export function DetailsStep({
  draft,
  dictionary,
}: {
  draft: InvitationDraft;
  dictionary: Dictionary;
}) {
  const copy = dictionary.create;
  const verses = listVerses(draft.locale);

  return (
    <div className="flex flex-col gap-5">
      <Field label={copy.messageLabel} hint={copy.optional}>
        <textarea
          name="message"
          defaultValue={draft.message}
          maxLength={600}
          className={`${FIELD_CLASS} min-h-28`}
        />
      </Field>

      <Field label={copy.quoteLabel}>
        <select name="quoteId" defaultValue={draft.quoteId} className={FIELD_CLASS}>
          <option value="">{copy.quoteNone}</option>
          {verses.map((verse) => (
            <option key={verse.id} value={verse.id}>
              {verse.source}
            </option>
          ))}
        </select>
      </Field>

      <Field label={copy.numeralsLabel}>
        <select name="numeralSystem" defaultValue={draft.numeralSystem} className={FIELD_CLASS}>
          {NUMERAL_SYSTEMS.map((system) => (
            <option key={system} value={system}>
              {system === 'arabic' ? copy.numeralsArabic : copy.numeralsLatin}
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="pb-2 text-sm text-[#23201a]">{copy.rsvpLabel}</legend>
        <label className="flex items-center gap-3 text-sm text-[#23201a]">
          <input
            type="checkbox"
            name="rsvpEnabled"
            defaultChecked={draft.rsvpEnabled}
            className="accent-[#23201a]"
          />
          {copy.rsvpYes}
        </label>
        <Field label={copy.rsvpDeadlineLabel} hint={copy.optional}>
          <input type="date" name="rsvpDeadline" defaultValue={draft.rsvpDeadline} className={FIELD_CLASS} />
        </Field>
      </fieldset>
    </div>
  );
}
