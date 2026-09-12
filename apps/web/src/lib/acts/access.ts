import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import type { ActType, ActVisibility, AudienceMode, RsvpStatus } from '@/generated/prisma/enums';

/**
 * Quién puede ver y responder a qué acto. TODO se resuelve en el servidor.
 *
 * Es la pieza que decide si una henna íntima aparece o no en la pantalla de
 * alguien, y por eso no acepta nada que venga del navegador: el invitado sale
 * del token, el evento sale del invitado, y los actos salen de las reglas. Un
 * `actId` enviado en un formulario no autoriza nada — se comprueba contra esto.
 *
 * El orden de decisión, y el orden importa:
 *
 *   1. Una EXCLUSIÓN con nombre y apellido gana sobre todo lo demás. Es lo que
 *      permite decir «este no» sin rehacer los grupos.
 *   2. Una invitación con nombre y apellido invita, aunque no esté en ningún
 *      grupo. Es la excepción que no se puede escribir con un grupo sin
 *      inventarse un grupo de una persona.
 *   3. Una regla `deny` sobre un grupo suyo cierra el paso. Gana sobre `allow`:
 *      «toda la familia menos los del pueblo» se escribe así y no enumerando a
 *      los demás.
 *   4. Una regla `allow` sobre un grupo suyo abre el paso.
 *   5. Un acto PÚBLICO lo ve cualquiera que tenga el enlace.
 *   6. Y si nada de lo anterior dice que sí, es que NO. Falla cerrado, que en
 *      esto es la única postura defendible: no enseñar de menos se arregla con
 *      una llamada, y enseñar de más no se arregla.
 */

export interface AuthorizedAct {
  id: string;
  type: ActType;
  label: string | null;
  order: number;
  date: string;
  time: string;
  endTime: string | null;
  timezone: string;
  venueName: string;
  venueAddress: string;
  venueMapUrl: string;
  optional: boolean;
  visibility: ActVisibility;
  isMain: boolean;
  /** Cuántos puede traer A ESTE acto, ya resuelto. */
  maxParty: number;
  /** Si este acto admite respuesta EN ABSOLUTO. */
  repliesEnabled: boolean;
  /**
   * Si todavía se puede contestar: `repliesEnabled` Y dentro de plazo.
   *
   * Van separados porque no dicen lo mismo y la pantalla tiene que distinguir:
   * «aquí no se confirma» es una nota del programa, y «se te pasó el plazo» es
   * un aviso a quien iba a contestar.
   */
  canRespond: boolean;
  /** Lo que ya contestó a ESTE acto, si contestó. */
  reply: { status: RsvpStatus; party: number; message: string | null } | null;
}

/**
 * La regla, y el ÚNICO sitio donde vive.
 *
 * La usan la agenda de un invitado y los recuentos del panel. Estaba escrita dos
 * veces —una en cada sitio, idénticas— y eso es como empiezan a decir cosas
 * distintas: alguien arregla un caso raro en una y la otra sigue como estaba, y
 * lo que queda es un panel que promete una lista y una invitación que enseña
 * otra. Aquí pasa lo mismo que con la liquidación de un cobro: se decide en un
 * sitio o no se decide.
 *
 * El orden importa:
 *   1. Una EXCLUSIÓN con nombre gana sobre todo.
 *   2. Una INVITACIÓN con nombre invita aunque no esté en ningún grupo, y un
 *      `deny` de grupo no la tumba: quien escribió el nombre sabía lo que había.
 *   3. Un `deny` de grupo cierra el paso; gana sobre `allow`.
 *   4. Un `allow` de grupo abre.
 *   5. Un acto PÚBLICO lo ve cualquiera con el enlace.
 *   6. Y si nada dice que sí, es que NO. Falla cerrado.
 */
export function authorizes(
  act: { visibility: ActVisibility; audiences: { segmentId: string; mode: AudienceMode }[] },
  invite: { excluded: boolean } | undefined,
  mine: ReadonlySet<string>,
): boolean {
  if (invite?.excluded === true) return false;
  if (invite !== undefined) return true;

  const denied = act.audiences.some((rule) => rule.mode === 'deny' && mine.has(rule.segmentId));
  if (denied) return false;

  const allowed = act.audiences.some((rule) => rule.mode === 'allow' && mine.has(rule.segmentId));
  return allowed || act.visibility === 'public';
}

const ACT_FIELDS = {
  id: true,
  type: true,
  label: true,
  order: true,
  date: true,
  time: true,
  endTime: true,
  timezone: true,
  venueName: true,
  venueAddress: true,
  venueMapUrl: true,
  optional: true,
  visibility: true,
  isMain: true,
  rsvpEnabled: true,
  rsvpDeadline: true,
} as const;

/** Si a estas alturas todavía se puede contestar a ese acto. */
function stillOpen(
  act: { rsvpEnabled: boolean; rsvpDeadline: Date | null },
  now: Date,
): boolean {
  if (!act.rsvpEnabled) return false;
  return act.rsvpDeadline === null || act.rsvpDeadline.getTime() > now.getTime();
}

/**
 * La agenda de UN invitado: los actos a los que está invitado, en orden.
 *
 * Una sola consulta por tabla y no una por acto: una boda con ocho actos y
 * cuatrocientos invitados no puede pagar una consulta por fila para pintar una
 * página que abre todo el grupo de WhatsApp a la vez.
 */
export async function agendaFor(
  scope: TenantScope,
  eventId: string,
  guest: { id: string; maxParty: number },
  now = new Date(),
): Promise<AuthorizedAct[]> {
  const prisma = db(scope);

  const [acts, memberships, invites, replies] = await Promise.all([
    prisma.eventAct.findMany({
      where: { eventId, event: scopedWhere(scope) },
      orderBy: [{ order: 'asc' }, { date: 'asc' }, { time: 'asc' }],
      select: { ...ACT_FIELDS, audiences: { select: { segmentId: true, mode: true } } },
    }),
    prisma.guestSegment.findMany({ where: { guestId: guest.id }, select: { segmentId: true } }),
    prisma.guestActInvite.findMany({
      where: { guestId: guest.id },
      select: { actId: true, maxParty: true, excluded: true },
    }),
    prisma.guestActRsvp.findMany({
      where: { guestId: guest.id },
      select: { actId: true, status: true, party: true, message: true },
    }),
  ]);

  const mine = new Set(memberships.map((row) => row.segmentId));
  const inviteOf = new Map(invites.map((row) => [row.actId, row]));
  const replyOf = new Map(replies.map((row) => [row.actId, row]));

  const authorized: AuthorizedAct[] = [];
  for (const act of acts) {
    const invite = inviteOf.get(act.id);
    if (!authorizes(act, invite, mine)) continue;

    const reply = replyOf.get(act.id);
    authorized.push({
      id: act.id,
      type: act.type,
      label: act.label,
      order: act.order,
      date: act.date,
      time: act.time,
      endTime: act.endTime,
      timezone: act.timezone,
      venueName: act.venueName,
      venueAddress: act.venueAddress,
      venueMapUrl: act.venueMapUrl,
      optional: act.optional,
      visibility: act.visibility,
      isMain: act.isMain,
      maxParty: invite?.maxParty ?? guest.maxParty,
      repliesEnabled: act.rsvpEnabled,
      canRespond: stillOpen(act, now),
      reply:
        reply === undefined
          ? null
          : { status: reply.status, party: reply.party, message: reply.message },
    });
  }
  return authorized;
}

/**
 * Los actos PÚBLICOS de un evento, para `/i/<slug>`.
 *
 * Esa página la abre cualquiera que tenga el enlace, y el enlace se reenvía a
 * grupos enteros de WhatsApp. Aquí no se filtra por invitado porque no hay
 * invitado: se enseña lo que el organizador marcó como público y nada más.
 */
export async function publicActs(
  scope: TenantScope,
  eventId: string,
): Promise<Omit<AuthorizedAct, 'maxParty' | 'canRespond' | 'repliesEnabled' | 'reply'>[]> {
  const acts = await db(scope).eventAct.findMany({
    where: { eventId, visibility: 'public', event: scopedWhere(scope) },
    orderBy: [{ order: 'asc' }, { date: 'asc' }, { time: 'asc' }],
    select: ACT_FIELDS,
  });
  return acts.map(({ rsvpEnabled: _e, rsvpDeadline: _d, ...act }) => act);
}

/**
 * Si ESTE invitado puede contestar a ESTE acto, y con cuánta gente.
 *
 * Lo llama la acción de confirmar, otra vez, después de haber pintado la
 * pantalla: entre que alguien abre la página y la envía pueden pasar días, y en
 * esos días el organizador puede haberle quitado el acto o haber cerrado el
 * plazo. Una pantalla pintada no es un permiso.
 */
export async function mayRespondTo(
  scope: TenantScope,
  eventId: string,
  guest: { id: string; maxParty: number },
  actId: string,
  party: number,
  now = new Date(),
): Promise<{ ok: true; maxParty: number } | { ok: false; reason: 'not_invited' | 'closed' | 'party' }> {
  const agenda = await agendaFor(scope, eventId, guest, now);
  const act = agenda.find((candidate) => candidate.id === actId);
  if (act === undefined) return { ok: false, reason: 'not_invited' };
  if (!act.canRespond) return { ok: false, reason: 'closed' };
  if (!Number.isInteger(party) || party < 1 || party > act.maxParty) {
    return { ok: false, reason: 'party' };
  }
  return { ok: true, maxParty: act.maxParty };
}
