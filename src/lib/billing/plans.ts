import type { PlanTier } from '@/generated/prisma/enums';
import { getPrisma } from '@/lib/db/client';
import type { Dictionary } from '@/lib/types';

/** The catalogue. Prices are in USD cents — money never touches a float. */
export const PLAN_CATALOGUE: {
  tier: PlanTier;
  name: string;
  priceMonthly: number;
  pricePerEvent: number;
  maxEvents: number | null;
  maxGuests: number | null;
  whiteLabel: boolean;
}[] = [
  { tier: 'free', name: 'Free', priceMonthly: 0, pricePerEvent: 0, maxEvents: 1, maxGuests: 50, whiteLabel: false },
  { tier: 'single_event', name: 'Single event', priceMonthly: 0, pricePerEvent: 3000, maxEvents: null, maxGuests: 300, whiteLabel: false },
  { tier: 'annual', name: 'Annual', priceMonthly: 1500, pricePerEvent: 0, maxEvents: 10, maxGuests: 500, whiteLabel: false },
  { tier: 'office', name: 'Office', priceMonthly: 12000, pricePerEvent: 0, maxEvents: null, maxGuests: null, whiteLabel: true },
];

export function planLabel(tier: PlanTier, dictionary: Dictionary): string {
  const copy = dictionary.admin.billing;
  const labels: Record<PlanTier, string> = {
    free: copy.planFree,
    single_event: copy.planSingle,
    annual: copy.planAnnual,
    office: copy.planOffice,
  };
  return labels[tier];
}

/** Cents to a readable amount. Never rounds a total into existence. */
export function formatMoney(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

export interface TenantLimits {
  tier: PlanTier;
  maxEvents: number | null;
  maxGuests: number | null;
  eventsUsed: number;
}

/** What this office may still do. A tenant with no subscription is on `free`. */
export async function limitsFor(tenantId: string): Promise<TenantLimits> {
  const prisma = getPrisma();

  const [subscription, eventsUsed] = await Promise.all([
    prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
    prisma.event.count({ where: { tenantId } }),
  ]);

  const plan = subscription?.plan;

  // `null` on a plan means unlimited, so it must not fall through to the free
  // plan's limits: coalescing here once billed an office out of its own events.
  if (plan === undefined) {
    const free = PLAN_CATALOGUE[0];
    return {
      tier: 'free',
      maxEvents: free?.maxEvents ?? null,
      maxGuests: free?.maxGuests ?? null,
      eventsUsed,
    };
  }

  return {
    tier: plan.tier,
    maxEvents: plan.maxEvents,
    maxGuests: plan.maxGuests,
    eventsUsed,
  };
}

/** True when another event would go past the plan. */
export async function eventLimitReached(tenantId: string): Promise<boolean> {
  const limits = await limitsFor(tenantId);
  return limits.maxEvents !== null && limits.eventsUsed >= limits.maxEvents;
}
