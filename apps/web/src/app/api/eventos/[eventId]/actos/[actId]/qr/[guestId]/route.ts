import { agendaFor } from '@/lib/acts/access';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { gateQrSvg } from '@/lib/checkin/codes';
import { gateCode } from '@/lib/checkin/service';
import { db } from '@/lib/db/client';
import { scopedWhere } from '@/lib/db/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ eventId: string; actId: string; guestId: string }>;
}

/**
 * GET /api/eventos/[eventId]/actos/[actId]/qr/[guestId] → el QR de UN invitado
 * para UN acto.
 *
 * Sale en SVG porque acaba en papel: un mapa de bits pequeño ampliado por una
 * impresora es un QR que el lector del móvil no coge a la primera.
 *
 * Los permisos se comprueban AQUÍ y no ocultando el enlace: esta dirección la
 * alcanza cualquiera que la adivine, y los tres ids vienen de la URL, o sea del
 * cliente. Se comprueban los tres: la sesión, que el invitado sea de ESTE
 * evento y de ESTA oficina, y que el acto esté en SU agenda.
 *
 * Lo último no es una formalidad: el código IDENTIFICA pero no autoriza, así
 * que un QR de alguien que no entra a ese acto sería un papel que la puerta va
 * a rechazar con una cola detrás. Mejor no darlo.
 *
 * «No existe» y «no es tuyo» responden lo mismo: lo contrario le diría a una
 * oficina qué ids hay en otra.
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await getSession();
  if (session === null) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  if (!sessionCan(session, 'event:read') || session.tenantId === null) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const { eventId, actId, guestId } = await context.params;
  const scope = scopeOf(session);

  const guest = await db(scope).guest.findFirst({
    where: { id: guestId, eventId, event: scopedWhere(scope) },
    select: { id: true, token: true, maxParty: true },
  });
  if (guest === null) return Response.json({ error: 'not_found' }, { status: 404 });

  // La regla de quién entra vive en `lib/acts/access.ts` y se le pregunta; no
  // se vuelve a escribir aquí. Un acto que no esté en su agenda —porque no es
  // de este evento, porque no está invitado o porque lo excluyeron después— se
  // responde como si no existiera.
  const agenda = await agendaFor(scope, eventId, { id: guest.id, maxParty: guest.maxParty });
  if (!agenda.some((act) => act.id === actId)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const svg = await gateQrSvg(gateCode(guest.token, actId));

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      // Es la entrada de una persona con nombre: ni se comparte ni se guarda
      // en el disco de un proxy por el camino.
      'cache-control': 'private, no-store',
    },
  });
}
