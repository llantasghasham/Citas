#!/usr/bin/env node
/**
 * Guards the project's non-negotiable RTL rule: no physical, direction-bound
 * CSS. Symmetric shorthands (px-, mx-, inset-) are allowed — they behave the
 * same in both directions. Run with `npm run lint:rtl`.
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
    });
  }
}

if (violations.length > 0) {
  console.error(`Physical CSS found (${violations.length}):\n${violations.map((v) => `  ${v}`).join('\n')}`);
  process.exit(1);
}
console.log('lint:rtl — no physical CSS found.');
