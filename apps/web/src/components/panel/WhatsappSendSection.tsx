import { queueWhatsappAction } from '@/app/panel/eventos/actions';
import { FIELD_CLASS } from '@/components/create/Field';
import type { ConnectionRow } from '@/lib/whatsapp/connections';
import type { QueueStats } from '@/lib/whatsapp/connections';
import { displayFont } from '@/lib/typography';
import { interpolate, type Dictionary, type Locale } from '@citas/core';

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
  dictionary,
  locale,
}: {
  eventId: string;
  connections: ConnectionRow[];
  stats: QueueStats;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.whatsapp;
  const connected = connections.filter((connection) => connection.status === 'connected');

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
          <button type="submit" className="border border-[#23201a] px-5 py-2.5 text-sm hover:opacity-70">
            {copy.send}
          </button>
        </form>
      )}
    </section>
  );
}
