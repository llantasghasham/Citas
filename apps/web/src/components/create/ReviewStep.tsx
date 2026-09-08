import { publishDraftAction, resetDraftAction } from '@/app/crear/actions';
import { draftProblems, type InvitationDraft } from '@/lib/create/draft';
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

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.16em] text-[#8a6c22]">{copy.steps.review}</p>
        <h2 className="text-2xl text-[#23201a]">{copy.preview}</h2>
      </header>

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
