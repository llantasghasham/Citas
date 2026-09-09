import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  secret: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Deliberately slow. A login code lives ten minutes and dies on use; a password
 * lives until somebody changes it, so a stolen database must stay useless for
 * as long as possible. Scrypt with these parameters costs about 32 MB and a
 * tenth of a second per guess — nothing on one sign-in, ruinous on millions.
 *
 * The cost lives inside the stored string, so raising it later does not
 * invalidate the passwords already set.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/** Under this, a password is not worth the ceremony of hashing it. */
export const MIN_PASSWORD_LENGTH = 12;

/** `scrypt$N$r$p$salt$key`, all base64url. Never the password itself. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, KEY_BYTES, PARAMS);

  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Compares in constant time, and only against a hash this code wrote: an
 * unparseable or foreign format is a failure, never an accidental pass.
 */
export async function passwordMatches(plain: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || key === undefined) return false;

  const params = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return false;
  }

  const expected = Buffer.from(key, 'base64url');
  let actual: Buffer;
  try {
    actual = await scryptAsync(
      plain.normalize('NFKC'),
      Buffer.from(salt, 'base64url'),
      expected.length,
      params,
    );
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** What is wrong with a proposed password, as field names. Empty means fine. */
export function passwordProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.normalize('NFKC').length < MIN_PASSWORD_LENGTH) problems.push('tooShort');
  if (plain.trim() !== plain) problems.push('padded');
  return problems;
}
