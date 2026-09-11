import { getPrisma } from '@/lib/db/client';
import { newPaymentReference } from '@/lib/payments/reference';
import type { PaymentProvider } from '@/lib/payments/types';
import type { Currency } from '@/generated/prisma/enums';

/**
 * Abrir una cobranza sin poder abrir dos.
 *
 * El orden es TODO el asunto. Antes se llamaba al proveedor y después se
 * escribía la fila; el índice único parcial —un cobro pendiente por pedido—
 * impedía guardar la segunda fila, pero no impedía que se hubiera creado la
 * segunda COBRANZA. Esa quedaba viva en Whish, con su enlace, esperando a que
 * alguien la pagara. Y alguien podía.
 *
 * Ahora se RESERVA primero: se escribe la fila con su referencia y sin enlace, y
 * es la base la que decide quién sigue. La segunda petición ni llega a la
 * pasarela; espera un momento a que la primera escriba el enlace y usa ese.
 *
 * Si la pasarela falla, la reserva se suelta — solo si sigue siendo una reserva,
 * nunca una que ya tenga enlace.
 */

export type ReserveOutcome =
  | { ok: true; payUrl: string }
  /** Otra petición está abriendo esta misma cobranza y aún no tiene enlace. */
  | { ok: false; reason: 'inFlight' }
  | { ok: false; reason: 'provider' };

/** Cuánto se espera a que gane la otra petición: cinco intentos de 300 ms. */
const WAIT_TRIES = 5;
const WAIT_MS = 300;

export interface OpenCollection {
  orderId: string;
  amount: number;
  currency: Currency;
  description: string;
  successUrl: string;
  failureUrl: string;
  callbackUrl: string;
  payerPhone?: string;
}

export async function openCollection(
  provider: PaymentProvider,
  order: OpenCollection,
): Promise<ReserveOutcome> {
  const prisma = getPrisma();

  // Lo que ya esté abierto y tenga enlace, se reutiliza: volver atrás y pulsar
  // otra vez es lo que hace cualquiera cuando una pasarela tarda.
  const open = await prisma.payment.findFirst({
    where: { orderId: order.orderId, provider: provider.id, status: 'pending' },
    select: { payUrl: true },
  });
  if (open?.payUrl != null && open.payUrl.length > 0) return { ok: true, payUrl: open.payUrl };

  const reference = newPaymentReference();
  let reservedId: string;
  try {
    const reserved = await prisma.payment.create({
      data: {
        orderId: order.orderId,
        provider: provider.id,
        providerRef: reference,
        status: 'pending',
        amount: order.amount,
        currency: order.currency,
      },
      select: { id: true },
    });
    reservedId = reserved.id;
  } catch {
    // La reserva la ganó otra petición. Ni se llama al proveedor: se espera un
    // momento a que escriba el enlace.
    return waitForWinner(provider.id, order.orderId);
  }

  try {
    const handle = await provider.createCollection({
      orderId: order.orderId,
      reference,
      amount: { amount: order.amount, currency: order.currency },
      description: order.description,
      successUrl: order.successUrl,
      failureUrl: order.failureUrl,
      callbackUrl: order.callbackUrl,
      ...(order.payerPhone === undefined ? {} : { payerPhone: order.payerPhone }),
    });

    if (handle.payUrl === undefined || handle.payUrl.length === 0) {
      await releaseReservation(reservedId);
      return { ok: false, reason: 'provider' };
    }

    await prisma.payment.update({
      where: { id: reservedId },
      // La referencia que el proveedor dice que usó, por si no fuera la nuestra.
      data: { payUrl: handle.payUrl, providerRef: handle.providerRef },
    });
    return { ok: true, payUrl: handle.payUrl };
  } catch (error) {
    await releaseReservation(reservedId);
    throw error;
  }
}

/**
 * Suelta la reserva, y SOLO si sigue siéndolo.
 *
 * Si mientras tanto le hubieran puesto enlace, o el aviso del proveedor la
 * hubiera marcado pagada, borrarla sería borrar un cobro de verdad.
 */
async function releaseReservation(paymentId: string): Promise<void> {
  await getPrisma()
    .payment.deleteMany({ where: { id: paymentId, status: 'pending', payUrl: null } })
    .catch(() => undefined);
}

async function waitForWinner(providerId: string, orderId: string): Promise<ReserveOutcome> {
  const prisma = getPrisma();
  for (let attempt = 0; attempt < WAIT_TRIES; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    const winner = await prisma.payment.findFirst({
      where: { orderId, provider: providerId as never, status: 'pending' },
      select: { payUrl: true },
    });
    if (winner?.payUrl != null && winner.payUrl.length > 0) {
      return { ok: true, payUrl: winner.payUrl };
    }
  }
  // La otra petición no llegó a escribir enlace: se dice, en vez de abrir una
  // segunda cobranza «por si acaso».
  return { ok: false, reason: 'inFlight' };
}
