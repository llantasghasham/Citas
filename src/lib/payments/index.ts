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
export function getPaymentProvider(): PaymentProvider {
  const configured = process.env['PAYMENTS_PROVIDER'] ?? 'mock';
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

export * from './types';
