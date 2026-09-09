import { accessSync, constants, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { CODE_SEND_FAILED_ACTION } from '@/lib/auth/otp';
import { getPrisma } from '@/lib/db/client';
import { unverifiedVerses } from '@/lib/verses';
import { gatewayHealth } from '@/lib/whatsapp/gateway';
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
    siteUrlCheck(),
    await codeDeliveryCheck(),
    await migrationsCheck(),
    await whatsappCheck(),
    versesCheck(),
  ];
}

/**
 * El servicio de WhatsApp, que es un proceso APARTE.
 *
 * Se despliega y se arranca por su cuenta, así que puede estar caído con la web
 * entera funcionando. Sin esto, la oficina lo descubriría al ver que la cola no
 * baja, y no sabría por qué.
 *
 * `warn` y no `fail` cuando no está: es opcional. Sin él se sigue enviando a
 * mano con `wa.me`, como antes de que existiera.
 */
async function whatsappCheck(): Promise<HealthCheck> {
  if (env('WHATSAPP_GATEWAY_TOKEN') === undefined) {
    return { key: 'whatsapp', level: 'warn', detail: 'WHATSAPP_GATEWAY_TOKEN' };
  }
  const { up, detail } = await gatewayHealth();
  return { key: 'whatsapp', level: up ? 'ok' : 'warn', detail };
}

/**
 * Que la base de datos del servidor tenga lo que este código da por hecho.
 *
 * Desplegar copia el código; aplicar las migraciones es otro paso, y si se
 * queda sin dar, lo que falla no es el arranque sino una pantalla suelta, días
 * después, con un error que no dice por qué. Esto lo dice antes.
 *
 * Se compara la carpeta de migraciones del repositorio con las que la base
 * declara aplicadas: es la misma pregunta que responde `prisma migrate status`,
 * hecha sin salir de la pantalla.
 */
async function migrationsCheck(): Promise<HealthCheck> {
  if (env('DATA_SOURCE') !== 'database') {
    return { key: 'migrations', level: 'warn', detail: 'DATA_SOURCE ≠ database' };
  }

  let onDisk: string[];
  try {
    onDisk = readdirSync(migrationsDirectory(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return { key: 'migrations', level: 'warn', detail: 'prisma/migrations' };
  }

  try {
    const rows = await getPrisma().$queryRawUnsafe<{ migration_name: string }[]>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
    );
    const applied = new Set(rows.map((row) => row.migration_name));
    const missing = onDisk.filter((name) => !applied.has(name));

    if (missing.length === 0) {
      return { key: 'migrations', level: 'ok', detail: `${onDisk.length}` };
    }
    // Se nombra la primera que falta: es lo que hay que buscar para entenderlo.
    return {
      key: 'migrations',
      level: 'fail',
      detail: `${missing.length} · ${missing[0] ?? ''} · npm run db:deploy`,
    };
  } catch {
    return { key: 'migrations', level: 'fail', detail: '_prisma_migrations' };
  }
}

/** La carpeta de migraciones, que en el servidor cuelga del paquete web. */
function migrationsDirectory(): string {
  for (const base of ['.', '..', '../..']) {
    const candidate = join(process.cwd(), base, 'prisma/migrations');
    try {
      accessSync(candidate, constants.R_OK);
      return candidate;
    } catch {
      // La siguiente.
    }
  }
  return join(process.cwd(), 'prisma/migrations');
}

/**
 * Sacred texts still carrying `verifiedBy: null`.
 *
 * The project's rule is that an entry is added only after a person checks it
 * against the cited edition and records their name. Until that happens the
 * platform is printing Qur'anic and biblical text on real wedding invitations
 * on nobody's authority, and no deploy fixes a verse that went out wrong.
 *
 * It is a person's job, not the code's — so the code's job is to keep saying so.
 */
function versesCheck(): HealthCheck {
  const pending = unverifiedVerses();
  if (pending.length === 0) return { key: 'verses', level: 'ok', detail: '0' };

  return {
    key: 'verses',
    level: 'fail',
    detail: `${pending.length} · ${pending.map((verse) => verse.id).join(' · ')}`.slice(0, 200),
  };
}

/**
 * Sign-in codes the mail server would not take, in the last day.
 *
 * These failures are swallowed on purpose — letting one escape would tell a
 * stranger which addresses have an account — so without this they are silent:
 * the person waiting for the code just sees nothing arrive, and nobody else
 * ever learns it happened. The reason is carried through verbatim, which is
 * usually the whole diagnosis.
 */
async function codeDeliveryCheck(): Promise<HealthCheck> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const failures = await getPrisma().auditLog.findMany({
      where: { action: CODE_SEND_FAILED_ACTION, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
      take: 50,
    });
    if (failures.length === 0) return { key: 'codeDelivery', level: 'ok', detail: '0' };

    const last = failures[0]?.metadata;
    const problem =
      typeof last === 'object' && last !== null && 'problem' in last
        ? String((last as { problem?: unknown }).problem ?? '')
        : '';
    return {
      key: 'codeDelivery',
      level: 'fail',
      detail: `${failures.length} · ${problem}`.slice(0, 160),
    };
  } catch {
    return { key: 'codeDelivery', level: 'warn', detail: '—' };
  }
}

/**
 * The address every share preview is built against.
 *
 * Without it Next resolves the Open Graph image relative to localhost, so a
 * link pasted into a WhatsApp group shows a grey rectangle — and nothing
 * anywhere says why, because the page itself is perfectly fine.
 */
function siteUrlCheck(): HealthCheck {
  const url = env('NEXT_PUBLIC_SITE_URL');
  if (url === undefined) {
    return { key: 'siteUrl', level: inProduction() ? 'fail' : 'warn', detail: 'NEXT_PUBLIC_SITE_URL' };
  }
  if (!url.startsWith('https://') && inProduction()) {
    return { key: 'siteUrl', level: 'warn', detail: url };
  }
  return { key: 'siteUrl', level: 'ok', detail: url };
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

/**
 * La pasarela, variable por variable.
 *
 * Nombrar la que falta es todo el valor: no hay pantalla donde configurar
 * Whish —y no la va a haber, ver más abajo—, así que esta fila es el único
 * sitio donde alguien se entera de que el cobro no puede funcionar.
 */
function paymentsCheck(): HealthCheck {
  const provider = env('PAYMENTS_PROVIDER') ?? 'mock';
  if (provider === 'mock') {
    return { key: 'payments', level: inProduction() ? 'fail' : 'warn', detail: provider };
  }
  if (provider !== 'whish') return { key: 'payments', level: 'fail', detail: provider };

  const falta = [
    env('WHISH_BASE_URL') ? null : 'WHISH_BASE_URL',
    env('WHISH_CHANNEL') ? null : 'WHISH_CHANNEL',
    env('WHISH_WEBSITE_URL') ? null : 'WHISH_WEBSITE_URL',
  ].filter((name): name is string => name !== null);

  const cifrado = env('WHISH_SECRET_ENC');
  if (cifrado === undefined) {
    falta.push(env('WHISH_SECRET') === undefined ? 'WHISH_SECRET_ENC' : 'WHISH_SECRET_ENC (hay uno en claro)');
  } else if (!cifrado.startsWith('v1.')) {
    // Parece configurado y solo falla al cobrar: el mismo error que ya ocurrió
    // con la contraseña del correo.
    falta.push('WHISH_SECRET_ENC · npm run secret:encrypt');
  }

  if (falta.length > 0) return { key: 'payments', level: 'fail', detail: falta.join(' · ') };
  return { key: 'payments', level: 'ok', detail: `whish · ${env('WHISH_BASE_URL') ?? ''}` };
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
