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
  /**
   * La referencia con la que se abre el cobro, decidida AQUÍ y no por el
   * adaptador.
   *
   * Importa el orden: la fila del cobro se escribe ANTES de llamar al
   * proveedor, y la escribe con esta referencia. Así el índice único parcial
   * —un cobro pendiente por pedido— para a la segunda petición antes de que
   * llegue a Whish. Generándola dentro del adaptador, dos peticiones simultáneas
   * abrían DOS cobranzas de verdad y solo se guardaba una: la otra se quedaba
   * viva en Whish, y alguien podía pagarla.
   */
  reference: string;
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

/**
 * Lo que el proveedor dice de un cobro: en qué estado está y, si lo cuenta, por
 * cuánto.
 *
 * El importe es OPCIONAL porque no todo proveedor lo devuelve al preguntar por
 * un estado, y porque inventarse el nombre de un campo que no se ha visto en la
 * respuesta de verdad es peor que no leerlo: daría una comprobación que siempre
 * pasa. Cuando viene, se compara; cuando no, se dice que no se comparó.
 */
export interface SettlementReading {
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
  /**
   * Asks the provider for the truth. Used for reconciliation, never the browser.
   *
   * La moneda viaja con la referencia porque Whish la EXIGE para encontrar el
   * cobro: su estado se consulta por `(externalId, currency)`. Preguntar en la
   * moneda equivocada no da un error, da un cobro que no aparece — y un pedido
   * pagado que se queda en «pendiente» para siempre es peor que un fallo.
   */
  getStatus(providerRef: string, currency: Currency): Promise<SettlementReading>;
  /** Validates an inbound callback and says what it means. Throws if not authentic. */
  verifyCallback(headers: Headers, rawBody: string): Promise<CallbackResult>;
}

export class PaymentError extends Error {
  readonly provider: PaymentProviderId;
  /**
   * Si se SABE que el proveedor no llegó a crear nada.
   *
   * Es la diferencia entre poder reintentar y no poder. Una negativa explícita
   * —«esos datos no valen»— es definitiva: no hay cobranza al otro lado y la
   * reserva local se suelta para que se pueda volver a intentar. Un tiempo
   * agotado o un 500 NO lo son: la cobranza puede existir perfectamente y ser
   * la respuesta la que se perdió, así que soltar la reserva y reintentar sería
   * abrir una SEGUNDA cobranza de verdad.
   *
   * Por defecto es falso, que es la suposición segura: ante la duda, se
   * conserva.
   */
  readonly definitive: boolean;

  constructor(
    message: string,
    provider: PaymentProviderId,
    options: { cause?: unknown; definitive?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'PaymentError';
    this.provider = provider;
    this.definitive = options.definitive ?? false;
  }
}

/** Lo que se sabe de un fallo al hablar con la pasarela. */
export function isDefinitiveFailure(error: unknown): boolean {
  return error instanceof PaymentError && error.definitive;
}
