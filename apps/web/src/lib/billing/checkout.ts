import { randomBytes } from 'node:crypto';
import { cache } from 'react';

import { PAYMENT_METHODS, type Locale, type PaymentMethod } from '@citas/core';

import type { Currency } from '@/generated/prisma/enums';
import { recordAudit } from '@/lib/audit';
import { applySettlement } from '@/lib/billing/reconcile';
import { getPrisma } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { getPaymentProvider, providerFor, type PaymentStatus } from '@/lib/payments';
import { setting } from '@/lib/settings';

import { findPackage, priceFor, type InvitationPackage } from './packages';

/**
 * Vender un paquete de invitaciones a la pareja que se casa.
 *
 * La pareja NO tiene cuenta aquí y no va a abrirse una para pagar: eso costaría
 * más ventas de las que protegería. Así que el pedido lleva su propio enlace
 * público, `/pagar/<token>`, que viaja por WhatsApp igual que las invitaciones.
 *
 * SEGUNDA CONSULTA SIN OFICINA DEL PROYECTO. La regla dice que la única es
 * buscar una invitación por su slug público, y que cualquier otra hay que
 * discutirla; esta es la discusión. Vale por lo mismo que aquella:
 *
 * - El token son 24 bytes al azar y no se puede adivinar. Sin él no hay lectura.
 * - Resuelve a UN pedido, nunca a un listado. Nadie puede recorrer los pedidos
 *   de una oficina, ni menos los de otra.
 * - Lo que devuelve es lo que hay que enseñarle a quien paga —de quién es la
 *   boda, qué paquete y cuánto—, no la oficina entera.
 *
 * Lo que NO hace es fiarse del navegador. Que la pareja vuelva a la URL de
 * éxito no cobra nada: el pedido se marca pagado cuando `getStatus()` lo dice.
 */

/** 24 bytes al azar, el mismo tamaño que el enlace personal del invitado. */
function newPayToken(): string {
  return randomBytes(24).toString('base64url');
}

export interface PackageSale {
  eventId: string;
  packageId: string;
  clientName: string;
  clientPhone: string | null;
}

/**
 * Abre el pedido y devuelve su enlace. NO llama todavía al proveedor: un enlace
 * de cobro caduca, y entre que la oficina lo crea y la pareja lo abre pueden
 * pasar días. La cobranza se pide cuando alguien va a pagar de verdad.
 */
export async function openPackageOrder(
  scope: TenantScope,
  sale: PackageSale,
  actorId: string,
): Promise<{ orderId: string; payToken: string } | { error: 'notFound' | 'unknownPackage' }> {
  const pack = findPackage(sale.packageId);
  if (pack === undefined) return { error: 'unknownPackage' };

  const prisma = getPrisma();
  const event = await prisma.event.findFirst({
    where: { id: sale.eventId, ...scopedWhere(scope) },
    select: { id: true, channel: true },
  });
  if (event === null) return { error: 'notFound' };

  // El precio lo decide el canal del EVENTO, no quien rellena el formulario:
  // una oficina con licencia deposita el mayorista, y lo que le cobre luego a
  // la pareja es su margen.
  const amount = priceFor(pack, event.channel);
  const payToken = newPayToken();

  const order = await prisma.order.create({
    data: {
      ...scopedWhere(scope),
      eventId: event.id,
      amount,
      currency: 'USD',
      description: `Paquete ${pack.guests}`,
      status: 'pending',
      packageGuests: pack.guests,
      clientName: sale.clientName,
      clientPhone: sale.clientPhone,
      payToken,
    },
  });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'order.package.open',
    entity: 'Order',
    entityId: order.id,
    metadata: { packageId: pack.id, guests: pack.guests, amount, channel: event.channel },
  });

  return { orderId: order.id, payToken };
}

export interface PublicOrder {
  payToken: string;
  officeName: string;
  officeLocale: Locale;
  eventTitle: string;
  eventLocale: Locale | null;
  clientName: string | null;
  guests: number;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  /** Lo que ya se le pidió al proveedor, si se le pidió algo. */
  providerRef: string | null;
}

/**
 * Ver arriba: consulta sin oficina, a propósito y por token.
 *
 * Memorizada por petición porque la piden dos: el layout raíz, para saber en
 * qué idioma declarar el documento, y la pantalla. Preguntar dos veces costaría
 * dos consultas por cada carga.
 */
export const loadPublicOrder = cache(async (payToken: string): Promise<PublicOrder | null> => {
  if (payToken.length < 16) return null;

  const order = await getPrisma().order.findUnique({
    where: { payToken },
    select: {
      payToken: true,
      amount: true,
      currency: true,
      status: true,
      packageGuests: true,
      clientName: true,
      eventId: true,
      tenant: { select: { name: true, defaultLocale: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { providerRef: true } },
    },
  });
  if (order === null || order.payToken === null || order.packageGuests === null) return null;

  // El nombre de la boda y el idioma en que se escribió: la pareja tiene que
  // reconocer lo suyo, y verlo en su idioma, no en el de la oficina.
  const event =
    order.eventId === null
      ? null
      : await getPrisma().event.findUnique({
          where: { id: order.eventId },
          select: {
            honorees: { orderBy: { order: 'asc' }, select: { name: true } },
            versions: { orderBy: { createdAt: 'asc' }, take: 1, select: { locale: true } },
          },
        });

  return {
    payToken: order.payToken,
    officeName: order.tenant.name,
    officeLocale: order.tenant.defaultLocale,
    eventTitle: event?.honorees.map((honoree) => honoree.name).join(' · ') ?? '',
    eventLocale: event?.versions[0]?.locale ?? null,
    clientName: order.clientName,
    guests: order.packageGuests,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    providerRef: order.payments[0]?.providerRef ?? null,
  };
});

/**
 * Pide la cobranza y dice a dónde mandar a quien paga. Whish aloja su propia
 * pantalla de pago, así que el destino es suyo, no nuestro: no se puede meter
 * en un iframe ni pedir aquí un número de tarjeta.
 */
export async function beginPublicPayment(
  payToken: string,
  origin: string,
): Promise<{ payUrl: string } | { error: 'notFound' | 'alreadyPaid' | 'provider' }> {
  const prisma = getPrisma();
  const order = await prisma.order.findUnique({
    where: { payToken },
    select: { id: true, tenantId: true, amount: true, currency: true, description: true, status: true },
  });
  if (order === null) return { error: 'notFound' };
  if (order.status === 'paid') return { error: 'alreadyPaid' };

  try {
    const provider = await getPaymentProvider();

    // Si ya hay una cobranza abierta para este pedido, se REUTILIZA. Sin esto,
    // un doble clic —o volver atrás y pulsar otra vez, que es lo que hace
    // cualquiera cuando una pasarela tarda— abría dos cobranzas en Whish para
    // la misma boda. Dos enlaces vivos es la forma más tonta de que una pareja
    // pague dos veces.
    const open = await prisma.payment.findFirst({
      where: { orderId: order.id, provider: provider.id, status: 'pending' },
      select: { payUrl: true },
    });
    if (open?.payUrl != null && open.payUrl.length > 0) return { payUrl: open.payUrl };

    const back = `${origin}/pagar/${payToken}`;
    const handle = await provider.createCollection({
      orderId: order.id,
      amount: { amount: order.amount, currency: order.currency },
      description: order.description,
      successUrl: `${back}?volvio=1`,
      failureUrl: `${back}?volvio=1&fallo=1`,
      callbackUrl: `${origin}/api/payments/${provider.id}/callback`,
    });
    if (handle.payUrl === undefined) return { error: 'provider' };

    try {
      await prisma.payment.create({
        data: {
          orderId: order.id,
          // El proveedor DE VERDAD, no aplastado contra «manual». Es lo que
          // luego decide a quién se le pregunta por este cobro.
          provider: provider.id,
          providerRef: handle.providerRef,
          payUrl: handle.payUrl,
          status: 'pending',
          amount: order.amount,
          currency: order.currency,
        },
      });
    } catch {
      // La base tiene un único parcial: UN cobro pendiente por pedido. Si dos
      // peticiones llegaron a la vez, las dos pasaron la comprobación de arriba
      // y solo una puede escribir. La que pierde usa el enlace de la que ganó,
      // en vez de reventar en la cara de quien está pagando.
      const winner = await prisma.payment.findFirst({
        where: { orderId: order.id, provider: provider.id, status: 'pending' },
        select: { payUrl: true },
      });
      if (winner?.payUrl == null) throw new Error('no se pudo abrir la cobranza');
      return { payUrl: winner.payUrl };
    }

    return { payUrl: handle.payUrl };
  } catch (error) {
    // Lo que falla aquí es la pasarela, y el detalle no es asunto de quien
    // paga: se queda en el log del servidor.
    console.error(`[pagar] no se pudo abrir la cobranza: ${String(error)}`);
    return { error: 'provider' };
  }
}

/**
 * Pregunta al proveedor qué pasó de verdad y lo escribe. Esto —ni el regreso
 * del navegador, ni el cuerpo del callback— es lo que marca un pedido pagado.
 */
export async function settlePublicOrder(payToken: string): Promise<PaymentStatus | null> {
  const prisma = getPrisma();
  const order = await prisma.order.findUnique({
    where: { payToken },
    select: {
      id: true,
      tenantId: true,
      amount: true,
      description: true,
      packageGuests: true,
      status: true,
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const payment = order?.payments[0];
  if (order === undefined || order === null) return null;
  if (order.status === 'paid') return 'paid';
  if (payment === undefined) return order.status;

  // El adaptador del proveedor con el que se abrió ESTE cobro. El efectivo no
  // tiene a quién preguntarle: lo marcó una persona y ya está decidido.
  const provider = providerFor(payment.provider);
  if (provider === null) return payment.status === 'paid' ? 'paid' : order.status;

  const status = await provider.getStatus(payment.providerRef, payment.currency);

  // Lo que significa ese estado lo decide UN solo sitio, el mismo que usan el
  // botón de la oficina y el repaso periódico.
  await applySettlement(order, payment.id, status, 'link');
  return status;
}

export interface SoldPackage {
  orderId: string;
  payToken: string;
  clientName: string | null;
  clientPhone: string | null;
  guests: number;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  createdAt: Date;
}

/** Los paquetes vendidos para UN evento, para la pantalla de la oficina. */
export async function listPackageOrders(
  scope: TenantScope,
  eventId: string,
): Promise<SoldPackage[]> {
  const orders = await getPrisma().order.findMany({
    where: { ...scopedWhere(scope), eventId, packageGuests: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      payToken: true,
      clientName: true,
      clientPhone: true,
      packageGuests: true,
      amount: true,
      currency: true,
      status: true,
      createdAt: true,
    },
  });

  return orders.flatMap((order) =>
    order.payToken === null || order.packageGuests === null
      ? []
      : [
          {
            orderId: order.id,
            payToken: order.payToken,
            clientName: order.clientName,
            clientPhone: order.clientPhone,
            guests: order.packageGuests,
            amount: order.amount,
            currency: order.currency,
            status: order.status,
            createdAt: order.createdAt,
          },
        ],
  );
}

export function packagesForChannel(
  catalogue: readonly InvitationPackage[],
  channel: 'self_service' | 'licensed_office' | 'concierge',
): { pack: InvitationPackage; price: number }[] {
  return catalogue.map((pack) => ({ pack, price: priceFor(pack, channel) }));
}


/**
 * Los medios de cobro encendidos hoy.
 *
 * Vacío no significa «todos»: significa que nadie ha configurado el cobro y que
 * la pantalla de pago no debe ofrecer nada. Whish es lo que trae de fábrica
 * porque es el mercado de arranque.
 */
export async function enabledMethods(): Promise<PaymentMethod[]> {
  const raw = (await setting('PAYMENT_METHODS')) ?? 'whish';
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is PaymentMethod =>
      PAYMENT_METHODS.some((candidate) => candidate === entry),
    );
}

/**
 * Marca un pedido como cobrado en efectivo.
 *
 * La regla del proyecto dice que solo la respuesta del proveedor marca pagada
 * una factura, y sigue en pie donde hay proveedor. El efectivo no lo tiene: lo
 * cobra una persona en un mostrador. Así que lo marca una PERSONA, con nombre,
 * en el historial, y nunca el navegador de quien paga ni un enlace público.
 *
 * Por eso esto no vive en `/pagar` sino en el panel, pide `billing:manage`, y
 * escribe un `Payment` con `provider: manual` para que la conciliación vea de
 * dónde salió cada peso.
 */
export async function markPaidInCash(
  scope: TenantScope,
  orderId: string,
  actorId: string,
): Promise<boolean> {
  const prisma = getPrisma();
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...scopedWhere(scope) },
    select: { id: true, amount: true, currency: true, status: true },
  });
  if (order === null || order.status === 'paid') return false;

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: 'manual',
      // Sin proveedor no hay referencia del proveedor: se guarda una propia,
      // que dice qué fue y cuándo, para no dejar el campo en blanco.
      providerRef: `cash_${order.id}`,
      status: 'paid',
      amount: order.amount,
      currency: order.currency,
      paidAt: new Date(),
    },
  });
  await prisma.order.update({ where: { id: order.id }, data: { status: 'paid' } });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'order.paid.cash',
    entity: 'Order',
    entityId: order.id,
    metadata: { amount: order.amount, currency: order.currency },
  });

  return true;
}
