import { randomBytes } from 'node:crypto';

/**
 * A readable stem when the names are in Latin script, plus a random tail so the
 * slug is unique without a retry loop and cannot be guessed from the couple's
 * names. Arabic names fall back to the neutral stem: transliterating them
 * automatically is exactly what the project forbids.
 */
export function buildSlug(names: string[]): string {
  const stem = names
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 3)
    .join('-');

  const tail = randomBytes(4).toString('hex').slice(0, 6);
  return `${stem.length === 0 ? 'invitacion' : stem}-${tail}`;
}
