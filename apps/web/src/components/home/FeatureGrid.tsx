import { SITE } from '@/config/site';
import { displayFont } from '@/lib/typography';
import type { Dictionary, Locale } from '@/lib/types';

/** The selling points, in the order the configuration lists them. */
export function FeatureGrid({ dictionary, locale }: { dictionary: Dictionary; locale: Locale }) {
  const items = dictionary.home.features.items;

  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {SITE.features.map((key) => (
        <li
          key={key}
          className="flex flex-col gap-3 rounded-lg border border-[#2A2419] bg-[#1A1712] p-6"
        >
          <h3 className={`${displayFont(locale)} text-xl text-[#F4EFE6]`}>{items[key].title}</h3>
          <p className="text-sm leading-relaxed text-[#A79C86]">{items[key].body}</p>
        </li>
      ))}
    </ul>
  );
}
