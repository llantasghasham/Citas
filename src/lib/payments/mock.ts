import {
  type CallbackResult,
  type CollectionHandle,
  type CollectionRequest,
  type PaymentProvider,
  type PaymentStatus,
} from './types';

/**
 * Development-only provider. It lets the whole order flow be exercised — create,
 * redirect, confirm, reconcile — before any Whish credentials exist, so the
 * application code is finished and tested by the time the real spec arrives.
 */
const states = new Map<string, PaymentStatus>();

export const mockProvider: PaymentProvider = {
  id: 'mock',

  createCollection(request: CollectionRequest): Promise<CollectionHandle> {
    const providerRef = `mock_${request.orderId}`;
    states.set(providerRef, 'pending');
    const payUrl = new URL(request.successUrl);
    payUrl.searchParams.set('mockRef', providerRef);

    return Promise.resolve({
      provider: 'mock',
      providerRef,
      payUrl: payUrl.toString(),
      status: 'pending',
    });
  },

  getStatus(providerRef: string): Promise<PaymentStatus> {
    // First read is pending, every read after that is paid: enough to exercise
    // both branches of the polling code.
    const current = states.get(providerRef) ?? 'pending';
    if (current === 'pending') states.set(providerRef, 'paid');
    return Promise.resolve(current);
  },

  verifyCallback(_headers: Headers, rawBody: string): Promise<CallbackResult> {
    const body = JSON.parse(rawBody) as { orderId?: string; status?: PaymentStatus };
    const orderId = body.orderId ?? 'unknown';
    return Promise.resolve({
      orderId,
      providerRef: `mock_${orderId}`,
      status: body.status ?? 'paid',
    });
  },
};
