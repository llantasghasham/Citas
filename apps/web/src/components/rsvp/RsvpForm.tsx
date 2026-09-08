import { submitRsvpAction } from '@/app/i/[slug]/actions';
import type { RsvpStatus } from '@/generated/prisma/enums';
import { RSVP_STATUSES, type ExistingReply } from '@/lib/rsvp/service';
import { bodyFont, displayFont } from '@/lib/typography';
import type { Dictionary, Invitation } from '@/lib/types';

interface RsvpFormProps {
  invitation: Invitation;
  dictionary: Dictionary;
  /** The reply already on file, when this browser has answered before. */
  reply: ExistingReply | null;
  outcome?: string;
}

const FIELD =
  'w-full border border-[color:var(--inv-accent)]/50 bg-white/70 px-4 py-3 text-base text-[color:var(--inv-primary)] outline-none focus-visible:border-[color:var(--inv-primary)] focus-visible:ring-2 focus-visible:ring-[color:var(--inv-accent)]';

/**
 * Lives below the card, never inside it: the invitation itself has to stay a
 * clean composition, because it is also the exported image.
 */
export function RsvpForm({ invitation, dictionary, reply, outcome }: RsvpFormProps) {
  const { locale, rsvp } = invitation;
  const copy = dictionary.rsvpForm;

  if (!rsvp.enabled) return null;

  const thanks: Record<RsvpStatus, string> = {
    attending: copy.thanksAttending,
    declined: copy.thanksDeclined,
    tentative: copy.thanksTentative,
  };

  if (outcome === 'ok' && reply !== null) {
    return (
      <section
        className={`${bodyFont(locale)} flex flex-col items-center gap-4 text-center text-[color:var(--inv-primary)]`}
      >
        <p className="text-lg">{thanks[reply.status]}</p>
        <a href="?" className="text-sm underline opacity-70 hover:opacity-100">
          {copy.change}
        </a>
      </section>
    );
  }

  if (outcome === 'closed') {
    return (
      <p className={`${bodyFont(locale)} text-center text-[color:var(--inv-primary)] opacity-80`}>
        {copy.closed}
      </p>
    );
  }

  return (
    <section className={`${bodyFont(locale)} flex flex-col gap-5`}>
      <h2 className={`${displayFont(locale)} text-center text-2xl text-[color:var(--inv-primary)]`}>
        {copy.heading}
      </h2>

      {outcome === 'invalid' || outcome === 'rate_limited' || outcome === 'not_found' ? (
        <p role="alert" className="text-center text-sm text-[#8c2f1e]">
          {copy.error}
        </p>
      ) : null}

      <form action={submitRsvpAction} className="flex flex-col gap-5">
        <input type="hidden" name="slug" value={invitation.slug} />

        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{copy.heading}</legend>
          {RSVP_STATUSES.map((status) => (
            <label
              key={status}
              className="flex cursor-pointer items-center gap-3 border border-[color:var(--inv-accent)]/40 bg-white/50 px-4 py-3 text-[color:var(--inv-primary)] has-[:checked]:border-[color:var(--inv-primary)] has-[:checked]:bg-white"
            >
              <input
                type="radio"
                name="status"
                value={status}
                required
                defaultChecked={reply?.status === status}
                className="accent-[color:var(--inv-primary)]"
              />
              {copy[status]}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-2 text-sm text-[color:var(--inv-primary)]">
          {copy.nameLabel}
          <input
            className={FIELD}
            name="name"
            defaultValue={reply?.name ?? ''}
            maxLength={120}
            required
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-[color:var(--inv-primary)]">
          {copy.partyLabel}
          <input
            className={FIELD}
            name="party"
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            defaultValue={reply?.party ?? 1}
            required
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-[color:var(--inv-primary)]">
          {copy.messageLabel}
          <textarea
            className={`${FIELD} min-h-24`}
            name="message"
            maxLength={500}
            defaultValue={reply?.message ?? ''}
          />
        </label>

        <button
          type="submit"
          className="bg-[color:var(--inv-primary)] px-6 py-3 text-base text-[color:var(--inv-background)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--inv-accent)]"
        >
          {copy.submit}
        </button>
      </form>
    </section>
  );
}
