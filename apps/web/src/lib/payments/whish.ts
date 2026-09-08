import {
  PaymentError,
  type CallbackResult,
  type CollectionHandle,
  type CollectionRequest,
  type PaymentProvider,
  type PaymentStatus,
} from './types';

/**
 * Whish Pay / Whish Collect adapter — the Lebanese rail.
 *
 * ⚠ THE WIRE CONTRACT BELOW IS NOT CONFIRMED. Whish publishes the "Whish Collect
 * Web Service Technical Specification" (balance, rate and collect operations)
 * only to merchants who hold an account. Every endpoint path and field name in
 * `CONTRACT` and in the mapping functions is a placeholder until that document
 * is in hand — see docs/COBRO-WHISH.md for the exact list to request.
 *
 * Everything outside this file is contract-independent: when the spec arrives,
 * only `CONTRACT` and the two mapping functions change.
 */
const CONTRACT = {
  collect: '/collect',
  status: '/collect/status',
  rate: '/rate',
  /** Header names Whish uses for merchant credentials. */
  headers: {
    channel: 'channel',
    secret: 'secret',
    websiteUrl: 'websiteurl',
  },
} as const;

interface WhishConfig {
  baseUrl: string;
  channel: string;
  secret: string;
  websiteUrl: string;
}

function readConfig(): WhishConfig {
  const baseUrl = process.env['WHISH_BASE_URL'];
  const channel = process.env['WHISH_CHANNEL'];
  const secret = process.env['WHISH_SECRET'];
  const websiteUrl = process.env['WHISH_WEBSITE_URL'];

  if (!baseUrl || !channel || !secret || !websiteUrl) {
    throw new PaymentError(
      'Whish is not configured. Set WHISH_BASE_URL, WHISH_CHANNEL, WHISH_SECRET and WHISH_WEBSITE_URL.',
      'whish',
    );
  }
  return { baseUrl, channel, secret, websiteUrl };
}

/** Maps whatever Whish calls a state onto our own. Unknown states are never "paid". */
function toStatus(raw: unknown): PaymentStatus {
  const value = String(raw).toLowerCase();
  if (value === 'success' || value === 'paid' || value === 'completed') return 'paid';
  if (value === 'failed' || value === 'declined') return 'failed';
  if (value === 'expired' || value === 'cancelled') return 'expired';
  if (value === 'refunded') return 'refunded';
  return 'pending';
}

async function call(
  config: WhishConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(path, config.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CONTRACT.headers.channel]: config.channel,
      [CONTRACT.headers.secret]: config.secret,
      [CONTRACT.headers.websiteUrl]: config.websiteUrl,
    },
    body: JSON.stringify(body),
    // A hung payment call must not hold a request open indefinitely.
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new PaymentError(`Whish returned HTTP ${response.status} for ${path}`, 'whish');
  }

  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null) {
    throw new PaymentError(`Whish returned a non-object body for ${path}`, 'whish');
  }
  return payload as Record<string, unknown>;
}

export const whishProvider: PaymentProvider = {
  id: 'whish',

  async createCollection(request: CollectionRequest): Promise<CollectionHandle> {
    const config = readConfig();
    const payload = await call(config, CONTRACT.collect, {
      amount: request.amount.amount,
      currency: request.amount.currency,
      invoice: request.description,
      externalId: request.orderId,
      successCallbackUrl: request.successUrl,
      failureCallbackUrl: request.failureUrl,
      successRedirectUrl: request.successUrl,
      failureRedirectUrl: request.failureUrl,
      callbackUrl: request.callbackUrl,
      ...(request.payerPhone === undefined ? {} : { phone: request.payerPhone }),
    });

    const data = (payload['data'] ?? payload) as Record<string, unknown>;
    const providerRef = data['collectUrl'] === undefined ? data['id'] : data['transactionId'];

    if (providerRef === undefined || providerRef === null) {
      throw new PaymentError('Whish did not return a collection reference', 'whish');
    }

    return {
      provider: 'whish',
      providerRef: String(providerRef),
      payUrl: typeof data['collectUrl'] === 'string' ? data['collectUrl'] : undefined,
      status: 'pending',
    };
  },

  async getStatus(providerRef: string): Promise<PaymentStatus> {
    const config = readConfig();
    const payload = await call(config, CONTRACT.status, { externalId: providerRef });
    const data = (payload['data'] ?? payload) as Record<string, unknown>;
    return toStatus(data['status'] ?? data['collectStatus']);
  },

  async verifyCallback(_headers: Headers, rawBody: string): Promise<CallbackResult> {
    // Whish's callback is not signed in any way we can verify yet, so the
    // callback is treated as a *hint* only: it tells us which order changed,
    // and getStatus() is what decides. Never mark an order paid from this body.
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error) {
      throw new PaymentError('Whish callback body is not JSON', 'whish', error);
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new PaymentError('Whish callback body is not an object', 'whish');
    }

    const body = parsed as Record<string, unknown>;
    const orderId = body['externalId'];
    const providerRef = body['transactionId'] ?? body['id'];

    if (orderId === undefined || providerRef === undefined) {
      throw new PaymentError('Whish callback is missing externalId or transactionId', 'whish');
    }

    return {
      orderId: String(orderId),
      providerRef: String(providerRef),
      status: toStatus(body['status']),
    };
  },
};
