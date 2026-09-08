/** Minimal runtime validators: JSON data is `unknown` until proven otherwise. */

export class DataError extends Error {
  constructor(path: string, expected: string, received: unknown) {
    super(`Invalid data at "${path}": expected ${expected}, received ${JSON.stringify(received)}`);
    this.name = 'DataError';
  }
}

export function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DataError(path, 'an object', value);
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new DataError(path, 'an array', value);
  return value;
}

export function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DataError(path, 'a non-empty string', value);
  }
  return value;
}

export function asOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return asString(value, path);
}

export function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DataError(path, 'a finite number', value);
  }
  return value;
}

export function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new DataError(path, 'a boolean', value);
  return value;
}

export function asEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  const candidate = asString(value, path);
  const match = allowed.find((option) => option === candidate);
  if (match === undefined) throw new DataError(path, `one of ${allowed.join(' | ')}`, value);
  return match;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WALL_CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function asIsoDate(value: unknown, path: string): string {
  const candidate = asString(value, path);
  if (!ISO_DATE.test(candidate) || Number.isNaN(Date.parse(`${candidate}T00:00:00Z`))) {
    throw new DataError(path, 'an ISO calendar date (YYYY-MM-DD)', value);
  }
  return candidate;
}

export function asTime(value: unknown, path: string): string {
  const candidate = asString(value, path);
  if (!WALL_CLOCK_TIME.test(candidate)) throw new DataError(path, 'a time (HH:mm)', value);
  return candidate;
}

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

export function asColour(value: unknown, path: string): string {
  const candidate = asString(value, path);
  if (!HEX_COLOUR.test(candidate)) throw new DataError(path, 'a hex colour (#rrggbb)', value);
  return candidate;
}

/** Only http(s) URLs reach the rendered markup. */
export function asHttpUrl(value: unknown, path: string): string {
  const candidate = asString(value, path);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new DataError(path, 'an absolute URL', value);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new DataError(path, 'an http(s) URL', value);
  }
  return parsed.toString();
}
