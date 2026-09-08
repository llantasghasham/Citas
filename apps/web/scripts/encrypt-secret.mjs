#!/usr/bin/env node
/**
 * Encrypts a secret so it can live in `.env` without being readable there.
 *
 *   npm run secret:encrypt --workspace @citas/web
 *
 * The value is read from standard input on purpose: passing it as an argument
 * would put the password in the process list and in the shell history.
 */
import { createInterface } from 'node:readline';

import { encryptSecret } from '../src/lib/secrets.ts';

const rl = createInterface({ input: process.stdin, terminal: false });
const lines = [];
for await (const line of rl) lines.push(line);

const value = lines.join('\n').trim();
if (value.length === 0) {
  console.error('Nothing on standard input. Try: printf %s "the-password" | npm run secret:encrypt');
  process.exit(1);
}

console.log(encryptSecret(value));
