import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';

import { InvitationCard } from '@/components/invitation/InvitationCard';
import { PanelHeader } from '@/components/panel/PanelHeader';
import { DetailsStep } from '@/components/create/DetailsStep';
import { LanguageStep } from '@/components/create/LanguageStep';
import { NamesStep } from '@/components/create/NamesStep';
import { ReviewStep } from '@/components/create/ReviewStep';
import { StepShell } from '@/components/create/StepShell';
import { TranslationsStep } from '@/components/create/TranslationsStep';
import { WhenStep } from '@/components/create/WhenStep';
import { getSession, sessionCan } from '@/lib/auth/session';
import { DRAFT_COOKIE } from '@/lib/create/cookie';
import { draftToInvitation, parseDraft } from '@/lib/create/draft';
import { getDictionary } from '@/lib/dictionary';
import { bodyFont, displayFont, latinOnly } from '@/lib/typography';
import type { Dictionary, Locale } from '@citas/core';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TOTAL_STEPS = 6;

/**
 * La vuelta, para quien NO ha entrado.
 *
 * Con sesión, esta pantalla lleva la cabecera del panel entera —el mismo menú,
 * el nombre de su oficina y su cuenta—, así que no hace falta un enlace suelto.
 * Sin sesión no hay panel al que volver: se llegó desde la portada y ahí es
 * donde se vuelve.
 */
function BackHome({
  copy,
  locale,
}: {
  copy: Dictionary['create'];
  locale: Locale;
}) {
  return (
    <Link
      href="/"
      className={`${bodyFont(locale)} self-start text-sm text-[#8a6c22] hover:underline`}
    >
      {copy.backHome}
    </Link>
  );
}

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
      <div className="flex min-h-[100dvh] flex-col bg-[#f4efe6]">
        {/* La cabecera del panel, la MISMA, para quien ha entrado. Sin ella esta
            pantalla parecía otro sitio: sin menú, sin el nombre de su oficina y
            sin manera de volver. */}
        {session !== null && <PanelHeader session={session} />}
        <main
          dir={direction}
          lang={draft.locale}
          className={`${bodyFont(draft.locale)} mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-6 p-8`}
        >
          {session === null && <BackHome copy={copy} locale={draft.locale} />}
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
      </div>
    );
  }

  const stepTitles = [
    copy.steps.language,
    copy.steps.names,
    copy.steps.when,
    copy.steps.details,
    copy.steps.translations,
  ];

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#f4efe6]">
      {session !== null && <PanelHeader session={session} />}
      <main
        dir={direction}
        lang={draft.locale}
        className={`${bodyFont(draft.locale)} mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-6 sm:p-10`}
      >
        {session === null && <BackHome copy={copy} locale={draft.locale} />}
        <h1 className={`${displayFont(draft.locale)} text-3xl text-[#23201a]`}>{copy.title}</h1>

        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            {step === 6 ? (
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
                locale={draft.locale}
                title={stepTitles[step - 1] ?? ''}
                dictionary={dictionary}
              >
                {step === 1 ? <LanguageStep draft={draft} dictionary={dictionary} /> : null}
                {step === 2 ? <NamesStep draft={draft} dictionary={dictionary} /> : null}
                {step === 3 ? <WhenStep draft={draft} dictionary={dictionary} /> : null}
                {step === 4 ? <DetailsStep draft={draft} dictionary={dictionary} /> : null}
                {step === 5 ? <TranslationsStep draft={draft} dictionary={dictionary} /> : null}
              </StepShell>
            )}
          </div>

          <aside className="flex flex-col gap-3 lg:sticky lg:top-10">
            <p className={`text-xs ${latinOnly(draft.locale, 'uppercase tracking-[0.16em]')} text-[#8a6c22]`}>{copy.preview}</p>
            <InvitationCard
              invitation={draftToInvitation(draft)}
              className="w-full overflow-hidden shadow-[0_16px_40px_-22px_rgba(59,50,38,0.6)]"
            />
          </aside>
        </div>
      </main>
    </div>
  );
}
