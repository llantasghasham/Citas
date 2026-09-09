import type { PlanTier } from '@/generated/prisma/enums';
import { recordAudit } from '@/lib/audit';
import { getPrisma } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { getPaymentProvider } from '@/lib/payments';

export interface OrderRow {
  id: string;
  amount: number;
  currency: string;
  description: string;
  status: string;
  createdAt: Date;
  paymentId: string | null;
  payUrl: string | null;
}

export async function listOrders(scope: TenantScope): Promise<OrderRow[]> {
  const orders = await getPrisma().order.findMany({
    where: scopedWhere(scope),
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  return orders.map((order) => {
    const payment = order.payments[0];
    return {
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      description: order.description,
      status: order.status,
      createdAt: order.createdAt,
      paymentId: payment?.id ?? null,
      payUrl: null,
    };
  });
}

/**
 * Opens an order for a plan and asks the provider for a collection. The order
 * exists before the provider is called, so a payment can always be traced back
 * to something we wrote down first.
 */
export async function startPlanOrder(
  scope: TenantScope,
  tier: PlanTier,
  actorId: string,
  origin: string,
): Promise<{ orderId: string; payUrl: string | null }> {
  const prisma = getPrisma();
  const plan = await prisma.plan.findUnique({ where: { tier } });
  if (plan === null) throw new Error(`Unknown plan tier "${tier}".`);

  const order = await prisma.order.create({
    data: {
      ...scopedWhere(scope),
      amount: plan.priceMonthly,
      currency: 'USD',
      description: `Plan ${plan.name}`,
      status: 'pending',
    },
  });

  const provider = await getPaymentProvider();
  const handle = await provider.createCollection({
    orderId: order.id,
    amount: { amount: order.amount, currency: 'USD' },
    description: order.description,
    successUrl: `${origin}/panel/facturacion?order=${order.id}`,
    failureUrl: `${origin}/panel/facturacion?order=${order.id}&failed=1`,
    callbackUrl: `${origin}/api/payments/${provider.id}/callback`,
  });

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: provider.id === 'whish' ? 'whish' : 'manual',
      providerRef: handle.providerRef,
      status: 'pending',
      amount: order.amount,
      currency: 'USD',
    },
  });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'order.open',
    entity: 'Order',
    entityId: order.id,
    metadata: { tier, amount: order.amount },
  });

  return { orderId: order.id, payUrl: handle.payUrl ?? null };
}

/**
 * Asks the provider what really happened and writes the answer down. This — not
 * the browser and not the callback body — is what decides that an order is paid.
 */
export async function settleOrder(scope: TenantScope, orderId: string): Promise<boolean> {
  const prisma = getPrisma();
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...scopedWhere(scope) },
    include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  const payment = order?.payments[0];
  if (order === null || payment === undefined) return false;

  const status = await (await getPaymentProvider()).getStatus(payment.providerRef);

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status,
      lastCheckedAt: new Date(),
      paidAt: status === 'paid' ? new Date() : null,
      events: { create: { kind: 'poll', payload: { status } } },
    },
  });
  await prisma.order.update({ where: { id: order.id }, data: { status } });

  if (status !== 'paid') return false;

  // Paying for a plan is what actually moves the office onto it.
  const tier = order.description.replace('Plan ', '');
  const plan = await prisma.plan.findFirst({ where: { name: tier } });
  if (plan !== null) {
    await prisma.subscription.upsert({
      where: { tenantId: scope.tenantId },
      update: { planId: plan.id, cancelledAt: null },
      create: { tenantId: scope.tenantId, planId: plan.id },
    });
  }

  await recordAudit({
    tenantId: scope.tenantId,
    action: 'order.paid',
    entity: 'Order',
    entityId: order.id,
    metadata: { amount: order.amount },
  });

  return true;
}
