'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { clientIp, requestHost } from '@/lib/admin/context';
import { recordAudit } from '@/lib/audit';
import { normalizeEmail, requestLoginCode, verifyLoginCode } from '@/lib/auth/otp';
import { PASSWORD_FAIL_ACTION, signInWithPassword } from '@/lib/auth/password-login';
import { destroySession, getSession, setSessionCookie } from '@/lib/auth/session';
import { getTenantByHost } from '@/lib/tenancy/current';

function signInUrl(email: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ email, ...params });
  return `/entrar?${query.toString()}`;
}

export async function requestCodeAction(formData: FormData): Promise<void> {
  const email = normalizeEmail(String(formData.get('email') ?? ''));
  const requestHeaders = await headers();

  await requestLoginCode(email, clientIp(requestHeaders) ?? undefined);

  // The same answer either way: whether this address has access is not something
  // an unauthenticated visitor gets to learn.
  redirect(signInUrl(email, { sent: '1' }));
}

export async function verifyCodeAction(formData: FormData): Promise<void> {
  const email = normalizeEmail(String(formData.get('email') ?? ''));
  const code = String(formData.get('code') ?? '');

  const requestHeaders = await headers();
  const tenant = await getTenantByHost(requestHost(requestHeaders));
  const ip = clientIp(requestHeaders);

  const outcome = await verifyLoginCode(email, code, tenant?.id ?? null, {
    userAgent: requestHeaders.get('user-agent') ?? undefined,
    ip: ip ?? undefined,
  });

  if (!outcome.ok || outcome.userId === null || outcome.token === null) {
    redirect(signInUrl(email, { sent: '1', error: '1' }));
  }

  await setSessionCookie(outcome.token);

  await recordAudit({
    tenantId: outcome.tenantId,
    actorId: outcome.userId,
    action: 'auth.sign_in',
    entity: 'User',
    entityId: outcome.userId,
    ip,
  });

  redirect('/panel');
}

/**
 * The way in when the mail is not moving.
 *
 * Offered to everyone so that failing here reveals nothing, but only an account
 * that has been given a password can pass — and only the platform's account and
 * an office's administrator are ever given one.
 */
export async function signInWithPasswordAction(formData: FormData): Promise<void> {
  const email = normalizeEmail(String(formData.get('email') ?? ''));
  const password = String(formData.get('password') ?? '');

  const requestHeaders = await headers();
  const tenant = await getTenantByHost(requestHost(requestHeaders));
  const ip = clientIp(requestHeaders);

  const outcome = await signInWithPassword(email, password, tenant?.id ?? null, {
    userAgent: requestHeaders.get('user-agent') ?? undefined,
    ip: ip ?? undefined,
  });

  if (!outcome.ok || outcome.userId === null || outcome.token === null) {
    // Recorded against the address, not an account: this is also what the rate
    // limit counts, and it must count before we know whether the account is real.
    await recordAudit({
      action: PASSWORD_FAIL_ACTION,
      entity: 'User',
      entityId: email,
      ip,
    });
    redirect(signInUrl(email, { password: '1', error: '1' }));
  }

  await setSessionCookie(outcome.token);

  await recordAudit({
    tenantId: outcome.tenantId,
    actorId: outcome.userId,
    action: 'auth.sign_in.password',
    entity: 'User',
    entityId: outcome.userId,
    ip,
  });

  redirect('/panel');
}

export async function signOutAction(): Promise<void> {
  const session = await getSession();

  if (session !== null) {
    const requestHeaders = await headers();
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'auth.sign_out',
      entity: 'User',
      entityId: session.userId,
      ip: clientIp(requestHeaders),
    });
  }

  await destroySession();
  redirect('/entrar');
}
