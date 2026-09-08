import { localizeNumerals, numberingSystemSubtag } from './numerals';
import type { Invitation, Locale, NumeralSystem } from './types';

/**
 * Regional tags. `ar-LB` matters: it yields the Levantine month names used in
 * Lebanon (تشرين الأول) rather than the Gulf ones (أكتوبر).
 */
const INTL_LOCALES: Record<Locale, string> = {
  ar: 'ar-LB',
  es: 'es-ES',
  pt: 'pt-PT',
  en: 'en-GB',
};

/**
 * Event dates and times are wall-clock values at the venue. They are pinned to
 * UTC so the web page and the server-rendered PNG always agree, whatever the
 * timezone of the machine doing the rendering.
 */
function toInstant(isoDate: string, time = '00:00'): Date {
  return new Date(`${isoDate}T${time}:00Z`);
}

function formatter(
  locale: Locale,
  system: NumeralSystem,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const tag = `${INTL_LOCALES[locale]}-u-nu-${numberingSystemSubtag(system)}`;
  return new Intl.DateTimeFormat(tag, { ...options, timeZone: 'UTC' });
}

function format(
  invitation: Invitation,
  options: Intl.DateTimeFormatOptions,
  instant: Date,
): string {
  const { locale, numeralSystem } = invitation;
  return localizeNumerals(formatter(locale, numeralSystem, options).format(instant), numeralSystem);
}

/** e.g. «السبت، ١٧ تشرين الأول ٢٠٢٦» / «Saturday, 9 January 2027». */
export function formatEventDate(invitation: Invitation): string {
  return format(
    invitation,
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
    toInstant(invitation.date),
  );
}

/** e.g. «٧:٣٠ م» / «19:30». */
export function formatEventTime(invitation: Invitation): string {
  return format(
    invitation,
    { hour: 'numeric', minute: '2-digit' },
    toInstant(invitation.date, invitation.time),
  );
}

/** Short form used inside the RSVP sentence. */
export function formatDeadline(invitation: Invitation, deadline: string): string {
  return format(
    invitation,
    { day: 'numeric', month: 'long', year: 'numeric' },
    toInstant(deadline),
  );
}

/** Machine-readable value for the `<time dateTime>` attribute. */
export function machineDateTime(invitation: Invitation): string {
  return `${invitation.date}T${invitation.time}`;
}
