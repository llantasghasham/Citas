import { cookies } from 'next/headers';
import { cache } from 'react';

import type { Role } from '@/generated/prisma/enums';
import type { Locale } from '@/lib/types';
import { getPrisma } from '@/lib/db/client';
import { tenantScope, type TenantScope } from '@/lib/db/tenant';

import { hashSecret, newSessionToken } from './tokens';
import type { Capability } from './permissions';
import { capabilitiesOf } from './role-config';

const COOKIE_NAME = 'citas_session';
const SESSION_DAYS = 30;
/** How stale `lastSeenAt` may get before it is worth another write. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  email: string;
  isSuperadmin: boolean;
  tenantId: string | null;
  role: Role | null;
  /** The language this person reads the panel in. Theirs, not the office's. */
  locale: Locale;
  /** El país que maneja. Decide prefijo telefónico y zona horaria por defecto. */
  country: string | null;
  avatarUrl: string | null;
  /**
   * Lo que esta persona puede hacer, YA resuelto.
   *
   * Se resuelve al abrir la sesión y no en cada comprobación, a propósito. El
   * reparto de permisos por rol es configurable, así que averiguarlo es una
   * consulta; si `sessionCan` fuera asíncrona, un `await` olvidado devolvería
   * una promesa —que es verdadera— y la comprobación pasaría SIEMPRE. Un
   * permiso que falla abierto por un descuido de sintaxis no es un permiso.
   */
  capabilities: readonly Capability[];
}

export interface SessionMetadata {
  userAgent?: string;
  ip?: string;
}

function expiryFromNow(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Creates the session row and returns the raw token — the only moment it exists
 * in the clear. The web sets it as a cookie; the mobile app keeps it and sends
 * it as a bearer token. Same sessions, same expiry, one table.
 */
export async function issueSession(
  userId: string,
  tenantId: string | null,
  metadata: SessionMetadata = {},
): Promise<string> {
  const token = newSessionToken();

  await getPrisma().session.create({
    data: {
      userId,
      tenantId,
      tokenHash: hashSecret(token),
      expiresAt: expiryFromNow(),
      userAgent: metadata.userAgent ?? null,
      ip: metadata.ip ?? null,
    },
  });

  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiryFromNow(),
  });
}

/** Browser flow: issue the session and put it in the cookie. */
export async function createSession(
  userId: string,
  tenantId: string | null,
  metadata: SessionMetadata = {},
): Promise<string> {
  const token = await issueSession(userId, tenantId, metadata);
  await setSessionCookie(token);
  return token;
}

/**
 * The signed-in user, or null. Never throws: callers decide what to do.
 * Memoised per request, so a layout and its page share one lookup.
 */
/** Resolves a raw token to a session, wherever it arrived from. */
export async function resolveSession(token: string): Promise<AuthenticatedSession | null> {
  if (token.length === 0) return null;

  const prisma = getPrisma();
  const row = await prisma.session.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { user: { include: { memberships: true } } },
  });

  if (row === null) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session
      .update({ where: { id: row.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  const membership =
    row.tenantId === null
      ? undefined
      : row.user.memberships.find((entry) => entry.tenantId === row.tenantId);

  const role: Role | null = row.user.isSuperadmin
    ? 'SUPERADMIN'
    : (membership?.role ?? null);

  return {
    sessionId: row.id,
    userId: row.userId,
    email: row.user.email,
    isSuperadmin: row.user.isSuperadmin,
    tenantId: row.tenantId,
    role,
    locale: row.user.locale,
    country: row.user.country,
    avatarUrl: row.user.avatarUrl,
    capabilities: role === null ? [] : await capabilitiesOf(role),
  };
}

/**
 * The signed-in user for a browser request, or null. Memoised per request, so a
 * layout and its page share one lookup.
 */
export const getSession = cache(async (): Promise<AuthenticatedSession | null> => {
  const store = await cookies();
  return resolveSession(store.get(COOKIE_NAME)?.value ?? '');
});

/** The signed-in user for an API request carrying `Authorization: Bearer …`. */
export async function getBearerSession(
  requestHeaders: Headers,
): Promise<AuthenticatedSession | null> {
  const header = requestHeaders.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined) return null;
  return resolveSession(token);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;

  if (token !== undefined && token.length > 0) {
    await getPrisma()
      .session.deleteMany({ where: { tokenHash: hashSecret(token) } })
      .catch(() => undefined);
  }
  store.delete(COOKIE_NAME);
}

export function sessionCan(
  session: AuthenticatedSession | null,
  capability: Capability,
): boolean {
  if (session === null || session.role === null) return false;
  // Se mira la lista que ya trae la sesión: sigue siendo síncrona, así que
  // ningún sitio puede olvidarse un `await` y quedarse con una promesa
  // verdadera en un `if`.
  return session.capabilities.includes(capability);
}

/**
 * The tenant scope for this session. Every business query needs one, and a
 * session without a tenant cannot produce it.
 */
export function scopeOf(session: AuthenticatedSession): TenantScope {
  if (session.tenantId === null) {
    throw new Error('This session is not working inside a tenant.');
  }
  return tenantScope(session.tenantId);
}
