import { authorize, isResponse } from '@/lib/api/mobile';
import { scopeOf, sessionCan } from '@/lib/auth/session';
import { listEvents } from '@/lib/repositories/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → the office's events with their reply counts. */
export async function GET(request: Request): Promise<Response> {
  const authorized = await authorize(request);
  if (isResponse(authorized)) return authorized;

  const { session } = authorized;
  if (!sessionCan(session, 'event:read') || session.tenantId === null) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  return Response.json({ events: await listEvents(scopeOf(session)) });
}
