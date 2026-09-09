#!/usr/bin/env node
/**
 * Guards two of the project's non-negotiable rules. Run with `npm run lint:rtl`.
 *
 * 1. No physical, direction-bound CSS. Symmetric shorthands (px-, mx-, inset-)
 *    are allowed — they behave the same in both directions.
 * 2. No letter-spacing or upper-casing on text that can be Arabic. Both are
 *    Latin typographic devices: `tracking-` prises apart the cursive joins that
 *    make Arabic legible, and `uppercase` means nothing in a script with no
 *    case. They must go through `latinOnly(locale, …)`, which drops them for
 *    Arabic and keeps them everywhere else.
 *
 *    Text that is Latin whatever the reader's language — a brand name, a field
 *    that only ever holds digits — is exempt with a `latin-only-ok` comment on
 *    the same line, which has to say why.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOTS = ['src'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.css']);

const RULES = [
  [/\b(?:margin|padding)-(?:left|right)\s*:/g, 'use margin-inline-start/end or padding-inline-start/end'],
  [/\btext-align\s*:\s*(?:left|right)\b/g, 'use text-align: start/end'],
  [/(?<![-\w])(?:left|right)\s*:\s*(?!0\b)/g, 'use inset-inline-start/end'],
  [/\bfloat\s*:\s*(?:left|right)\b/g, 'use flexbox or grid instead of float'],
  [/(?<![-\w])(?:ml|mr|pl|pr)-\[?[\w.[\]%/-]+/g, 'use ms-/me-/ps-/pe- (logical Tailwind utilities)'],
  [/(?<![-\w])text-(?:left|right)(?![-\w])/g, 'use text-start / text-end'],
  [/(?<![-\w])(?:border|rounded)-(?:l|r)(?:-|\b)/g, 'use the -s / -e logical variants'],
  [/(?<![-\w])float-(?:left|right)(?![-\w])/g, 'use flexbox or grid instead of float'],
];

/** Latin-only typography, which must be wrapped in `latinOnly(locale, …)`. */
const LATIN_ONLY_RULES = [
  [/(?<![-\w])uppercase(?![-\w])/g, 'wrap in latinOnly(locale, …): Arabic has no case'],
  [
    /(?<![-\w])tracking-\[?[\w.[\]%/-]+/g,
    'wrap in latinOnly(locale, …): letter-spacing breaks Arabic cursive joins',
  ],
];

/** True when the match sits inside a `latinOnly(` call on the same line. */
function insideLatinOnly(line, index) {
  const before = line.slice(0, index);
  const open = before.lastIndexOf('latinOnly(');
  if (open === -1) return false;
  // Balanced enough for one line of JSX: still open when the match happens.
  const after = before.slice(open);
  return (after.split('(').length - after.split(')').length) > 0;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTENSIONS.has(extname(full))) yield full;
  }
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const [pattern, hint] of RULES) {
        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern)) {
          violations.push(`${relative(process.cwd(), file)}:${index + 1}  "${match[0].trim()}" — ${hint}`);
        }
      }

      // The marker is accepted on the line itself or in the three above it: a
      // JSX opening tag takes no comment between its attributes, so the note
      // has to sit before the element and the class can be a few lines down.
      const exempt = lines
        .slice(Math.max(0, index - 3), index + 1)
        .some((candidate) => candidate.includes('latin-only-ok'));
      if (extname(file) !== '.css' && !exempt) {
        for (const [pattern, hint] of LATIN_ONLY_RULES) {
          pattern.lastIndex = 0;
          for (const match of line.matchAll(pattern)) {
            if (insideLatinOnly(line, match.index ?? 0)) continue;
            violations.push(
              `${relative(process.cwd(), file)}:${index + 1}  "${match[0].trim()}" — ${hint}`,
            );
          }
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error(`RTL violations (${violations.length}):\n${violations.map((v) => `  ${v}`).join('\n')}`);
  process.exit(1);
}
console.log('lint:rtl — logical CSS only, and no Latin typography on Arabic.');
