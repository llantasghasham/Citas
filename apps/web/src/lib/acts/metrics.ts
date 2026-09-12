import type { ActType, ActVisibility,  RsvpStatus} from '@/generated/prisma/enums';
import { authorizes } from './access';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';

/**
 * Los números de una boda repartida en actos: cuántos entran a cada uno,
 * cuántos han contestado y cuántas sillas hay comprometidas.
 *
 * Con un solo acto y una sola respuesta esto era una consulta. Con ocho actos y
 * gente distinta en cada uno, la pregunta «¿cuánta gente viene a la henna?» ya
 * no la contesta una columna: hay que resolver ANTES quién está invitado a la
 * henna, que es una decisión con cinco reglas y un orden.
 *
 * ── Por qué se agrega en memoria y no con `groupBy` ────────────────────────
 *
 * Porque la autorización no es un `where`. «Una exclusión con nombre gana sobre
 * todo; una invitación con nombre invita aunque no esté en ningún grupo; un
 * `deny` de grupo gana sobre un `allow`; un `allow` abre; un acto público lo ve
 * cualquiera; y si nada dice que sí, es que NO» no se escribe en SQL sin un par
 * de `NOT EXISTS` anidados que nadie va a poder leer dentro de un año — y que
 * además se desviarían de `agendaFor` en cuanto una de las dos cambiara.
 *
 * Así que se traen las filas UNA vez —los actos con sus reglas, y los invitados
 * con sus grupos, sus invitaciones con nombre y sus respuestas— y se cruzan
 * aquí. Es un número FIJO de consultas: las mismas para una boda de veinte
 * invitados que para una de cuatrocientos, y las mismas con un acto que con
 * ocho. La alternativa —preguntar por invitado— son cuatro consultas por fila:
 * mil seiscientas para pintar una pantalla que se mira de reojo.
 *
 * Lo que cabe en memoria: cuatrocientos invitados por ocho actos son tres mil
 * doscientas comparaciones de conjuntos. Eso no es un problema de escala, es un
 * bucle.
 */

/** Hasta cuántos nombres de ejemplo devuelve la cobertura de cada caso. */
export const SAMPLE_LIMIT = 50;

export interface ActMetrics {
  actId: string;
  type: ActType;
  label: string | null;
  order: number;
  date: string;
  time: string;
  visibility: ActVisibility;
  isMain: boolean;
  /**
   * Cuántos invitados pueden entrar. Es EXACTO, no una aproximación por grupos:
   * se aplica invitado a invitado el mismo orden de decisión que `agendaFor`,
   * así que quien esté en dos grupos permitidos se cuenta UNA vez y una
   * exclusión con nombre resta de verdad.
   */
  authorized: number;
  /** De esos, cuántos han contestado algo (venga, no venga o quizá). */
  replied: number;
  attending: number;
  declined: number;
  /** El «quizá» existe en el modelo y no se reparte entre los otros dos. */
  tentative: number;
  /** Los autorizados que no han dicho nada. */
  pending: number;
  /**
   * Sillas comprometidas: la suma de `party` de quienes vienen, que YA se
   * cuenta a sí mismo. Quien confirmó por cuatro ocupa cuatro, no una.
   */
  seats: number;
  capacity: number | null;
  /** El aforo es un AVISO, no una barrera: aquí solo se dice que se pasó. */
  overCapacity: boolean;
}

export interface CoverageGuest {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface CoverageCase {
  count: number;
  /** Hasta `SAMPLE_LIMIT` nombres, para que la pantalla enseñe a QUIÉN. */
  sample: CoverageGuest[];
}

export interface Coverage {
  /** Cuántos invitados tiene la boda en total. */
  guests: number;
  /**
   * Los que no están autorizados a NINGÚN acto: nadie va a poder invitarlos,
   * porque no hay a qué. Es el agujero que este estudio existe para enseñar.
   *
   * Ojo con un detalle que no es un fallo: un acto PÚBLICO lo ve cualquiera con
   * el enlace, así que en cuanto hay uno este recuento baja a cero. Es correcto
   * —a esa gente sí se la puede invitar a algo— pero conviene saberlo antes de
   * leer un cero como «está todo bien».
   */
  inNoAct: CoverageCase;
  /** Sin teléfono y sin correo: no hay por dónde avisarles. */
  unreachable: CoverageCase;
  /** Están en algún acto y no han contestado a ninguno. */
  silent: CoverageCase;
  /**
   * Los que ABRIERON su invitación y aun así no contestaron a nada.
   *
   * Es un subconjunto de `silent`, y va aparte porque son dos conversaciones
   * distintas: a quien no la abrió hay que MANDÁRSELA otra vez —quizá el enlace
   * no le llegó—, y a quien la abrió y no contestó hay que ESCRIBIRLE. Con
   * `Guest.openedAt` esto no se podía distinguir: solo decía «alguna vez».
   */
  openedNoReply: CoverageCase;
}

export interface ActReport {
  acts: ActMetrics[];
  coverage: Coverage;
}


/**
 * Todo lo que hace falta para las dos vistas, en un número fijo de consultas.
 *
 * Devuelve `null` cuando el evento no es de esta oficina, que es la misma
 * respuesta que cuando no existe: lo contrario le diría a una oficina qué ids
 * de evento hay en otra.
 */
async function roster(scope: TenantScope, eventId: string) {
  const prisma = db(scope);

  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  if (event === null) return null;

  const [acts, guests] = await Promise.all([
    prisma.eventAct.findMany({
      where: { eventId, event: scopedWhere(scope) },
      orderBy: [{ order: 'asc' }, { date: 'asc' }, { time: 'asc' }],
      select: {
        id: true,
        type: true,
        label: true,
        order: true,
        date: true,
        time: true,
        capacity: true,
        visibility: true,
        isMain: true,
        audiences: { select: { segmentId: true, mode: true } },
      },
    }),
    // En orden alfabético para que los ejemplos de la cobertura salgan siempre
    // los mismos: una lista de «hasta cincuenta» que cambia de orden en cada
    // recarga no se puede comparar con la de ayer.
    prisma.guest.findMany({
      where: { eventId, event: scopedWhere(scope) },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        segments: { select: { segmentId: true } },
        actInvites: { select: { actId: true, excluded: true } },
        actRsvps: { select: { actId: true, status: true, party: true } },
      },
    }),
  ]);

  return { acts, guests };
}

type Roster = NonNullable<Awaited<ReturnType<typeof roster>>>;
type RosterGuest = Roster['guests'][number];
type RosterAct = Roster['acts'][number];

/**
 * Un invitado ya resuelto: a qué actos entra y qué contestó en cada uno.
 *
 * Se resuelve UNA vez y lo leen las dos vistas. Separarlo en dos recorridos
 * —uno para los números y otro para la cobertura— sería aplicar dos veces el
 * mismo orden de decisión, con dos sitios donde puede desviarse.
 */
interface Resolved {
  guest: RosterGuest;
  /** Los actos a los que puede entrar, con su respuesta si la hay. */
  entries: { act: RosterAct; reply: { status: RsvpStatus; party: number } | null }[];
}

function resolve(data: Roster): Resolved[] {
  return data.guests.map((guest) => {
    const mine = new Set(guest.segments.map((row) => row.segmentId));
    const inviteOf = new Map(guest.actInvites.map((row) => [row.actId, row]));
    const replyOf = new Map(guest.actRsvps.map((row) => [row.actId, row]));

    const entries: Resolved['entries'] = [];
    for (const act of data.acts) {
      // Lo que no autoriza no entra, y con ello se queda fuera su respuesta:
      // una contestación a un acto del que luego se excluyó a esa persona no
      // cuenta, porque ya no va. Contarla dejaría «contestados» por encima de
      // «pueden entrar», que es un número que no se puede explicar a nadie.
      if (!authorizes(act, inviteOf.get(act.id), mine)) continue;

      const reply = replyOf.get(act.id);
      entries.push({
        act,
        reply: reply === undefined ? null : { status: reply.status, party: reply.party },
      });
    }
    return { guest, entries };
  });
}

/** Los números de cada acto: quién entra, quién contestó y cuántas sillas. */
export async function actMetrics(
  scope: TenantScope,
  eventId: string,
): Promise<ActMetrics[] | null> {
  const data = await roster(scope, eventId);
  return data === null ? null : metricsFrom(data.acts, resolve(data));
}

/**
 * Quién ha ABIERTO su invitación alguna vez.
 *
 * Sale de `InvitationVisit` y no de `Guest.openedAt`: aquel solo dice «alguna
 * vez» y no distingue a quien la abrió y no contestó —a ese hay que escribirle—
 * de quien no la abrió nunca —a ese hay que mandársela otra vez—. Se pide
 * agrupado para traer un id por invitado y no una fila por apertura: una
 * invitación que se reenvía se abre muchas veces.
 */
async function openedBy(scope: TenantScope, eventId: string): Promise<Set<string>> {
  const rows = await db(scope).invitationVisit.groupBy({
    by: ['guestId'],
    where: { eventId, guestId: { not: null } },
  });
  return new Set(rows.flatMap((row) => (row.guestId === null ? [] : [row.guestId])));
}

/** La cobertura: a quién no se puede invitar, a quién no se puede avisar. */
export async function coverage(scope: TenantScope, eventId: string): Promise<Coverage | null> {
  const [data, opened] = await Promise.all([roster(scope, eventId), openedBy(scope, eventId)]);
  return data === null ? null : coverageFrom(resolve(data), opened);
}

/**
 * Las dos vistas con UNA sola lectura.
 *
 * La pantalla del estudio enseña las dos juntas, y pedirlas por separado sería
 * leer dos veces las mismas filas para pintar la misma página.
 */
export async function actReport(scope: TenantScope, eventId: string): Promise<ActReport | null> {
  const [data, opened] = await Promise.all([roster(scope, eventId), openedBy(scope, eventId)]);
  if (data === null) return null;
  const resolved = resolve(data);
  return { acts: metricsFrom(data.acts, resolved), coverage: coverageFrom(resolved, opened) };
}

function metricsFrom(acts: RosterAct[], resolved: Resolved[]): ActMetrics[] {
  interface Tally {
    authorized: number;
    attending: number;
    declined: number;
    tentative: number;
    seats: number;
  }
  const tally = new Map<string, Tally>();
  for (const act of acts) {
    tally.set(act.id, { authorized: 0, attending: 0, declined: 0, tentative: 0, seats: 0 });
  }

  for (const { entries } of resolved) {
    for (const { act, reply } of entries) {
      const row = tally.get(act.id);
      if (row === undefined) continue;
      row.authorized += 1;
      if (reply === null) continue;
      if (reply.status === 'attending') {
        row.attending += 1;
        // `party` se cuenta a sí mismo, así que esto son sillas y no
        // acompañantes: quien viene con tres ocupa cuatro.
        row.seats += reply.party;
      } else if (reply.status === 'declined') {
        row.declined += 1;
      } else {
        row.tentative += 1;
      }
    }
  }

  return acts.map((act) => {
    const row = tally.get(act.id) ?? {
      authorized: 0,
      attending: 0,
      declined: 0,
      tentative: 0,
      seats: 0,
    };
    const replied = row.attending + row.declined + row.tentative;
    return {
      actId: act.id,
      type: act.type,
      label: act.label,
      order: act.order,
      date: act.date,
      time: act.time,
      visibility: act.visibility,
      isMain: act.isMain,
      authorized: row.authorized,
      replied,
      attending: row.attending,
      declined: row.declined,
      tentative: row.tentative,
      pending: row.authorized - replied,
      seats: row.seats,
      capacity: act.capacity,
      // Un aforo sin poner no se pasa nunca: nulo es «no lo sé», no «cero».
      overCapacity: act.capacity !== null && row.seats > act.capacity,
    };
  });
}

function coverageFrom(resolved: Resolved[], opened: ReadonlySet<string>): Coverage {
  const inNoAct: CoverageGuest[] = [];
  const unreachable: CoverageGuest[] = [];
  const silent: CoverageGuest[] = [];
  const openedNoReply: CoverageGuest[] = [];
  let inNoActCount = 0;
  let unreachableCount = 0;
  let silentCount = 0;
  let openedNoReplyCount = 0;

  const sampleOf = (guest: RosterGuest): CoverageGuest => ({
    id: guest.id,
    name: guest.name,
    phone: guest.phone,
    email: guest.email,
  });

  for (const { guest, entries } of resolved) {
    if (entries.length === 0) {
      inNoActCount += 1;
      // Se cuentan TODOS y se guardan cincuenta: el recuento es el dato y los
      // nombres son para que alguien pueda empezar a arreglarlo.
      if (inNoAct.length < SAMPLE_LIMIT) inNoAct.push(sampleOf(guest));
    } else if (entries.every((entry) => entry.reply === null)) {
      silentCount += 1;
      if (silent.length < SAMPLE_LIMIT) silent.push(sampleOf(guest));
      if (opened.has(guest.id)) {
        openedNoReplyCount += 1;
        if (openedNoReply.length < SAMPLE_LIMIT) openedNoReply.push(sampleOf(guest));
      }
    }

    const phone = guest.phone ?? '';
    const email = guest.email ?? '';
    if (phone.length === 0 && email.length === 0) {
      unreachableCount += 1;
      if (unreachable.length < SAMPLE_LIMIT) unreachable.push(sampleOf(guest));
    }
  }

  return {
    guests: resolved.length,
    inNoAct: { count: inNoActCount, sample: inNoAct },
    unreachable: { count: unreachableCount, sample: unreachable },
    silent: { count: silentCount, sample: silent },
    openedNoReply: { count: openedNoReplyCount, sample: openedNoReply },
  };
}

// Se reexporta para que la exportación por acto la importe de un solo sitio.
export { authorizes };
