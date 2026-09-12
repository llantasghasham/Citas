import { agendaFor, publicActs, type AuthorizedAct } from '@/lib/acts/access';
import { db } from '@/lib/db/client';
import { scopeForSlug } from '@/lib/db/directory';
import type { TenantScope } from '@/lib/db/tenant';

/**
 * El programa que ve QUIEN está mirando la invitación.
 *
 * Un mismo enlace enseña cosas distintas según quién lo abra, y eso se decide
 * aquí, en el servidor, una sola vez:
 *
 *   - Sin enlace personal: los actos PÚBLICOS y nada más. La invitación se
 *     reenvía a grupos enteros de WhatsApp, así que lo que salga aquí sale para
 *     cualquiera que reciba el reenvío.
 *   - Con enlace personal: SU agenda, con las reglas de `agendaFor`.
 *
 * El `actId` que llegue del navegador no decide nada: se comprueba contra esta
 * lista. Y el token no vale «por ser un token» — tiene que pertenecer a ESTE
 * evento, que es la misma regla que ya valía para el formulario de confirmación.
 * Un token de otra boda se trata como si no hubiera ninguno: se enseña lo
 * público y no se dice más, porque decir «ese token no es de aquí» ya es contar
 * que existe en otro sitio.
 */
export interface VisitorAgenda {
  scope: TenantScope;
  eventId: string;
  acts: AuthorizedAct[];
  /** Quién mira, cuando trae enlace personal reconocido. */
  guest: { id: string; name: string; maxParty: number } | null;
}

/** Lo público, con la forma de una agenda y sin nada que se pueda contestar. */
function asProgramme(acts: Awaited<ReturnType<typeof publicActs>>): AuthorizedAct[] {
  return acts.map((act) => ({ ...act, maxParty: 0, repliesEnabled: false, canRespond: false, reply: null }));
}

export async function visitorAgenda(
  slug: string,
  token: string | undefined,
): Promise<VisitorAgenda | null> {
  const scope = await scopeForSlug(slug);
  if (scope === null) return null;

  const prisma = db(scope);
  const version = await prisma.invitationVersion.findUnique({
    where: { slug },
    select: { event: { select: { id: true } } },
  });
  if (version === null) return null;
  const eventId = version.event.id;

  const guest =
    token === undefined || token.length === 0
      ? null
      : await prisma.guest.findFirst({
          where: { token, eventId },
          select: { id: true, name: true, maxParty: true },
        });

  if (guest === null) {
    return { scope, eventId, acts: asProgramme(await publicActs(scope, eventId)), guest: null };
  }
  return { scope, eventId, acts: await agendaFor(scope, eventId, guest), guest };
}
