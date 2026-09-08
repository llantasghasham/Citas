'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { clientIp, requestHost } from '@/lib/admin/context';
import { recordAudit } from '@/lib/audit';
import { normalizeEmail, requestLoginCode, verifyLoginCode } from '@/lib/auth/otp';
import { destroySession, getSession } from '@/lib/auth/session';
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

  if (!outcome.ok || outcome.userId === null) {
    redirect(signInUrl(email, { sent: '1', error: '1' }));
  }

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
