import { scopeOf } from '@/lib/auth/session';
import { authorize, isResponse } from '@/lib/api/mobile';
import { limitsFor } from '@/lib/billing/plans';
import { getTenantById } from '@/lib/tenancy/current';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → who the app is signed in as, and what its office may do. */
export async function GET(request: Request): Promise<Response> {
  const authorized = await authorize(request);
  if (isResponse(authorized)) return authorized;

  const { session } = authorized;
  const tenant = session.tenantId === null ? null : await getTenantById(session.tenantId);
  const limits = session.tenantId === null ? null : await limitsFor(scopeOf(session));

  return Response.json({
    email: session.email,
    role: session.role,
    tenant: tenant === null ? null : { id: tenant.id, name: tenant.name, locale: tenant.defaultLocale },
    limits,
  });
}
