import { publishDraftAction, resetDraftAction } from '@/app/crear/actions';
import { draftProblems, draftVersions, type InvitationDraft } from '@/lib/create/draft';
import { LOCALE_NAMES } from '@/lib/create/options';
import { interpolate } from '@/lib/dictionary';
import type { Dictionary } from '@/lib/types';

interface ReviewStepProps {
  draft: InvitationDraft;
  dictionary: Dictionary;
  signedIn: boolean;
  failed: boolean;
}

const BUTTON =
  'bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a6c22] disabled:opacity-40';

/** The last step: what is still missing, and the one button that publishes. */
export function ReviewStep({ draft, dictionary, signedIn, failed }: ReviewStepProps) {
  const copy = dictionary.create;
  const problems = draftProblems(draft);
  const versions = draftVersions(draft);
  const languages = versions.map((version) => LOCALE_NAMES[version.locale]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.16em] text-[#8a6c22]">{copy.steps.review}</p>
        <h2 className="text-2xl text-[#23201a]">{copy.preview}</h2>
      </header>

      {/* Which languages this actually publishes as. A guest whose language is
          missing falls back to the first one, so it is worth seeing before
          publishing rather than after the list goes out. */}
      <p className="text-sm text-[#6a6456]">
        <span className="text-[#23201a]">{copy.reviewLanguages}: </span>
        {languages.length === 1
          ? interpolate(copy.reviewLanguagesNone, { language: languages[0] ?? '' })
          : languages.join(' · ')}
      </p>

      {problems.length > 0 || failed ? (
        <p role="alert" className="text-sm text-[#8c2f1e]">
          {copy.errorInvalid}
        </p>
      ) : null}

      {signedIn ? null : (
        <p className="text-sm text-[#6a6456]">
          {copy.signInToPublish}{' '}
          <a href="/entrar" className="underline">
            /entrar
          </a>
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <form action={publishDraftAction}>
          <button type="submit" className={BUTTON} disabled={!signedIn || problems.length > 0}>
            {copy.publish}
          </button>
        </form>
        <form action={resetDraftAction}>
          <button
            type="submit"
            className="border border-[#23201a] px-6 py-3 text-base text-[#23201a] transition-opacity hover:opacity-70"
          >
            {copy.startOver}
          </button>
        </form>
      </div>
    </div>
  );
}
