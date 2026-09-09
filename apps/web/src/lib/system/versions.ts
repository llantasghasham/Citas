import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getPrisma } from '@/lib/db/client';
import type { StackKey } from '@/lib/types';

/**
 * Where node_modules can be, seen from the running server: this app, and the
 * workspace root above it where npm hoists everything shared. Read from disk
 * rather than resolved through `require`, because the server code is bundled
 * and a resolution rooted in the bundle finds nothing.
 */
const ROOTS = ['.', '..', '../..'].map((step) => join(process.cwd(), step, 'node_modules'));

export interface StackEntry {
  key: StackKey;
  /** The package or product as it is known outside this codebase. */
  name: string;
  version: string | null;
  /** True when the number comes from what is installed, not what is declared. */
  installed: boolean;
}

/** The version actually installed next to this app, or null when not found. */
function installedVersion(name: string): string | null {
  for (const root of ROOTS) {
    try {
      const pkg: unknown = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8'));
      const version = (pkg as { version?: unknown }).version;
      if (typeof version === 'string') return version;
    } catch {
      // Not under this root; try the next one.
    }
  }
  return null;
}

/**
 * The mobile app's packages live in its own workspace and cannot be resolved
 * from here, so they are read from what it declares. Marked as such rather than
 * passed off as an installed version.
 */
function declaredInMobile(name: string): string | null {
  try {
    const raw = readFileSync(join(process.cwd(), '..', 'mobile', 'package.json'), 'utf8');
    const pkg: unknown = JSON.parse(raw);
    const deps = (pkg as { dependencies?: Record<string, string> }).dependencies ?? {};
    return deps[name]?.replace(/^[\^~]/, '') ?? null;
  } catch {
    return null;
  }
}

/** PostgreSQL's own version string, shortened to the number. */
async function databaseVersion(): Promise<string | null> {
  try {
    const rows =
      await getPrisma().$queryRawUnsafe<{ version: string }[]>('SELECT version() AS version');
    const full = rows[0]?.version ?? '';
    return /PostgreSQL (\d+(?:\.\d+)?)/.exec(full)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * What this installation is running, read at request time.
 *
 * Nothing here is a hard-coded string: a status page that states a version
 * somebody typed into it once is a status page that lies the day after the
 * first update.
 */
export async function readStack(): Promise<StackEntry[]> {
  const resolved = (key: StackKey, name: string): StackEntry => ({
    key,
    name,
    version: installedVersion(name),
    installed: true,
  });

  return [
    { key: 'node', name: 'Node.js', version: process.version.replace(/^v/, ''), installed: true },
    resolved('next', 'next'),
    resolved('react', 'react'),
    resolved('typescript', 'typescript'),
    resolved('tailwind', 'tailwindcss'),
    resolved('prisma', '@prisma/client'),
    { key: 'database', name: 'PostgreSQL', version: await databaseVersion(), installed: true },
    resolved('puppeteer', 'puppeteer-core'),
    resolved('mailer', 'nodemailer'),
    { key: 'expo', name: 'Expo', version: declaredInMobile('expo'), installed: false },
    { key: 'reactNative', name: 'React Native', version: declaredInMobile('react-native'), installed: false },
  ];
}
