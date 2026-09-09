/**
 * Payment domain. Deliberately provider-agnostic: Lebanon collects through
 * Whish, and a second country (or a second rail for cards) plugs in behind the
 * same port without touching the rest of the application.
 */

export const CURRENCIES = ['USD', 'LBP', 'CRC'] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * Amounts are integers in the currency's minor unit — cents for USD, whole
 * units for LBP, which has no practical subdivision. Floats never touch money.
 */
export interface Money {
  amount: number;
  currency: Currency;
}

export const PAYMENT_PROVIDERS = ['whish', 'mock'] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'refunded';

export interface CollectionRequest {
  /** Our order id. Doubles as the idempotency key: retrying must not double-charge. */
  orderId: string;
  amount: Money;
  description: string;
  /** Whish identifies a payer by phone number. */
  payerPhone?: string;
  successUrl: string;
  failureUrl: string;
  /** Where the provider confirms the payment, server to server. */
  callbackUrl: string;
}

export interface CollectionHandle {
  provider: PaymentProviderId;
  /** The provider's own identifier for this collection. */
  providerRef: string;
  /** Where to send the payer, when the provider hosts the payment step. */
  payUrl?: string;
  status: PaymentStatus;
}

export interface CallbackResult {
  orderId: string;
  providerRef: string;
  status: PaymentStatus;
  amount?: Money;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  /**
   * Comprueba que las credenciales valen, sin mover dinero. Opcional: no todo
   * proveedor ofrece una operación de solo lectura con la que hacerlo.
   */
  probe?(): Promise<string>;
  /** Opens a collection and returns where to send the payer. */
  createCollection(request: CollectionRequest): Promise<CollectionHandle>;
  /** Asks the provider for the truth. Used for reconciliation, never the browser. */
  getStatus(providerRef: string): Promise<PaymentStatus>;
  /** Validates an inbound callback and says what it means. Throws if not authentic. */
  verifyCallback(headers: Headers, rawBody: string): Promise<CallbackResult>;
}

export class PaymentError extends Error {
  readonly provider: PaymentProviderId;

  constructor(message: string, provider: PaymentProviderId, cause?: unknown) {
    super(message, { cause });
    this.name = 'PaymentError';
    this.provider = provider;
  }
}
