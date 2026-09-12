import Link from 'next/link';
import { redirect } from 'next/navigation';

import { runCampaignAction } from '@/app/panel/eventos/[eventId]/envios/actions';
import { getAdminContext } from '@/lib/admin/context';
import { readActs } from '@/lib/acts/service';
import { readSegments } from '@/lib/acts/segments';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { listConnections } from '@/lib/whatsapp/connections';
import { previewCampaign, type ExclusionReason } from '@/lib/whatsapp/campaigns';
import { displayFont } from '@/lib/typography';
import { interpolate, type Dictionary } from '@citas/core';

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{
    acto?: string;
    grupo?: string;
    numero?: string;
    tipo?: string;
    ver?: string;
    error?: string;
    enviados?: string;
    fuera?: string;
  }>;
}

const CONTROL =
  'h-10 border border-[#cdc6b6] bg-white px-3 text-sm text-[#23201a] outline-none focus-visible:border-[#8a6c22] focus-visible:ring-2 focus-visible:ring-[#c9a227]';
const BUTTON = 'h-10 border border-[#23201a] bg-white px-4 text-sm text-[#23201a] hover:opacity-70';
const LABEL = 'flex flex-col gap-1 text-sm text-[#6b6455]';

/**
 * Un envío: a un grupo, para un acto, con un texto.
 *
 * La pantalla está partida en dos a propósito. Elegir y VER a quién le llegaría
 * es un GET que no escribe nada; mandar es lo único que escribe. Pulsar «mandar»
 * sobre doscientas personas no se deshace, así que quien lo pulsa tiene que
 * haber visto antes a cuántos les llega, a cuántos no y por qué.
 *
 * Lo que se enseña sale de `previewCampaign`, la MISMA función que usa el envío
 * por dentro. Una vista previa que calculara por su cuenta se desviaría el día
 * que alguien tocara una regla.
 */
export default async function CampaignsPage({ params, searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:read') || session.tenantId === null) {
    redirect('/panel');
  }

  const { eventId } = await params;
  const query = await searchParams;
  const { dictionary } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.campaigns;
  const types = dictionary.actTypes;

  const [acts, segments, connections] = await Promise.all([
    readActs(scopeOf(session), eventId),
    readSegments(scopeOf(session), eventId),
    listConnections(scopeOf(session)),
  ]);
  if (acts === null || segments === null) redirect('/panel');

  const canSend = sessionCan(session, 'event:write');
  const connectionId = query.numero ?? connections[0]?.id ?? '';
  const kind = query.tipo === 'reminder' ? 'reminder' : 'invitation';

  // Solo se calcula cuando lo piden: mirar la pantalla no tiene por qué costar
  // una vuelta entera por los cuatrocientos invitados de la boda.
  const preview =
    query.ver === '1' && connectionId.length > 0
      ? await previewCampaign(scopeOf(session), {
          eventId,
          actId: query.acto ?? null,
          segmentId: query.grupo ?? null,
          kind,
          template: kind,
          version: '1',
          connectionId,
        })
      : null;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={`/panel/eventos/${eventId}`} className="text-sm text-[#8a6c22] hover:underline">
          {copy.back}
        </Link>
        <h1 className={`${displayFont} text-3xl text-[#23201a]`}>{copy.heading}</h1>
        <p className="max-w-2xl text-sm text-[#6b6455]">{copy.intro}</p>
      </header>

      {query.enviados !== undefined && (
        <p className="border border-[#2e7d32] bg-[#f1f8f2] p-3 text-sm text-[#2e7d32]">
          {interpolate(copy.results, {
            sent: query.enviados,
            failed: '0',
            excluded: query.fuera ?? '0',
          })}
        </p>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3 border border-[#ddd6c6] bg-white p-4">
        <input type="hidden" name="ver" value="1" />
        <label className={`${LABEL} min-w-56`}>
          {copy.actLabel}
          <select name="acto" defaultValue={query.acto ?? ''} className={CONTROL}>
            <option value="">{copy.wholeEvent}</option>
            {acts.map((act) => (
              <option key={act.id} value={act.id}>
                {act.label ?? types[act.type]} · {act.date}
              </option>
            ))}
          </select>
        </label>
        <label className={`${LABEL} min-w-56`}>
          {copy.segmentLabel}
          <select name="grupo" defaultValue={query.grupo ?? ''} className={CONTROL}>
            <option value="">{copy.everyone}</option>
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </select>
        </label>
        <label className={`${LABEL} min-w-56`}>
          {copy.connectionLabel}
          <select name="numero" defaultValue={connectionId} className={CONTROL}>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={BUTTON}>
          {copy.preview}
        </button>
      </form>

      {preview !== null && 'error' in preview && (
        <p className="border border-[#b3261e] bg-[#fdf2f1] p-3 text-sm text-[#b3261e]">
          {copy.empty}
        </p>
      )}

      {preview !== null && !('error' in preview) && (
        <section className="flex flex-col gap-3 border border-[#ddd6c6] bg-white p-4">
          <p className="text-sm text-[#2e7d32]">
            {interpolate(copy.willReach, { count: String(preview.included.length) })}
          </p>
          <p className="text-sm text-[#b3261e]">
            {interpolate(copy.excluded, { count: String(preview.excluded.length) })}
          </p>

          {/* El desglose de los que se quedan fuera es lo que de verdad hay que
              mirar: son los que hay que arreglar antes del siguiente envío. */}
          <ul className="flex flex-col gap-1">
            {(Object.entries(preview.excludedBy) as [ExclusionReason, number][])
              .filter(([, count]) => count > 0)
              .map(([reason, count]) => (
                <li key={reason} className="text-sm text-[#6b6455]">
                  {count} · {reasonText(copy, reason)}
                </li>
              ))}
          </ul>

          {canSend && preview.included.length > 0 && (
            <form action={runCampaignAction} className="border-t border-[#efeadd] pt-3">
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="actId" value={query.acto ?? ''} />
              <input type="hidden" name="segmentId" value={query.grupo ?? ''} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="version" value="1" />
              <input type="hidden" name="connectionId" value={connectionId} />
              <button type="submit" className={BUTTON}>
                {copy.send}
              </button>
            </form>
          )}
        </section>
      )}
    </>
  );
}

function reasonText(copy: Dictionary['admin']['campaigns'], reason: ExclusionReason): string {
  const reasons = copy.reasons as unknown as Record<string, string | undefined>;
  return reasons[reason] ?? reason;
}
