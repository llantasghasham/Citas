import { cookies } from 'next/headers';
import { cache } from 'react';

import type { Role } from '@/generated/prisma/enums';
import { getPrisma } from '@/lib/db/client';
import { tenantScope, type TenantScope } from '@/lib/db/tenant';

import { hashSecret, newSessionToken } from './tokens';
import { roleCan, type Capability } from './permissions';

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
}

export interface SessionMetadata {
  userAgent?: string;
  ip?: string;
}

function expiryFromNow(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

/** Creates the session and returns the raw token — the only time it exists. */
export async function createSession(
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

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiryFromNow(),
  });

  return token;
}

/**
 * The signed-in user, or null. Never throws: callers decide what to do.
 * Memoised per request, so a layout and its page share one lookup.
 */
export const getSession = cache(async (): Promise<AuthenticatedSession | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token === undefined || token.length === 0) return null;

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

  return {
    sessionId: row.id,
    userId: row.userId,
    email: row.user.email,
    isSuperadmin: row.user.isSuperadmin,
    tenantId: row.tenantId,
    role: row.user.isSuperadmin ? 'SUPERADMIN' : (membership?.role ?? null),
  };
});

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
  return roleCan(session.role, capability);
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
