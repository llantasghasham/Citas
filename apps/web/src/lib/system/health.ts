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
    await extraSuperadminsCheck(),
  ];
}

/**
 * Any other account that can reach every office.
 *
 * The seed leaves a placeholder superadmin behind when SUPERADMIN_EMAIL is
 * changed afterwards, and a full-power account nobody is watching is a spare
 * key under the mat. One is expected; more want a reason.
 */
async function extraSuperadminsCheck(): Promise<HealthCheck> {
  const configured = (env('SUPERADMIN_EMAIL') ?? '').toLowerCase();
  try {
    const others = await getPrisma().user.findMany({
      where: { isSuperadmin: true, email: { not: configured } },
      select: { email: true },
      orderBy: { email: 'asc' },
      take: 5,
    });
    if (others.length === 0) return { key: 'extraSuperadmins', level: 'ok', detail: '0' };
    return {
      key: 'extraSuperadmins',
      level: 'warn',
      detail: others.map((user) => user.email).join(' · '),
    };
  } catch {
    return { key: 'extraSuperadmins', level: 'warn', detail: '—' };
  }
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

/**
 * Outgoing mail, variable by variable.
 *
 * Every branch here is a mistake somebody has actually made on this
 * installation. Naming the exact variable at fault is the whole point: the day
 * the codes stopped arriving, nothing anywhere said why, and finding it took
 * days.
 */
function mailerCheck(): HealthCheck {
  const fail = (detail: string): HealthCheck => ({ key: 'mailer', level: 'fail', detail });

  if (env('MAILER') !== 'smtp') {
    // Without this, the one-time code never leaves the machine and nobody can
    // sign in at all. In production the console mailer also refuses to run.
    return { key: 'mailer', level: inProduction() ? 'fail' : 'warn', detail: 'console' };
  }

  const host = env('SMTP_HOST');
  if (host === undefined) return fail('SMTP_HOST');
  if (env('SMTP_USER') === undefined) return fail('SMTP_USER');

  // Writing SMTP_FROM instead of MAIL_FROM has already broken one deployment.
  if (env('MAIL_FROM') === undefined) {
    return fail(env('SMTP_FROM') === undefined ? 'MAIL_FROM' : 'MAIL_FROM ← SMTP_FROM');
  }

  const encrypted = env('SMTP_PASSWORD_ENC');
  if (encrypted === undefined) {
    if (env('SMTP_PASSWORD') === undefined) return fail('SMTP_PASSWORD_ENC');
    return { key: 'mailer', level: inProduction() ? 'fail' : 'warn', detail: 'SMTP_PASSWORD' };
  }
  // The password pasted in the clear into the encrypted field: it looks set,
  // and it fails only at the moment somebody tries to sign in.
  if (!encrypted.startsWith('v1.')) return fail('SMTP_PASSWORD_ENC · npm run secret:encrypt');

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
