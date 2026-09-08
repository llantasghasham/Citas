import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { InvitationCard } from '@/components/invitation/InvitationCard';
import { DetailsStep } from '@/components/create/DetailsStep';
import { LanguageStep } from '@/components/create/LanguageStep';
import { NamesStep } from '@/components/create/NamesStep';
import { ReviewStep } from '@/components/create/ReviewStep';
import { StepShell } from '@/components/create/StepShell';
import { WhenStep } from '@/components/create/WhenStep';
import { getSession, sessionCan } from '@/lib/auth/session';
import { DRAFT_COOKIE } from '@/lib/create/cookie';
import { draftToInvitation, parseDraft } from '@/lib/create/draft';
import { getDictionary } from '@/lib/dictionary';
import { bodyFont, displayFont } from '@/lib/typography';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TOTAL_STEPS = 5;

interface PageProps {
  searchParams: Promise<{ step?: string; published?: string; error?: string }>;
}

function stepNumber(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '1', 10);
  if (!Number.isInteger(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), TOTAL_STEPS);
}

/**
 * Multi-step creation with a live preview.
 *
 * The preview is the real InvitationCard fed by the draft, rendered on the
 * server like every other invitation — so what the organiser sees while typing
 * is the same component that will produce the page and the PNG, not a mock-up
 * that can drift from it.
 */
export default async function CreatePage({ searchParams }: PageProps) {
  const { step: rawStep, published, error } = await searchParams;
  const store = await cookies();
  const draft = parseDraft(store.get(DRAFT_COOKIE)?.value);

  const dictionary = getDictionary(draft.locale);
  const copy = dictionary.create;
  const direction = draft.locale === 'ar' ? 'rtl' : 'ltr';
  const session = await getSession();
  const canPublish = session !== null && sessionCan(session, 'event:write');
  const step = stepNumber(rawStep);

  if (published !== undefined && published.length > 0) {
    return (
      <main
        dir={direction}
        lang={draft.locale}
        className={`${bodyFont(draft.locale)} mx-auto flex min-h-[100dvh] max-w-2xl flex-col items-start gap-6 bg-[#f4efe6] p-8`}
      >
        <h1 className={`${displayFont(draft.locale)} text-3xl text-[#23201a]`}>
          {copy.publishedTitle}
        </h1>
        <p className="text-[#6a6456]">{copy.publishedHint}</p>
        <code className="w-full overflow-x-auto border border-[#ddd6c6] bg-white px-4 py-3 font-mono text-sm">
          /i/{published}
        </code>
        <div className="flex flex-wrap gap-3">
          <a
            href={`/i/${published}`}
            className="bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] hover:opacity-90"
          >
            {copy.openInvitation}
          </a>
          <a
            href={`/api/render/${published}?download=1`}
            className="border border-[#23201a] px-6 py-3 text-base text-[#23201a] hover:opacity-70"
          >
            {copy.downloadImage}
          </a>
          <a
            href="/crear?step=1"
            className="border border-[#23201a] px-6 py-3 text-base text-[#23201a] hover:opacity-70"
          >
            {copy.startOver}
          </a>
        </div>
      </main>
    );
  }

  const stepTitles = [
    copy.steps.language,
    copy.steps.names,
    copy.steps.when,
    copy.steps.details,
  ];

  return (
    <main
      dir={direction}
      lang={draft.locale}
      className={`${bodyFont(draft.locale)} mx-auto flex min-h-[100dvh] max-w-5xl flex-col gap-8 bg-[#f4efe6] p-6 sm:p-10`}
    >
      <h1 className={`${displayFont(draft.locale)} text-3xl text-[#23201a]`}>{copy.title}</h1>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {step === 5 ? (
            <ReviewStep
              draft={draft}
              dictionary={dictionary}
              signedIn={canPublish}
              failed={error === '1'}
            />
          ) : (
            <StepShell
              step={step}
              total={TOTAL_STEPS}
              title={stepTitles[step - 1] ?? ''}
              dictionary={dictionary}
            >
              {step === 1 ? <LanguageStep draft={draft} dictionary={dictionary} /> : null}
              {step === 2 ? <NamesStep draft={draft} dictionary={dictionary} /> : null}
              {step === 3 ? <WhenStep draft={draft} dictionary={dictionary} /> : null}
              {step === 4 ? <DetailsStep draft={draft} dictionary={dictionary} /> : null}
            </StepShell>
          )}
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-10">
          <p className="text-xs uppercase tracking-[0.16em] text-[#8a6c22]">{copy.preview}</p>
          <InvitationCard
            invitation={draftToInvitation(draft)}
            className="w-full overflow-hidden shadow-[0_16px_40px_-22px_rgba(59,50,38,0.6)]"
          />
        </aside>
      </div>
    </main>
  );
}
