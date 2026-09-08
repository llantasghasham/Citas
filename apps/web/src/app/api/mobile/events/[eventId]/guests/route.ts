import { authorize, isResponse } from '@/lib/api/mobile';
import { scopeOf, sessionCan } from '@/lib/auth/session';
import { listGuests } from '@/lib/repositories/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

/** GET → the guest list for one event of this office. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const authorized = await authorize(request);
  if (isResponse(authorized)) return authorized;

  const { session } = authorized;
  if (!sessionCan(session, 'event:read') || session.tenantId === null) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const { eventId } = await context.params;
  const guests = await listGuests(scopeOf(session), eventId);
  // Another office's event answers exactly like one that does not exist.
  if (guests === null) return Response.json({ error: 'event_not_found' }, { status: 404 });

  return Response.json({ guests });
}
