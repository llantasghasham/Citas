import { setting } from '@/lib/settings';

import { mockProvider } from './mock';
import { PAYMENT_PROVIDERS, PaymentError, type PaymentProvider, type PaymentProviderId } from './types';
import { whishProvider } from './whish';

const PROVIDERS: Record<PaymentProviderId, PaymentProvider> = {
  whish: whishProvider,
  mock: mockProvider,
};

/**
 * Lebanon collects through Whish. `mock` exists so the order flow can be built
 * and tested before the merchant account is open; it is refused in production.
 */
export async function getPaymentProvider(): Promise<PaymentProvider> {
  const configured = (await setting('PAYMENTS_PROVIDER')) ?? 'mock';
  const id = PAYMENT_PROVIDERS.find((candidate) => candidate === configured);

  if (id === undefined) {
    throw new PaymentError(
      `Unknown PAYMENTS_PROVIDER "${configured}". Expected one of: ${PAYMENT_PROVIDERS.join(', ')}.`,
      'whish',
    );
  }
  if (id === 'mock' && process.env.NODE_ENV === 'production') {
    throw new PaymentError('The mock payment provider must never run in production.', 'mock');
  }

  return PROVIDERS[id];
}

/**
 * El adaptador de un pago YA ABIERTO, resuelto por el proveedor con el que se
 * abrió y no por el que esté configurado hoy.
 *
 * La diferencia importa el día que se cambia de pasarela. `getPaymentProvider()`
 * lee la configuración actual: preguntarle a Tilopay por una referencia de
 * Whish devuelve «no existe», que este código leería como pendiente, y el
 * cobro de una boda ya pagada se quedaría sin activar para siempre.
 *
 * Devuelve `null` para `manual`: el efectivo no tiene a quién preguntarle. Lo
 * marca una persona con su nombre, que es justamente la razón de que exista.
 */
export function providerFor(id: string): PaymentProvider | null {
  if (id === 'manual') return null;

  const known = PAYMENT_PROVIDERS.find((candidate) => candidate === id);
  if (known === undefined) {
    throw new PaymentError(`No hay adaptador para el proveedor "${id}".`, 'whish');
  }
  if (known === 'mock' && process.env.NODE_ENV === 'production') {
    throw new PaymentError('The mock payment provider must never run in production.', 'mock');
  }
  return PROVIDERS[known];
}

export * from './types';
