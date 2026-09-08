import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';
import { clientIp } from '@/lib/admin/context';
import { buildCsv } from '@/lib/export/csv';
import { listGuests } from '@/lib/repositories/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

/**
 * GET /api/events/[eventId]/guests → the guest list as a spreadsheet.
 *
 * Authorisation is checked here and not merely by hiding the link: this URL is
 * reachable by anyone who can guess it.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await getSession();
  if (session === null) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  if (!sessionCan(session, 'event:read')) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const { eventId } = await context.params;
  const guests = await listGuests(scopeOf(session), eventId);
  // Not found and not yours are the same answer: otherwise this endpoint tells
  // one office which event ids exist in another.
  if (guests === null) return Response.json({ error: 'event_not_found' }, { status: 404 });

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'guests.export',
    entity: 'Event',
    entityId: eventId,
    metadata: { rows: guests.length },
    ip: clientIp(request.headers),
  });

  const csv = buildCsv(
    ['name', 'locale', 'status', 'party', 'message', 'responded_at', 'self_added'],
    guests.map((guest) => [
      guest.name,
      guest.locale,
      guest.status,
      guest.party,
      guest.message,
      guest.respondedAt === null ? null : guest.respondedAt.toISOString(),
      guest.selfAdded ? 'yes' : 'no',
    ]),
  );

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="guests-${eventId}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
