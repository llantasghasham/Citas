import { createTransport, type Transporter } from 'nodemailer';

import { secret, setting } from '@/lib/settings';

import type { Email, Mailer, MailReceipt } from './types';

/**
 * SMTP delivery.
 *
 * The password is read from `SMTP_PASSWORD_ENC`, encrypted with the key in
 * `CITAS_SECRET_KEY_FILE`, so the `.env` alone does not reveal it.
 * `SMTP_PASSWORD` in the clear is still accepted — some hosts leave no choice —
 * but it is refused in production, where there is no excuse for it.
 */
let transporter: Transporter | undefined;

/**
 * Lee un ajuste obligatorio, y señala el nombre parecido cuando lo encuentra
 * puesto: escribir `SMTP_FROM` donde el código lee `MAIL_FROM` ya costó un
 * despliegue, y «MAIL_FROM no está» es inútil para quien mira una línea que
 * parece ponerlo.
 */
async function required(name: 'SMTP_HOST' | 'SMTP_USER' | 'MAIL_FROM'): Promise<string> {
  const value = await setting(name);
  if (value !== undefined && value.length > 0) return value;

  const confuso = name === 'MAIL_FROM' && (process.env['SMTP_FROM'] ?? '').length > 0;
  throw new Error(
    `${name} no está configurado.${confuso ? ' SMTP_FROM sí, pero ese no es el nombre que se lee.' : ''}`,
  );
}

async function getTransporter(): Promise<Transporter> {
  if (transporter !== undefined) return transporter;

  const port = Number.parseInt((await setting('SMTP_PORT')) ?? '587', 10);
  const password = await secret('SMTP_PASSWORD');
  if (password === undefined) {
    throw new Error('No hay contraseña de SMTP. Póngala en el panel, en Configuración.');
  }

  transporter = createTransport({
    host: await required('SMTP_HOST'),
    port,
    // 587 is STARTTLS: the connection opens in the clear and is upgraded.
    // Only 465 is TLS from the first byte.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: await required('SMTP_USER'), pass: password },
    // A mail server that accepts the connection and then says nothing would
    // otherwise hold the sign-in request open for as long as it liked, and
    // /entrar would hang for everybody, not just for the one signing in.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return transporter;
}

/** El transporte guarda la conexión: al cambiar la configuración hay que soltarla. */
export function resetTransporter(): void {
  transporter = undefined;
}

export const smtpMailer: Mailer = {
  id: 'smtp',

  async send(email: Email): Promise<MailReceipt> {
    try {
      const info = await (await getTransporter()).sendMail({
        from: await required('MAIL_FROM'),
        to: email.to,
        subject: email.subject,
        text: email.text,
      });

      // Kept because `verify()` never reaches this far: it stops after the
      // login, so a server that authenticates happily and then refuses the
      // recipient looks identical to one that works.
      return {
        accepted: (info.accepted ?? []).map(String),
        rejected: (info.rejected ?? []).map(String),
        response: info.response ?? '',
      };
    } catch (error) {
      // Never let the credentials travel in an error: nodemailer's messages can
      // carry the auth line, and this ends up in the journal.
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw new Error(`SMTP delivery failed: ${reason.replace(/AUTH\s+\S+/gi, 'AUTH […]')}`);
    }
  },
};
