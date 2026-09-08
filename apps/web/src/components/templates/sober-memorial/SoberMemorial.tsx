import { EventMoment } from '@/components/invitation/EventMoment';
import { HonoreesBlock } from '@/components/invitation/HonoreesBlock';
import { HostsBlock } from '@/components/invitation/HostsBlock';
import { IntroLine } from '@/components/invitation/IntroLine';
import { Kicker } from '@/components/invitation/Kicker';
import { MessageBlock } from '@/components/invitation/MessageBlock';
import { QuoteBlock } from '@/components/invitation/QuoteBlock';
import { RsvpNote } from '@/components/invitation/RsvpNote';
import { VenueBlock } from '@/components/invitation/VenueBlock';
import type { TemplateProps } from '@/components/templates/types';

import { MourningFrame } from './MourningFrame';
import { Rule } from './Rule';

const RULE = 'h-[0.4cqw] w-[18cqw] text-[color:var(--inv-accent)]';

/**
 * "sober-memorial": pale ground, one hairline border, no ornament, wide margins.
 *
 * It is the same set of parts as the celebratory template — the difference is
 * everything that was taken away. More air and fewer marks is what makes a card
 * read as mourning rather than as a party.
 */
export function SoberMemorial({ invitation, dictionary, interactive }: TemplateProps) {
  const parts = { invitation, dictionary };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[color:var(--inv-background)]">
      <MourningFrame label={dictionary.aria.ornament} />

      <div className="relative flex h-full w-full flex-col items-center justify-between px-[13cqw] py-[13cqw] text-center">
        <header className="flex flex-col items-center gap-[4cqw]">
          <Kicker {...parts} />
          <Rule className={RULE} />
          <HostsBlock {...parts} />
        </header>

        <section className="flex flex-col items-center gap-[4cqw]">
          <IntroLine {...parts} />
          <HonoreesBlock {...parts} />
          <QuoteBlock {...parts} />
        </section>

        <footer className="flex flex-col items-center gap-[3.4cqw]">
          <EventMoment {...parts} />
          <Rule className={RULE} />
          <VenueBlock {...parts} interactive={interactive} />
          <MessageBlock {...parts} />
          <RsvpNote {...parts} />
        </footer>
      </div>
    </div>
  );
}

export default SoberMemorial;
