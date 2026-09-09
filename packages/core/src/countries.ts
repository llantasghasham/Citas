import type { Locale } from './types';

/**
 * Los países que este sistema sabe manejar.
 *
 * Lo que se guarda de cada uno es lo que CAMBIA el comportamiento, no su
 * nombre: el prefijo telefónico con el que se normaliza una lista de invitados,
 * la zona horaria con la que se guarda la hora de un evento, y la moneda con la
 * que se cobra. El nombre lo pone `Intl.DisplayNames`, que ya viene con el
 * runtime y habla los cuatro idiomas — escribir cuatro listas de doscientos
 * nombres a mano sería inventar cuatro listas que envejecen.
 *
 * La lista es larga a propósito, pero no es «todos los países del mundo»: son
 * los que tienen sentido para un negocio de invitaciones árabe-latino, con el
 * Líbano y Costa Rica primero porque son los dos mercados de verdad.
 */
export interface Country {
  /** ISO 3166-1 alfa-2. */
  code: string;
  /** Prefijo E.164, con el más. */
  dial: string;
  /** Zona IANA de la capital: el valor por defecto al crear un evento. */
  timezone: string;
  /** La moneda del país. Solo se cobra en las que hay pasarela. */
  currency: string;
}

export const COUNTRIES: readonly Country[] = [
  // Los dos mercados.
  { code: 'LB', dial: '+961', timezone: 'Asia/Beirut', currency: 'LBP' },
  { code: 'CR', dial: '+506', timezone: 'America/Costa_Rica', currency: 'CRC' },

  // El resto del Levante y el Golfo, donde vive la diáspora libanesa.
  { code: 'AE', dial: '+971', timezone: 'Asia/Dubai', currency: 'AED' },
  { code: 'SA', dial: '+966', timezone: 'Asia/Riyadh', currency: 'SAR' },
  { code: 'QA', dial: '+974', timezone: 'Asia/Qatar', currency: 'QAR' },
  { code: 'KW', dial: '+965', timezone: 'Asia/Kuwait', currency: 'KWD' },
  { code: 'BH', dial: '+973', timezone: 'Asia/Bahrain', currency: 'BHD' },
  { code: 'OM', dial: '+968', timezone: 'Asia/Muscat', currency: 'OMR' },
  { code: 'JO', dial: '+962', timezone: 'Asia/Amman', currency: 'JOD' },
  { code: 'SY', dial: '+963', timezone: 'Asia/Damascus', currency: 'SYP' },
  { code: 'IQ', dial: '+964', timezone: 'Asia/Baghdad', currency: 'IQD' },
  { code: 'EG', dial: '+20', timezone: 'Africa/Cairo', currency: 'EGP' },
  { code: 'MA', dial: '+212', timezone: 'Africa/Casablanca', currency: 'MAD' },
  { code: 'TN', dial: '+216', timezone: 'Africa/Tunis', currency: 'TND' },
  { code: 'DZ', dial: '+213', timezone: 'Africa/Algiers', currency: 'DZD' },
  { code: 'TR', dial: '+90', timezone: 'Europe/Istanbul', currency: 'TRY' },

  // América Latina.
  { code: 'MX', dial: '+52', timezone: 'America/Mexico_City', currency: 'MXN' },
  { code: 'GT', dial: '+502', timezone: 'America/Guatemala', currency: 'GTQ' },
  { code: 'SV', dial: '+503', timezone: 'America/El_Salvador', currency: 'USD' },
  { code: 'HN', dial: '+504', timezone: 'America/Tegucigalpa', currency: 'HNL' },
  { code: 'NI', dial: '+505', timezone: 'America/Managua', currency: 'NIO' },
  { code: 'PA', dial: '+507', timezone: 'America/Panama', currency: 'PAB' },
  { code: 'CO', dial: '+57', timezone: 'America/Bogota', currency: 'COP' },
  { code: 'VE', dial: '+58', timezone: 'America/Caracas', currency: 'VES' },
  { code: 'EC', dial: '+593', timezone: 'America/Guayaquil', currency: 'USD' },
  { code: 'PE', dial: '+51', timezone: 'America/Lima', currency: 'PEN' },
  { code: 'BO', dial: '+591', timezone: 'America/La_Paz', currency: 'BOB' },
  { code: 'CL', dial: '+56', timezone: 'America/Santiago', currency: 'CLP' },
  { code: 'AR', dial: '+54', timezone: 'America/Argentina/Buenos_Aires', currency: 'ARS' },
  { code: 'UY', dial: '+598', timezone: 'America/Montevideo', currency: 'UYU' },
  { code: 'PY', dial: '+595', timezone: 'America/Asuncion', currency: 'PYG' },
  { code: 'BR', dial: '+55', timezone: 'America/Sao_Paulo', currency: 'BRL' },
  { code: 'DO', dial: '+1', timezone: 'America/Santo_Domingo', currency: 'DOP' },
  { code: 'CU', dial: '+53', timezone: 'America/Havana', currency: 'CUP' },

  // Europa y el norte, donde también hay diáspora.
  { code: 'ES', dial: '+34', timezone: 'Europe/Madrid', currency: 'EUR' },
  { code: 'PT', dial: '+351', timezone: 'Europe/Lisbon', currency: 'EUR' },
  { code: 'FR', dial: '+33', timezone: 'Europe/Paris', currency: 'EUR' },
  { code: 'IT', dial: '+39', timezone: 'Europe/Rome', currency: 'EUR' },
  { code: 'DE', dial: '+49', timezone: 'Europe/Berlin', currency: 'EUR' },
  { code: 'GB', dial: '+44', timezone: 'Europe/London', currency: 'GBP' },
  { code: 'US', dial: '+1', timezone: 'America/New_York', currency: 'USD' },
  { code: 'CA', dial: '+1', timezone: 'America/Toronto', currency: 'CAD' },
  { code: 'AU', dial: '+61', timezone: 'Australia/Sydney', currency: 'AUD' },
];

export function findCountry(code: string | null | undefined): Country | undefined {
  return COUNTRIES.find((country) => country.code === code);
}

/**
 * El nombre del país en el idioma que se esté leyendo.
 *
 * `Intl.DisplayNames` viene con el runtime y habla los cuatro. Si un runtime no
 * lo trajera, se devuelve el código: mejor «LB» que una pantalla que revienta.
 */
export function countryName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** La lista ya ordenada por su nombre en ese idioma, como se lee. */
export function countriesFor(locale: Locale): { code: string; name: string; dial: string }[] {
  const collator = new Intl.Collator(locale);

  return COUNTRIES.map((country) => ({
    code: country.code,
    name: countryName(country.code, locale),
    dial: country.dial,
  })).sort((a, b) => collator.compare(a.name, b.name));
}
