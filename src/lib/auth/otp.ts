import { getPrisma } from '@/lib/db/client';
import { getMailer } from '@/lib/mail';

import { createSession, type SessionMetadata } from './session';
import { hashSecret, newLoginCode, secretMatches } from './tokens';

const CODE_TTL_MINUTES = 10;
/** Wrong guesses before the code dies. Six digits with five tries is 1 in 20 000. */
const MAX_ATTEMPTS = 5;
/** Codes one address may request inside the window, so nobody's inbox is a weapon. */
const MAX_CODES_PER_WINDOW = 3;
const WINDOW_MINUTES = 15;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function looksLikeEmail(email: string): boolean {
  return EMAIL_SHAPE.test(email) && email.length <= 254;
}

/**
 * Sends a one-time code — or quietly does nothing.
 *
 * The caller is told nothing either way: whether an address has access is not
 * something an unauthenticated stranger gets to find out.
 */
export async function requestLoginCode(rawEmail: string, ip?: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) return;

  const prisma = getPrisma();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  const recent = await prisma.loginCode.count({ where: { email, createdAt: { gte: since } } });
  if (recent >= MAX_CODES_PER_WINDOW) return;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user === null) return;

  const code = newLoginCode();
  await prisma.loginCode.create({
    data: {
      email,
      codeHash: hashSecret(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
      ip: ip ?? null,
    },
  });

  await getMailer().send({
    to: email,
    subject: `Citas — ${code}`,
    text: `Your one-time code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.\n\nIf you did not ask for it, ignore this message.`,
  });
}

export interface VerifyOutcome {
  ok: boolean;
  userId: string | null;
  tenantId: string | null;
}

/**
 * Checks the code and, if it holds up, opens a session.
 *
 * `hostTenantId` is the office the request was addressed to. When there is one,
 * the user must belong to it — arriving at another office's subdomain with a
 * valid code of your own is not a way in.
 */
export async function verifyLoginCode(
  rawEmail: string,
  rawCode: string,
  hostTenantId: string | null,
  metadata: SessionMetadata = {},
): Promise<VerifyOutcome> {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.trim();
  const failure: VerifyOutcome = { ok: false, userId: null, tenantId: null };

  if (!looksLikeEmail(email) || !/^\d{6}$/.test(code)) return failure;

  const prisma = getPrisma();
  const challenge = await prisma.loginCode.findFirst({
    where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (challenge === null) return failure;

  if (challenge.attempts >= MAX_ATTEMPTS) {
    await prisma.loginCode.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    return failure;
  }

  await prisma.loginCode.update({
    where: { id: challenge.id },
    data: { attempts: { increment: 1 } },
  });

  if (!secretMatches(code, challenge.codeHash)) return failure;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: true },
  });
  if (user === null) return failure;

  let tenantId: string | null = null;
  if (hostTenantId !== null) {
    const belongs = user.memberships.some((entry) => entry.tenantId === hostTenantId);
    if (!belongs && !user.isSuperadmin) return failure;
    tenantId = hostTenantId;
  } else {
    tenantId = user.memberships[0]?.tenantId ?? null;
  }

  // The code is spent the moment it works, so it cannot be replayed.
  await prisma.loginCode.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  await createSession(user.id, tenantId, metadata);

  return { ok: true, userId: user.id, tenantId };
}
