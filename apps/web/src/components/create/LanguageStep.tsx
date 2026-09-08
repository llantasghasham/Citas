import { LOCALE_NAMES } from '@/lib/create/options';
import type { InvitationDraft } from '@/lib/create/draft';
import { EVENT_TYPES, LOCALES, type Dictionary } from '@/lib/types';

import { Field, FIELD_CLASS } from './Field';

/** The language decides the script, the direction and the numerals, so it goes first. */
export function LanguageStep({
  draft,
  dictionary,
}: {
  draft: InvitationDraft;
  dictionary: Dictionary;
}) {
  const copy = dictionary.create;

  return (
    <div className="flex flex-col gap-5">
      <Field label={copy.localeLabel}>
        <select name="locale" defaultValue={draft.locale} className={FIELD_CLASS}>
          {LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_NAMES[locale]}
            </option>
          ))}
        </select>
      </Field>

      <Field label={copy.eventTypeLabel}>
        <select name="eventType" defaultValue={draft.eventType} className={FIELD_CLASS}>
          {EVENT_TYPES.map((eventType) => (
            <option key={eventType} value={eventType}>
              {dictionary.eventTypes[eventType]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
