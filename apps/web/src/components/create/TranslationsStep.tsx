import { LOCALE_NAMES } from '@/lib/create/options';
import type { InvitationDraft } from '@/lib/create/draft';
import { interpolate } from '@/lib/dictionary';
import { LOCALES, type Dictionary, type Locale } from '@/lib/types';
import { listVerses } from '@/lib/verses';

import { Field, FIELD_CLASS } from './Field';

/**
 * The same event, written out in the other languages its guests read.
 *
 * A guest list from Beirut is not monolingual, and a guest marked `en` who
 * lands on the Arabic card has been sent the wrong invitation. Each language is
 * typed by hand: nothing here is machine-translated, and the verse list stays
 * closed per language.
 */
export function TranslationsStep({
  draft,
  dictionary,
}: {
  draft: InvitationDraft;
  dictionary: Dictionary;
}) {
  const copy = dictionary.create;
  const others = LOCALES.filter((locale) => locale !== draft.locale);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-[#6a6456]">{copy.translationsHint}</p>
      <p className="text-sm text-[#6a6456]">{copy.translationSharedNote}</p>

      {others.map((locale) => (
        <TranslationBlock key={locale} locale={locale} draft={draft} dictionary={dictionary} />
      ))}
    </div>
  );
}

function TranslationBlock({
  locale,
  draft,
  dictionary,
}: {
  locale: Locale;
  draft: InvitationDraft;
  dictionary: Dictionary;
}) {
  const copy = dictionary.create;
  const translation = draft.translations[locale];
  const verses = listVerses(locale);
  const language = LOCALE_NAMES[locale];

  return (
    <fieldset className="flex flex-col gap-4 border border-[#ddd6c6] bg-white/40 p-4">
      <legend className="px-2 text-sm text-[#8a6c22]">{language}</legend>

      <label className="flex items-center gap-3 text-sm text-[#23201a]">
        <input
          type="checkbox"
          name={`translationEnabled_${locale}`}
          defaultChecked={translation.enabled}
          className="accent-[#23201a]"
        />
        {interpolate(copy.translationEnable, { language })}
      </label>

      {/* Typed in the language it belongs to, so Arabic reads right-to-left
          while it is being written and not only once published. */}
      <Field label={interpolate(copy.translationMessageLabel, { language })} hint={copy.optional}>
        <textarea
          name={`translationMessage_${locale}`}
          defaultValue={translation.message}
          maxLength={600}
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          lang={locale}
          className={`${FIELD_CLASS} min-h-24`}
        />
      </Field>

      <Field label={copy.quoteLabel}>
        <select
          name={`translationQuote_${locale}`}
          defaultValue={translation.quoteId}
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          lang={locale}
          className={FIELD_CLASS}
        >
          <option value="">{copy.quoteNone}</option>
          {verses.map((verse) => (
            <option key={verse.id} value={verse.id}>
              {verse.source}
            </option>
          ))}
        </select>
      </Field>
    </fieldset>
  );
}
