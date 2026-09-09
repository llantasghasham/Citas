'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { clientIp } from '@/lib/admin/context';
import { recordAudit } from '@/lib/audit';
import { getSession, sessionCan } from '@/lib/auth/session';
import { getPrisma } from '@/lib/db/client';
import { getMailer } from '@/lib/mail';

const TEST_ACTION = 'system.mail.test';
/** One test a minute. A button that sends mail is a button that can send spam. */
const COOLDOWN_SECONDS = 60;

/**
 * Sends one real message, and shows what the mail server answered.
 *
 * The configuration can be complete and delivery still fail — a wrong password,
 * a provider refusing the login, a blocked port. Nothing short of an actual send
 * tells you that, and the day the codes stopped arriving there was no way to ask.
 *
 * It only ever writes to the configured superadmin address. A field for an
 * arbitrary recipient would turn this panel into a way to send mail from the
 * office's own domain to anyone.
 */
export async function sendTestMailAction(): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  // Naming the missing variable, not just "it failed": an unset address and a
  // provider refusing the login are different problems with different fixes.
  const to = process.env['SUPERADMIN_EMAIL'];
  if (to === undefined || to.length === 0) {
    redirect('/panel/sistema?mail=failed&reason=SUPERADMIN_EMAIL');
  }

  const since = new Date(Date.now() - COOLDOWN_SECONDS * 1000);
  const recent = await getPrisma().auditLog.count({
    where: { action: TEST_ACTION, createdAt: { gte: since } },
  });
  if (recent > 0) redirect('/panel/sistema?mail=tooSoon');

  const ip = clientIp(await headers());
  let problem: string | null = null;
  try {
    await getMailer().send({
      to,
      subject: 'Citas — prueba de correo saliente',
      text:
        'Este mensaje confirma que el envío de correo funciona en esta instalación.\n' +
        'Si lo está leyendo, los códigos de un solo uso también saldrán.\n',
    });
  } catch (error) {
    problem = error instanceof Error ? error.message : 'unknown error';
  }

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: TEST_ACTION,
    entity: 'User',
    entityId: session.userId,
    metadata: { ok: problem === null, problem },
    ip,
  });

  if (problem !== null) {
    redirect(`/panel/sistema?mail=failed&reason=${encodeURIComponent(problem.slice(0, 300))}`);
  }
  redirect('/panel/sistema?mail=ok');
}
