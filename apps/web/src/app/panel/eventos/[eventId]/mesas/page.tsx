import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  addTableAction,
  autoSeatAction,
  clearSeatingAction,
  editTableAction,
  removeTableAction,
  seatGuestAction,
} from '@/app/panel/eventos/[eventId]/mesas/actions';
import { getAdminContext } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { readSeating, type SeatedGuest, type TableRow } from '@/lib/tables/service';
import { displayFont } from '@/lib/typography';
import { interpolate, plural, type Dictionary } from '@citas/core';

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ error?: string; sentados?: string; levantados?: string }>;
}

const CONTROL = 'h-10 border border-[#cdc6b6] bg-white px-3 text-sm text-[#23201a] outline-none focus-visible:border-[#8a6c22] focus-visible:ring-2 focus-visible:ring-[#c9a227]';
const BUTTON = 'h-10 border border-[#23201a] bg-white px-4 text-sm text-[#23201a] hover:opacity-70';
const BUTTON_SOFT = 'h-10 border border-[#ddd6c6] bg-white px-4 text-sm text-[#23201a] hover:opacity-70';

/**
 * El reparto del salón.
 *
 * Existe porque esto se hacía en una hoja de cálculo aparte, y la hoja no se
 * entera de que ayer tres invitados cancelaron. Aquí las sillas las cuenta la
 * misma base que guarda las confirmaciones: quien no ha contestado no ocupa
 * sitio, y quien se sentó y luego dijo que no sigue en su mesa, señalado, hasta
 * que una persona decida qué hacer con él.
 *
 * Sin JavaScript de cliente, como el resto: cada fila es su propio formulario.
 */
export default async function TablesPage({ params, searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:read') || session.tenantId === null) {
    redirect('/panel');
  }

  const { eventId } = await params;
  const { error, sentados, levantados } = await searchParams;
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.tables;

  const seating = await readSeating(scopeOf(session), eventId);
  if (seating === null) redirect('/panel');

  const canWrite = sessionCan(session, 'event:write');
  const short = seating.needed > seating.available;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={`/panel/eventos/${eventId}`} className="text-sm text-[#8a6c22] hover:underline">
          {copy.back}
        </Link>
        <h1 className={`${displayFont(locale)} text-3xl`}>{copy.heading}</h1>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.intro}</p>
        <p className={`text-sm ${short ? 'text-[#8c2f1e]' : 'text-[#6a6456]'}`}>
          {interpolate(copy.balance, {
            needed: String(seating.needed),
            available: String(seating.available),
          })}
        </p>
      </header>

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-[#8c2f1e]">
          {error === 'duplicate' ? copy.duplicate : copy.notFound}
        </p>
      )}
      {sentados === undefined ? null : (
        <p className="text-sm text-[#2f6b3a]">
          {plural(locale, copy.movedCount, Number.parseInt(sentados, 10) || 0)}
        </p>
      )}
      {levantados === undefined ? null : (
        <p className="text-sm text-[#8a6c22]">
          {plural(locale, copy.clearedCount, Number.parseInt(levantados, 10) || 0)}
        </p>
      )}

      {canWrite ? (
        <section className="flex flex-col gap-4 border border-[#ddd6c6] bg-white/60 p-5">
          <form action={addTableAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="eventId" value={eventId} />
            <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
              {dictionary.admin.guests.name}
              <input
                name="name"
                maxLength={60}
                placeholder={copy.namePlaceholder}
                className={`${CONTROL} w-64`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
              {copy.seatsLabel}
              <input
                type="number"
                name="seats"
                min={1}
                max={50}
                defaultValue={10}
                dir="ltr"
                className={`${CONTROL} w-20 tabular-nums`}
              />
            </label>
            <button type="submit" className={BUTTON}>
              {copy.add}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-3 border-t border-[#ddd6c6] pt-4">
            <form action={autoSeatAction}>
              <input type="hidden" name="eventId" value={eventId} />
              <button type="submit" className={BUTTON_SOFT} disabled={seating.tables.length === 0}>
                {copy.autoSeat}
              </button>
            </form>
            <form action={clearSeatingAction}>
              <input type="hidden" name="eventId" value={eventId} />
              <button type="submit" className="text-sm text-[#8c2f1e] underline">
                {copy.clear}
              </button>
            </form>
            <span className="text-xs text-[#6a6456]">{copy.autoSeatHint}</span>
          </div>
        </section>
      ) : null}

      <section className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-[#6a6456]">{copy.print}:</span>
        <Link
          href={`/panel/eventos/${eventId}/mesas/imprimir?vista=mesa`}
          className="text-[#8a6c22] underline"
        >
          {copy.printByTable}
        </Link>
        <Link
          href={`/panel/eventos/${eventId}/mesas/imprimir?vista=invitado`}
          className="text-[#8a6c22] underline"
        >
          {copy.printByGuest}
        </Link>
        <span className="text-xs text-[#6a6456]">{copy.printHint}</span>
      </section>

      {/* Los que faltan por sentar van ARRIBA y no al final: es la única lista
          de esta pantalla sobre la que hay algo que hacer. */}
      <section className="flex flex-col gap-3">
        <h2 className={`${displayFont(locale)} text-xl`}>
          {copy.unseated}
          {seating.unseated.length === 0 ? '' : ` · ${seating.unseated.length}`}
        </h2>
        {seating.unseated.length === 0 ? (
          <p className="text-sm text-[#2f6b3a]">{copy.unseatedEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {seating.unseated.map((guest) => (
              <li key={guest.id} className="flex flex-wrap items-center gap-3 border-b border-[#e7e0d2] pb-2">
                <GuestName guest={guest} copy={copy} />
                {canWrite ? (
                  <SeatPicker
                    eventId={eventId}
                    guest={guest}
                    current={null}
                    tables={seating.tables}
                    copy={copy}
                    saveLabel={dictionary.admin.config.save}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {seating.tables.length === 0 ? (
        <p className="text-sm text-[#6a6456]">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col gap-6">
          {seating.tables.map((table) => (
            <li key={table.id} className="flex flex-col gap-3 border border-[#ddd6c6] bg-white/60 p-5">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className={`${displayFont(locale)} text-lg`}>{table.name}</span>
                <span
                  className={`text-sm tabular-nums ${
                    table.taken > table.seats ? 'text-[#8c2f1e]' : 'text-[#6a6456]'
                  }`}
                >
                  {interpolate(copy.occupancy, {
                    taken: String(table.taken),
                    seats: String(table.seats),
                  })}
                </span>
                {table.taken > table.seats ? (
                  <span className="text-sm text-[#8c2f1e]">{copy.overflow}</span>
                ) : null}
              </div>

              {table.guests.length === 0 ? (
                <p className="text-sm text-[#6a6456]">{copy.seatedNobody}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {table.guests.map((guest) => (
                    <li
                      key={guest.id}
                      className="flex flex-wrap items-center gap-3 border-b border-[#e7e0d2] pb-2 last:border-0"
                    >
                      <GuestName guest={guest} copy={copy} />
                      {canWrite ? (
                        <SeatPicker
                          eventId={eventId}
                          guest={guest}
                          current={table.id}
                          tables={seating.tables}
                          copy={copy}
                          saveLabel={dictionary.admin.config.save}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {canWrite ? (
                <div className="flex flex-wrap items-center gap-3 border-t border-[#ddd6c6] pt-3">
                  <form action={editTableAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="tableId" value={table.id} />
                    <input
                      name="name"
                      defaultValue={table.name}
                      maxLength={60}
                      className={`${CONTROL} w-56`}
                    />
                    <input
                      type="number"
                      name="seats"
                      min={1}
                      max={50}
                      defaultValue={table.seats}
                      dir="ltr"
                      className={`${CONTROL} w-20 tabular-nums`}
                    />
                    <button type="submit" className={BUTTON_SOFT}>
                      {dictionary.admin.config.save}
                    </button>
                  </form>
                  <form action={removeTableAction} className="ms-auto">
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="tableId" value={table.id} />
                    <button type="submit" className="text-sm text-[#8c2f1e] underline">
                      {dictionary.admin.whatsapp.remove}
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** El nombre, con cuántas sillas ocupa y el aviso de que ya no viene. */
function GuestName({
  guest,
  copy,
}: {
  guest: SeatedGuest;
  copy: Dictionary['admin']['tables'];
}) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-[#23201a]">
      {guest.name}
      {guest.seats > 1 ? (
        <span className="tabular-nums text-xs text-[#6a6456]">×{guest.seats}</span>
      ) : null}
      {/* Sentado y que ya no viene. No se le quita el sitio solo: la mesa la
          montó una persona y puede querer dejar el hueco donde está. */}
      {guest.seats === 0 ? <span className="text-xs text-[#8c2f1e]">{copy.ghost}</span> : null}
    </span>
  );
}

/** Un desplegable con todas las mesas y su botón. Sin JavaScript de cliente. */
function SeatPicker({
  eventId,
  guest,
  current,
  tables,
  copy,
  saveLabel,
}: {
  eventId: string;
  guest: SeatedGuest;
  current: string | null;
  tables: TableRow[];
  copy: Dictionary['admin']['tables'];
  saveLabel: string;
}) {
  return (
    <form action={seatGuestAction} className="ms-auto flex items-center gap-2">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="guestId" value={guest.id} />
      <label className="sr-only" htmlFor={`mesa-${guest.id}`}>
        {copy.heading}
      </label>
      <select
        id={`mesa-${guest.id}`}
        name="tableId"
        defaultValue={current ?? ''}
        className="h-10 border border-[#cdc6b6] bg-white px-3 text-sm text-[#23201a]"
      >
        <option value="">{copy.noTable}</option>
        {tables.map((table) => (
          <option key={table.id} value={table.id}>
            {table.name}
          </option>
        ))}
      </select>
      <button type="submit" className="h-10 border border-[#ddd6c6] bg-white px-3 text-sm hover:opacity-70">
        {saveLabel}
      </button>
    </form>
  );
}
