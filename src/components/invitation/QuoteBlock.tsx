import { bodyFont, latinOnly, quoteEmphasis } from '@/lib/typography';

import type { InvitationPartProps } from './props';

/**
 * Renders a verse that was resolved from data/verses.json. Nothing here ever
 * generates, completes or edits the text.
 */
export function QuoteBlock({ invitation, dictionary }: InvitationPartProps) {
  const { locale, quote } = invitation;
  if (quote === undefined) return null;

  return (
    <figure className={`${bodyFont(locale)} flex max-w-[74cqw] flex-col items-center gap-[1.4cqw]`}>
      <blockquote
        className={`${quoteEmphasis(locale)} text-[3.2cqw] leading-[1.9] text-[color:var(--inv-primary)] opacity-85`}
      >
        {quote.text}
      </blockquote>
      <figcaption className={`${latinOnly(locale, 'tracking-[0.16em]')} text-[2.4cqw] text-[color:var(--inv-primary)] opacity-60`}>
        <span className="sr-only">{dictionary.labels.quoteSource}: </span>
        {quote.source}
      </figcaption>
    </figure>
  );
}
