import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  addActAction,
  addSegmentAction,
  editActAction,
  fillSegmentAction,
  moveActAction,
  removeActAction,
  removeSegmentAction,
  setAudienceAction,
} from '@/app/panel/eventos/[eventId]/actos/actions';
import { getAdminContext } from '@/lib/admin/context';
import { ACT_TYPES, readActs, type ActRow } from '@/lib/acts/service';
import { readSegments, type SegmentRow } from '@/lib/acts/segments';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { displayFont } from '@/lib/typography';
import { interpolate, type Dictionary } from '@citas/core';

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ error?: string; metidos?: string; abierto?: string }>;
}

const CONTROL =
  'h-10 w-full border border-[#cdc6b6] bg-white px-3 text-sm text-[#23201a] outline-none focus-visible:border-[#8a6c22] focus-visible:ring-2 focus-visible:ring-[#c9a227]';
const BUTTON = 'h-10 border border-[#23201a] bg-white px-4 text-sm text-[#23201a] hover:opacity-70';
const BUTTON_SOFT =
  'h-10 border border-[#ddd6c6] bg-white px-4 text-sm text-[#23201a] hover:opacity-70';
const LABEL = 'flex flex-col gap-1 text-sm text-[#6b6455]';

/**
 * Los actos de una celebración, y quién entra a cada uno.
 *
 * Es la pantalla que convierte «una boda es una fecha» en lo que una boda es de
 * verdad: una henna el jueves en casa, la ceremonia el sábado y la recepción esa
 * noche, cada una con su gente. Lo que decide aquí el organizador es lo que ve
 * cada invitado en su enlace — y por eso cada regla se explica al lado, en vez
 * de esperar a que alguien deduzca qué hace un «no entra».
 *
 * Sin JavaScript de cliente, como el resto del panel: cada acto es un
 * `<details>` con su propio formulario, y cada regla de grupo es otro.
 */
export default async function ActsPage({ params, searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:read') || session.tenantId === null) {
    redirect('/panel');
  }

  const { eventId } = await params;
  const { error, metidos, abierto } = await searchParams;
  const { dictionary } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.acts;

  const [acts, segments] = await Promise.all([
    readActs(scopeOf(session), eventId),
    readSegments(scopeOf(session), eventId),
  ]);
  if (acts === null || segments === null) redirect('/panel');

  const canWrite = sessionCan(session, 'event:write');
  const problems = (error ?? '').split(',').filter((code) => code.length > 0);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={`/panel/eventos/${eventId}`} className="text-sm text-[#8a6c22] hover:underline">
          {copy.back}
        </Link>
        <h1 className={`${displayFont} text-3xl text-[#23201a]`}>{copy.heading}</h1>
        <p className="max-w-2xl text-sm text-[#6b6455]">{copy.intro}</p>
      </header>

      {problems.length > 0 && (
        <p className="border border-[#b3261e] bg-[#fdf2f1] p-3 text-sm text-[#b3261e]">
          {problems
            .map((code) => problemText(copy, code))
            .filter((text) => text.length > 0)
            .join(' ')}
        </p>
      )}
      {metidos !== undefined && (
        <p className="border border-[#ddd6c6] bg-[#f7f4ec] p-3 text-sm text-[#6b6455]">
          {interpolate(copy.segmentMembers, { count: metidos })}
        </p>
      )}

      <Segments
        copy={copy}
        eventId={eventId}
        segments={segments}
        canWrite={canWrite}
      />

      <section className="flex flex-col gap-4">
        {acts.length === 0 && <p className="text-sm text-[#6b6455]">{copy.empty}</p>}
        {acts.map((act, index) => (
          <ActCard
            key={act.id}
            copy={copy}
            eventId={eventId}
            act={act}
            segments={segments}
            canWrite={canWrite}
            first={index === 0}
            last={index === acts.length - 1}
            open={abierto === act.id}
          />
        ))}
      </section>

      {canWrite && (
        <details className="border border-[#ddd6c6] bg-white p-4">
          <summary className="cursor-pointer text-sm text-[#8a6c22]">{copy.add}</summary>
          <form action={addActAction} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="eventId" value={eventId} />
            <ActFields copy={copy} />
            <button type="submit" className={`${BUTTON} self-start`}>
              {copy.add}
            </button>
          </form>
        </details>
      )}
    </>
  );
}

type Copy = Dictionary['admin']['acts'];

function problemText(copy: Copy, code: string): string {
  const problems = copy.problems as unknown as Record<string, string | undefined>;
  return problems[code] ?? '';
}

function Segments({
  copy,
  eventId,
  segments,
  canWrite,
}: {
  copy: Copy;
  eventId: string;
  segments: SegmentRow[];
  canWrite: boolean;
}) {
  return (
    <section className="flex flex-col gap-3 border border-[#ddd6c6] bg-white p-4">
      <h2 className={`${displayFont} text-xl text-[#23201a]`}>{copy.segmentsHeading}</h2>
      <p className="max-w-2xl text-sm text-[#6b6455]">{copy.segmentsIntro}</p>

      {segments.length === 0 && <p className="text-sm text-[#6b6455]">{copy.segmentEmpty}</p>}

      <ul className="flex flex-col gap-2">
        {segments.map((segment) => (
          <li
            key={segment.id}
            className="flex flex-wrap items-center gap-3 border-t border-[#efeadd] pt-2"
          >
            <span className="text-sm text-[#23201a]">{segment.name}</span>
            <span className="text-xs text-[#6b6455]">
              {interpolate(copy.segmentMembers, { count: String(segment.members) })}
            </span>
            {canWrite && (
              <span className="flex flex-wrap gap-2 ms-auto">
                <form action={fillSegmentAction}>
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="segmentId" value={segment.id} />
                  <button type="submit" className={BUTTON_SOFT}>
                    {copy.segmentFill}
                  </button>
                </form>
                <form action={removeSegmentAction}>
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="segmentId" value={segment.id} />
                  <button type="submit" className={BUTTON_SOFT}>
                    {copy.segmentRemove}
                  </button>
                </form>
              </span>
            )}
          </li>
        ))}
      </ul>

      {canWrite && (
        <form action={addSegmentAction} className="flex flex-wrap items-end gap-2 pt-2">
          <input type="hidden" name="eventId" value={eventId} />
          <label className={`${LABEL} min-w-56`}>
            {copy.segmentNameLabel}
            <input name="name" required maxLength={60} className={CONTROL} />
          </label>
          <button type="submit" className={BUTTON}>
            {copy.segmentAdd}
          </button>
        </form>
      )}
    </section>
  );
}

function ActCard({
  copy,
  eventId,
  act,
  segments,
  canWrite,
  first,
  last,
  open,
}: {
  copy: Copy;
  eventId: string;
  act: ActRow;
  segments: SegmentRow[];
  canWrite: boolean;
  first: boolean;
  last: boolean;
  open: boolean;
}) {
  const types = copy.types as unknown as Record<string, string | undefined>;
  const name = act.label ?? types[act.type] ?? act.type;

  return (
    <article className="flex flex-col gap-3 border border-[#ddd6c6] bg-white p-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={`${displayFont} text-xl text-[#23201a]`}>{name}</h2>
        {act.isMain && (
          <span className="border border-[#c9a227] px-2 py-0.5 text-xs text-[#8a6c22]">
            {copy.main}
          </span>
        )}
        <span className="text-xs text-[#6b6455]">
          {act.visibility === 'public' ? copy.visibilityPublic : copy.visibilitySegmented}
        </span>
        <span className="text-sm text-[#6b6455] ms-auto">
          {act.date} · {act.time}
          {act.endTime === null ? '' : `–${act.endTime}`}
        </span>
      </header>

      <p className="text-sm text-[#6b6455]">
        {act.venueName} · {act.venueAddress}
      </p>
      <p className="text-xs text-[#6b6455]">
        {interpolate(copy.counts, {
          invited: String(act.invited),
          attending: String(act.attending),
          seats: String(act.seats),
        })}
        {act.capacity !== null && ` / ${act.capacity}`}
      </p>
      {act.isMain && <p className="text-xs text-[#6b6455]">{copy.mainHint}</p>}

      {segments.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-[#efeadd] pt-3">
          <h3 className="text-sm text-[#23201a]">{copy.audienceHeading}</h3>
          <p className="text-xs text-[#6b6455]">{copy.audienceHint}</p>
          <ul className="flex flex-col gap-2">
            {segments.map((segment) => {
              const rule = act.audiences.find((entry) => entry.segmentId === segment.id);
              return (
                <li key={segment.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-40 text-sm text-[#23201a]">{segment.name}</span>
                  <form action={setAudienceAction} className="flex items-center gap-2">
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="actId" value={act.id} />
                    <input type="hidden" name="segmentId" value={segment.id} />
                    <select
                      name="mode"
                      defaultValue={rule?.mode ?? 'none'}
                      disabled={!canWrite}
                      className={`${CONTROL} w-auto`}
                    >
                      <option value="none">{copy.audienceNone}</option>
                      <option value="allow">{copy.audienceAllow}</option>
                      <option value="deny">{copy.audienceDeny}</option>
                    </select>
                    {canWrite && (
                      <button type="submit" className={BUTTON_SOFT}>
                        {copy.edit}
                      </button>
                    )}
                  </form>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[#efeadd] pt-3">
          {!first && (
            <form action={moveActAction}>
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="actId" value={act.id} />
              <input type="hidden" name="direction" value="up" />
              <button type="submit" className={BUTTON_SOFT}>
                {copy.moveUp}
              </button>
            </form>
          )}
          {!last && (
            <form action={moveActAction}>
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="actId" value={act.id} />
              <input type="hidden" name="direction" value="down" />
              <button type="submit" className={BUTTON_SOFT}>
                {copy.moveDown}
              </button>
            </form>
          )}
          {!act.isMain && (
            <form action={removeActAction} className="ms-auto">
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="actId" value={act.id} />
              <button type="submit" className={BUTTON_SOFT}>
                {copy.remove}
              </button>
            </form>
          )}
        </div>
      )}

      {canWrite && (
        <details open={open} className="border-t border-[#efeadd] pt-3">
          <summary className="cursor-pointer text-sm text-[#8a6c22]">{copy.edit}</summary>
          <form action={editActAction} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="actId" value={act.id} />
            <ActFields copy={copy} act={act} />
            <button type="submit" className={`${BUTTON} self-start`}>
              {copy.edit}
            </button>
          </form>
        </details>
      )}
    </article>
  );
}

/** Los campos de un acto. Los mismos al crear y al editar, a propósito. */
function ActFields({ copy, act }: { copy: Copy; act?: ActRow }) {
  const types = copy.types as unknown as Record<string, string | undefined>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className={LABEL}>
        {copy.typeLabel}
        <select name="type" defaultValue={act?.type ?? 'other'} className={CONTROL}>
          {ACT_TYPES.map((type) => (
            <option key={type} value={type}>
              {types[type] ?? type}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        {copy.labelLabel}
        <input
          name="label"
          defaultValue={act?.label ?? ''}
          placeholder={copy.labelPlaceholder}
          maxLength={60}
          className={CONTROL}
        />
      </label>

      <label className={LABEL}>
        {copy.dateLabel}
        <input type="date" name="date" required defaultValue={act?.date ?? ''} className={CONTROL} />
      </label>
      <label className={LABEL}>
        {copy.timeLabel}
        <input type="time" name="time" required defaultValue={act?.time ?? ''} className={CONTROL} />
      </label>

      <label className={LABEL}>
        {copy.endTimeLabel}
        <input type="time" name="endTime" defaultValue={act?.endTime ?? ''} className={CONTROL} />
      </label>
      <label className={LABEL}>
        {copy.timezoneLabel}
        <input
          name="timezone"
          defaultValue={act?.timezone ?? 'Asia/Beirut'}
          className={CONTROL}
        />
      </label>

      <label className={LABEL}>
        {copy.venueNameLabel}
        <input name="venueName" required defaultValue={act?.venueName ?? ''} className={CONTROL} />
      </label>
      <label className={LABEL}>
        {copy.venueAddressLabel}
        <input
          name="venueAddress"
          required
          defaultValue={act?.venueAddress ?? ''}
          className={CONTROL}
        />
      </label>

      <label className={LABEL}>
        {copy.venueMapLabel}
        <input name="venueMapUrl" defaultValue={act?.venueMapUrl ?? ''} className={CONTROL} />
      </label>
      <label className={LABEL}>
        {copy.capacityLabel}
        <input
          type="number"
          min={1}
          name="capacity"
          defaultValue={act?.capacity ?? ''}
          className={CONTROL}
        />
        <span className="text-xs text-[#6b6455]">{copy.capacityHint}</span>
      </label>

      <label className={LABEL}>
        {copy.visibilityLabel}
        <select name="visibility" defaultValue={act?.visibility ?? 'segmented'} className={CONTROL}>
          <option value="segmented">{copy.visibilitySegmented}</option>
          <option value="public">{copy.visibilityPublic}</option>
        </select>
        <span className="text-xs text-[#6b6455]">{copy.visibilityHint}</span>
      </label>
      <label className={LABEL}>
        {copy.deadlineLabel}
        <input
          type="date"
          name="rsvpDeadline"
          defaultValue={act?.rsvpDeadline?.toISOString().slice(0, 10) ?? ''}
          className={CONTROL}
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-[#23201a]">
        <input type="checkbox" name="rsvpEnabled" defaultChecked={act?.rsvpEnabled ?? true} />
        {copy.rsvpLabel}
      </label>
      <label className="flex items-center gap-2 text-sm text-[#23201a]">
        <input type="checkbox" name="optional" defaultChecked={act?.optional ?? false} />
        {copy.optionalLabel}
      </label>
    </div>
  );
}
