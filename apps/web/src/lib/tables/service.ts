import type { Locale } from '@citas/core';

import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import type { RsvpStatus } from '@/generated/prisma/enums';

/**
 * El reparto del salón: qué mesas hay y quién se sienta en cada una.
 *
 * Todo cuelga del EVENTO, y el evento de la oficina. Ninguna función de aquí
 * acepta un id de mesa sin comprobar antes que la boda es de quien pregunta:
 * el id viaja en un campo oculto del formulario, así que darlo por bueno sería
 * dejar que quien administra una oficina moviera las mesas de otra.
 *
 * Quien ocupa una silla es quien ha CONFIRMADO. Un invitado sin respuesta no se
 * sienta: repartir doscientas sillas entre gente que a lo mejor no viene es la
 * hoja de cálculo que esto viene a sustituir.
 */

/** Cuántas sillas ocupa un invitado. `party` ya se cuenta a sí mismo. */
export function seatsTaken(guest: { status: RsvpStatus | null; party: number | null }): number {
  if (guest.status !== 'attending') return 0;
  return Math.max(1, guest.party ?? 1);
}

export interface SeatedGuest {
  id: string;
  name: string;
  locale: Locale;
  status: RsvpStatus | null;
  party: number | null;
  /** Sillas que ocupa: `party` si viene, cero si no. */
  seats: number;
}

export interface TableRow {
  id: string;
  name: string;
  seats: number;
  position: number;
  guests: SeatedGuest[];
  /** Sillas ocupadas por los que han confirmado. */
  taken: number;
  /** Sentados que a día de hoy NO vienen: se avisa, no se les quita el sitio. */
  ghosts: number;
}

export interface EventSeating {
  eventId: string;
  tables: TableRow[];
  /** Confirmados que todavía no tienen mesa. */
  unseated: SeatedGuest[];
  /** Sillas que hacen falta y sillas que hay, para la cabecera. */
  needed: number;
  available: number;
}

/** El evento, comprobando la oficina. Nulo si no es suya o no existe. */
async function ownedEvent(scope: TenantScope, eventId: string): Promise<string | null> {
  const event = await db(scope).event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  return event?.id ?? null;
}

export async function readSeating(
  scope: TenantScope,
  eventId: string,
): Promise<EventSeating | null> {
  if ((await ownedEvent(scope, eventId)) === null) return null;
  const prisma = db(scope);

  const [tables, guests] = await Promise.all([
    prisma.table.findMany({
      where: { eventId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, seats: true, position: true },
    }),
    prisma.guest.findMany({
      where: { eventId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        locale: true,
        tableId: true,
        rsvp: { select: { status: true, party: true } },
      },
    }),
  ]);

  const seated = new Map<string, SeatedGuest[]>();
  const unseated: SeatedGuest[] = [];
  for (const guest of guests) {
    const row: SeatedGuest = {
      id: guest.id,
      name: guest.name,
      locale: guest.locale,
      status: guest.rsvp?.status ?? null,
      party: guest.rsvp?.party ?? null,
      seats: seatsTaken({ status: guest.rsvp?.status ?? null, party: guest.rsvp?.party ?? null }),
    };
    if (guest.tableId === null) {
      // Solo se echa en falta a quien viene. Los demás no ocupan silla.
      if (row.seats > 0) unseated.push(row);
      continue;
    }
    const list = seated.get(guest.tableId) ?? [];
    list.push(row);
    seated.set(guest.tableId, list);
  }

  const rows = tables.map((table) => {
    const sitting = seated.get(table.id) ?? [];
    return {
      ...table,
      guests: sitting,
      taken: sitting.reduce((total, guest) => total + guest.seats, 0),
      ghosts: sitting.filter((guest) => guest.seats === 0).length,
    };
  });

  return {
    eventId,
    tables: rows,
    unseated,
    needed: rows.reduce((total, table) => total + table.taken, 0) +
      unseated.reduce((total, guest) => total + guest.seats, 0),
    available: rows.reduce((total, table) => total + table.seats, 0),
  };
}

/** El nombre más corto que no choca con otro: «Mesa 1», «Mesa 2»… */
async function nextName(scope: TenantScope, eventId: string, prefix: string): Promise<string> {
  const taken = new Set(
    (await db(scope).table.findMany({ where: { eventId }, select: { name: true } })).map(
      (table) => table.name,
    ),
  );
  for (let number = 1; number <= 500; number += 1) {
    const candidate = `${prefix} ${number}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${prefix} ${Date.now()}`;
}

export type TableOutcome = 'ok' | 'notFound' | 'duplicate';

export async function addTable(
  scope: TenantScope,
  eventId: string,
  name: string,
  seats: number,
  prefix: string,
): Promise<TableOutcome> {
  if ((await ownedEvent(scope, eventId)) === null) return 'notFound';

  const clean = name.trim().slice(0, 60);
  const finalName = clean.length > 0 ? clean : await nextName(scope, eventId, prefix);
  const last = await db(scope).table.findFirst({
    where: { eventId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  try {
    await db(scope).table.create({
      data: {
        eventId,
        name: finalName,
        seats: clampSeats(seats),
        position: (last?.position ?? -1) + 1,
      },
    });
    return 'ok';
  } catch {
    // El único choque posible es el nombre repetido: lo impide la base.
    return 'duplicate';
  }
}

/** Entre una silla y cincuenta. Una mesa de cero no es una mesa. */
export function clampSeats(seats: number): number {
  if (!Number.isFinite(seats)) return 10;
  return Math.min(50, Math.max(1, Math.trunc(seats)));
}

export async function editTable(
  scope: TenantScope,
  eventId: string,
  tableId: string,
  name: string,
  seats: number,
): Promise<TableOutcome> {
  if ((await ownedEvent(scope, eventId)) === null) return 'notFound';

  const clean = name.trim().slice(0, 60);
  try {
    // Por `(id, eventId)`: un id de la boda de otro no encuentra nada.
    const changed = await db(scope).table.updateMany({
      where: { id: tableId, eventId },
      data: { seats: clampSeats(seats), ...(clean.length > 0 ? { name: clean } : {}) },
    });
    return changed.count === 0 ? 'notFound' : 'ok';
  } catch {
    return 'duplicate';
  }
}

/**
 * Quita la mesa. Los invitados se quedan SIN sitio; no se borra a nadie.
 *
 * Las dos escrituras van en UNA transacción, y en este orden: levantar a los
 * sentados y luego quitar la mesa. La clave foránea es compuesta —lleva el
 * evento dentro, que es lo que impide sentar a alguien en la boda de otro— y
 * `ON DELETE SET NULL` sobre una clave compuesta pondría a nulo también
 * `eventId`, que no lo admite. Así que el orden lo pone el código y la clave
 * queda de red: si alguien borrara una mesa con gente sentada por otro camino,
 * la base se lo impide en vez de dejar filas apuntando a nada.
 */
export async function removeTable(
  scope: TenantScope,
  eventId: string,
  tableId: string,
): Promise<TableOutcome> {
  if ((await ownedEvent(scope, eventId)) === null) return 'notFound';
  const prisma = db(scope);

  return prisma.$transaction(async (tx) => {
    await tx.guest.updateMany({ where: { eventId, tableId }, data: { tableId: null } });
    const gone = await tx.table.deleteMany({ where: { id: tableId, eventId } });
    return gone.count === 0 ? 'notFound' : 'ok';
  });
}

/**
 * Sienta a un invitado, o lo levanta con `tableId` vacío.
 *
 * Las dos condiciones van en el WHERE de UNA escritura: el invitado tiene que
 * ser de este evento y la mesa también. Comprobarlo antes y escribir después
 * deja hueco entre las dos cosas, y la base lo comprueba igual —la clave
 * foránea es compuesta— así que hacerlo aquí solo sirve para dar una respuesta
 * en vez de una excepción.
 */
export async function seatGuest(
  scope: TenantScope,
  eventId: string,
  guestId: string,
  tableId: string | null,
): Promise<TableOutcome> {
  if ((await ownedEvent(scope, eventId)) === null) return 'notFound';
  const prisma = db(scope);

  if (tableId !== null) {
    const table = await prisma.table.findFirst({
      where: { id: tableId, eventId },
      select: { id: true },
    });
    if (table === null) return 'notFound';
  }

  const moved = await prisma.guest.updateMany({
    where: { id: guestId, eventId },
    data: { tableId },
  });
  return moved.count === 0 ? 'notFound' : 'ok';
}

/**
 * Reparte de una vez a todos los que están sin sitio.
 *
 * No es un algoritmo listo y no pretende serlo: llena la primera mesa con hueco
 * y pasa a la siguiente, respetando que un grupo NO se parte —quien confirmó
 * por cuatro se sienta con sus cuatro o no se sienta—. Sirve para el primer
 * reparto de doscientas personas, que a mano son doscientos desplegables; a
 * quién se pone al lado de quién lo decide la familia, no el programa, y para
 * eso está mover a uno de mesa después.
 */
export async function autoSeat(scope: TenantScope, eventId: string): Promise<number> {
  const seating = await readSeating(scope, eventId);
  if (seating === null) return 0;

  const room = seating.tables.map((table) => ({ id: table.id, free: table.seats - table.taken }));
  // Los grupos grandes primero: colocados al final no cabrían en ningún hueco.
  const pending = [...seating.unseated].sort((a, b) => b.seats - a.seats);

  const moves: { guestId: string; tableId: string }[] = [];
  for (const guest of pending) {
    const spot = room.find((table) => table.free >= guest.seats);
    if (spot === undefined) continue;
    spot.free -= guest.seats;
    moves.push({ guestId: guest.id, tableId: spot.id });
  }
  if (moves.length === 0) return 0;

  // En una transacción: un reparto a medias por un fallo de red deja al salón
  // con la mitad de la gente sentada y nadie sabiendo cuál mitad.
  const prisma = db(scope);
  await prisma.$transaction(
    moves.map((move) =>
      prisma.guest.updateMany({ where: { id: move.guestId, eventId }, data: { tableId: move.tableId } }),
    ),
  );
  return moves.length;
}

/** Levanta a todo el mundo. El reparto se rehace; los invitados no se tocan. */
export async function clearSeating(scope: TenantScope, eventId: string): Promise<number> {
  if ((await ownedEvent(scope, eventId)) === null) return 0;
  const cleared = await db(scope).guest.updateMany({
    where: { eventId, tableId: { not: null } },
    data: { tableId: null },
  });
  return cleared.count;
}
