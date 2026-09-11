import { redirect } from 'next/navigation';

import { settleOrderAction, startPlanOrderAction } from '@/app/panel/actions';
import { getAdminContext } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { listOrders } from '@/lib/billing/orders';
import { formatMoney, limitsFor, PLAN_CATALOGUE, planLabel } from '@/lib/billing/plans';
import { actorTimezone } from '@/lib/time/actor';
import { formatDate } from '@/lib/time/display';
import { displayFont, latinOnly } from '@/lib/typography';

/** The office's plan, what it has used, and what it has been billed. */
export default async function BillingPage() {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'billing:manage') || session.tenantId === null) {
    redirect('/panel');
  }

  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const zone = await actorTimezone(session);
  const copy = dictionary.admin.billing;
  const scope = scopeOf(session);
  const [limits, orders] = await Promise.all([limitsFor(session.tenantId), listOrders(scope)]);

  return (
    <>
      <h1 className={`${displayFont(locale)} text-3xl`}>{copy.heading}</h1>

      <dl className="flex flex-col border-t border-[#ddd6c6]">
        <div className="flex flex-col gap-1 border-b border-[#ddd6c6] py-4 sm:flex-row sm:gap-6">
          <dt className="text-sm text-[#6a6456] sm:w-48">{copy.plan}</dt>
          <dd>{planLabel(limits.tier, dictionary)}</dd>
        </div>
        <div className="flex flex-col gap-1 border-b border-[#ddd6c6] py-4 sm:flex-row sm:gap-6">
          <dt className="text-sm text-[#6a6456] sm:w-48">{copy.eventsUsed}</dt>
          <dd className="tabular-nums">
            {limits.eventsUsed} / {limits.maxEvents ?? copy.unlimited}
          </dd>
        </div>
      </dl>

      <section className="flex flex-col gap-4">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.choosePlan}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {PLAN_CATALOGUE.map((plan) => (
            <form
              key={plan.tier}
              action={startPlanOrderAction}
              className="flex items-center justify-between gap-4 border border-[#ddd6c6] bg-white/60 px-4 py-3"
            >
              <input type="hidden" name="tier" value={plan.tier} />
              <span className="flex flex-col">
                <span>{planLabel(plan.tier, dictionary)}</span>
                <span className="text-sm tabular-nums text-[#6a6456]">
                  {formatMoney(plan.priceMonthly, 'USD', locale)}
                </span>
              </span>
              <button
                type="submit"
                disabled={plan.tier === limits.tier}
                className="border border-[#23201a] px-4 py-2 text-sm hover:opacity-70 disabled:opacity-30"
              >
                {copy.pay}
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.orders}</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-[#6a6456]">{copy.noOrders}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-sm">
              <thead>
                <tr className={`border-b border-[#c9bfa6] text-xs ${latinOnly(locale, 'uppercase tracking-[0.12em]')} text-[#8a6c22]`}>
                  <th className="py-2 text-start">{copy.created}</th>
                  <th className="py-2 text-start">{copy.plan}</th>
                  <th className="py-2 text-end">{copy.amount}</th>
                  <th className="py-2 text-start">{copy.state}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-[#ddd6c6]">
                    <td className="py-3 tabular-nums text-[#6a6456]">
                      {formatDate(order.createdAt, locale, zone)}
                    </td>
                    <td className="py-3">
                      {order.description}
                      {/* El código va JUNTO a la factura que paga. Escrito en
                          otra pantalla no lo encuentra nadie, y sin él un SINPE
                          no se puede casar con nada: llega el dinero y no se
                          sabe de quién es. */}
                      {order.status === 'pending' && order.payCode !== null ? (
                        <span
                          className="ms-2 border border-[#ddd6c6] bg-white px-2 py-0.5 font-mono text-xs text-[#8a6c22]"
                          dir="ltr"
                          title={dictionary.admin.sinpe.payCodeHint}
                        >
                          {order.payCode}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 text-end tabular-nums">
                      {formatMoney(order.amount, order.currency, locale)}
                    </td>
                    <td className="py-3 text-[#6a6456]">{order.status}</td>
                    <td className="py-3 text-end">
                      {order.status === 'pending' ? (
                        <form action={settleOrderAction}>
                          <input type="hidden" name="orderId" value={order.id} />
                          <button type="submit" className="underline text-[#8a6c22]">
                            {copy.pay}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
