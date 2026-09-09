import { SITE } from '@/config/site';
import { displayFont } from '@/lib/typography';
import type { Dictionary, Locale } from '@/lib/types';

/**
 * The questions, as native `<details>`: they open and close with no client
 * JavaScript, and a search engine reads the answers whether they are open or
 * not.
 */
export function FaqList({ dictionary, locale }: { dictionary: Dictionary; locale: Locale }) {
  const items = dictionary.home.faq.items;

  return (
    <ul className="flex max-w-3xl flex-col gap-3">
      {SITE.faq.map((key) => (
        <li key={key}>
          <details className="group rounded-lg border border-[#2A2419] bg-[#1A1712] px-6 py-4">
            <summary
              className={`${displayFont(locale)} cursor-pointer list-none text-lg text-[#F4EFE6] marker:content-none`}
            >
              {items[key].question}
            </summary>
            <p className="pt-3 text-sm leading-relaxed text-[#A79C86]">{items[key].answer}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}
