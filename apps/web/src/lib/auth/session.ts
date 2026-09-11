import { cookies } from 'next/headers';
import { cache } from 'react';

import type { Role } from '@/generated/prisma/enums';
import type { Locale } from '@/lib/types';
import { getPrisma } from '@/lib/db/client';
import { tenantScope, type TenantScope } from '@/lib/db/tenant';
import { avatarSrc } from '@/lib/profile/avatar';

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
  /** Cómo se llama. Nulo mientras no lo haya escrito en su perfil. */
  name: string | null;
  isSuperadmin: boolean;
  tenantId: string | null;
  role: Role | null;
  /** The language this person reads the panel in. Theirs, not the office's. */
  locale: Locale;
  /** El país que maneja. Decide prefijo telefónico y zona horaria por defecto. */
  country: string | null;
  /** La dirección de su foto, ya resuelta: la subida si la hay, si no la de fuera. */
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
    // `omit` de la foto, y no es cosmético: esta consulta corre en CADA
    // petición del panel. Traerse los bytes de la imagen para acabar usando
    // solo su huella sería pagar la foto entera en cada carga de pantalla.
    include: {
      user: { include: { memberships: true }, omit: { avatarData: true } },
      // Para saber si la oficina sigue abierta. Es una columna, no una consulta
      // más: esto corre en cada petición del panel.
      tenant: { select: { status: true } },
    },
  });

  if (row === null) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }

  // Una oficina SUSPENDIDA no trabaja, y no basta con dejar de dejarla entrar:
  // una sesión abierta dura treinta días, así que suspender sin esto no
  // suspendía nada hasta que a esa persona se le ocurriera cerrar sesión. Se
  // comprueba aquí, en el único sitio por el que pasa todo —panel, acciones de
  // servidor, API móvil y trabajos automáticos—, en vez de en cada pantalla.
  //
  // El superadministrador se salva: es quien tiene que poder entrar a arreglar
  // lo que sea que llevó a suspenderla.
  if (row.tenant !== null && row.tenant.status === 'suspended' && !row.user.isSuperadmin) {
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
    name: row.user.name,
    isSuperadmin: row.user.isSuperadmin,
    tenantId: row.tenantId ?? (row.user.isSuperadmin ? await rootTenantId() : null),
    role,
    locale: row.user.locale,
    country: row.user.country,
    avatarUrl: avatarSrc(row.userId, row.user),
    capabilities: role === null ? [] : await capabilitiesOf(role),
  };
}

/**
 * La oficina de la plataforma, para un superadministrador que no pertenece a
 * ninguna.
 *
 * El alta lo crea SIN membresía —está por encima de las oficinas, no dentro de
 * una— y eso deja su sesión sin `tenantId`. El resultado no era un aviso: era
 * que media aplicación se comportaba como si no hubiera nada. La pantalla de
 * WhatsApp salía vacía y el botón de añadir devolvía al panel sin decir por
 * qué, que es exactamente el fallo que ya costó dos veces en este proyecto.
 *
 * Así que trabaja en la oficina raíz, que es la de la plataforma. Sigue siendo
 * la ÚNICA consulta de tenant sin tenant, y no devuelve datos de negocio de
 * nadie: devuelve cuál es la oficina propia.
 */
const rootTenantId = cache(async (): Promise<string | null> => {
  const root = await getPrisma().tenant.findFirst({
    where: { isRoot: true },
    select: { id: true },
  });
  return root?.id ?? null;
});

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
