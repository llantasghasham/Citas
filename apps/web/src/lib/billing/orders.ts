import type { PlanTier } from '@/generated/prisma/enums';
import { recordAudit } from '@/lib/audit';
import { applySettlement } from '@/lib/billing/reconcile';
import { getPrisma } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { getPaymentProvider, providerFor } from '@/lib/payments';
import { newPayCode } from '@/lib/payments/sinpe/code';
import { planPriceInCrc } from '@/lib/payments/sinpe/price';

export interface OrderRow {
  id: string;
  amount: number;
  currency: string;
  description: string;
  status: string;
  createdAt: Date;
  paymentId: string | null;
  payUrl: string | null;
  /** El código que hay que escribir en el detalle del SINPE, si se cobra así. */
  payCode: string | null;
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
      payCode: order.payCode,
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
      // Ver `checkout.ts`: todo pedido nace con su código.
      payCode: newPayCode(),
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
 * Abre el pedido de un plan para pagarlo por SINPE Móvil.
 *
 * No hay pasarela a la que pedirle una cobranza: el SINPE lo hace una persona
 * desde su móvil, y lo único que llega después es el correo del banco. Así que
 * esto solo escribe el pedido —en COLONES, que es lo único que mueve el SINPE—
 * con su código, y devuelve lo que hay que enseñarle a quien va a pagar: a qué
 * número, cuánto, y qué escribir en el detalle.
 *
 * Se reutiliza el pedido abierto del mismo plan, como con Whish: un segundo
 * pedido por lo mismo es un segundo código, y entonces el SINPE que llegue casa
 * con uno y el otro se queda ahí para siempre.
 */
export async function startSinpeOrder(
  scope: TenantScope,
  tier: PlanTier,
  actorId: string,
): Promise<{ orderId: string; amount: number; payCode: string }> {
  const prisma = getPrisma();
  const plan = await prisma.plan.findUnique({ where: { tier } });
  if (plan === null) throw new Error(`Unknown plan tier "${tier}".`);

  const amount = await planPriceInCrc(plan.priceMonthly);
  const description = `Plan ${plan.name}`;

  const open = await prisma.order.findFirst({
    where: { ...scopedWhere(scope), description, status: 'pending', currency: 'CRC' },
    select: { id: true, amount: true, payCode: true },
  });
  if (open !== null && open.payCode !== null) {
    // El importe puede haber cambiado si cambió el tipo de cambio. Se actualiza
    // en el pedido que ya existe en vez de abrir otro: lo que tiene que casar
    // es lo que la oficina está viendo AHORA en la pantalla.
    if (open.amount !== amount) {
      await prisma.order.update({ where: { id: open.id }, data: { amount } });
    }
    return { orderId: open.id, amount, payCode: open.payCode };
  }

  const payCode = newPayCode();
  const order = await prisma.order.create({
    data: {
      ...scopedWhere(scope),
      amount,
      currency: 'CRC',
      description,
      status: 'pending',
      payCode,
    },
  });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'order.open.sinpe',
    entity: 'Order',
    entityId: order.id,
    metadata: { tier, amount },
  });

  return { orderId: order.id, amount, payCode };
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

  const reading = await provider.getStatus(payment.providerRef, payment.currency);
  const status = reading.status;

  // Escribirlo y aplicar lo que significa: un solo sitio, compartido con el
  // enlace de pago de la pareja y con el repaso periódico. Tres copias de esto
  // son tres formas distintas de cobrar un plan y no activarlo.
  await applySettlement(order, payment.id, status, 'panel');
  return status === 'paid';
}
