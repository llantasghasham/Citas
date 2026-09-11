import { applySettlement } from '@/lib/billing/reconcile';
import { getPrisma } from '@/lib/db/client';
import { encryptSecret } from '@/lib/secrets';
import type { SinpeMovementStatus } from '@/generated/prisma/enums';

/**
 * Los buzones de SINPE y lo leído de ellos, para la pantalla del panel.
 *
 * Hoy todo esto es de la PLATAFORMA —la fase 1 es que las oficinas le paguen la
 * mensualidad al dueño— y por eso lo guarda `platform:manage`. El modelo ya
 * distingue el buzón de una oficina (`tenantId`), así que la fase 2 es añadir
 * el filtro, no rehacer nada.
 */

export interface AccountRow {
  id: string;
  name: string;
  bank: string;
  phone: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  folder: string;
  verifyCertificate: boolean;
  active: boolean;
  forSubscriptions: boolean;
  tenantId: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
}

export interface MovementRow {
  id: string;
  senderName: string | null;
  senderPhone: string | null;
  amount: number;
  reference: string;
  detail: string | null;
  bank: string | null;
  status: SinpeMovementStatus;
  receivedAt: Date;
  accountName: string;
}

export async function listAccounts(): Promise<AccountRow[]> {
  return getPrisma().sinpeAccount.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      bank: true,
      phone: true,
      imapHost: true,
      imapPort: true,
      imapUser: true,
      folder: true,
      verifyCertificate: true,
      active: true,
      forSubscriptions: true,
      tenantId: true,
      lastCheckedAt: true,
      lastError: true,
    },
  });
}

/** Lo último leído. Sin asignar primero: es lo único sobre lo que hay que obrar. */
export async function listMovements(limit = 40): Promise<MovementRow[]> {
  const rows = await getPrisma().sinpeMovement.findMany({
    orderBy: [{ status: 'asc' }, { receivedAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      senderName: true,
      senderPhone: true,
      amount: true,
      reference: true,
      detail: true,
      bank: true,
      status: true,
      receivedAt: true,
      account: { select: { name: true } },
    },
  });
  return rows.map(({ account, ...row }) => ({ ...row, accountName: account.name }));
}

export interface AccountInput {
  name: string;
  bank: string;
  phone: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  /** Vacía significa «no la toques», como en todo el resto del panel. */
  imapPassword: string;
  folder: string;
  verifyCertificate: boolean;
  active: boolean;
  forSubscriptions: boolean;
}

export async function addAccount(input: AccountInput): Promise<void> {
  await getPrisma().sinpeAccount.create({
    data: {
      // Sin oficina: el buzón de la plataforma. Ver arriba.
      tenantId: null,
      name: input.name.slice(0, 80),
      bank: input.bank.slice(0, 40),
      phone: input.phone.slice(0, 20),
      imapHost: input.imapHost.slice(0, 200),
      imapPort: clampPort(input.imapPort),
      imapUser: input.imapUser.slice(0, 200),
      // Cifrada con AES-256-GCM y la llave fuera de la base, como la del SMTP.
      imapPasswordEnc: encryptSecret(input.imapPassword),
      folder: input.folder.slice(0, 100) || 'INBOX',
      verifyCertificate: input.verifyCertificate,
      active: input.active,
      forSubscriptions: input.forSubscriptions,
    },
  });
}

export async function editAccount(id: string, input: AccountInput): Promise<void> {
  await getPrisma().sinpeAccount.update({
    where: { id },
    data: {
      name: input.name.slice(0, 80),
      bank: input.bank.slice(0, 40),
      phone: input.phone.slice(0, 20),
      imapHost: input.imapHost.slice(0, 200),
      imapPort: clampPort(input.imapPort),
      imapUser: input.imapUser.slice(0, 200),
      // Vacía = no se toca. La pantalla NUNCA devuelve la que hay: se
      // reemplaza, no se lee.
      ...(input.imapPassword.length > 0
        ? { imapPasswordEnc: encryptSecret(input.imapPassword) }
        : {}),
      folder: input.folder.slice(0, 100) || 'INBOX',
      verifyCertificate: input.verifyCertificate,
      active: input.active,
      forSubscriptions: input.forSubscriptions,
    },
  });
}

export async function removeAccount(id: string): Promise<void> {
  await getPrisma().sinpeAccount.delete({ where: { id } }).catch(() => undefined);
}

function clampPort(port: number): number {
  if (!Number.isFinite(port)) return 993;
  return Math.min(65535, Math.max(1, Math.trunc(port)));
}

/** Los cobros pendientes a los que se puede asignar un movimiento a mano. */
export interface AssignableOrder {
  id: string;
  description: string;
  amount: number;
  currency: string;
  payCode: string | null;
  tenantName: string;
}

export async function assignableOrders(limit = 50): Promise<AssignableOrder[]> {
  const orders = await getPrisma().order.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      description: true,
      amount: true,
      currency: true,
      payCode: true,
      tenant: { select: { name: true } },
    },
  });
  return orders.map(({ tenant, ...order }) => ({ ...order, tenantName: tenant.name }));
}

/**
 * Asigna un movimiento a un cobro A MANO, porque lo decidió una persona.
 *
 * Sigue exigiendo que el IMPORTE coincida. Que lo pulse alguien no convierte en
 * buena idea dar por pagado un plan de veinticinco mil con un SINPE de mil: si
 * de verdad no coinciden, lo que hay que arreglar es el pedido.
 */
export async function assignMovement(movementId: string, orderId: string): Promise<boolean> {
  const prisma = getPrisma();
  const movement = await prisma.sinpeMovement.findUnique({
    where: { id: movementId },
    select: { id: true, amount: true, reference: true, status: true },
  });
  if (movement === null || movement.status !== 'pending') return false;

  const order = await prisma.order.findFirst({
    where: { id: orderId, status: 'pending', amount: movement.amount },
    select: { id: true, tenantId: true, amount: true, description: true, packageGuests: true },
  });
  if (order === null) return false;

  const payment = await prisma.payment.upsert({
    where: { provider_providerRef: { provider: 'sinpe', providerRef: movement.reference } },
    update: {},
    create: {
      orderId: order.id,
      provider: 'sinpe',
      providerRef: movement.reference,
      status: 'pending',
      amount: movement.amount,
      currency: 'CRC',
    },
    select: { id: true },
  });

  await applySettlement(order, payment.id, 'paid', 'sinpe');
  await prisma.sinpeMovement.updateMany({
    where: { id: movementId, status: 'pending' },
    data: { status: 'applied', paymentId: payment.id, settledAt: new Date() },
  });
  return true;
}
