import { clientIp, requestHost } from '@/lib/admin/context';
import { readJson, str } from '@/lib/api/mobile';
import { recordAudit } from '@/lib/audit';
import { verifyLoginCode } from '@/lib/auth/otp';
import { getTenantByHost } from '@/lib/tenancy/current';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { email, code } → { token }.
 *
 * The token is the same session a browser would get; the app stores it instead
 * of a cookie. It is returned once and never again.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const tenant = await getTenantByHost(requestHost(request.headers));
  const ip = clientIp(request.headers);

  const outcome = await verifyLoginCode(str(body, 'email'), str(body, 'code'), tenant?.id ?? null, {
    userAgent: request.headers.get('user-agent') ?? undefined,
    ip: ip ?? undefined,
  });

  if (!outcome.ok || outcome.token === null || outcome.userId === null) {
    return Response.json({ error: 'invalid_code' }, { status: 401 });
  }

  await recordAudit({
    tenantId: outcome.tenantId,
    actorId: outcome.userId,
    action: 'auth.sign_in.mobile',
    entity: 'User',
    entityId: outcome.userId,
    ip,
  });

  return Response.json({ token: outcome.token });
}
