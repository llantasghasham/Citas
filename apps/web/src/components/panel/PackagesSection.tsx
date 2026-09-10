import { markCashAction, sellPackageAction } from '@/app/panel/eventos/actions';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import type { SoldPackage } from '@/lib/billing/checkout';
import { formatMoney } from '@/lib/billing/plans';
import { PACKAGE_CATALOGUE, priceFor } from '@/lib/billing/packages';
import type { GuestAllowance } from '@/lib/billing/packages';
import { COUNTRY_CODES, toWaMe } from '@/lib/guests/phone';
import { formatDate } from '@/lib/time/display';
import { displayFont, latinOnly } from '@/lib/typography';
import type { AcquisitionChannel } from '@/generated/prisma/enums';
import { interpolate, type Dictionary, type Locale } from '@citas/core';

interface Props {
  eventId: string;
  channel: AcquisitionChannel;
  allowance: GuestAllowance;
  sold: SoldPackage[];
  /** El token recién creado, para señalar cuál es el enlace nuevo. */
  justSold?: string;
  origin: string;
  dictionary: Dictionary;
  locale: Locale;
  /** El reloj de quien mira: una fecha en UTC discute mal una factura. */
  timezone: string;
  canSell: boolean;
  /** True cuando el efectivo está encendido en la configuración. */
  cashEnabled: boolean;
}

/**
 * Vender un paquete de invitaciones para esta boda, y ver lo ya vendido.
 *
 * Vive en la pantalla del evento y no en la de facturación a propósito: lo que
 * se vende aquí es de ESTA boda, y quien lo vende está mirando la lista de
 * invitados que no le cabe. La facturación es de la oficina; esto es del evento.
 *
 * El precio no se escribe: sale del canal del evento. Una oficina con licencia
 * ve el mayorista, una venta directa ve el de la pareja, y nadie teclea una
 * cifra que luego haya que cuadrar.
 */
export function PackagesSection({
  eventId,
  channel,
  allowance,
  sold,
  justSold,
  origin,
  dictionary,
  locale,
  timezone,
  canSell,
  cashEnabled,
}: Props) {
  const copy = dictionary.admin.packages;
  const billing = dictionary.admin.billing;

  return (
    <section id="paquetes" className="flex flex-col gap-4">
      <h2 className={`${displayFont(locale)} text-2xl`}>{copy.heading}</h2>

      <p className="text-sm text-[#6a6456]">
        {copy.allowance}: <span className="tabular-nums">{allowance.used}</span> /{' '}
        <span className="tabular-nums">{allowance.allowed ?? billing.unlimited}</span>{' '}
        <span className="text-[#8a6c22]">
          ({allowance.fromPackage ? copy.fromPackage : copy.fromPlan})
        </span>
      </p>

      {justSold === undefined ? null : (
        <p className="border border-[#c9a227] bg-[#fdf9ef] p-4 text-sm text-[#8a6c22]">
          {copy.created}
        </p>
      )}

      {canSell ? (
        <form action={sellPackageAction} className="flex flex-col gap-4 border border-[#ddd6c6] bg-white/60 p-5">
          <input type="hidden" name="eventId" value={eventId} />
          <p className="text-sm text-[#6a6456]">{copy.hint}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={copy.clientLabel}>
              <input name="clientName" required maxLength={120} className={FIELD_CLASS} />
            </Field>
            <Field label={copy.clientPhoneLabel}>
              <div className="flex gap-2">
                <select name="country" defaultValue="+961" className={`${FIELD_CLASS} w-28`} dir="ltr">
                  {COUNTRY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <input name="clientPhone" inputMode="tel" dir="ltr" className={`${FIELD_CLASS} flex-1`} />
              </div>
            </Field>
          </div>

          <Field label={copy.packageLabel}>
            <select name="packageId" defaultValue="p200" className={FIELD_CLASS}>
              {PACKAGE_CATALOGUE.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {interpolate(dictionary.pay.guestsLine, { guests: String(pack.guests) })} ·{' '}
                  {formatMoney(priceFor(pack, channel), 'USD', locale)}
                </option>
              ))}
            </select>
          </Field>

          <button
            type="submit"
            className="self-start border border-[#23201a] px-5 py-2 text-sm hover:opacity-70"
          >
            {copy.sell}
          </button>
        </form>
      ) : null}

      <h3 className={`${displayFont(locale)} text-lg`}>{copy.sold}</h3>
      {sold.length === 0 ? (
        <p className="text-sm text-[#6a6456]">{copy.noneSold}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className={`border-b border-[#c9bfa6] text-xs ${latinOnly(locale, 'uppercase tracking-[0.12em]')} text-[#8a6c22]`}>
                <th className="py-2 text-start">{billing.created}</th>
                <th className="py-2 text-start">{copy.clientLabel}</th>
                <th className="py-2 text-end">{copy.guestsColumn}</th>
                <th className="py-2 text-end">{billing.amount}</th>
                <th className="py-2 text-start">{billing.state}</th>
                <th className="py-2 text-end">{copy.payLink}</th>
              </tr>
            </thead>
            <tbody>
              {sold.map((order) => {
                const link = `${origin}/pagar/${order.payToken}`;
                const message = interpolate(copy.whatsappMessage, {
                  name: order.clientName ?? '',
                  guests: String(order.guests),
                  link,
                });

                return (
                  <tr
                    key={order.orderId}
                    className={`border-b border-[#ddd6c6] ${
                      order.payToken === justSold ? 'bg-[#fdf9ef]' : ''
                    }`}
                  >
                    <td className="py-3 tabular-nums text-[#6a6456]">
                      {formatDate(order.createdAt, locale, timezone)}
                    </td>
                    <td className="py-3">{order.clientName ?? '—'}</td>
                    <td className="py-3 text-end tabular-nums">{order.guests}</td>
                    <td className="py-3 text-end tabular-nums">
                      {formatMoney(order.amount, order.currency, locale)}
                    </td>
                    <td
                      className={`py-3 ${order.status === 'paid' ? 'text-[#3d5a2f]' : 'text-[#6a6456]'}`}
                    >
                      {order.status}
                    </td>
                    <td className="py-3 text-end">
                      {order.status === 'paid' ? null : (
                        <span className="flex flex-col items-end gap-1">
                          {/* El enlace en claro además del botón: la oficina lo
                              copia y lo manda por donde quiera, no solo por
                              WhatsApp. */}
                          <a href={link} className="font-mono text-xs underline text-[#8a6c22]" dir="ltr">
                            /pagar/{order.payToken.slice(0, 8)}…
                          </a>
                          <a
                            className="underline text-[#8a6c22]"
                            target="_blank"
                            rel="noreferrer"
                            href={`https://wa.me/${
                              order.clientPhone === null ? '' : toWaMe(order.clientPhone)
                            }?text=${encodeURIComponent(message)}`}
                          >
                            {copy.sendLink}
                          </a>
                          {/* En efectivo no hay proveedor que confirme: lo
                              anota quien recibió el dinero, con su nombre. */}
                          {cashEnabled && canSell ? (
                            <form action={markCashAction}>
                              <input type="hidden" name="eventId" value={eventId} />
                              <input type="hidden" name="orderId" value={order.orderId} />
                              <button type="submit" className="underline text-[#6a6456]">
                                {copy.markCash}
                              </button>
                            </form>
                          ) : null}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
