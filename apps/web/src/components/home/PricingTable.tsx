import { numberingSystemSubtag } from '@citas/core';

import type { ResolvedSite } from '@/lib/home/site';
import { formatMoney, PLAN_CATALOGUE } from '@/lib/billing/plans';
import { defaultNumerals } from '@/lib/create/options';
import { displayFont } from '@/lib/typography';
import type { Dictionary, Locale } from '@/lib/types';

/**
 * The price table, read from the billing catalogue rather than retyped here:
 * a page that advertises a price the checkout does not charge is worse than no
 * page. Amounts are whole cents until the moment they are formatted.
 */
export function PricingTable({ dictionary, locale, site }: { dictionary: Dictionary; locale: Locale; site: ResolvedSite }) {
  const copy = dictionary.home.pricing;
  const names = dictionary.admin.billing;
  // Arabic reading gets Arabic-Indic digits here too. A page that writes ٥٠
  // guests two blocks above and 50.00 in the price is two pages.
  const money = `${locale}-u-nu-${numberingSystemSubtag(defaultNumerals(locale))}`;
  const labels = {
    free: names.planFree,
    single_event: names.planSingle,
    annual: names.planAnnual,
    office: names.planOffice,
  };

  return (
    <div className="flex flex-col gap-8">
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {site.plans.map((key) => {
          const plan = PLAN_CATALOGUE.find((entry) => entry.tier === key);
          if (plan === undefined) return null;

          const monthly = plan.priceMonthly > 0;
          const perEvent = plan.pricePerEvent > 0;
          const amount = monthly ? plan.priceMonthly : plan.pricePerEvent;

          return (
            <li
              key={key}
              className="flex flex-col gap-4 rounded-lg border border-[#2A2419] bg-[#1A1712] p-6"
            >
              <h3 className={`${displayFont(locale)} text-xl text-[#F4EFE6]`}>{labels[key]}</h3>

              <p className="flex flex-wrap items-baseline gap-2">
                <span className={`${displayFont(locale)} text-3xl text-[#E4C76B]`} dir="ltr">
                  {monthly || perEvent ? formatMoney(amount, 'USD', money) : copy.free}
                </span>
                {monthly || perEvent ? (
                  <span className="text-xs text-[#786F5D]">
                    {monthly ? copy.perMonth : copy.perEvent}
                  </span>
                ) : null}
              </p>

              <p className="flex-1 text-sm leading-relaxed text-[#A79C86]">{copy.benefits[key]}</p>

              <a
                href={site.routes.create}
                className="rounded-full border border-[#4A3F26] px-5 py-2.5 text-center text-sm text-[#F4EFE6] transition-colors hover:border-[#C9A227]"
              >
                {copy.cta}
              </a>
            </li>
          );
        })}
      </ul>

      <p className="max-w-2xl text-xs leading-relaxed text-[#786F5D]">{copy.note}</p>
    </div>
  );
}
