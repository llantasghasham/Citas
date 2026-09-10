import { recordAudit } from '@/lib/audit';
import { getPrisma } from '@/lib/db/client';
import { getPaymentProvider } from '@/lib/payments';
import type { PaymentStatus } from '@/lib/payments/types';

/**
 * Los cobros que se quedaron a medias.
 *
 * El callback de Whish no va firmado, así que en este proyecto es un AVISO: lo
 * que decide es preguntarle al proveedor. Y un aviso se pierde — el servidor
 * estaba reiniciando, la red se cayó, Whish reintentó tres veces y se rindió.
 *
 * Hasta ahora, un cobro cuyo aviso se perdía solo se enteraba de que estaba
 * pagado cuando alguien ABRÍA una pantalla: la pareja volviendo a su enlace de
 * pago, o la oficina pulsando el botón de la factura. Si nadie miraba, el
 * dinero estaba cobrado en Whish y el pedido seguía «pendiente» aquí. Eso no es
 * un aviso perdido: es una boda que pagó y a la que no se le entregó.
 *
 * Esto es lo que cierra ese agujero, y es lo mismo que hacen las tres pantallas
 * —una sola función, para que no haya tres criterios de qué significa «pagado».
 */

/** Antes de esto no se pregunta: al pagador le acaban de abrir la pasarela. */
const GRACE_MS = 2 * 60 * 1000;

/** Después de esto se deja en paz: un cobro de hace un mes no va a pagarse. */
const GIVE_UP_MS = 30 * 24 * 60 * 60 * 1000;

/** Cuántos se miran de una pasada. El proveedor no es nuestro para saturarlo. */
const BATCH = 200;

export interface ReconcileSummary {
  checked: number;
  changed: number;
  paid: number;
  errors: number;
}

/**
 * Escribe lo que dijo el proveedor, y hace lo que ese estado significa.
 *
 * Es el único sitio donde un pedido pasa a pagado. Las tres entradas
 * —el enlace de la pareja, el botón de la oficina y este trabajo periódico—
 * pasan por aquí, porque tres copias de esta lógica son tres formas distintas
 * de que un plan no se active después de cobrarlo.
 */
export async function applySettlement(
  order: { id: string; tenantId: string; amount: number; description: string; packageGuests: number | null },
  paymentId: string,
  status: PaymentStatus,
  via: 'link' | 'panel' | 'job',
): Promise<void> {
  const prisma = getPrisma();

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status,
      lastCheckedAt: new Date(),
      paidAt: status === 'paid' ? new Date() : null,
      events: { create: { kind: 'poll', payload: { status, via } } },
    },
  });
  await prisma.order.update({ where: { id: order.id }, data: { status } });

  if (status !== 'paid') return;

  // Pagar un PLAN es lo que mueve de plan a la oficina. Un paquete de
  // invitaciones no toca la suscripción: es una venta suelta para una boda.
  if (order.packageGuests === null) {
    const plan = await prisma.plan.findFirst({
      where: { name: order.description.replace('Plan ', '') },
    });
    if (plan !== null) {
      await prisma.subscription.upsert({
        where: { tenantId: order.tenantId },
        update: { planId: plan.id, cancelledAt: null },
        create: { tenantId: order.tenantId, planId: plan.id },
      });
    }
  }

  await recordAudit({
    tenantId: order.tenantId,
    action: 'order.paid',
    entity: 'Order',
    entityId: order.id,
    metadata: { amount: order.amount, via },
  });
}

/**
 * Repasa los cobros que llevan rato en «pendiente» y le pregunta al proveedor.
 *
 * No lanza: un cobro que falla no puede impedir que se miren los demás, y este
 * trabajo se ejecuta sin nadie delante. Lo que devuelve es lo que se imprime en
 * el registro del servicio.
 */
export async function reconcilePending(): Promise<ReconcileSummary> {
  const prisma = getPrisma();
  const now = Date.now();

  const payments = await prisma.payment.findMany({
    where: {
      status: 'pending',
      // El efectivo no tiene pasarela a la que preguntar: lo marca una persona.
      provider: { not: 'manual' },
      createdAt: { lt: new Date(now - GRACE_MS), gt: new Date(now - GIVE_UP_MS) },
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
    select: {
      id: true,
      providerRef: true,
      currency: true,
      order: {
        select: {
          id: true,
          tenantId: true,
          amount: true,
          description: true,
          packageGuests: true,
          status: true,
        },
      },
    },
  });

  const summary: ReconcileSummary = { checked: 0, changed: 0, paid: 0, errors: 0 };
  if (payments.length === 0) return summary;

  const provider = await getPaymentProvider();

  for (const payment of payments) {
    summary.checked += 1;
    try {
      const status = await provider.getStatus(payment.providerRef, payment.currency);
      if (status === 'pending') continue;

      await applySettlement(payment.order, payment.id, status, 'job');
      summary.changed += 1;
      if (status === 'paid') summary.paid += 1;
    } catch (error) {
      // Se anota y se sigue. La próxima pasada lo vuelve a intentar, y mientras
      // tanto el pedido se queda pendiente, que es lo seguro.
      summary.errors += 1;
      console.error(`[conciliar] ${payment.id}: ${String(error)}`);
    }
  }

  return summary;
}
