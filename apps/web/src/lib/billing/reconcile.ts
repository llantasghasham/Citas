import { getPrisma } from '@/lib/db/client';
import { providerFor } from '@/lib/payments';
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

/**
 * Cuánto se le da a una reserva que quedó EN EL AIRE antes de darla por
 * perdida.
 *
 * Es la fila que se escribió antes de llamar a la pasarela y a la que nunca se
 * le pudo poner enlace, porque la respuesta se perdió. Mientras esté ahí, el
 * índice de «un cobro abierto por pedido» impide abrir otro — que es justo lo
 * que se quiere al principio: si la cobranza existe al otro lado, abrir una
 * segunda es cobrar dos veces.
 *
 * Un cuarto de hora es tiempo de sobra para que la pasarela sepa de ella. Si
 * pasado eso sigue sin aparecer, se da por caducada y el pedido puede volver a
 * intentarlo. Y si apareciera después, el aviso del proveedor la encuentra
 * igual por su referencia: `applySettlement` admite pasar de caducado a pagado.
 */
const UNKNOWN_GRACE_MS = 15 * 60 * 1000;

/** Cuántos se miran de una pasada. El proveedor no es nuestro para saturarlo. */
const BATCH = 200;

export interface ReconcileSummary {
  checked: number;
  changed: number;
  paid: number;
  errors: number;
  /** Cobros que llevaban un mes abiertos y se dieron por caducados. */
  expired: number;
}

/**
 * Escribe lo que dijo el proveedor, y hace lo que ese estado significa.
 *
 * Es el único sitio donde un pedido pasa a pagado. Las cuatro entradas —el
 * enlace de la pareja, el botón de la oficina, el aviso del proveedor y este
 * repaso periódico— pasan por aquí, porque cuatro copias de esta lógica son
 * cuatro formas distintas de cobrar un plan y no activarlo.
 *
 * Tres propiedades, y las tres hacen falta:
 *
 *  1. **Atómico.** Pago, pedido, suscripción y registro se escriben en UNA
 *     transacción. Antes eran cuatro escrituras sueltas: morir entre la
 *     segunda y la tercera dejaba un pedido cobrado sin plan activo.
 *  2. **Monótono.** `paid` es terminal salvo reembolso. Un aviso atrasado, o la
 *     respuesta lenta de una consulta anterior, no puede devolver a pendiente
 *     un cobro que ya entró.
 *  3. **Idempotente.** El mismo aviso dos veces no activa el plan dos veces ni
 *     escribe dos líneas en el historial. Se sabe porque la fila del pago se
 *     bloquea y se comprueba DENTRO de la transacción.
 *
 * Devuelve si de verdad cambió algo, para que quien llama no cuente como
 * novedad lo que ya estaba escrito.
 */
export async function applySettlement(
  order: { id: string; tenantId: string; amount: number; description: string; packageGuests: number | null },
  paymentId: string,
  status: PaymentStatus,
  via: 'link' | 'panel' | 'job' | 'callback' | 'sinpe',
  /**
   * Por cuánto dice el proveedor que se cobró, cuando lo dice.
   *
   * Que un cobro esté «pagado» no significa que se haya pagado LO QUE SE PEDÍA.
   * Si el importe o la moneda no coinciden con lo que se abrió, esto NO liquida
   * nada: deja el cobro pendiente, escribe lo que llegó y que lo mire una
   * persona. Activar un plan porque alguien pagó mil de veinticinco mil es
   * regalar el producto; darlo por bueno cobrando de más es peor.
   */
  reported?: { amount: number; currency: string },
): Promise<boolean> {
  return getPrisma().$transaction(async (tx) => {
    // Se relee DENTRO de la transacción y con bloqueo de fila: dos avisos
    // simultáneos del mismo cobro llegan aquí a la vez, y sin esto los dos
    // verían «pendiente» y los dos activarían el plan.
    const [locked] = await tx.$queryRaw<
      { id: string; status: PaymentStatus; amount: number; currency: string }[]
    >`
      SELECT id, status, amount, currency FROM "Payment" WHERE id = ${paymentId} FOR UPDATE
    `;
    if (locked === undefined) return false;

    // El importe, antes que nada. Un pago que no cuadra no se liquida ni se
    // marca fallido: se deja pendiente —para que el repaso siga mirándolo— y se
    // guarda crudo lo que dijo el proveedor, que es lo único que sirve cuando
    // se discute un cobro.
    if (
      reported !== undefined &&
      status === 'paid' &&
      (reported.amount !== locked.amount || reported.currency !== locked.currency)
    ) {
      await tx.paymentEvent.create({
        data: {
          paymentId,
          kind: 'amount_mismatch',
          payload: {
            esperado: { amount: locked.amount, currency: locked.currency },
            recibido: reported,
            via,
          },
        },
      });
      console.error(
        `[pagos] importe que no cuadra en ${paymentId}: se esperaban ` +
          `${locked.amount} ${locked.currency} y llegaron ${reported.amount} ${reported.currency}`,
      );
      return false;
    }

    // Ya cobrado. Solo un reembolso puede mover esto, y eso no llega por aquí.
    if (locked.status === 'paid' && status !== 'refunded') return false;
    if (locked.status === status) return false;

    const paidNow = status === 'paid';
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status,
        lastCheckedAt: new Date(),
        paidAt: paidNow ? new Date() : null,
        events: { create: { kind: 'poll', payload: { status, via } } },
      },
    });

    // `updateMany` con la condición dentro: si otra vía marcó el pedido pagado
    // entre medias, esto no lo pisa.
    await tx.order.updateMany({
      where: { id: order.id, NOT: { status: 'paid' } },
      data: { status },
    });

    if (paidNow) {
      // Pagar un PLAN es lo que mueve de plan a la oficina. Un paquete de
      // invitaciones no toca la suscripción: es una venta suelta para una boda.
      if (order.packageGuests === null) {
        const plan = await tx.plan.findFirst({
          where: { name: order.description.replace('Plan ', '') },
        });
        if (plan !== null) {
          await tx.subscription.upsert({
            where: { tenantId: order.tenantId },
            update: { planId: plan.id, cancelledAt: null },
            create: { tenantId: order.tenantId, planId: plan.id },
          });
        }
      }

      // El registro va DENTRO de la transacción. Un historial que puede
      // perderse porque el proceso murió después de cobrar no es un historial.
      await tx.auditLog.create({
        data: {
          tenantId: order.tenantId,
          action: 'order.paid',
          entity: 'Order',
          entityId: order.id,
          metadata: { amount: order.amount, via },
        },
      });
    }

    return true;
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
      provider: true,
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

  const summary: ReconcileSummary = { checked: 0, changed: 0, paid: 0, errors: 0, expired: 0 };

  // Lo que lleva un mes abierto se CIERRA. El repaso solo mira la ventana de
  // los últimos treinta días, así que lo anterior se quedaba «pendiente» para
  // siempre: pendientes eternos que ensucian la facturación, mantienen ocupado
  // el índice de «un cobro abierto por pedido» —y con él impiden abrir uno
  // nuevo— y hacen que nadie se fíe de lo que dice esa columna.
  //
  // Se cierran con una sola escritura condicional, sin preguntarle a nadie: a
  // los treinta días la pasarela tampoco lo tiene ya abierto. Y solo los que
  // SIGUEN pendientes, para no pisar uno que acabe de cobrarse.
  const stale = await prisma.payment.updateMany({
    where: {
      status: 'pending',
      provider: { not: 'manual' },
      createdAt: { lt: new Date(now - GIVE_UP_MS) },
    },
    data: { status: 'expired' },
  });
  summary.expired = stale.count;
  summary.expired += await resolveOrphans(now);

  if (payments.length === 0) return summary;

  for (const payment of payments) {
    summary.checked += 1;
    try {
      // El adaptador del proveedor con el que se ABRIÓ este cobro, no el que
      // esté configurado hoy: cambiar de pasarela no puede dejar huérfanos los
      // cobros anteriores.
      const provider = providerFor(payment.provider);
      if (provider === null) continue;

      const reading = await provider.getStatus(payment.providerRef, payment.currency);
      const status = reading.status;
      if (status === 'pending') continue;

      if (await applySettlement(payment.order, payment.id, status, 'job')) {
        summary.changed += 1;
        if (status === 'paid') summary.paid += 1;
      }
    } catch (error) {
      // Se anota y se sigue. La próxima pasada lo vuelve a intentar, y mientras
      // tanto el pedido se queda pendiente, que es lo seguro.
      summary.errors += 1;
      console.error(`[conciliar] ${payment.id}: ${String(error)}`);
    }
  }

  return summary;
}

/**
 * Las reservas que quedaron en el aire: sin enlace y sin respuesta.
 *
 * Se le PREGUNTA al proveedor por esa referencia antes de nada. Si dice que se
 * pagó, se liquida —esa es la cobranza huérfana que sí existía y que alguien
 * pagó—. Si dice que no sabe nada y ya pasó la gracia, se caduca para que el
 * pedido pueda volver a intentarlo.
 *
 * Devuelve cuántas se cerraron.
 */
async function resolveOrphans(now: number): Promise<number> {
  const prisma = getPrisma();
  const orphans = await prisma.payment.findMany({
    where: {
      status: 'pending',
      payUrl: null,
      provider: { not: 'manual' },
      createdAt: { lt: new Date(now - UNKNOWN_GRACE_MS) },
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
    select: {
      id: true,
      provider: true,
      providerRef: true,
      currency: true,
      order: {
        select: {
          id: true,
          tenantId: true,
          amount: true,
          description: true,
          packageGuests: true,
        },
      },
    },
  });

  let closed = 0;
  for (const orphan of orphans) {
    const provider = providerFor(orphan.provider);
    if (provider === null) continue;

    try {
      const reading = await provider.getStatus(orphan.providerRef, orphan.currency);
      if (reading.status === 'paid') {
        // Existía, y alguien la pagó. Esto es exactamente lo que se protegía al
        // no borrar la reserva: sin la fila, este cobro no se podría reconocer.
        await applySettlement(
          orphan.order,
          orphan.id,
          'paid',
          'job',
          reading.amount === undefined
            ? undefined
            : { amount: reading.amount.amount, currency: reading.amount.currency },
        );
        continue;
      }
    } catch {
      // El proveedor no contesta. Se vuelve a mirar en la siguiente pasada: no
      // se caduca una reserva por no poder preguntar.
      continue;
    }

    // Contestó y no la conoce, o sigue sin pagarse pasada la gracia. Se cierra
    // para que el pedido pueda volver a intentarlo.
    const done = await prisma.payment.updateMany({
      where: { id: orphan.id, status: 'pending', payUrl: null },
      data: { status: 'expired' },
    });
    closed += done.count;
  }
  return closed;
}
