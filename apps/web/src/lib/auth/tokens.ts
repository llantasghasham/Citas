import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Bytes of entropy in a session token. 256 bits. */
const SESSION_TOKEN_BYTES = 32;

/** Length of the emailed one-time code. Six digits is what people can retype. */
const CODE_DIGITS = 6;

/**
 * Secrets are stored hashed, never in the clear: a dump of the database must not
 * let anyone impersonate a user or replay a login code.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/** Cryptographically random, so a code cannot be predicted from an earlier one. */
export function newLoginCode(): string {
  const max = 10 ** CODE_DIGITS;
  return String(randomInt(0, max)).padStart(CODE_DIGITS, '0');
}

/** Compares hashes without leaking, through timing, how much of it matched. */
export function secretMatches(candidate: string, storedHash: string): boolean {
  const candidateHash = Buffer.from(hashSecret(candidate), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidateHash.length !== stored.length) return false;
  return timingSafeEqual(candidateHash, stored);
}
