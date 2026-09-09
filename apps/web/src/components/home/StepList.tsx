import { localizeNumerals } from '@/lib/numerals';
import { displayFont } from '@/lib/typography';
import type { Dictionary, Locale } from '@/lib/types';

const STEPS = ['write', 'send', 'track'] as const;

/** Three steps, numbered in the reader's own numerals. */
export function StepList({ dictionary, locale }: { dictionary: Dictionary; locale: Locale }) {
  const items = dictionary.home.steps.items;

  return (
    <ol className="grid gap-8 sm:grid-cols-3">
      {STEPS.map((key, index) => (
        <li key={key} className="flex flex-col gap-3 border-t border-[#3A3122] pt-6">
          <span className={`${displayFont(locale)} text-3xl text-[#C9A227]`}>
            {localizeNumerals(String(index + 1), locale === 'ar' ? 'arabic' : 'latin')}
          </span>
          <h3 className={`${displayFont(locale)} text-xl text-[#F4EFE6]`}>{items[key].title}</h3>
          <p className="text-sm leading-relaxed text-[#A79C86]">{items[key].body}</p>
        </li>
      ))}
    </ol>
  );
}
