import { accessSync, constants } from 'node:fs';

import { getPrisma } from '@/lib/db/client';
import type { HealthKey } from '@/lib/types';

export type HealthLevel = 'ok' | 'warn' | 'fail';

export interface HealthCheck {
  key: HealthKey;
  level: HealthLevel;
  /** What is actually configured, shown as-is. Never a secret's value. */
  detail: string;
}

const inProduction = (): boolean => process.env.NODE_ENV === 'production';

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Everything this installation needs in order to work, checked one by one.
 *
 * The point is that the page says out loud what is missing: this office could
 * not sign in for days because outgoing mail was never configured, and nothing
 * anywhere said so.
 *
 * No secret's value is ever reported — only whether it is set.
 */
export async function readHealth(): Promise<HealthCheck[]> {
  return [
    await databaseCheck(),
    dataSourceCheck(),
    mailerCheck(),
    paymentsCheck(),
    renderStoreCheck(),
    secretKeyCheck(),
    chromiumCheck(),
    await superadminCheck(),
  ];
}

async function databaseCheck(): Promise<HealthCheck> {
  if (env('DATA_SOURCE') !== 'database') {
    return { key: 'database', level: 'warn', detail: 'DATA_SOURCE ≠ database' };
  }
  try {
    await getPrisma().$queryRawUnsafe('SELECT 1');
    return { key: 'database', level: 'ok', detail: 'PostgreSQL' };
  } catch {
    return { key: 'database', level: 'fail', detail: 'DATABASE_URL' };
  }
}

function dataSourceCheck(): HealthCheck {
  const source = env('DATA_SOURCE') ?? 'json';
  if (source === 'database') return { key: 'dataSource', level: 'ok', detail: source };
  // The JSON file is a demo fixture: nothing an office creates is saved.
  return { key: 'dataSource', level: inProduction() ? 'fail' : 'warn', detail: source };
}

function mailerCheck(): HealthCheck {
  if (env('MAILER') !== 'smtp') {
    // Without this, the one-time code never leaves the machine and nobody can
    // sign in at all. In production the console mailer also refuses to run.
    return { key: 'mailer', level: inProduction() ? 'fail' : 'warn', detail: 'console' };
  }
  const host = env('SMTP_HOST');
  if (host === undefined) return { key: 'mailer', level: 'fail', detail: 'SMTP_HOST' };
  if (env('SMTP_PASSWORD_ENC') === undefined) {
    const detail = env('SMTP_PASSWORD') === undefined ? 'SMTP_PASSWORD_ENC' : `${host} · SMTP_PASSWORD`;
    return { key: 'mailer', level: inProduction() ? 'fail' : 'warn', detail };
  }
  return { key: 'mailer', level: 'ok', detail: host };
}

function paymentsCheck(): HealthCheck {
  const provider = env('PAYMENTS_PROVIDER') ?? 'mock';
  if (provider === 'mock') {
    return { key: 'payments', level: inProduction() ? 'fail' : 'warn', detail: provider };
  }
  if (provider === 'whish' && env('WHISH_SECRET') === undefined) {
    return { key: 'payments', level: 'fail', detail: 'WHISH_SECRET' };
  }
  return { key: 'payments', level: 'ok', detail: provider };
}

function renderStoreCheck(): HealthCheck {
  const stored = env('DATA_SOURCE') === 'database';
  // Without a store every guest opening the link starts their own Chromium.
  return {
    key: 'renderStore',
    level: stored ? 'ok' : 'warn',
    detail: stored ? 'PostgreSQL' : '—',
  };
}

function secretKeyCheck(): HealthCheck {
  const file = env('CITAS_SECRET_KEY_FILE');
  if (file !== undefined) {
    try {
      accessSync(file, constants.R_OK);
      return { key: 'secretKey', level: 'ok', detail: 'CITAS_SECRET_KEY_FILE' };
    } catch {
      return { key: 'secretKey', level: 'fail', detail: 'CITAS_SECRET_KEY_FILE' };
    }
  }
  if (env('CITAS_SECRET_KEY') !== undefined) {
    // Readable in the process list and in any dump of the environment.
    return { key: 'secretKey', level: 'warn', detail: 'CITAS_SECRET_KEY' };
  }
  return { key: 'secretKey', level: inProduction() ? 'fail' : 'warn', detail: '—' };
}

function chromiumCheck(): HealthCheck {
  const path = env('CHROMIUM_PATH');
  if (path === undefined) return { key: 'chromium', level: 'fail', detail: 'CHROMIUM_PATH' };
  try {
    accessSync(path, constants.X_OK);
    return { key: 'chromium', level: 'ok', detail: path };
  } catch {
    return { key: 'chromium', level: 'fail', detail: path };
  }
}

async function superadminCheck(): Promise<HealthCheck> {
  const email = env('SUPERADMIN_EMAIL');
  if (email === undefined || email.startsWith('cambiame@')) {
    return { key: 'superadmin', level: 'fail', detail: 'SUPERADMIN_EMAIL' };
  }
  try {
    const user = await getPrisma().user.findUnique({
      where: { email: email.toLowerCase() },
      select: { isSuperadmin: true },
    });
    if (user === null) return { key: 'superadmin', level: 'fail', detail: `${email} · npm run db:seed` };
    if (!user.isSuperadmin) return { key: 'superadmin', level: 'fail', detail: email };
    return { key: 'superadmin', level: 'ok', detail: email };
  } catch {
    return { key: 'superadmin', level: 'warn', detail: email };
  }
}
