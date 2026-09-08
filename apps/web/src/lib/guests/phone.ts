/** Country codes this market actually dials. */
export const COUNTRY_CODES = ['+961', '+506', '+971', '+34', '+351', '+44', '+1'] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

/**
 * Normalises whatever the client wrote in their spreadsheet into the form
 * WhatsApp needs. People write `03 456 789`, `+961 3 456789` and
 * `00961-3-456789` for the same number, and a wrong one means an invitation
 * that never arrives.
 */
export function toE164(raw: string, defaultCountry: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const cleaned = trimmed.replace(/[^\d+]/g, '');
  // `00` is how the rest of the world writes a leading `+`.
  const withPlus = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;

  if (withPlus.startsWith('+')) {
    return /^\+\d{8,15}$/.test(withPlus) ? withPlus : null;
  }

  // A national number: drop the trunk zero and prepend the country.
  const national = withPlus.replace(/^0+/, '');
  if (!/^\d{6,14}$/.test(national)) return null;
  return `${defaultCountry}${national}`;
}

/** The digits-only form wa.me expects in its path. */
export function toWaMe(e164: string): string {
  return e164.replace(/\D/g, '');
}
