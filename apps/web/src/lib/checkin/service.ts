import { timingSafeEqual } from 'node:crypto';

import type { Locale, RsvpStatus } from '@/generated/prisma/enums';
import { agendaFor, authorizes } from '@/lib/acts/access';
import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { signWithSecretKey } from '@/lib/secrets';

/**
 * La puerta: el código del QR, quién pasa, quién falta y cómo se deshace una
 * entrada equivocada.
 *
 * Dos cosas mandan aquí y las dos son de este proyecto de siempre:
 *
 *   1. **No hay una tabla más de tokens.** El código del QR se DERIVA del
 *      enlace personal que el invitado ya tiene (`/g/<token>`) más el id del
 *      acto, firmado con la llave de `lib/secrets.ts`. Un token nuevo por
 *      invitado y acto serían ocho filas por persona en una boda de ocho actos,
 *      con su caducidad, su purga y su día en que alguien se olvida de
 *      purgarlas. Derivarlo no guarda nada y no caduca mal: la firma vale
 *      mientras valga la llave.
 *   2. **Quien decide quién entra es la regla de siempre**, la de
 *      `lib/acts/access.ts`. El código IDENTIFICA, no autoriza: verificar la
 *      firma solo dice «este QR lo escribimos nosotros para esta persona y este
 *      acto». Si al organizador le dio por excluirla después, el QR sigue
 *      verificando y la puerta sigue diciendo que no. Escribir la autorización
 *      otra vez aquí sería tener dos reglas que un día dirán cosas distintas.
 *
 * Y una tercera que es de la puerta y de ninguna otra pantalla: en una puerta
 * hay gente delante mirando. El segundo intento dice «ya entró, a las 20:14» y
 * nada más — ni con quién viene, ni qué contestó, ni en qué mesa se sienta.
 */

/** Propósito de la firma. Separa esta llave de cualquier otro uso de la misma. */
const GATE_PURPOSE = 'gate-code';

/**
 * Versión del formato, delante y en el propio código.
 *
 * Cambiar cómo se firma sin poder distinguir un código viejo de uno nuevo
 * obligaría a reimprimir todos los QR de las bodas ya enviadas el mismo día del
 * despliegue. Con la marca delante, el día que haga falta se pueden aceptar los
 * dos durante una temporada.
 */
const CODE_VERSION = 'g1';

/**
 * Cuánta firma viaja: 16 caracteres base64url son 96 bits.
 *
 * El HMAC entero son 43 y no caben cómodos en un QR junto al token. 96 bits no
 * se aciertan a fuerza de intentos contra una puerta —ni contra mil puertas—, y
 * la firma no protege un secreto reutilizable: protege UNA pareja de invitado y
 * acto.
 */
const SIGNATURE_CHARS = 16;

/** El separador no puede aparecer en las partes: el token es base64url. */
const SEPARATOR = '.';

function signature(guestToken: string, actId: string): string {
  // El id del acto va DENTRO de la firma, y por eso el QR de la henna no abre
  // la recepción: son dos puertas, dos listas y a veces dos días distintos.
  return signWithSecretKey(GATE_PURPOSE, `${guestToken}\u0000${actId}`).slice(0, SIGNATURE_CHARS);
}

/**
 * El texto que va dentro del QR de un invitado para UN acto.
 *
 * `g1.<token del invitado>.<firma>`. Lleva el token porque la puerta tiene que
 * poder saber de quién es el código —una firma sola no se puede invertir— y la
 * firma porque el token solo se puede leer de un enlace reenviado por WhatsApp:
 * sin firmarlo, cualquiera que reciba una invitación reenviada se fabricaría la
 * entrada de otro acto al que no está invitado. La firma la comprueba el
 * servidor, así que no hay que confiar en nada de lo que llega.
 */
export function gateCode(guestToken: string, actId: string): string {
  if (guestToken.length === 0 || actId.length === 0) {
    throw new Error('Un código de puerta necesita el token del invitado y el id del acto.');
  }
  return [CODE_VERSION, guestToken, signature(guestToken, actId)].join(SEPARATOR);
}

/**
 * Comprueba un código y devuelve el token del invitado, o `null`.
 *
 * No dice POR QUÉ falla —formato, versión o firma— y no es descuido: quien
 * prueba códigos contra una puerta aprende de cada matiz que se le conteste.
 */
export function readGateCode(code: string, actId: string): string | null {
  const parts = code.trim().split(SEPARATOR);
  if (parts.length !== 3) return null;

  const [version, guestToken, provided] = parts;
  if (version !== CODE_VERSION) return null;
  if (guestToken === undefined || guestToken.length === 0) return null;
  if (provided === undefined || provided.length !== SIGNATURE_CHARS) return null;

  const expected = Buffer.from(signature(guestToken, actId), 'utf8');
  const candidate = Buffer.from(provided, 'utf8');
  // Longitudes iguales ya garantizadas arriba; `timingSafeEqual` las exige y
  // además no cuenta cuántos caracteres acertó quien lo intenta.
  if (candidate.length !== expected.length) return null;
  return timingSafeEqual(candidate, expected) ? guestToken : null;
}

/** Lo que la pantalla de la puerta necesita saber de quien acaba de pasar. */
export interface CheckedInGuest {
  id: string;
  name: string;
  locale: Locale;
  /** Cuántos podía traer A ESTE acto, ya resuelto (`AuthorizedAct.maxParty`). */
  maxParty: number;
  /** Cuántos han entrado con esta entrada, él incluido. */
  people: number;
}

export type CheckInOutcome =
  | { ok: true; guest: CheckedInGuest; seated: string | null }
  /** Ni el código verifica, ni el token es de un invitado de esta boda. */
  | { ok: false; reason: 'bad_code' }
  /** Es un invitado de la boda, pero no de ESTE acto. */
  | { ok: false; reason: 'not_invited' }
  /** Trae más gente de la que tenía autorizada PARA ESTE ACTO. */
  | { ok: false; reason: 'too_many'; allowed: number }
  /** Ya entró. La hora de la PRIMERA entrada, y nada más. */
  | { ok: false; reason: 'already_checked_in'; at: Date };

export interface CheckInRequest {
  /** El texto leído del QR. */
  code?: string;
  /** O el enlace personal, cuando el operador lo busca a mano en la lista. */
  guestToken?: string;
  actId: string;
  /** Cuántos pasan, él incluido. Vacío es uno. */
  people?: number;
  operatorId?: string | null;
  /** Qué puerta, cuando hay más de una. Texto libre del salón. */
  gate?: string | null;
}

/**
 * Dejar pasar a alguien a un acto.
 *
 * El orden de las comprobaciones no es indiferente: primero quién es (la
 * firma), luego si entra (la regla de siempre), luego con cuántos, y solo
 * entonces se escribe. Al revés se escribiría una entrada que después hay que
 * deshacer, y deshacerla no saca a nadie del salón.
 *
 * Lo de «ya entró» no lo decide una lectura previa: lo decide el índice único
 * `(actId, guestId)` al escribir. Dos operadores con dos móviles leyendo el
 * mismo QR a la vez pasan los dos por la lectura y los dos verían la cola
 * vacía; lo único que hay entre eso y contar dos veces a la misma persona es la
 * base.
 */
export async function checkIn(
  scope: TenantScope,
  eventId: string,
  request: CheckInRequest,
): Promise<CheckInOutcome> {
  const prisma = db(scope);

  const token =
    request.code !== undefined && request.code.length > 0
      ? readGateCode(request.code, request.actId)
      : request.guestToken !== undefined && request.guestToken.length > 0
        ? request.guestToken
        : null;
  if (token === null) return { ok: false, reason: 'bad_code' };

  // El evento y la oficina van en el WHERE, no se comprueban después: un token
  // de la boda de al lado tiene que responder lo mismo que un código inventado.
  const guest = await prisma.guest.findFirst({
    where: { token, eventId, event: scopedWhere(scope) },
    select: {
      id: true,
      name: true,
      locale: true,
      maxParty: true,
      table: { select: { name: true } },
    },
  });
  if (guest === null) return { ok: false, reason: 'bad_code' };

  // La regla de quién entra vive en `lib/acts/access.ts` y se importa. Aquí se
  // le pregunta; no se vuelve a escribir.
  const agenda = await agendaFor(scope, eventId, { id: guest.id, maxParty: guest.maxParty });
  const act = agenda.find((candidate) => candidate.id === request.actId);
  if (act === undefined) return { ok: false, reason: 'not_invited' };

  // Un número raro en una puerta es un dedazo de quien teclea con gente
  // delante, no un ataque: se cuenta a la persona que está ahí. Pasarse del
  // tope SÍ se dice, porque esa la tiene que resolver alguien.
  const asked = request.people;
  const people = asked !== undefined && Number.isInteger(asked) && asked >= 1 ? asked : 1;
  if (people > act.maxParty) return { ok: false, reason: 'too_many', allowed: act.maxParty };

  let created: { id: string };
  try {
    created = await prisma.checkIn.create({
      data: {
        eventId,
        actId: request.actId,
        guestId: guest.id,
        people,
        operatorId: request.operatorId ?? null,
        gate: request.gate ?? null,
      },
      select: { id: true },
    });
  } catch (error) {
    // Si ya hay una entrada suya, lo que falló fue el índice único y este es el
    // segundo intento. Si no la hay, el fallo es otro y tiene que verse: una
    // puerta que se traga los errores deja pasar a todo el mundo.
    const existing = await prisma.checkIn.findUnique({
      where: { actId_guestId: { actId: request.actId, guestId: guest.id } },
      select: { createdAt: true },
    });
    if (existing === null) throw error;
    return { ok: false, reason: 'already_checked_in', at: existing.createdAt };
  }

  await recordAudit({
    tenantId: scope.tenantId,
    actorId: request.operatorId ?? null,
    action: 'checkin.enter',
    entity: 'checkIn',
    entityId: created.id,
    metadata: {
      eventId,
      actId: request.actId,
      guestId: guest.id,
      people,
      gate: request.gate ?? null,
    },
  });

  return {
    ok: true,
    guest: {
      id: guest.id,
      name: guest.name,
      locale: guest.locale,
      maxParty: act.maxParty,
      people,
    },
    // Dónde se sienta es lo único que hace falta decir en voz alta en una
    // puerta, y solo cuando hay mesa: si nadie le ha guardado sitio, no se le
    // promete uno.
    seated: guest.table?.name ?? null,
  };
}

/** Una fila de la pantalla de la puerta. */
export interface GateEntry {
  guestId: string;
  name: string;
  phone: string | null;
  /** Cuántos puede traer A ESTE acto. */
  maxParty: number;
  /** Lo que contestó a ESTE acto, si contestó. */
  rsvp: RsvpStatus | null;
  /** Las sillas que comprometió al contestar, él incluido. */
  party: number | null;
  table: string | null;
  /** Cuándo pasó, si pasó. */
  enteredAt: Date | null;
  /** Con cuántos pasó. */
  people: number | null;
  gate: string | null;
}

export interface GateList {
  actId: string;
  /** Quién ha entrado, del último al primero: lo de arriba es lo de ahora. */
  inside: GateEntry[];
  /** Quién falta, en orden alfabético: por ahí se busca un nombre. */
  pending: GateEntry[];
  /** Cuánta gente hay dentro, sumando acompañantes. */
  headcount: number;
}

/**
 * Quién ha entrado y quién falta a un acto.
 *
 * Se resuelve en un número FIJO de consultas y se cruza en memoria, por la
 * misma razón que `lib/acts/metrics.ts`: la autorización no es un `where` —son
 * cinco reglas con un orden— y escribirla en SQL sería tenerla escrita dos
 * veces, que es como dos pantallas acaban diciendo cosas distintas.
 *
 * Devuelve `null` cuando el acto no es de este evento o el evento no es de esta
 * oficina, que es la misma respuesta que cuando no existe.
 */
export async function gateList(
  scope: TenantScope,
  eventId: string,
  actId: string,
): Promise<GateList | null> {
  const prisma = db(scope);

  const act = await prisma.eventAct.findFirst({
    where: { id: actId, eventId, event: scopedWhere(scope) },
    select: { id: true, visibility: true, audiences: { select: { segmentId: true, mode: true } } },
  });
  if (act === null) return null;

  const [guests, entries] = await Promise.all([
    prisma.guest.findMany({
      where: { eventId, event: scopedWhere(scope) },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        maxParty: true,
        table: { select: { name: true } },
        segments: { select: { segmentId: true } },
        actInvites: { select: { actId: true, excluded: true, maxParty: true } },
        actRsvps: { select: { actId: true, status: true, party: true } },
      },
    }),
    prisma.checkIn.findMany({
      where: { actId, eventId },
      orderBy: { createdAt: 'desc' },
      select: { guestId: true, createdAt: true, people: true, gate: true },
    }),
  ]);

  const entered = new Map(entries.map((row) => [row.guestId, row]));
  const inside: GateEntry[] = [];
  const pending: GateEntry[] = [];

  for (const guest of guests) {
    const mine = new Set(guest.segments.map((row) => row.segmentId));
    const invite = guest.actInvites.find((row) => row.actId === actId);
    const entry = entered.get(guest.id);

    // Quien YA entró sigue en la lista aunque le hayan quitado el acto después:
    // está dentro del salón, y una pantalla que lo esconda no lo saca de ahí —
    // solo deja a quien está en la puerta sin la fila que hay que revocar.
    if (!authorizes(act, invite, mine) && entry === undefined) continue;

    const reply = guest.actRsvps.find((row) => row.actId === actId);
    const row: GateEntry = {
      guestId: guest.id,
      name: guest.name,
      phone: guest.phone,
      maxParty: invite?.maxParty ?? guest.maxParty,
      rsvp: reply?.status ?? null,
      party: reply?.party ?? null,
      table: guest.table?.name ?? null,
      enteredAt: entry?.createdAt ?? null,
      people: entry?.people ?? null,
      gate: entry?.gate ?? null,
    };
    if (entry === undefined) pending.push(row);
    else inside.push(row);
  }

  // Los de dentro, por hora y del último al primero: quien mira la pantalla en
  // una puerta quiere ver lo que acaba de pasar, no la letra A.
  inside.sort((a, b) => (b.enteredAt?.getTime() ?? 0) - (a.enteredAt?.getTime() ?? 0));

  return {
    actId,
    inside,
    pending,
    headcount: inside.reduce((total, row) => total + (row.people ?? 0), 0),
  };
}

/**
 * Deshacer una entrada.
 *
 * Existe porque en una puerta se equivoca cualquiera: dos personas con el mismo
 * nombre, un QR reenviado, un dedazo en el número de acompañantes. Borra la
 * fila en vez de marcarla, porque lo que cuenta el aforo es la fila y un estado
 * más sería un estado que alguien olvidará filtrar — pero queda en el
 * historial, con quién lo hizo y qué deshizo, que es donde se mira cuando la
 * cifra de la puerta no cuadra con el salón.
 */
export async function revokeCheckIn(
  scope: TenantScope,
  eventId: string,
  actId: string,
  guestId: string,
  actorId: string | null,
): Promise<boolean> {
  const prisma = db(scope);

  // El acto tiene que ser de este evento y de esta oficina: el id viaja en un
  // campo oculto del formulario de la puerta, así que es un dato del cliente.
  const existing = await prisma.checkIn.findFirst({
    where: { actId, guestId, eventId, act: { event: scopedWhere(scope) } },
    select: { id: true, people: true, createdAt: true },
  });
  if (existing === null) return false;

  await prisma.checkIn.delete({ where: { id: existing.id } });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'checkin.revoke',
    entity: 'checkIn',
    entityId: existing.id,
    metadata: {
      eventId,
      actId,
      guestId,
      people: existing.people,
      enteredAt: existing.createdAt.toISOString(),
    },
  });
  return true;
}
