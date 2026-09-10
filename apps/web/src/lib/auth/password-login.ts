import { getPrisma } from '@/lib/db/client';

import { passwordMatches } from './password';
import { issueSession, type SessionMetadata } from './session';
import type { VerifyOutcome } from './otp';
import { looksLikeEmail, normalizeEmail } from './otp';

/** Failed tries one address gets before the door closes for a while. */
const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

export const PASSWORD_FAIL_ACTION = 'auth.password.fail';

/**
 * The way in when the mail is not moving.
 *
 * The platform's own account cannot depend on a mail server it does not own:
 * an SMTP outage would lock the owner out of the machine that is supposed to
 * fix it. A password is only ever accepted for an account that has one, and
 * only the platform's account and an office's administrator may be given one —
 * the end client signs in with a code, which is the product's rule and stays
 * the rule.
 *
 * Everything else matches the code path exactly: the same generic failure so
 * nobody can map which addresses exist, the same office check, and the same
 * session.
 */
export async function signInWithPassword(
  rawEmail: string,
  password: string,
  hostTenantId: string | null,
  metadata: SessionMetadata = {},
): Promise<VerifyOutcome> {
  const email = normalizeEmail(rawEmail);
  const failure: VerifyOutcome = { ok: false, userId: null, tenantId: null, token: null };

  if (!looksLikeEmail(email) || password.length === 0) return failure;

  const prisma = getPrisma();

  // Counted per address, not per account, so the limit applies before we know
  // whether the account exists — otherwise the rate limit itself would answer
  // that question.
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const failures = await prisma.auditLog.count({
    where: { action: PASSWORD_FAIL_ACTION, entityId: email, createdAt: { gte: since } },
  });
  if (failures >= MAX_FAILURES) return failure;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: true },
    // Sin los bytes de la foto: aquí solo se comprueba una contraseña.
    omit: { avatarData: true },
  });
  if (user === null || user.passwordHash === null) return failure;
  if (!(await passwordMatches(password, user.passwordHash))) return failure;

  let tenantId: string | null = null;
  if (hostTenantId !== null) {
    // Arriving at another office's subdomain with a valid password of your own
    // is not a way in, exactly as with a code.
    const belongs = user.memberships.some((entry) => entry.tenantId === hostTenantId);
    if (!belongs && !user.isSuperadmin) return failure;
    tenantId = hostTenantId;
  } else {
    tenantId = user.memberships[0]?.tenantId ?? null;
  }

  const token = await issueSession(user.id, tenantId, metadata);

  return { ok: true, userId: user.id, tenantId, token };
}
