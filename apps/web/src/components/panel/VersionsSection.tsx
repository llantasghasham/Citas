import { addVersionAction } from '@/app/panel/eventos/actions';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import { LOCALE_NAMES } from '@/lib/create/options';
import { interpolate } from '@/lib/dictionary';
import type { EventVersion } from '@/lib/repositories/versions';
import { displayFont } from '@/lib/typography';
import { LOCALES, type Dictionary, type Locale } from '@/lib/types';
import { listVerses } from '@/lib/verses';

interface VersionsSectionProps {
  eventId: string;
  versions: EventVersion[];
  dictionary: Dictionary;
  locale: Locale;
  canWrite: boolean;
}

/**
 * The languages one event has been written in, and how to add the next one.
 *
 * An office in Beirut sends to a list that is not monolingual. Without this the
 * event has exactly one version and every guest — whatever language they were
 * imported as — opens that one.
 */
export function VersionsSection({
  eventId,
  versions,
  dictionary,
  locale,
  canWrite,
}: VersionsSectionProps) {
  const copy = dictionary.admin.versions;
  const missing = LOCALES.filter(
    (candidate) => !versions.some((version) => version.locale === candidate),
  );

  return (
    <section className="flex flex-col gap-4 border-t border-[#ddd6c6] pt-6">
      <h2 className={`${displayFont(locale)} text-xl`}>{copy.heading}</h2>
      <p className="text-sm text-[#6a6456]">{copy.hint}</p>

      <ul className="flex flex-col gap-2">
        {versions.map((version) => (
          <li key={version.slug} className="flex flex-wrap items-baseline gap-3 text-sm">
            <span className="text-[#23201a]">{LOCALE_NAMES[version.locale]}</span>
            <code className="font-mono text-xs text-[#6a6456]" dir="ltr">
              /i/{version.slug}
            </code>
            <a className="text-xs underline text-[#8a6c22]" href={`/i/${version.slug}`}>
              {copy.open}
            </a>
          </li>
        ))}
      </ul>

      {missing.length === 0 ? <p className="text-sm text-[#6a6456]">{copy.complete}</p> : null}

      {canWrite
        ? missing.map((candidate) => (
            <AddVersionForm
              key={candidate}
              eventId={eventId}
              target={candidate}
              dictionary={dictionary}
            />
          ))
        : null}
    </section>
  );
}

function AddVersionForm({
  eventId,
  target,
  dictionary,
}: {
  eventId: string;
  target: Locale;
  dictionary: Dictionary;
}) {
  const copy = dictionary.admin.versions;
  const language = LOCALE_NAMES[target];
  const verses = listVerses(target);

  return (
    <details className="border border-[#ddd6c6] bg-white/40 p-4">
      <summary className="cursor-pointer text-sm text-[#8a6c22]">
        {interpolate(copy.addIn, { language })}
      </summary>

      <form action={addVersionAction} className="flex max-w-xl flex-col gap-4 pt-4">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="locale" value={target} />

        {/* Written in the language it is for, so Arabic reads right-to-left as
            it is typed and not only once published. */}
        <Field
          label={interpolate(dictionary.create.translationMessageLabel, { language })}
          hint={dictionary.create.optional}
        >
          <textarea
            name="message"
            maxLength={600}
            dir={target === 'ar' ? 'rtl' : 'ltr'}
            lang={target}
            className={`${FIELD_CLASS} min-h-24`}
          />
        </Field>

        <Field label={dictionary.create.quoteLabel} hint={copy.quoteHint}>
          <select
            name="quoteId"
            defaultValue=""
            dir={target === 'ar' ? 'rtl' : 'ltr'}
            lang={target}
            className={FIELD_CLASS}
          >
            <option value="">{dictionary.create.quoteNone}</option>
            {verses.map((verse) => (
              <option key={verse.id} value={verse.id}>
                {verse.source}
              </option>
            ))}
          </select>
        </Field>

        <button
          type="submit"
          className="bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] hover:opacity-90"
        >
          {copy.add}
        </button>
      </form>
    </details>
  );
}
