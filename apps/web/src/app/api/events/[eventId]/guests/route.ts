import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';
import { canonicalOrigin, clientIp } from '@/lib/admin/context';
import { buildCsv } from '@/lib/export/csv';
import { listGuestsWithLinks } from '@/lib/repositories/guests';

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
  const event = await listGuestsWithLinks(scopeOf(session), eventId);
  // Not found and not yours are the same answer: otherwise this endpoint tells
  // one office which event ids exist in another.
  if (event === null) return Response.json({ error: 'event_not_found' }, { status: 404 });
  const { guests } = event;
  const origin = await canonicalOrigin(request.headers);

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'guests.export',
    entity: 'Event',
    entityId: eventId,
    metadata: { rows: guests.length },
    ip: clientIp(request.headers),
  });

  // The personal link travels in the export on purpose: it is what lets an
  // office send the invitations with whatever tool it already uses.
  const csv = buildCsv(
    [
      'name',
      'phone',
      'locale',
      // The language they will really open, which is theirs only if somebody
      // wrote the invitation in it.
      'invitation_locale',
      'personal_link',
      'opened_at',
      'status',
      'party',
    ],
    guests.map((guest) => [
      guest.name,
      guest.phone,
      guest.locale,
      guest.version?.locale ?? null,
      `${origin}/g/${guest.token}`,
      guest.openedAt === null ? null : guest.openedAt.toISOString(),
      guest.status,
      guest.party,
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
