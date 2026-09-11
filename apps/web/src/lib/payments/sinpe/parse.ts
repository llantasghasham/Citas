import { plainText } from '@/lib/payments/sinpe/text';

/**
 * Lee un correo del banco y dice qué movimiento de SINPE cuenta.
 *
 * Esta es LA pieza peligrosa del cobro por SINPE: no hay pasarela que confirme
 * nada, así que lo único que separa un cobro de verdad de un cobro inventado es
 * lo que se lea aquí. Por eso falla CERRADO: cuando no puede sacar el monto y
 * la referencia con certeza, no devuelve un movimiento a medias — no devuelve
 * ninguno. Un pago no reconocido lo arregla una persona en un minuto; un pago
 * inventado activa un plan que nadie pagó y nadie se entera.
 *
 * Y por eso no se toma NUNCA un número suelto: el monto tiene que venir con su
 * marca de moneda o detrás de su etiqueta. Así fue como un `width:402.812px` de
 * una hoja de estilo se convirtió en ₡402.812 en todos los correos.
 */

export const SINPE_BANKS = [
  'bac',
  'bn',
  'bcr',
  'davivienda',
  'popular',
  'promerica',
  'scotiabank',
  'lafise',
  'cathay',
] as const;
export type SinpeBank = (typeof SINPE_BANKS)[number];

/** Cómo se reconoce cada banco. `bac` incluye Credomatic; `bn`, BNCR. */
const BANK_PATTERNS: Record<SinpeBank, RegExp> = {
  bac: /\bbac\b|credomatic/i,
  bn: /banco\s+nacional|\bbncr\b/i,
  bcr: /banco\s+de\s+costa\s+rica|bancobcr|\bbcr\b/i,
  davivienda: /davivienda/i,
  popular: /banco\s+popular|\bpopular\b/i,
  promerica: /promerica|prom[ée]rica/i,
  scotiabank: /scotiabank/i,
  lafise: /lafise/i,
  cathay: /cathay/i,
};

export type MovementType = 'sinpe_movil' | 'transferencia' | 'deposito' | 'credito';

export interface SinpeMovement {
  /** Céntimos enteros, como `Payment.amount`. Ningún decimal toca dinero. */
  amount: number;
  currency: 'CRC';
  /** El comprobante. Es lo que hace imposible procesar dos veces el mismo pago. */
  reference: string;
  senderName: string | null;
  senderPhone: string | null;
  bank: SinpeBank | null;
  movementType: MovementType;
  /** A qué número entró, cuando el aviso lo dice. */
  destinationNumber: string | null;
  /**
   * Lo que escribió quien pagó, cuando el banco lo trae.
   *
   * Es lo ÚNICO que puede decir a qué cobro va este dinero. El comprobante no
   * sirve para eso: lo inventa el banco al mandarlo, así que aquí no se conoce
   * antes de que llegue.
   */
  detail: string | null;
  /** El correo ya limpio. Lo usa el casador, que busca en todo el texto. */
  text: string;
}

export type SinpeReading =
  /** Plata que SALE, un aviso de cuenta repetido, o un correo que no es del banco. */
  | { outcome: 'ignore'; reason: 'outgoing' | 'account_notice' | 'not_a_notice' }
  | { outcome: 'movement'; movement: SinpeMovement };

/**
 * Un comprobante de SINPE Móvil tiene 25 dígitos. El aviso de movimiento de
 * cuenta trae uno mucho más corto, y SIEMPRE EL MISMO, porque identifica al
 * aviso y no al movimiento. Doce es el corte: por debajo no es un comprobante.
 */
const SHORT_REFERENCE = 12;
/** Por debajo de esto ni se mira: no hay comprobante de banco tan corto. */
const MIN_REFERENCE = 8;

const OUTGOING = /d[ée]bito\s+(en|de)\s+su\s+cuenta/i;
const ACCOUNT_NOTICE = /(cr[ée]dito|d[ée]bito)\s+(en|de)\s+su\s+cuenta/i;
const MENTIONS_PAYMENT =
  /sinpe|dep[óo]sito|transferencia|cr[ée]dito\s+(en|a)\s+(su\s+)?cuenta|ha\s+recibido/i;

export function parseSinpeEmail(subject: string, body: string): SinpeReading {
  const text = plainText(`${subject}\n${body}`);

  // 1. PLATA QUE SALE. Antes de nada, porque un SINPE enviado también dice
  //    «Transferencia SINPE» y pasaría cualquier filtro de los de abajo. Darlo
  //    por cobrado es dar por pagada una venta que nadie pagó.
  if (OUTGOING.test(text)) return { outcome: 'ignore', reason: 'outgoing' };

  const reference = findReference(text);
  const bank = findBank(text);

  // 2. EL MISMO PAGO, CONTADO DOS VECES. Por cada pago llegan dos correos: el
  //    aviso del SINPE Móvil —con nombre y comprobante largo— y el aviso de
  //    movimiento de cuenta, sin nombre y con una referencia corta que se
  //    repite. Son la misma plata; el segundo se guarda y no se cobra.
  if (ACCOUNT_NOTICE.test(text) && (reference === null || reference.length < SHORT_REFERENCE)) {
    return { outcome: 'ignore', reason: 'account_notice' };
  }

  // 3. ¿ES SIQUIERA UN AVISO DE BANCO? Las DOS cosas, o cualquier factura del
  //    buzón que diga «transferencia» se convierte en un SINPE inventado.
  const looksLikePayment = MENTIONS_PAYMENT.test(text);
  const identified = reference !== null || bank !== null;
  if (!looksLikePayment || !identified) return { outcome: 'ignore', reason: 'not_a_notice' };

  const amount = findAmount(text);
  // Falla cerrado: sin las dos, no hay movimiento. Con una referencia sola no
  // se puede casar nada, y con un monto solo se casaría con el cobro de
  // cualquiera que deba lo mismo.
  if (amount === null || reference === null) {
    return { outcome: 'ignore', reason: 'not_a_notice' };
  }

  const phones = findPhones(text);
  return {
    outcome: 'movement',
    movement: {
      amount,
      currency: 'CRC',
      reference,
      senderName: findSenderName(text),
      senderPhone: phones[0] ?? null,
      bank,
      movementType: findMovementType(text),
      destinationNumber: phones[1] ?? null,
      detail: findDetail(text),
      text,
    },
  };
}

function findBank(text: string): SinpeBank | null {
  return SINPE_BANKS.find((bank) => BANK_PATTERNS[bank].test(text)) ?? null;
}

function findMovementType(text: string): MovementType {
  if (/sinpe\s*m[óo]vil/i.test(text)) return 'sinpe_movil';
  if (/transferencia/i.test(text)) return 'transferencia';
  if (/dep[óo]sito/i.test(text)) return 'deposito';
  return 'credito';
}

/**
 * El comprobante. Primero por su etiqueta, y solo si no la hay, la tirada de
 * dígitos más larga del correo.
 *
 * Se buscan DÍGITOS y nada más. La versión anterior de esto, en el sistema de
 * donde viene la especificación, capturaba letras y devolvía «ncia» — el final
 * de la palabra «Referencia» partida por una etiqueta.
 */
function findReference(text: string): string | null {
  const labelled = text.match(
    /(?:comprobante|referencia|ref\.?|n[úu]mero\s+de\s+documento|documento)\s*[:#]?\s*([0-9][0-9\s-]{5,40}[0-9])/i,
  );
  const fromLabel = labelled?.[1]?.replace(/[\s-]/g, '');
  if (fromLabel !== undefined && fromLabel.length >= MIN_REFERENCE) return fromLabel;

  const runs = [...text.matchAll(/\b(\d{8,})\b/g)].map((match) => match[1] ?? '');
  if (runs.length === 0) return fromLabel ?? null;

  // La más larga: el comprobante del SINPE Móvil tiene 25 dígitos y ninguna
  // otra cifra del correo se le acerca.
  return runs.reduce((longest, run) => (run.length > longest.length ? run : longest));
}

/**
 * El monto, en céntimos.
 *
 * SIEMPRE con su marca de moneda o detrás de su etiqueta. Un número suelto no
 * se toma jamás: cualquier medida, fecha o número de teléfono del correo lo
 * sería, y así entró un `402.812` de una hoja de estilo.
 */
function findAmount(text: string): number | null {
  const patterns = [
    /(?:₡|¢|CRC|colones)\s*([\d.,]+)/i,
    /([\d.,]+)\s*(?:₡|¢|CRC|colones)/i,
    /monto\s*[:=]?\s*([\d.,]+)/i,
    /por\s+(?:la\s+suma\s+de\s+)?([\d.,]+)/i,
  ];

  for (const pattern of patterns) {
    const raw = text.match(pattern)?.[1];
    if (raw === undefined) continue;
    const cents = toCents(raw);
    if (cents !== null) return cents;
  }
  return null;
}

/**
 * «25.000,50», «25,000.50», «25000», «25.000» → céntimos.
 *
 * Cuando hay dos separadores, el ÚLTIMO es el decimal, se escriba a la
 * costarricense o a la inglesa. Cuando hay uno solo se mira cuántos dígitos
 * lleva detrás: tres son millares —`25.000` son veinticinco mil, no veinticinco
 * con cero— y dos, decimales. Cualquier otra cosa no se adivina: se descarta.
 */
export function toCents(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(/[.,]$/, '');
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let whole = cleaned;
  let decimals = '';

  if (lastDot >= 0 && lastComma >= 0) {
    const cut = Math.max(lastDot, lastComma);
    whole = cleaned.slice(0, cut);
    decimals = cleaned.slice(cut + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const cut = Math.max(lastDot, lastComma);
    const tail = cleaned.slice(cut + 1);
    // Un único separador con tres dígitos detrás son millares, salvo que haya
    // más de un separador (ya cubierto arriba).
    if (tail.length === 3 && cleaned.indexOf(cleaned[cut] ?? '') === cut) {
      whole = cleaned;
    } else if (tail.length === 1 || tail.length === 2) {
      whole = cleaned.slice(0, cut);
      decimals = tail;
    } else {
      return null;
    }
  }

  const digits = whole.replace(/[.,]/g, '');
  if (digits.length === 0 || !/^\d+$/.test(digits)) return null;
  if (decimals.length > 0 && !/^\d{1,2}$/.test(decimals)) return null;

  const cents = Number.parseInt(digits, 10) * 100 + Number.parseInt(decimals.padEnd(2, '0') || '0', 10);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Los teléfonos costarricenses del correo, en el orden en que aparecen. */
function findPhones(text: string): string[] {
  const found = [...text.matchAll(/(?:\+?506[\s-]?)?\b([2-8]\d{3})[\s-]?(\d{4})\b/g)].map(
    (match) => `${match[1] ?? ''}${match[2] ?? ''}`,
  );
  return [...new Set(found)];
}

/**
 * Quién pagó. Solo lo trae el aviso del SINPE Móvil; el de cuenta, no — que es
 * justamente una de las cosas que los distingue.
 */
function findSenderName(text: string): string | null {
  const patterns = [
    /(?:de\s+parte\s+de|remitente|env[íi]a(?:do\s+por)?)\s*[:]?\s*([\p{Lu}][\p{L}.'\-\s]{2,60}?)(?=\s+(?:por|el|desde|con)\b|[\n,.;]|$)/u,
    /ha\s+recibido\s+(?:un\s+)?(?:sinpe\s*m[óo]vil\s+)?de\s+([\p{Lu}][\p{L}.'\-\s]{2,60}?)(?=\s+(?:por|el|desde|con)\b|[\n,.;]|$)/iu,
  ];

  for (const pattern of patterns) {
    const name = text.match(pattern)?.[1]?.trim().replace(/\s+/g, ' ');
    if (name !== undefined && name.length >= 3) return name;
  }
  return null;
}

/**
 * El texto libre que escribió quien paga: «motivo», «detalle», «descripción».
 *
 * Cada banco lo llama de una manera y alguno no lo trae. Se saca como AYUDA
 * para que una persona vea de un vistazo a qué venía el dinero — el casador no
 * depende de esto: busca el código en el correo entero, que es lo único que
 * funciona igual en los nueve bancos.
 */
function findDetail(text: string): string | null {
  const match = text.match(
    /(?:motivo|detalle|descripci[óo]n|concepto|nota)\s*[:=]?\s*([^\n]{1,120})/i,
  );
  const detail = match?.[1]?.trim();
  return detail !== undefined && detail.length > 0 ? detail : null;
}
