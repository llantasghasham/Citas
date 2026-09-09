import {
  PaymentError,
  type CallbackResult,
  type CollectionHandle,
  type CollectionRequest,
  type PaymentProvider,
  type PaymentStatus,
} from './types';

/**
 * Whish Collect adapter — the Lebanese rail.
 *
 * The wire contract below is no longer a guess. It matches what Whish's own
 * `itel-service` exposes, corroborated across several independent live
 * integrations (the paths, the header casing, the `collectUrl` field and the
 * numeric `externalId`); see docs/COBRO-WHISH.md for where each part was
 * confirmed and what still has to come from Whish itself.
 *
 * How a payment actually happens, because it decides the whole flow: Whish does
 * NOT let a site collect card details itself. `collect` returns a `collectUrl`
 * and the payer is sent there, to a page Whish hosts. That is a feature — no
 * card number ever reaches this server — but it means the payer always leaves
 * the site, and there is nothing to embed.
 */
const CONTRACT = {
  collect: 'payment/collect',
  status: 'payment/collect/status',
  balance: 'payment/account/balance',
  /** Case matters: the service reads `websiteUrl`, not `websiteurl`. */
  headers: {
    channel: 'channel',
    secret: 'secret',
    websiteUrl: 'websiteUrl',
  },
} as const;

/**
 * The reference we hand back is the `externalId` WE assign, not an id of
 * Whish's own.
 *
 * That is what the service echoes in its callback and the only thing its status
 * endpoint accepts, so storing anything else would leave a payment that can
 * never be reconciled. It has to be numeric: several live integrations state
 * it, and this product's ids are cuids.
 */
function newExternalId(): string {
  // Milliseconds since the epoch plus three random digits: unique per
  // collection, ordered in time, and comfortably inside a 64-bit integer.
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
}

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
  // The paths are relative, so the base has to end in a slash or `new URL`
  // swallows the last segment of it.
  return { baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, channel, secret, websiteUrl };
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

  const envelope = payload as Record<string, unknown>;
  // The service wraps everything in `{ status, code, dialog, data }` and answers
  // 200 even when it refused: a failure has to be read from the body.
  if (envelope['status'] === false) {
    const code = envelope['code'] ?? 'unknown';
    throw new PaymentError(`Whish refused ${path}: ${String(code)}`, 'whish');
  }

  const data = envelope['data'];
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : envelope;
}

export const whishProvider: PaymentProvider = {
  id: 'whish',

  async createCollection(request: CollectionRequest): Promise<CollectionHandle> {
    const config = readConfig();
    const externalId = newExternalId();

    const data = await call(config, CONTRACT.collect, {
      amount: request.amount.amount,
      currency: request.amount.currency,
      invoice: request.description,
      externalId: Number(externalId),
      // Server-to-server notice and browser redirect are different things and
      // Whish takes both. Neither of them decides anything: only getStatus does.
      successCallbackUrl: request.callbackUrl,
      failureCallbackUrl: request.callbackUrl,
      successRedirectUrl: request.successUrl,
      failureRedirectUrl: request.failureUrl,
      ...(request.payerPhone === undefined ? {} : { phone: request.payerPhone }),
    });

    const collectUrl = data['collectUrl'];
    if (typeof collectUrl !== 'string' || collectUrl.length === 0) {
      throw new PaymentError('Whish did not return a collectUrl', 'whish');
    }

    return { provider: 'whish', providerRef: externalId, payUrl: collectUrl, status: 'pending' };
  },

  /**
   * Asks Whish what really happened. `providerRef` is the externalId we sent.
   *
   * The currency is required by the service and this product bills in USD; a
   * second currency would have to travel with the reference.
   */
  async getStatus(providerRef: string): Promise<PaymentStatus> {
    const config = readConfig();
    const data = await call(config, CONTRACT.status, {
      currency: 'USD',
      externalId: Number(providerRef),
    });
    return toStatus(data['collectStatus'] ?? data['status']);
  },

  async verifyCallback(_headers: Headers, rawBody: string): Promise<CallbackResult> {
    // Whish's callback carries no signature we can verify, so it is a *hint*:
    // it says which collection moved, and getStatus() decides what that means.
    // Nothing is ever marked paid from this body.
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
    const externalId = body['externalId'];
    if (externalId === undefined || externalId === null) {
      throw new PaymentError('Whish callback is missing externalId', 'whish');
    }

    return {
      // Both are the same value on this rail, and deliberately so: it is the
      // only handle Whish and this application agree on.
      orderId: String(externalId),
      providerRef: String(externalId),
      status: toStatus(body['status']),
    };
  },
};
