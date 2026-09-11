import { createHash } from 'node:crypto';

import { applySettlement } from '@/lib/billing/reconcile';
import { controlDb } from '@/lib/db/client';
import { codeAppearsIn } from '@/lib/payments/sinpe/code';
import { parseSinpeEmail, type SinpeMovement } from '@/lib/payments/sinpe/parse';
import { plainText } from '@/lib/payments/sinpe/text';

/**
 * Lo que se hace con un correo del banco, de principio a fin.
 *
 * Tres pasos, y el orden importa:
 *
 *  1. LEER. `parseSinpeEmail` decide si es dinero que entra, dinero que sale o
 *     ruido del buzón. Lo que no entra se guarda igual cuando se reconoce —
 *     saber por qué no se cobró algo vale tanto como cobrarlo.
 *  2. GUARDAR. Con el comprobante como clave única por cuenta. Leer el mismo
 *     correo dos veces no puede crear dos movimientos, y eso lo impide la BASE.
 *  3. CASAR. Solo si coinciden el monto EXACTO y el código que quien paga
 *     escribió. Nunca por monto solo.
 *
 * Lo que no casa se queda `pending` y lo asigna una persona. Que sobren
 * movimientos sin dueño es NORMAL, no un error: alguien paga sin poner el
 * código, o paga otra cosa.
 */

export type IngestOutcome =
  | { kind: 'ignored'; reason: 'outgoing' | 'account_notice' | 'not_a_notice' }
  | { kind: 'duplicate'; movementId: string }
  | { kind: 'stored'; movementId: string; applied: boolean };

/** Una cuenta, con lo que hace falta para guardarle un movimiento. */
interface AccountRef {
  id: string;
  tenantId: string | null;
}

export async function ingestSinpeEmail(
  account: AccountRef,
  subject: string,
  body: string,
  /** De quién viene. Davivienda no nombra al banco más que aquí. */
  from = '',
): Promise<IngestOutcome> {
  const reading = parseSinpeEmail(subject, body, from);
  const raw = `${from}\n${subject}\n${body}`.trim().slice(0, 20_000);

  // Plata que SALE no se guarda: no es un cobro que nadie vaya a revisar, y
  // llenar la pantalla de movimientos propios es cómo se deja de mirarla.
  if (reading.outcome === 'ignore' && reading.reason === 'outgoing') {
    return { kind: 'ignored', reason: 'outgoing' };
  }
  // Lo que no es un aviso de banco tampoco: sería guardar el buzón entero.
  if (reading.outcome === 'ignore' && reading.reason === 'not_a_notice') {
    return { kind: 'ignored', reason: 'not_a_notice' };
  }

  // El aviso de movimiento de cuenta SÍ se guarda, como `ignored`. Es la misma
  // plata que el aviso de SINPE Móvil contada dos veces, y el dueño ya se
  // confundió una vez creyendo que eran pagos repetidos: dejarlo escrito, con
  // su motivo, es lo que evita que vuelva a pasar.
  if (reading.outcome === 'ignore' && reading.reason === 'account_notice') {
    await storeIgnored(account, raw, reading.amount ?? 0);
    return { kind: 'ignored', reason: 'account_notice' };
  }
  if (reading.outcome === 'ignore') return { kind: 'ignored', reason: reading.reason };

  const stored = await store(account, reading.movement, raw);
  if (stored.duplicate) return { kind: 'duplicate', movementId: stored.id };

  const applied = await tryMatch(stored.id);
  return { kind: 'stored', movementId: stored.id, applied };
}

/**
 * Guarda el movimiento. Si el comprobante ya estaba, NO escribe nada y devuelve
 * el que había: el mismo correo leído dos veces es un caso corriente —el buzón
 * se repasa cada cinco minutos— y no puede cobrar dos veces.
 */
async function store(
  account: AccountRef,
  movement: SinpeMovement,
  raw: string,
): Promise<{ id: string; duplicate: boolean }> {
  const prisma = controlDb();
  const existing = await prisma.sinpeMovement.findUnique({
    where: { accountId_reference: { accountId: account.id, reference: movement.reference } },
    select: { id: true },
  });
  if (existing !== null) return { id: existing.id, duplicate: true };

  try {
    const row = await prisma.sinpeMovement.create({
      data: {
        accountId: account.id,
        tenantId: account.tenantId,
        senderName: movement.senderName,
        senderPhone: movement.senderPhone,
        amount: movement.amount,
        currency: 'CRC',
        reference: movement.reference,
        detail: movement.detail,
        bank: movement.bank,
        movementType: movement.movementType,
        destinationNumber: movement.destinationNumber,
        status: 'pending',
        raw,
      },
      select: { id: true },
    });
    return { id: row.id, duplicate: false };
  } catch {
    // Dos repasos a la vez sobre el mismo correo. El índice único decide, y el
    // que pierde lee la fila del que ganó en vez de dar error.
    const winner = await prisma.sinpeMovement.findUniqueOrThrow({
      where: { accountId_reference: { accountId: account.id, reference: movement.reference } },
      select: { id: true },
    });
    return { id: winner.id, duplicate: true };
  }
}

/**
 * El aviso de movimiento de cuenta, guardado para que se vea POR QUÉ no se
 * cobró — y con su importe de verdad, no con un cero: «esto llegó y no se
 * cobró porque es el mismo dinero» es lo que evita la confusión que ya hubo.
 *
 * Su referencia no sirve de clave: es SIEMPRE LA MISMA porque identifica al
 * aviso y no al movimiento (en el sistema del que viene esto se repite
 * `1054101` en cinco correos distintos). Así que la clave se saca del correo
 * entero, con una huella. Y tiene que ser DETERMINISTA: con la hora dentro,
 * cada pasada del temporizador —cada cinco minutos, releyendo lo mismo— habría
 * guardado otra fila del mismo aviso.
 */
async function storeIgnored(account: AccountRef, raw: string, amount: number): Promise<void> {
  const fingerprint = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  await controlDb()
    .sinpeMovement.create({
      data: {
        accountId: account.id,
        tenantId: account.tenantId,
        amount,
        currency: 'CRC',
        reference: `aviso-${fingerprint}`,
        movementType: 'credito',
        status: 'ignored',
        raw,
      },
    })
    // Ya estaba: es el mismo aviso releído, que es lo normal.
    .catch(() => undefined);
}

/**
 * Casa el movimiento con un cobro pendiente y lo da por pagado.
 *
 * LAS DOS COSAS: el monto exacto y el código que escribió quien paga. Por monto
 * solo jamás — dos oficinas con el mismo plan pagan lo mismo el mismo día, y
 * equivocarse ahí es activarle el plan a la que no pagó.
 *
 * El cobro se crea con el COMPROBANTE como `providerRef`, que es único por
 * proveedor: aunque todo lo demás fallara, el mismo comprobante no puede
 * generar dos cobros.
 */
export async function tryMatch(movementId: string): Promise<boolean> {
  const prisma = controlDb();
  const movement = await prisma.sinpeMovement.findUnique({
    where: { id: movementId },
    select: {
      id: true,
      amount: true,
      status: true,
      reference: true,
      raw: true,
      account: { select: { tenantId: true } },
    },
  });
  if (movement === null || movement.status !== 'pending') return false;

  const text = plainText(movement.raw);
  // Solo pedidos sin pagar, en colones y con el mismo importe. Cuando la cuenta
  // es de una oficina, además, los de ESA oficina: en la fase dos esto es
  // dinero de otro.
  const candidates = await prisma.order.findMany({
    where: {
      status: 'pending',
      currency: 'CRC',
      amount: movement.amount,
      payCode: { not: null },
      ...(movement.account.tenantId === null ? {} : { tenantId: movement.account.tenantId }),
    },
    select: {
      id: true,
      tenantId: true,
      amount: true,
      description: true,
      packageGuests: true,
      payCode: true,
    },
    take: 200,
  });

  const order = candidates.find(
    (candidate) => candidate.payCode !== null && codeAppearsIn(text, candidate.payCode),
  );
  if (order === undefined) return false;

  return settle(movement.id, movement.reference, movement.amount, order);
}

/** Escribe el cobro y lo liquida, en la ÚNICA función que da algo por pagado. */
async function settle(
  movementId: string,
  reference: string,
  amount: number,
  order: {
    id: string;
    tenantId: string;
    amount: number;
    description: string;
    packageGuests: number | null;
  },
): Promise<boolean> {
  const prisma = controlDb();

  // El comprobante como `providerRef`. Si ya existe, es que este movimiento ya
  // se aplicó: se reutiliza en vez de crear un segundo cobro.
  const payment = await prisma.payment.upsert({
    where: { provider_providerRef: { provider: 'sinpe', providerRef: reference } },
    update: {},
    create: {
      orderId: order.id,
      provider: 'sinpe',
      providerRef: reference,
      status: 'pending',
      amount,
      currency: 'CRC',
    },
    select: { id: true },
  });

  const changed = await applySettlement(order, payment.id, 'paid', 'sinpe');

  await prisma.sinpeMovement.updateMany({
    where: { id: movementId, status: 'pending' },
    data: { status: 'applied', paymentId: payment.id, settledAt: new Date() },
  });
  return changed;
}
