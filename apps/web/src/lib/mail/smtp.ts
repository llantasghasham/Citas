import { createTransport, type Transporter } from 'nodemailer';

import { decryptSecret } from '@/lib/secrets';

import type { Email, Mailer } from './types';

/**
 * SMTP delivery.
 *
 * The password is read from `SMTP_PASSWORD_ENC`, encrypted with the key in
 * `CITAS_SECRET_KEY_FILE`, so the `.env` alone does not reveal it.
 * `SMTP_PASSWORD` in the clear is still accepted — some hosts leave no choice —
 * but it is refused in production, where there is no excuse for it.
 */
function password(): string {
  const encrypted = process.env['SMTP_PASSWORD_ENC'];
  if (encrypted !== undefined && encrypted.length > 0) return decryptSecret(encrypted);

  const plain = process.env['SMTP_PASSWORD'];
  if (plain === undefined || plain.length === 0) {
    throw new Error('No SMTP password. Set SMTP_PASSWORD_ENC (see npm run secret:encrypt).');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SMTP_PASSWORD in the clear is not allowed in production. Use SMTP_PASSWORD_ENC.');
  }
  return plain;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is not set.`);
  return value;
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (transporter !== undefined) return transporter;

  const port = Number.parseInt(process.env['SMTP_PORT'] ?? '587', 10);

  transporter = createTransport({
    host: required('SMTP_HOST'),
    port,
    // 587 is STARTTLS: the connection opens in the clear and is upgraded.
    // Only 465 is TLS from the first byte.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: required('SMTP_USER'), pass: password() },
  });

  return transporter;
}

export const smtpMailer: Mailer = {
  id: 'smtp',

  async send(email: Email): Promise<void> {
    try {
      await getTransporter().sendMail({
        from: required('MAIL_FROM'),
        to: email.to,
        subject: email.subject,
        text: email.text,
      });
    } catch (error) {
      // Never let the credentials travel in an error: nodemailer's messages can
      // carry the auth line, and this ends up in the journal.
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw new Error(`SMTP delivery failed: ${reason.replace(/AUTH\s+\S+/gi, 'AUTH […]')}`);
    }
  },
};
