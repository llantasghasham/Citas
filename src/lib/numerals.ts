import type { NumeralSystem } from './types';

/** Eastern Arabic-Indic digits, indexed by their western value. */
const EASTERN_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

const EASTERN_TO_WESTERN = new Map<string, string>(
  EASTERN_DIGITS.map((digit, index) => [digit, String(index)]),
);

/**
 * Rewrites every digit in `input` into the requested numeral system, so a
 * string that already went through Intl (or arrived as raw data) always matches
 * the invitation's `numeralSystem` flag.
 */
export function localizeNumerals(input: string, system: NumeralSystem): string {
  if (system === 'arabic') {
    return input.replace(/[0-9]/g, (digit) => EASTERN_DIGITS[Number(digit)] ?? digit);
  }
  return input.replace(/[٠-٩]/g, (digit) => EASTERN_TO_WESTERN.get(digit) ?? digit);
}

/** BCP-47 numbering-system subtag for the given flag. */
export function numberingSystemSubtag(system: NumeralSystem): 'arab' | 'latn' {
  return system === 'arabic' ? 'arab' : 'latn';
}
