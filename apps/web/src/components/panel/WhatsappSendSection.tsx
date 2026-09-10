import {
  cancelScheduledAction,
  queueWhatsappAction,
  retryFailedAction,
  setReminderAction,
} from '@/app/panel/eventos/actions';
import { FIELD_CLASS } from '@/components/create/Field';
import type { ConnectionRow, FailedMessage, QueueStats } from '@/lib/whatsapp/connections';
import { REMINDER_DAYS } from '@/lib/whatsapp/reminders';
import { utcToZoned } from '@/lib/time/zoned';
import { displayFont } from '@/lib/typography';
import { interpolate, plural, type Dictionary, type Locale } from '@citas/core';

/**
 * Mandar las invitaciones desde el número de la oficina.
 *
 * Convive con el envío a mano y no lo sustituye: la columna de `wa.me` sigue
 * ahí, invitado por invitado, y es lo que se usa cuando no hay ningún número
 * conectado. Esto añade una forma de enviar, no quita la anterior.
 *
 * El botón ENCOLA. No manda. Lo que sale del botón son filas; lo que manda es
 * el servicio, de uno en uno y con su freno.
 */
export function WhatsappSendSection({
  eventId,
  connections,
  stats,
  scheduled,
  reminderDays,
  failed,
  timezone,
  dictionary,
  locale,
}: {
  eventId: string;
  connections: ConnectionRow[];
  stats: QueueStats;
  /** La tanda que está esperando su hora, si es que hay una. */
  scheduled: { count: number; at: Date } | null;
  /** Cuántos días antes se recuerda a quien no ha contestado. Nulo = nunca. */
  reminderDays: number | null;
  /** Los que se rindieron, con nombre y motivo. */
  failed: FailedMessage[];
  /** El reloj de quien mira: con él se escribe y con él se lee la hora. */
  timezone: string;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.whatsapp;
  const connected = connections.filter((connection) => connection.status === 'connected');

  const cuando = (instant: Date): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: timezone })
      .format(instant);

  return (
    <section id="whatsapp" className="flex flex-col gap-4 border-t border-[#ddd6c6] pt-6">
      <h2 className={`${displayFont(locale)} text-xl`}>{copy.sendHeading}</h2>
      <p className="max-w-xl text-sm text-[#6a6456]">{copy.sendHint}</p>

      <p className="text-sm text-[#6a6456] tabular-nums">
        {interpolate(copy.queuedCount, {
          queued: String(stats.queued),
          sent: String(stats.sent),
          failed: String(stats.failed),
        })}
      </p>

      {/* Una tanda con fecha es una promesa a plazo. Verla y poder deshacerla es
          lo que la separa de una bomba: la pareja cambia el día, o alguien se
          equivoca de mes, y hasta ahora no habría forma de enterarse antes de
          que doscientas personas recibieran el mensaje. */}
      {scheduled === null ? null : (
        <div className="flex flex-wrap items-center gap-4 border border-[#c9a227] bg-[#fdf9ee] p-4">
          <p className="text-sm text-[#8a6c22]">
            {plural(locale, copy.scheduledFor, scheduled.count, { when: cuando(scheduled.at) })}
          </p>
          <form action={cancelScheduledAction} className="ms-auto">
            <input type="hidden" name="eventId" value={eventId} />
            <button type="submit" className="text-sm underline text-[#8c2f1e]">
              {copy.cancelScheduled}
            </button>
          </form>
        </div>
      )}

      {/* Las que se rindieron. Plegadas, porque lo normal es que no haya
          ninguna; pero abiertas dicen A QUIÉN no le llegó y por qué, que es lo
          único que sirve. Antes solo salía el número, y «12 fallidas» sobre
          doscientas es una frase que preocupa y no deja hacer nada. */}
      {failed.length === 0 ? null : (
        <details className="border border-[#e0c9c3] bg-[#fdf4f2]">
          <summary className="cursor-pointer px-4 py-3 text-sm text-[#8c2f1e]">
            {plural(locale, copy.failedTitle, failed.length)}
          </summary>

          <div className="flex flex-col gap-3 px-4 pb-4">
            <ul className="flex flex-col gap-2">
              {failed.map((message) => (
                <li
                  key={message.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[#e0c9c3] pt-2 text-sm"
                >
                  <span>{message.name ?? '—'}</span>
                  <span className="font-mono text-xs text-[#6a6456]" dir="ltr">
                    {message.phone}
                  </span>
                  {/* «No salió» y «no consta si llegó» son cosas distintas, y
                      tratarlas igual llevaría a reenviar un mensaje que ya
                      está en el teléfono de alguien. */}
                  <span
                    className={
                      message.status === 'sent_unknown'
                        ? 'text-xs text-[#8a6c22]'
                        : 'text-xs text-[#8c2f1e]'
                    }
                  >
                    {message.status === 'sent_unknown' ? `${copy.unsure} · ` : ''}
                    {message.reason ?? ''}
                  </span>
                  <form action={retryFailedAction} className="ms-auto">
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="messageId" value={message.id} />
                    <button type="submit" className="text-xs underline text-[#8a6c22]">
                      {copy.retry}
                    </button>
                  </form>
                </li>
              ))}
            </ul>

            <p className="text-xs text-[#6a6456]">{copy.failedHint}</p>

            <form action={retryFailedAction}>
              <input type="hidden" name="eventId" value={eventId} />
              <button
                type="submit"
                className="border border-[#23201a] px-4 py-2 text-sm hover:opacity-70"
              >
                {copy.retryAll}
              </button>
            </form>
          </div>
        </details>
      )}

      {connected.length === 0 ? (
        <p className="text-sm text-[#8a6c22]">
          {copy.noConnection}{' '}
          <a href="/panel/configuracion?s=whatsapp" className="underline">
            {copy.heading}
          </a>
        </p>
      ) : (
        <form action={queueWhatsappAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="eventId" value={eventId} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#6a6456]">{copy.heading}</span>
            <select name="connectionId" className={FIELD_CLASS}>
              {connected.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                  {connection.phone === null ? '' : ` · +${connection.phone}`}
                </option>
              ))}
            </select>
          </label>

          {/* Vacío es «ahora», que es como funcionaba antes de existir esto:
              quien no quiera programar nada no tiene que tocar el campo. */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#6a6456]">{copy.scheduleLabel}</span>
            <input
              type="datetime-local"
              name="scheduledAt"
              min={utcToZoned(new Date(), timezone)}
              className={FIELD_CLASS}
              dir="ltr"
            />
          </label>

          <button type="submit" className="border border-[#23201a] px-5 py-2.5 text-sm hover:opacity-70">
            {copy.send}
          </button>
        </form>
      )}

      {connected.length === 0 ? null : (
        <p className="max-w-xl text-xs text-[#6a6456]">
          {interpolate(copy.scheduleHint, { zone: timezone })}
        </p>
      )}

      {/* El recordatorio. Va aquí y no en la ficha del evento porque sale por
          el mismo número y por la misma cola: quien decide una cosa está
          decidiendo la otra. */}
      <form
        action={setReminderAction}
        className="flex flex-wrap items-end gap-3 border-t border-[#ddd6c6] pt-5"
      >
        <input type="hidden" name="eventId" value={eventId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[#6a6456]">{copy.reminderLabel}</span>
          <select name="reminderDays" defaultValue={reminderDays ?? ''} className={FIELD_CLASS}>
            <option value="">{copy.reminderOff}</option>
            {REMINDER_DAYS.map((days) => (
              <option key={days} value={days}>
                {plural(locale, copy.reminderDays, days)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="border border-[#ddd6c6] px-4 py-2.5 text-sm hover:opacity-70">
          {dictionary.admin.config.save}
        </button>
        <p className="w-full max-w-xl text-xs text-[#6a6456]">{copy.reminderHint}</p>
      </form>
    </section>
  );
}
