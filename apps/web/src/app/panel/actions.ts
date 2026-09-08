'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requestHost } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { startPlanOrder, settleOrder } from '@/lib/billing/orders';
import { addMember, createOffice, normalizeSubdomain } from '@/lib/repositories/tenants';
import { LOCALES, type Locale } from '@/lib/types';
import type { PlanTier, Role } from '@/generated/prisma/enums';

const TIERS: PlanTier[] = ['free', 'single_event', 'annual', 'office'];
const ASSIGNABLE_ROLES: Role[] = ['TENANT_ADMIN', 'OPERATOR', 'ORGANIZER'];

function pick<T extends string>(value: FormDataEntryValue | null, allowed: T[], fallback: T): T {
  return allowed.find((candidate) => candidate === String(value)) ?? fallback;
}

/** Only a superadmin creates offices, and the check lives here, on the server. */
export async function createOfficeAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  const created = await createOffice({
    name: String(formData.get('name') ?? '').trim(),
    subdomain: normalizeSubdomain(String(formData.get('subdomain') ?? '')),
    defaultLocale: pick<Locale>(formData.get('defaultLocale'), [...LOCALES], 'ar'),
    tier: pick(formData.get('tier'), TIERS, 'free'),
  });

  redirect(created === null ? '/panel/oficinas?error=1' : '/panel/oficinas?created=1');
}

export async function addMemberAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'tenant:staff')) redirect('/panel');

  const added = await addMember(
    scopeOf(session),
    String(formData.get('email') ?? ''),
    pick(formData.get('role'), ASSIGNABLE_ROLES, 'OPERATOR'),
  );

  redirect(added ? '/panel/equipo?added=1' : '/panel/equipo?error=1');
}

export async function startPlanOrderAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'billing:manage')) redirect('/panel');

  const requestHeaders = await headers();
  const origin = `http://${requestHost(requestHeaders)}`;

  const { payUrl } = await startPlanOrder(
    scopeOf(session),
    pick(formData.get('tier'), TIERS, 'free'),
    session.userId,
    origin,
  );

  redirect(payUrl ?? '/panel/facturacion');
}

/**
 * Asks the provider whether the money actually arrived. This is the only thing
 * that marks an order paid — never the browser coming back from a redirect.
 */
export async function settleOrderAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'billing:manage')) redirect('/panel');

  const paid = await settleOrder(scopeOf(session), String(formData.get('orderId') ?? ''));
  redirect(`/panel/facturacion?settled=${paid ? 'paid' : 'pending'}`);
}
