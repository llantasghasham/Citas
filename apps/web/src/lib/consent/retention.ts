import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';

/**
 * Lo que se tira cuando la boda ya pasó.
 *
 * Guardar el teléfono de doscientos invitados de una boda de hace tres años no
 * le sirve a nadie: la celebración ocurrió, nadie va a volver a escribirles por
 * ella, y lo único que sigue haciendo ese dato es poder filtrarse. Un dato que
 * ya no hace falta y que nadie borra es exactamente el que aparece en el
 * volcado, igual que las sesiones caducadas que borra `purgeExpired`.
 *
 * ANONIMIZA en vez de borrar la fila, y esa es la decisión del archivo:
 *
 *   - El NOMBRE y la RESPUESTA se quedan. La boda ocurrió y el recuento es
 *     historia suya: cuánta gente vino, quién estaba en qué mesa y cuántos
 *     confirmaron es lo que la oficina enseña cuando la pareja pregunta años
 *     después, y es la base de lo que le factura a su cliente. Borrar al
 *     invitado entero se lleva por delante ese recuento y deja unas mesas
 *     montadas para nadie.
 *   - El TELÉFONO y el CORREO se van. Son lo único que convierte ese recuento
 *     en una lista de personas localizables, y para lo que queda del evento —
 *     mirar lo que pasó— no hacen ninguna falta.
 *   - El `AuditLog` NO se toca. Es el registro de quién hizo qué, incluido esto
 *     mismo: un borrado que borra su propio rastro no es un borrado, es una
 *     desaparición. Tampoco se tocan las respuestas.
 *
 * Lo que esto NO se lleva, y hay que saberlo: `WhatsappMessage.toPhone` guarda
 * el número al que se escribió, y se queda. Es el registro de lo que salió —lo
 * que se mira cuando alguien pregunta si a un invitado le llegó su invitación—
 * y borrarlo sería borrar la prueba. Las dos reglas se tocan aquí y la decisión
 * es a favor del registro; si algún día se decide lo contrario, se decide para
 * esa tabla y con su propio plazo, no de rebote desde este archivo.
 *
 * Y NO SE EJECUTA SOLO. No hay temporizador que llame a esto, ni lo va a haber
 * por su cuenta: lo dispara una PERSONA desde el panel, o un temporizador que
 * alguien monte a propósito sabiendo lo que borra. Un trabajo automático que
 * llegue de serie borrando teléfonos de bodas es el que un día se lleva la lista
 * de una boda que todavía no se ha celebrado porque alguien tecleó mal la fecha.
 */

/** Lo que se mira para decidir si a un evento ya le toca. */
export interface RetentionCandidate {
  eventId: string;
  /** El último día que hubo algo: el del evento o el de su último acto. */
  lastDay: string;
  /** Cuántos invitados conservan todavía teléfono o correo. */
  withContact: number;
}

export type PurgeResult =
  | { ok: true; lastDay: string; visits: number; preferences: number; guests: number }
  | { ok: false; reason: 'notFound' }
  | { ok: false; reason: 'tooSoon'; lastDay: string };

/**
 * El día, en UTC, a partir del cual un evento ya cumplió su plazo.
 *
 * El día es UTC y se dice a las claras, como el del cupo de WhatsApp: la fecha
 * de un evento es local a su sede y la de aquí no, así que en el borde puede
 * bailar un día. En una retención que se mide en meses eso da igual; lo que no
 * daría igual es fingir una precisión que no hay.
 */
function cutoffDay(keepDays: number): string {
  if (!Number.isInteger(keepDays) || keepDays < 0) {
    throw new Error('Los días que se conservan tienen que ser un entero de cero para arriba.');
  }
  return new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
}

/**
 * El último día del evento: el suyo, o el de su acto más tardío si lo hay.
 *
 * Se mira el acto más tardío y no la fecha del evento a secas porque un `Event`
 * no es una fecha, es el contenedor: la despedida puede ser dos días después de
 * la ceremonia, y borrar los teléfonos contando desde la ceremonia sería borrar
 * mientras todavía queda gente a la que avisar.
 */
function lastDayOf(event: { date: string; acts: { date: string }[] }): string {
  return event.acts.reduce((latest, act) => (act.date > latest ? act.date : latest), event.date);
}

/**
 * Qué eventos están listos, SIN tocar nada.
 *
 * Existe para que quien va a pulsar el botón vea antes qué se va a llevar. Las
 * dos cosas separadas y en este orden, por lo mismo que `db:split` son dos
 * órdenes y no una: entre mirar y borrar tiene que caber una persona.
 */
export async function retentionCandidates(
  scope: TenantScope,
  keepDays: number,
): Promise<RetentionCandidate[]> {
  const cutoff = cutoffDay(keepDays);

  // Se filtra primero por la fecha del evento y luego por la de sus actos: un
  // evento cuya fecha todavía no llegó al corte tampoco puede tener un último
  // acto que sí, así que este filtro solo deja fuera lo que ya no era candidato.
  const events = await db(scope).event.findMany({
    where: { ...scopedWhere(scope), date: { lte: cutoff } },
    select: {
      id: true,
      date: true,
      acts: { select: { date: true } },
      guests: {
        where: { OR: [{ phone: { not: null } }, { email: { not: null } }] },
        select: { id: true },
      },
    },
    orderBy: { date: 'asc' },
  });

  return events
    .map((event) => ({
      eventId: event.id,
      lastDay: lastDayOf(event),
      withContact: event.guests.length,
    }))
    .filter((candidate) => candidate.lastDay <= cutoff);
}

/**
 * Tira lo que ya no hace falta de un evento pasado.
 *
 * Todo en una transacción: a medias dejaría un evento con los teléfonos
 * quitados y las visitas puestas, y nadie sabría si eso es que se purgó o que
 * no. Y es IDEMPOTENTE — volver a pasarlo no rompe nada ni cuenta dos veces,
 * porque lo que ya está a nulo no se vuelve a poner a nulo.
 */
export async function purgeAfterEvent(
  scope: TenantScope,
  eventId: string,
  options: { keepDays: number; actorId?: string | null },
): Promise<PurgeResult> {
  const cutoff = cutoffDay(options.keepDays);
  const prisma = db(scope);

  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true, date: true, acts: { select: { date: true } } },
  });
  if (event === null) return { ok: false, reason: 'notFound' };

  const lastDay = lastDayOf(event);
  // La comprobación se hace AQUÍ y no solo en la pantalla que lo ofrece: entre
  // listar los candidatos y pulsar el botón pueden pasar días, y el id del
  // evento viaja en un formulario, así que es un dato del cliente como
  // cualquier otro.
  if (lastDay > cutoff) return { ok: false, reason: 'tooSoon', lastDay };

  const done = await prisma.$transaction(async (tx) => {
    const visits = await tx.invitationVisit.deleteMany({ where: { eventId } });
    const preferences = await tx.guestPreference.deleteMany({ where: { eventId } });
    // El nombre se queda; el teléfono y el correo se van.
    const guests = await tx.guest.updateMany({
      where: { eventId, OR: [{ phone: { not: null } }, { email: { not: null } }] },
      data: { phone: null, email: null },
    });
    return { visits: visits.count, preferences: preferences.count, guests: guests.count };
  });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId: options.actorId ?? null,
    action: 'retention.purge',
    entity: 'Event',
    entityId: eventId,
    metadata: {
      keepDays: options.keepDays,
      lastDay,
      visits: done.visits,
      preferences: done.preferences,
      guests: done.guests,
    },
  });

  return { ok: true, lastDay, ...done };
}
