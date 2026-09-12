import { recordAudit } from '@/lib/audit';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { exportAct } from '@/lib/export/acts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ eventId: string; actId: string }>;
}

/**
 * GET /api/events/[eventId]/actos/[actId] → la lista de UN acto, en hoja de
 * cálculo.
 *
 * Es lo que se le manda al salón y al catering, y por eso es por acto: la cena
 * y la henna no tienen la misma gente ni el mismo día. Los permisos se
 * comprueban AQUÍ y no ocultando el enlace: esta dirección la alcanza cualquiera
 * que la adivine.
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await getSession();
  if (session === null) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  if (!sessionCan(session, 'event:read')) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const { eventId, actId } = await context.params;
  const sheet = await exportAct(scopeOf(session), eventId, actId);
  // «No existe» y «no es tuyo» se responden igual: lo contrario le diría a una
  // oficina qué ids de acto hay en otra.
  if (sheet === null) return Response.json({ error: 'act_not_found' }, { status: 404 });

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'act.export',
    entity: 'EventAct',
    entityId: actId,
    metadata: { eventId, rows: sheet.rows },
  });

  return new Response(sheet.csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${sheet.filename}"`,
    },
  });
}
