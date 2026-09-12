import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  checkInAction,
  revokeCheckInAction,
} from '@/app/panel/eventos/[eventId]/puerta/actions';
import { getAdminContext } from '@/lib/admin/context';
import { readActs } from '@/lib/acts/service';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { gateList, type GateEntry } from '@/lib/checkin/service';
import { formatDateTime } from '@/lib/time/display';
import { displayFont } from '@/lib/typography';
import { interpolate, type Dictionary, type Locale } from '@citas/core';

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{
    acto?: string;
    error?: string;
    desde?: string;
    entro?: string;
    con?: string;
  }>;
}

const CONTROL =
  'h-12 border border-[#cdc6b6] bg-white px-3 text-base text-[#23201a] outline-none focus-visible:border-[#8a6c22] focus-visible:ring-2 focus-visible:ring-[#c9a227]';
const BUTTON = 'h-12 border border-[#23201a] bg-white px-5 text-base text-[#23201a] hover:opacity-70';
const BUTTON_SOFT = 'h-9 border border-[#ddd6c6] bg-white px-3 text-sm text-[#23201a] hover:opacity-70';
const LABEL = 'flex flex-col gap-1 text-sm text-[#6b6455]';

/**
 * La puerta, el día del evento.
 *
 * Es la única pantalla del panel pensada para usarse DE PIE y con una cola
 * delante: los campos y los botones son más altos que en el resto, el resultado
 * de la última entrada sale arriba y grande, y el foco vuelve solo al campo del
 * código para poder encadenar lecturas sin tocar la pantalla.
 *
 * Sin JavaScript de cliente, como todo el panel: cada lectura es un envío de
 * formulario.
 */
export default async function GatePage({ params, searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:read') || session.tenantId === null) {
    redirect('/panel');
  }

  const { eventId } = await params;
  const { acto, error, desde, entro, con } = await searchParams;
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.gate;

  const acts = await readActs(scopeOf(session), eventId);
  if (acts === null) redirect('/panel');
  if (acts.length === 0) redirect(`/panel/eventos/${eventId}/actos`);

  const chosen = acts.find((act) => act.id === acto) ?? acts[0];
  if (chosen === undefined) redirect(`/panel/eventos/${eventId}/actos`);

  const list = await gateList(scopeOf(session), eventId, chosen.id);
  if (list === null) redirect('/panel');

  const canWrite = sessionCan(session, 'event:write');
  const types = dictionary.actTypes;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={`/panel/eventos/${eventId}`} className="text-sm text-[#8a6c22] hover:underline">
          {copy.back}
        </Link>
        <h1 className={`${displayFont} text-3xl text-[#23201a]`}>{copy.heading}</h1>
        <p className="max-w-2xl text-sm text-[#6b6455]">{copy.intro}</p>
      </header>

      {/* Lo último que pasó, arriba y grande: es lo que mira quien está de pie. */}
      {entro !== undefined && (
        <p className="border border-[#2e7d32] bg-[#f1f8f2] p-4 text-lg text-[#2e7d32]">
          {interpolate(copy.ok, { name: entro, people: con ?? '1' })}
        </p>
      )}
      {error !== undefined && (
        <p className="border border-[#b3261e] bg-[#fdf2f1] p-4 text-lg text-[#b3261e]">
          {gateError(copy, error, desde, locale, chosen.timezone)}
        </p>
      )}

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className={`${LABEL} min-w-56`}>
          {copy.actLabel}
          <select name="acto" defaultValue={chosen.id} className={CONTROL}>
            {acts.map((act) => (
              <option key={act.id} value={act.id}>
                {act.label ?? types[act.type]} · {act.date}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={BUTTON_SOFT}>
          {copy.actLabel}
        </button>
      </form>

      {canWrite && (
        <form action={checkInAction} className="flex flex-wrap items-end gap-3 border border-[#ddd6c6] bg-white p-4">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="actId" value={chosen.id} />
          <label className={`${LABEL} min-w-64 grow`}>
            {copy.codeLabel}
            {/* autoFocus para poder encadenar lecturas sin tocar la pantalla. */}
            <input name="code" required autoFocus autoComplete="off" className={CONTROL} />
          </label>
          <label className={LABEL}>
            {copy.peopleLabel}
            <input type="number" name="people" min={1} defaultValue={1} className={`${CONTROL} w-24`} />
          </label>
          <label className={LABEL}>
            {copy.gateLabel}
            <input name="gate" className={`${CONTROL} w-32`} />
          </label>
          <button type="submit" className={BUTTON}>
            {copy.submit}
          </button>
        </form>
      )}

      <p className="text-sm text-[#6b6455]">
        {interpolate(copy.inside, {
          count: String(list.inside.length),
          seats: String(list.headcount),
        })}
        {chosen.capacity !== null && ` / ${chosen.capacity}`}
      </p>

      <section className="flex flex-col gap-2">
        <h2 className={`${displayFont} text-xl text-[#23201a]`}>{copy.listIn}</h2>
        {list.inside.length === 0 ? (
          <p className="text-sm text-[#6b6455]">{copy.empty}</p>
        ) : (
          <ul className="flex flex-col">
            {list.inside.map((entry) => (
              <li
                key={entry.guestId}
                className="flex flex-wrap items-center gap-3 border-b border-[#efeadd] py-2"
              >
                <span className="text-sm text-[#23201a]">{entry.name}</span>
                <span className="text-xs text-[#6b6455]">{entry.people}</span>
                {entry.table !== null && (
                  <span className="text-xs text-[#6b6455]">{entry.table}</span>
                )}
                <span className="text-xs text-[#6b6455] ms-auto">
                  {entry.enteredAt === null
                    ? ''
                    : formatDateTime(entry.enteredAt, locale, chosen.timezone)}
                </span>
                {canWrite && (
                  <form action={revokeCheckInAction}>
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="actId" value={chosen.id} />
                    <input type="hidden" name="guestId" value={entry.guestId} />
                    <button type="submit" className={BUTTON_SOFT}>
                      {copy.undo}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={`${displayFont} text-xl text-[#23201a]`}>{copy.listPending}</h2>
        <ul className="flex flex-col">
          {list.pending.map((entry) => (
            <li
              key={entry.guestId}
              className="flex flex-wrap items-center gap-3 border-b border-[#efeadd] py-2"
            >
              <span className="text-sm text-[#23201a]">{entry.name}</span>
              <Seats entry={entry} />
              {entry.table !== null && (
                <span className="text-xs text-[#6b6455] ms-auto">{entry.table}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Cuánta gente esperaba traer, si contestó. */
function Seats({ entry }: { entry: GateEntry }) {
  if (entry.party === null) return null;
  return <span className="text-xs text-[#6b6455]">{entry.party}</span>;
}

function gateError(
  copy: Dictionary['admin']['gate'],
  code: string,
  since: string | undefined,
  locale: Locale,
  timeZone: string,
): string {
  const errors = copy.errors as unknown as Record<string, string | undefined>;
  const text = errors[code] ?? errors['bad_code'] ?? '';
  if (code !== 'already_checked_in' || since === undefined) return text;

  const at = new Date(since);
  return interpolate(text, {
    time: Number.isNaN(at.getTime()) ? '' : formatDateTime(at, locale, timeZone),
  });
}
