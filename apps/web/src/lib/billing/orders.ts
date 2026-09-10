import type { PlanTier } from '@/generated/prisma/enums';
import { recordAudit } from '@/lib/audit';
import { applySettlement } from '@/lib/billing/reconcile';
import { getPrisma } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { getPaymentProvider, providerFor } from '@/lib/payments';

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

  const provider = await getPaymentProvider();

  // Si esta oficina ya tiene un pedido de ESTE plan abierto y sin pagar, se
  // reutiliza con su enlace. Sin esto, pulsar dos veces —o volver atrás cuando
  // la pasarela tarda— dejaba dos facturas abiertas por lo mismo, y la oficina
  // veía dos cobros pendientes del mismo plan sin saber cuál pagar.
  const open = await prisma.order.findFirst({
    where: {
      ...scopedWhere(scope),
      description: `Plan ${plan.name}`,
      status: 'pending',
      payments: { some: { provider: provider.id, status: 'pending', payUrl: { not: null } } },
    },
    select: {
      id: true,
      payments: {
        where: { provider: provider.id, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { payUrl: true },
      },
    },
  });
  const reusable = open?.payments[0]?.payUrl;
  if (open !== null && reusable != null) return { orderId: open.id, payUrl: reusable };

  const order = await prisma.order.create({
    data: {
      ...scopedWhere(scope),
      amount: plan.priceMonthly,
      currency: 'USD',
      description: `Plan ${plan.name}`,
      status: 'pending',
    },
  });

  const handle = await provider.createCollection({
    orderId: order.id,
    amount: { amount: order.amount, currency: order.currency },
    description: order.description,
    successUrl: `${origin}/panel/facturacion?order=${order.id}`,
    failureUrl: `${origin}/panel/facturacion?order=${order.id}&failed=1`,
    callbackUrl: `${origin}/api/payments/${provider.id}/callback`,
  });

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: provider.id,
      providerRef: handle.providerRef,
      payUrl: handle.payUrl ?? null,
      status: 'pending',
      amount: order.amount,
      currency: order.currency,
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

  // El adaptador del proveedor con el que se abrió ESTE cobro. El efectivo no
  // tiene a quién preguntarle: lo marcó una persona y ya está decidido.
  const provider = providerFor(payment.provider);
  // El efectivo no tiene a quién preguntarle: lo marcó una persona con su
  // nombre y ya está decidido.
  if (provider === null) return payment.status === 'paid';

  const status = await provider.getStatus(payment.providerRef, payment.currency);

  // Escribirlo y aplicar lo que significa: un solo sitio, compartido con el
  // enlace de pago de la pareja y con el repaso periódico. Tres copias de esto
  // son tres formas distintas de cobrar un plan y no activarlo.
  await applySettlement(order, payment.id, status, 'panel');
  return status === 'paid';
}
