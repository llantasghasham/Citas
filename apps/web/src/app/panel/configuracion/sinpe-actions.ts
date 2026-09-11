'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { clientIp } from '@/lib/admin/context';
import { recordAudit } from '@/lib/audit';
import { getSession, sessionCan, type AuthenticatedSession } from '@/lib/auth/session';
import {
  addAccount,
  assignMovement,
  editAccount,
  removeAccount,
  type AccountInput,
} from '@/lib/payments/sinpe/accounts';
import { ingestSinpeEmail } from '@/lib/payments/sinpe/service';
import { getPrisma } from '@/lib/db/client';

/**
 * Los buzones de SINPE.
 *
 * Todo esto es de la PLATAFORMA, así que lo guarda `platform:manage`: son los
 * campos que deciden a qué cuenta entra el dinero de las mensualidades, igual
 * que los de la pasarela. Y por eso mismo queda en el historial con su autor —
 * pero NUNCA con la contraseña: se anota qué cambió, jamás su valor.
 */
async function guard(): Promise<AuthenticatedSession> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');
  return session;
}

const BACK = '/panel/configuracion?s=sinpe';

function readInput(formData: FormData): AccountInput {
  return {
    name: String(formData.get('name') ?? '').trim(),
    bank: String(formData.get('bank') ?? '').trim(),
    phone: String(formData.get('phone') ?? '').trim(),
    imapHost: String(formData.get('imapHost') ?? '').trim(),
    imapPort: Number.parseInt(String(formData.get('imapPort') ?? '993'), 10),
    imapUser: String(formData.get('imapUser') ?? '').trim(),
    imapPassword: String(formData.get('imapPassword') ?? ''),
    folder: String(formData.get('folder') ?? 'INBOX').trim(),
    verifyCertificate: formData.get('verifyCertificate') !== null,
    active: formData.get('active') !== null,
    forSubscriptions: formData.get('forSubscriptions') !== null,
  };
}

export async function addSinpeAccountAction(formData: FormData): Promise<void> {
  const session = await guard();
  const input = readInput(formData);
  if (input.name.length === 0 || input.imapHost.length === 0 || input.imapUser.length === 0) {
    redirect(`${BACK}&sinpe=incompleto`);
  }
  if (input.imapPassword.length === 0) redirect(`${BACK}&sinpe=sinClave`);

  await addAccount(input);
  await recordAudit({
    tenantId: session.tenantId ?? '',
    actorId: session.userId,
    action: 'sinpe.account.add',
    entity: 'SinpeAccount',
    entityId: input.imapUser,
    // El usuario y el servidor, jamás la contraseña.
    metadata: { host: input.imapHost, user: input.imapUser },
    ip: clientIp(await headers()),
  });
  redirect(`${BACK}&sinpe=guardado`);
}

export async function editSinpeAccountAction(formData: FormData): Promise<void> {
  const session = await guard();
  const id = String(formData.get('id') ?? '');
  const input = readInput(formData);

  await editAccount(id, input);
  await recordAudit({
    tenantId: session.tenantId ?? '',
    actorId: session.userId,
    action: 'sinpe.account.edit',
    entity: 'SinpeAccount',
    entityId: id,
    metadata: { changed: input.imapPassword.length > 0 ? 'datos y contraseña' : 'datos' },
    ip: clientIp(await headers()),
  });
  redirect(`${BACK}&sinpe=guardado`);
}

export async function removeSinpeAccountAction(formData: FormData): Promise<void> {
  const session = await guard();
  const id = String(formData.get('id') ?? '');

  await removeAccount(id);
  await recordAudit({
    tenantId: session.tenantId ?? '',
    actorId: session.userId,
    action: 'sinpe.account.remove',
    entity: 'SinpeAccount',
    entityId: id,
    ip: clientIp(await headers()),
  });
  redirect(`${BACK}&sinpe=guardado`);
}

export async function assignMovementAction(formData: FormData): Promise<void> {
  const session = await guard();
  const movementId = String(formData.get('movementId') ?? '');
  const orderId = String(formData.get('orderId') ?? '');
  if (orderId.length === 0) redirect(BACK);

  const done = await assignMovement(movementId, orderId);
  await recordAudit({
    tenantId: session.tenantId ?? '',
    actorId: session.userId,
    action: 'sinpe.movement.assign',
    entity: 'SinpeMovement',
    entityId: movementId,
    metadata: { orderId, done },
    ip: clientIp(await headers()),
  });
  redirect(`${BACK}&sinpe=${done ? 'asignado' : 'asignarFallo'}`);
}

/**
 * Leer un correo pegado a mano.
 *
 * Sirve para dos cosas de verdad: probar cómo se lee un aviso del banco ANTES
 * de conectar el buzón —que es la única forma de saber si los patrones de ese
 * banco funcionan—, y cobrar un SINPE que llegó por SMS y no por correo.
 */
export async function readPastedEmailAction(formData: FormData): Promise<void> {
  await guard();
  const accountId = String(formData.get('accountId') ?? '');
  const from = String(formData.get('from') ?? '').slice(0, 200);
  const subject = String(formData.get('subject') ?? '').slice(0, 500);
  const body = String(formData.get('body') ?? '').slice(0, 100_000);
  if (accountId.length === 0 || body.trim().length === 0) redirect(`${BACK}&sinpe=incompleto`);

  const account = await getPrisma().sinpeAccount.findUnique({
    where: { id: accountId },
    select: { id: true, tenantId: true },
  });
  if (account === null) redirect(`${BACK}&sinpe=incompleto`);

  const outcome = await ingestSinpeEmail(account, subject, body, from);
  const result =
    outcome.kind === 'duplicate'
      ? 'duplicado'
      : outcome.kind === 'ignored'
        ? outcome.reason
        : outcome.applied
          ? 'cobrado'
          : 'guardado';
  redirect(`${BACK}&leido=${result}`);
}
