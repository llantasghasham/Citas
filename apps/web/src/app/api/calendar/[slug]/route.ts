import { buildIcs, wallClockToUtc } from '@/lib/calendar/ics';
import { isCalendarDate, isClockTime } from '@/lib/time/zoned';
import { getDictionary } from '@/lib/dictionary';
import { getInvitationRepository } from '@/lib/repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/** GET /api/calendar/[slug] → the event as a calendar file the guest can open. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { slug } = await context.params;
  const invitation = await getInvitationRepository().findBySlug(slug);
  if (invitation === undefined) {
    return Response.json({ error: 'invitation_not_found', slug }, { status: 404 });
  }

  // Una fila vieja puede traer una fecha que no existe —se publicaban antes de
  // que esto se comprobara— y `wallClockToUtc` la correría en silencio: el
  // calendario del invitado guardaría un día distinto al de la invitación.
  // Mejor un error que una cita el día equivocado.
  if (!isCalendarDate(invitation.date) || !isClockTime(invitation.time)) {
    return Response.json({ error: 'invalid_event_date', slug }, { status: 422 });
  }

  const dictionary = getDictionary(invitation.locale);
  const honorees = invitation.honorees.map((honoree) => honoree.name).join(' · ');
  const invitationUrl = new URL(`/i/${invitation.slug}`, request.url).toString();

  const ics = buildIcs({
    uid: `${invitation.id}@citas`,
    start: wallClockToUtc(invitation.date, invitation.time, invitation.timeZone),
    summary: `${dictionary.eventTypes[invitation.eventType]} — ${honorees}`,
    description: `${invitation.message}\n\n${invitationUrl}`,
    location: `${invitation.venue.name}, ${invitation.venue.address}`,
    url: invitationUrl,
  });

  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${invitation.slug}.ics"`,
      'cache-control': 'public, max-age=0, s-maxage=3600',
    },
  });
}
