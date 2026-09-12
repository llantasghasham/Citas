import type { RsvpStatus } from '@/generated/prisma/enums';
import { db } from '@/lib/db/client';
import type { TenantScope } from '@/lib/db/tenant';

import { mayRespondTo } from './access';

/**
 * La respuesta a UN acto, que es la fuente de verdad.
 *
 * `Rsvp` —la respuesta global de toda la vida— no desaparece: se mantiene al día
 * como RESUMEN, en la misma transacción, porque lo leen las mesas, la
 * exportación, los recordatorios y media docena de pantallas. Pero es un
 * resumen y no manda: «a la ceremonia sí y a la recepción no» no cabe en una
 * fila, y esa es justo la frase que una familia necesita poder decir.
 *
 * El resumen se calcula, nunca se escribe a mano desde fuera. Si se pudiera
 * escribir por los dos lados, un día dirían cosas distintas y nadie sabría cuál
 * creer.
 */

export interface ActAnswer {
  status: RsvpStatus;
  party: number;
  message?: string | null;
}

export type AnswerOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_invited' | 'closed' | 'party' };

export async function answerAct(
  scope: TenantScope,
  eventId: string,
  guest: { id: string; maxParty: number },
  actId: string,
  answer: ActAnswer,
  now = new Date(),
): Promise<AnswerOutcome> {
  // Se vuelve a comprobar aquí, con la pantalla ya enviada: entre abrirla y
  // mandarla pueden pasar días, y en esos días el organizador puede haberle
  // quitado el acto o cerrado el plazo.
  const allowed = await mayRespondTo(scope, eventId, guest, actId, answer.party, now);
  if (!allowed.ok) return allowed;

  const prisma = db(scope);
  const message =
    answer.message === undefined || answer.message === null || answer.message.length === 0
      ? null
      : answer.message;

  await prisma.$transaction(async (tx) => {
    await tx.guestActRsvp.upsert({
      where: { guestId_actId: { guestId: guest.id, actId } },
      update: { status: answer.status, party: answer.party, message, respondedAt: now },
      create: {
        guestId: guest.id,
        actId,
        eventId,
        status: answer.status,
        party: answer.party,
        message,
        respondedAt: now,
      },
    });

    // El resumen, dentro de la MISMA transacción. Fuera, un proceso que muriera
    // en medio dejaría la respuesta por acto escrita y el resumen diciendo otra
    // cosa — y el resumen es lo que cuenta las sillas.
    const replies = await tx.guestActRsvp.findMany({
      where: { guestId: guest.id },
      select: { status: true, party: true, message: true, act: { select: { isMain: true } } },
    });
    const summary = summarise(replies);
    if (summary === null) return;

    await tx.rsvp.upsert({
      where: { guestId: guest.id },
      update: { status: summary.status, party: summary.party, message: summary.message },
      create: {
        guestId: guest.id,
        status: summary.status,
        party: summary.party,
        message: summary.message,
      },
    });
  });

  return { ok: true };
}

interface Reply {
  status: RsvpStatus;
  party: number;
  message: string | null;
  act: { isMain: boolean };
}

/**
 * Una respuesta global a partir de las respuestas por acto.
 *
 * El acto PRINCIPAL manda cuando hay respuesta suya: es el que heredó lo que el
 * evento era antes de que existieran los actos, así que su respuesta es
 * literalmente la de antes y las pantallas viejas siguen viendo lo mismo.
 *
 * Sin respuesta al principal, viene quien viene a ALGO, con el grupo más grande
 * que haya confirmado a algún acto. Contar el más grande y no el último es lo
 * que hace que las mesas no se queden cortas: quien viene con cuatro a la
 * recepción necesita cuatro sillas aunque a la henna vaya solo.
 */
export function summarise(
  replies: Reply[],
): { status: RsvpStatus; party: number; message: string | null } | null {
  if (replies.length === 0) return null;

  const main = replies.find((reply) => reply.act.isMain);
  if (main !== undefined) {
    return { status: main.status, party: main.party, message: main.message };
  }

  const attending = replies.filter((reply) => reply.status === 'attending');
  if (attending.length > 0) {
    const biggest = attending.reduce((best, reply) => (reply.party > best.party ? reply : best));
    return { status: 'attending', party: biggest.party, message: biggest.message };
  }

  const tentative = replies.find((reply) => reply.status === 'tentative');
  if (tentative !== undefined) {
    return { status: 'tentative', party: tentative.party, message: tentative.message };
  }

  const declined = replies[0];
  return declined === undefined
    ? null
    : { status: 'declined', party: declined.party, message: declined.message };
}
