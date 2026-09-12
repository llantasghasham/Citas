import { cookies, headers } from 'next/headers';

import { calendarFor, legacyCalendar, type CalendarSubject } from '@/lib/calendar/agenda';
import { canonicalOrigin } from '@/lib/admin/context';
import { db } from '@/lib/db/client';
import { scopeForSlug } from '@/lib/db/directory';
import { getDictionary } from '@/lib/dictionary';
import { getInvitationRepository } from '@/lib/repositories';
import { guestCookieName } from '@/lib/rsvp/cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/calendar/[slug] → la celebración entera como archivo de calendario.
 *
 * Devuelve un `VEVENT` por acto, y CUÁLES depende de quién pide:
 *
 *   - Sin nada: los actos públicos. Este enlace cuelga de una página que se
 *     reenvía a grupos enteros de WhatsApp.
 *   - Con la cookie del invitado —la que deja su enlace personal— o con
 *     `?g=<token>`: SU agenda, que puede incluir la henna a la que está
 *     invitado y no incluir la de otro.
 *   - Y si el evento todavía no tiene actos, el evento de siempre. Hay bodas
 *     repartidas desde antes de que existieran.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { slug } = await context.params;
  const invitation = await getInvitationRepository().findBySlug(slug);
  if (invitation === undefined) {
    return Response.json({ error: 'invitation_not_found', slug }, { status: 404 });
  }

  const dictionary = getDictionary(invitation.locale);
  // El enlace SALE de aquí: se queda meses en el calendario del móvil de un
  // invitado. Así que sale del origen CONFIGURADO y no de `request.url`, que
  // Next arma con la cabecera `Host` — la escribe quien llama. Es la misma regla
  // que el enlace de pago y el personal del invitado.
  //
  // Y si no hay dirección configurada, el archivo sale SIN enlace en vez de
  // fallar: `canonicalOrigin` lanza a propósito —un enlace mal escrito es peor
  // que ninguno— pero aquí «ninguno» es una cita de calendario con su hora y su
  // sitio, que sigue sirviendo. Caer a la cabecera sí estaría mal: sería meterle
  // a un invitado un enlace a un dominio ajeno dentro de su propia agenda.
  const invitationUrl = await canonicalOrigin(await headers())
    .then((origin) => `${origin}/i/${invitation.slug}`)
    .catch(() => '');
  const subject: CalendarSubject = {
    eventName: dictionary.eventTypes[invitation.eventType],
    honorees: invitation.honorees.map((honoree) => honoree.name).join(' · '),
    actTypeNames: dictionary.actTypes,
    message: invitation.message,
    url: invitationUrl,
    legacy: {
      uid: `${invitation.id}@citas`,
      date: invitation.date,
      time: invitation.time,
      timeZone: invitation.timeZone,
      location: `${invitation.venue.name}, ${invitation.venue.address}`,
    },
  };

  // El token del invitado: el que dejó su enlace personal en una cookie, o el
  // que trae la dirección. Es lo ÚNICO que se acepta de fuera — quién ve qué
  // acto lo decide el servidor a partir de él, nunca una lista de actos que
  // mande el navegador.
  const fromQuery = new URL(request.url).searchParams.get('g');
  const guestToken =
    fromQuery ?? (await cookies()).get(guestCookieName(slug))?.value ?? undefined;

  // Los actos viven en PostgreSQL. Sin base de datos detrás, lo que hay es el
  // evento del archivo JSON, que es como se comportaba esto hasta ahora.
  const scope =
    process.env['DATA_SOURCE'] === 'database' ? await scopeForSlug(slug) : null;
  const version =
    scope === null
      ? null
      : await db(scope).invitationVersion.findUnique({
          where: { slug },
          select: { eventId: true },
        });

  const result =
    scope === null || version === null
      ? legacyCalendar(subject)
      : await calendarFor(scope, version.eventId, subject, { guestToken });

  // Una fila vieja puede traer una fecha que no existe —se publicaban antes de
  // que esto se comprobara— y convertirla la correría en silencio: el calendario
  // del invitado guardaría un día distinto al de la invitación. Mejor un error
  // que una cita el día equivocado.
  if (!result.ok) {
    return Response.json({ error: 'invalid_event_date', slug }, { status: 422 });
  }

  // Lo personal NO se guarda en ninguna caché intermedia: la agenda de quien
  // trae token lleva los actos a los que ESA persona está invitada, y servírsela
  // al siguiente que pida el archivo enseñaría la henna de una familia a un
  // compañero de trabajo. Lo público sí se cachea, que es el caso de todos.
  const personal = guestToken !== undefined && guestToken.length > 0;

  return new Response(result.ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${invitation.slug}.ics"`,
      'cache-control': personal ? 'private, no-store' : 'public, max-age=0, s-maxage=3600',
      vary: 'Cookie',
    },
  });
}
