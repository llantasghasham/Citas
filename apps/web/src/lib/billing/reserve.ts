import { controlDb } from '@/lib/db/client';
import { newPaymentReference } from '@/lib/payments/reference';
import { isDefinitiveFailure, type PaymentProvider } from '@/lib/payments/types';
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
  | { ok: false; reason: 'provider' }
  /**
   * La pasarela ni dijo que sí ni dijo que no: se agotó el tiempo, o contestó
   * un 500. La cobranza PUEDE existir al otro lado, así que la reserva se
   * queda puesta y no se abre otra. Quien la resuelve es el repaso periódico,
   * preguntándole al proveedor.
   */
  | { ok: false; reason: 'unknown' };

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
  const prisma = controlDb();

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
      // Contestó, y contestó sin enlace: no hay nada que reutilizar y tampoco
      // una cobranza en el aire. Se suelta.
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
    // AQUÍ estaba la ventana. Se soltaba la reserva pasara lo que pasara, así
    // que un tiempo agotado —con la cobranza ya creada al otro lado y solo la
    // respuesta perdida— dejaba el camino libre para abrir una SEGUNDA.
    //
    // Ahora solo se suelta cuando se SABE que no se creó nada: una negativa
    // explícita de la pasarela, o un 4xx. Ante la duda se conserva, y quien lo
    // resuelve es el repaso periódico: pregunta por esa referencia, y si nunca
    // aparece la da por caducada para que se pueda volver a intentar.
    if (isDefinitiveFailure(error)) {
      await releaseReservation(reservedId);
      throw error;
    }

    await noteUnknown(reservedId, error);
    return { ok: false, reason: 'unknown' };
  }
}

/**
 * Deja escrito que esta reserva quedó en el aire, y por qué.
 *
 * No se borra: la cobranza puede existir en la pasarela. La fila es lo único
 * que ata esa referencia a este pedido, así que sin ella la cobranza huérfana
 * no se podría ni reconocer si alguien la paga.
 */
async function noteUnknown(paymentId: string, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : 'error desconocido';
  await controlDb()
    .paymentEvent.create({
      data: {
        paymentId,
        kind: 'open_unknown',
        payload: { reason: reason.slice(0, 500) },
      },
    })
    .catch(() => undefined);
}

/**
 * Suelta la reserva, y SOLO si sigue siéndolo.
 *
 * Si mientras tanto le hubieran puesto enlace, o el aviso del proveedor la
 * hubiera marcado pagada, borrarla sería borrar un cobro de verdad.
 */
async function releaseReservation(paymentId: string): Promise<void> {
  await controlDb()
    .payment.deleteMany({ where: { id: paymentId, status: 'pending', payUrl: null } })
    .catch(() => undefined);
}

async function waitForWinner(providerId: string, orderId: string): Promise<ReserveOutcome> {
  const prisma = controlDb();
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
