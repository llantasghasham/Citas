import { EventMoment } from '@/components/invitation/EventMoment';
import { HonoreesBlock } from '@/components/invitation/HonoreesBlock';
import { HostsBlock } from '@/components/invitation/HostsBlock';
import { Kicker } from '@/components/invitation/Kicker';
import { IntroLine } from '@/components/invitation/IntroLine';
import { MessageBlock } from '@/components/invitation/MessageBlock';
import { QuoteBlock } from '@/components/invitation/QuoteBlock';
import { RsvpNote } from '@/components/invitation/RsvpNote';
import { VenueBlock } from '@/components/invitation/VenueBlock';
import type { TemplateProps } from '@/components/templates/types';

import { Flourish } from './Flourish';
import { GoldFrame } from './GoldFrame';

const ORNAMENT = 'h-[2.6cqw] w-[24cqw] text-[color:var(--inv-accent)]';

/**
 * "classic-gold": cream ground, gold floral frame, centred hierarchy.
 * All spacing is expressed in container query units, so the composition is
 * identical whether the card is 1080px wide (PNG export) or 340px (phone).
 */
export function ClassicGold({ invitation, dictionary, interactive }: TemplateProps) {
  const parts = { invitation, dictionary };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[color:var(--inv-background)]">
      <GoldFrame label={dictionary.aria.ornament} />

      <div className="relative flex h-full w-full flex-col items-center justify-between px-[10cqw] py-[9cqw] text-center">
        <header className="flex flex-col items-center gap-[2.4cqw]">
          <Kicker {...parts} />
          <Flourish className={ORNAMENT} />
          <HostsBlock {...parts} />
        </header>

        <section className="flex flex-col items-center gap-[3cqw]">
          <IntroLine {...parts} />
          <HonoreesBlock {...parts} />
          <QuoteBlock {...parts} />
        </section>

        <footer className="flex flex-col items-center gap-[2.6cqw]">
          <EventMoment {...parts} />
          <Flourish className={ORNAMENT} />
          <VenueBlock {...parts} interactive={interactive} />
          <MessageBlock {...parts} />
          <RsvpNote {...parts} />
        </footer>
      </div>
    </div>
  );
}

export default ClassicGold;
