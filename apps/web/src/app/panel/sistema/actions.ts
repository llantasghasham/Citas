'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { clientIp } from '@/lib/admin/context';
import { recordAudit } from '@/lib/audit';
import { getSession, sessionCan } from '@/lib/auth/session';
import { controlDb } from '@/lib/db/client';
import { getMailer } from '@/lib/mail';
import { getPaymentProvider } from '@/lib/payments';

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
 * It only ever writes to the address of whoever pressed the button (falling back
 * to the configured superadmin address). A field for an arbitrary recipient
 * would turn this panel into a way to send mail from the office's own domain to
 * anyone.
 */
export async function sendTestMailAction(): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  // A QUIÉN se le manda: a la dirección de QUIEN pulsa el botón, y solo si no
  // la tiene, a la del entorno. Es la misma clase de destinatario —una cuenta
  // de esta instalación, nunca una escrita a mano— y es la única que la persona
  // que está mirando la pantalla puede abrir. Con `SUPERADMIN_EMAIL` a secas,
  // un correo que salía perfectamente parecía no salir: llegaba a un buzón que
  // no era el suyo, y el panel decía «enviado» sin decir adónde.
  const to = session.email.length > 0 ? session.email : (process.env['SUPERADMIN_EMAIL'] ?? '');
  if (to.length === 0) {
    redirect('/panel/configuracion?mail=failed&reason=SUPERADMIN_EMAIL');
  }

  const since = new Date(Date.now() - COOLDOWN_SECONDS * 1000);
  const recent = await controlDb().auditLog.count({
    where: { action: TEST_ACTION, createdAt: { gte: since } },
  });
  if (recent > 0) redirect('/panel/configuracion?mail=tooSoon');

  const ip = clientIp(await headers());
  let problem: string | null = null;
  let receipt = '';
  try {
    const result = await (await getMailer()).send({
      to,
      subject: 'Citas — prueba de correo saliente',
      text:
        'Este mensaje confirma que el envío de correo funciona en esta instalación.\n' +
        'Si lo está leyendo, los códigos de un solo uso también saldrán.\n',
    });

    // What the provider actually said. Handing a message over is not delivering
    // it — a server can take it and drop it, and nobody is told — so the last
    // witnessed fact is worth showing instead of a bare "sent".
    // El destinatario va PRIMERO. «Enviado» sin decir adónde es lo que hace que
    // se busque el fallo en el servidor de correo cuando el mensaje está en
    // otro buzón —o en la carpeta de no deseado de este.
    receipt = `para ${to} · ${result.response} · aceptados: ${result.accepted.join(', ') || '—'}${
      result.rejected.length > 0 ? ` · rechazados: ${result.rejected.join(', ')}` : ''
    }`;
    if (result.accepted.length === 0) {
      problem = `El servidor no aceptó ningún destinatario. ${receipt}`;
    }
  } catch (error) {
    problem = error instanceof Error ? error.message : 'unknown error';
  }

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: TEST_ACTION,
    entity: 'User',
    entityId: session.userId,
    metadata: { ok: problem === null, problem, receipt },
    ip,
  });

  if (problem !== null) {
    redirect(`/panel/configuracion?mail=failed&reason=${encodeURIComponent(problem.slice(0, 300))}`);
  }
  redirect(`/panel/configuracion?mail=ok&reason=${encodeURIComponent(receipt.slice(0, 300))}`);
}

const PROBE_ACTION = 'system.payments.probe';

/**
 * Pregunta a la pasarela si las credenciales valen.
 *
 * Es de SOLO LECTURA: consulta el saldo del comercio y no crea ningún cobro,
 * así que se puede pulsar sin ensuciar nada. Y es lo único que distingue «mal
 * configurado» de «Whish rechaza estas credenciales».
 */
export async function probePaymentsAction(): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  const ip = clientIp(await headers());
  let resultado: string;
  let ok = true;
  try {
    const provider = await getPaymentProvider();
    resultado =
      provider.probe === undefined
        ? `${provider.id}: no ofrece comprobación`
        : await provider.probe();
  } catch (error) {
    ok = false;
    resultado = error instanceof Error ? error.message : 'error desconocido';
  }

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: PROBE_ACTION,
    entity: 'User',
    entityId: session.userId,
    metadata: { ok, resultado },
    ip,
  });

  redirect(
    `/panel/configuracion?pago=${ok ? 'ok' : 'failed'}&motivo=${encodeURIComponent(resultado.slice(0, 300))}`,
  );
}

/**
 * Le quita el mando a un superadministrador que sobra.
 *
 * Existe porque no había ninguna forma de hacerlo. El instalador escribe un
 * `SUPERADMIN_EMAIL` de relleno —`cambiame@ejemplo.com`—, `db:seed` lo convierte
 * en superadministrador, y el día que el dueño pone el suyo de verdad la cuenta
 * de relleno **se queda**: con mando sobre todas las oficinas, sobre el cobro y
 * sobre la configuración, en una dirección que él no controla. La pantalla lo
 * marcaba en ámbar y no ofrecía nada que pulsar, así que llevaba meses ahí.
 *
 * Le quita el mando, NO borra a la persona. Borrarla se llevaría por delante su
 * historial —quién hizo qué y cuándo— que es justo lo que hay que conservar
 * cuando se retira un acceso. Y se puede deshacer, que es lo que hace que
 * alguien se atreva a pulsarlo.
 *
 * Tres cosas que no deja hacer, y las tres son la misma: cerrarse la puerta
 * desde dentro.
 *
 *   1. A uno mismo. Es cómo se queda una instalación sin nadie que pueda entrar.
 *   2. Al de `SUPERADMIN_EMAIL`, que es el que el servidor considera el dueño.
 *   3. Al último que quede.
 */
export async function revokeSuperadminAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  // El correo viaja en un formulario, así que es un dato del cliente: todo lo
  // que decide se comprueba aquí contra la base, no contra lo que llegó.
  if (email.length === 0) redirect('/panel/sistema?super=invalid');

  const configured = (process.env['SUPERADMIN_EMAIL'] ?? '').trim().toLowerCase();
  if (email === configured) redirect('/panel/sistema?super=configured');
  if (email === session.email.toLowerCase()) redirect('/panel/sistema?super=self');

  const prisma = controlDb();
  const total = await prisma.user.count({ where: { isSuperadmin: true } });
  if (total <= 1) redirect('/panel/sistema?super=last');

  const target = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isSuperadmin: true },
  });
  if (target === null || !target.isSuperadmin) redirect('/panel/sistema?super=notFound');

  await prisma.user.update({ where: { id: target.id }, data: { isSuperadmin: false } });
  // Y se cierran sus sesiones. Sin esto, quien estuviera dentro seguiría
  // trabajando con los permisos que se le acaban de quitar hasta treinta días:
  // es el mismo agujero que tenía suspender una oficina.
  await prisma.session.deleteMany({ where: { userId: target.id } });

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'system.superadmin.revoke',
    entity: 'User',
    entityId: target.id,
    metadata: { email },
  });

  redirect('/panel/sistema?super=ok');
}
