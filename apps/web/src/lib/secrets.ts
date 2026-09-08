import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Encryption at rest for the few secrets that a running service must be able to
 * read back — today the SMTP password.
 *
 * Be clear about what this does and does not buy. Sending mail needs the
 * password in the clear at that moment, so the key has to live on the same
 * machine: anyone who can read both files can read the password. What it does
 * protect against is the `.env` leaking *on its own* — copied into a backup,
 * pasted into a chat, read by another process — because the key is kept
 * somewhere else, with its own permissions.
 *
 * Real protection is still: mode 600, never in the repository, and rotation.
 */
const FORMAT = 'v1';

function readKey(): Buffer {
  const inline = process.env['CITAS_SECRET_KEY'];
  const path = process.env['CITAS_SECRET_KEY_FILE'];

  const material =
    inline !== undefined && inline.length > 0
      ? inline
      : path !== undefined && path.length > 0
        ? readFileSync(path, 'utf8')
        : undefined;

  if (material === undefined) {
    throw new Error(
      'No encryption key. Set CITAS_SECRET_KEY_FILE (preferred) or CITAS_SECRET_KEY.',
    );
  }

  const key = Buffer.from(material.trim(), 'base64');
  if (key.length !== 32) {
    throw new Error('The encryption key must be 32 bytes, base64 encoded (openssl rand -base64 32).');
  }
  return key;
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', readKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    FORMAT,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const [format, iv, tag, ciphertext] = payload.split('.');
  if (format !== FORMAT || iv === undefined || tag === undefined || ciphertext === undefined) {
    throw new Error('Malformed encrypted secret. Expected v1.<iv>.<tag>.<ciphertext>.');
  }

  const decipher = createDecipheriv('aes-256-gcm', readKey(), Buffer.from(iv, 'base64'));
  // GCM verifies the tag on final(): a tampered value throws instead of
  // decrypting into something else.
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
