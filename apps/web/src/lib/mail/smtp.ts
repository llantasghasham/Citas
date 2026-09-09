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
  if (encrypted !== undefined && encrypted.length > 0) {
    // The mistake this catches actually happened: the password was pasted into
    // this variable in the clear. Decrypting it would only say "malformed
    // secret", which does not tell anybody what they did.
    if (!encrypted.startsWith('v1.')) {
      throw new Error(
        'SMTP_PASSWORD_ENC does not hold an encrypted value (it must start with "v1."). ' +
          'It looks like the password was pasted in the clear. Encrypt it first: ' +
          'npm run secret:encrypt --workspace @citas/web',
      );
    }
    return decryptSecret(encrypted);
  }

  const plain = process.env['SMTP_PASSWORD'];
  if (plain === undefined || plain.length === 0) {
    throw new Error('No SMTP password. Set SMTP_PASSWORD_ENC (see npm run secret:encrypt).');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SMTP_PASSWORD in the clear is not allowed in production. Use SMTP_PASSWORD_ENC.');
  }
  return plain;
}

/**
 * Reads a variable, and points at the near-miss when there is one: writing
 * `SMTP_FROM` instead of `MAIL_FROM` has already cost one deployment, and
 * "MAIL_FROM is not set" is a useless thing to say to somebody who is looking
 * straight at a line that seems to set it.
 */
const NEAR_MISSES: Record<string, string> = { MAIL_FROM: 'SMTP_FROM' };

function required(name: string): string {
  const value = process.env[name];
  if (value !== undefined && value.length > 0) return value;

  const confused = NEAR_MISSES[name];
  const hint =
    confused !== undefined && (process.env[confused] ?? '').length > 0
      ? ` ${confused} is set, but that is not the name this reads.`
      : '';
  throw new Error(`${name} is not set.${hint}`);
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
    // A mail server that accepts the connection and then says nothing would
    // otherwise hold the sign-in request open for as long as it liked, and
    // /entrar would hang for everybody, not just for the one signing in.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
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
