import { answerActAction } from '@/app/i/[slug]/actions';
import type { AuthorizedAct } from '@/lib/acts/access';
import type { Dictionary } from '@citas/core';
import { interpolate } from '@citas/core';

/**
 * El programa de la celebración, tal y como lo ve QUIEN está mirando.
 *
 * Va debajo de la tarjeta y nunca dentro: la tarjeta es además la imagen que se
 * exporta, y un programa de cuatro actos dentro de un PNG de 1080×1920 no cabe
 * ni se lee.
 *
 * Lo que sale aquí ya viene decidido por el servidor (`visitorAgenda`). Este
 * componente no filtra nada: si filtrara, habría dos sitios donde decidir quién
 * ve qué y un día dirían cosas distintas.
 *
 * Sin JavaScript de cliente: cada acto es su propio formulario.
 */
interface Props {
  slug: string;
  acts: AuthorizedAct[];
  /** Si quien mira trae enlace personal. Sin él, esto es solo lectura. */
  personal: boolean;
  dictionary: Dictionary;
}

export function ActAgenda({ slug, acts, personal, dictionary }: Props) {
  if (acts.length === 0) return null;

  const copy = dictionary.agenda;
  const form = dictionary.rsvpForm;

  return (
    <section className="flex w-full flex-col gap-4">
      <h2 className="text-center text-lg text-[color:var(--inv-primary)]">{copy.heading}</h2>
      {personal && <p className="text-center text-xs opacity-70">{copy.yours}</p>}

      <ul className="flex flex-col gap-4">
        {acts.map((act) => (
          <li
            key={act.id}
            id={`acto-${act.id}`}
            className="flex flex-col gap-2 border border-[color:var(--inv-accent)] p-4"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-base text-[color:var(--inv-primary)]">
                {act.label ?? dictionary.actTypes[act.type]}
              </h3>
              {act.optional && <span className="text-xs opacity-70">{copy.optional}</span>}
              <span className="text-sm ms-auto">
                {act.date} · {act.time}
                {act.endTime === null
                  ? ''
                  : ` ${interpolate(copy.until, { time: act.endTime })}`}
              </span>
            </div>

            <p className="text-sm opacity-80">
              {act.venueName}
              {act.venueAddress.length > 0 ? ` · ${act.venueAddress}` : ''}
            </p>
            {act.venueMapUrl.length > 0 && (
              <a
                href={act.venueMapUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm underline"
              >
                {dictionary.actions.viewMap}
              </a>
            )}

            {personal && act.reply !== null && (
              <p className="text-sm">
                {form[act.reply.status]}
                {act.reply.party > 1 ? ` · ${act.reply.party}` : ''}
              </p>
            )}

            {personal && act.canRespond && (
              <form
                action={answerActAction}
                className="flex flex-wrap items-end gap-2 border-t border-[color:var(--inv-accent)] pt-3"
              >
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="actId" value={act.id} />

                <label className="flex flex-col gap-1 text-xs">
                  {form.heading}
                  <select
                    name="status"
                    defaultValue={act.reply?.status ?? 'attending'}
                    className="h-10 border border-[color:var(--inv-accent)] bg-white/70 px-2 text-sm"
                  >
                    <option value="attending">{form.attending}</option>
                    <option value="declined">{form.declined}</option>
                    <option value="tentative">{form.tentative}</option>
                  </select>
                </label>

                {/* El tope es el de ESTE acto: quien trae acompañante a la
                    recepción no lo trae por eso a la henna. */}
                <label className="flex flex-col gap-1 text-xs">
                  {form.partyLabel}
                  <input
                    type="number"
                    name="party"
                    min={1}
                    max={act.maxParty}
                    defaultValue={act.reply?.party ?? 1}
                    className="h-10 w-20 border border-[color:var(--inv-accent)] bg-white/70 px-2 text-sm"
                  />
                </label>

                <button
                  type="submit"
                  className="h-10 border border-[color:var(--inv-primary)] px-4 text-sm"
                >
                  {act.reply === null ? form.submit : form.change}
                </button>
              </form>
            )}

            {personal && !act.canRespond && (
              <p className="text-xs opacity-70">
                {act.repliesEnabled ? copy.closed : copy.noReplies}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
