import { authorizes } from '@/lib/acts/access';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';

/**
 * Lo que hace falta saber de cada invitado para que la fiesta le sirva: qué
 * come, cómo llega, qué necesita para moverse y si quiere salir en las fotos.
 *
 * ── Por qué las claves son una LISTA CERRADA ──────────────────────────────
 *
 * Porque esto no es un campo más. «Sin gluten», «celíaco», «silla de ruedas»,
 * «no me saquéis en las fotos» son datos de salud y de creencias de personas
 * que NO tienen cuenta aquí, que no han aceptado ningún aviso de privacidad y
 * que lo único que hicieron fue abrir un enlace que les reenviaron por
 * WhatsApp. Un campo libre —«pregunta lo que quieras»— acabaría guardando lo
 * que a nadie se le ocurrió limitar: un diagnóstico, una medicación, el motivo
 * por el que alguien no bebe. Y lo acabaría guardando para siempre, en una base
 * que se exporta a CSV y se manda por correo.
 *
 * Así que se pregunta lo que hace falta para servir una cena y montar un salón,
 * y nada más. Es la misma decisión que la del versículo: una lista fija vale
 * más que un campo libre cuando lo que se guarda no se puede desguardar. Y es
 * hermana de la de `docs/DECISIONES-TOMADAS.md` §5 —ni religión, ni rito, ni
 * denominación en el modelo—: lo que un organizador necesite de más cabe en una
 * nota SUYA, que es suya y no una columna de todos.
 *
 * Añadir una clave es una decisión de producto, no un `if`: se escribe aquí,
 * con su razón, y se traduce en los cuatro idiomas.
 */
export const PREFERENCE_KEYS = ['diet', 'transport', 'accessibility', 'photos'] as const;

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

export function isPreferenceKey(value: string): value is PreferenceKey {
  return (PREFERENCE_KEYS as readonly string[]).includes(value);
}

/**
 * Cuánto puede medir un valor.
 *
 * Corto a propósito: el valor lo elige una pantalla de opciones («sin gluten»,
 * «vegetariano», «autobús»), no lo redacta nadie. El tope es lo que impide que
 * un formulario a mano convierta este campo en el texto libre que la lista
 * cerrada de arriba existe para evitar.
 */
const MAX_VALUE_LENGTH = 80;

export interface PreferenceInput {
  /** Nulo o ausente: vale para toda la celebración. */
  actId?: string | null;
  key: string;
  /** Vacío BORRA: «no contesté» no es un dato que haya que guardar. */
  value: string;
}

export type PreferenceOutcome =
  | { ok: true }
  | { ok: false; reason: 'bad_key' | 'bad_value' | 'not_found' };

export interface PreferenceRow {
  actId: string | null;
  key: PreferenceKey;
  value: string;
  updatedAt: Date;
}

/** El invitado, comprobado contra su evento y su oficina. */
async function guestOf(
  scope: TenantScope,
  eventId: string,
  guestId: string,
): Promise<{ id: string } | null> {
  // El id del invitado viaja en un formulario, así que es un dato del cliente:
  // el evento y la oficina van en el WHERE, no en un `if` de después.
  return db(scope).guest.findFirst({
    where: { id: guestId, eventId, event: scopedWhere(scope) },
    select: { id: true },
  });
}

/**
 * Guardar (o borrar) UNA preferencia.
 *
 * No es un `upsert` y no puede serlo: la clave única es `(guestId, actId, key)`
 * y PostgreSQL considera distintos dos nulos, así que la preferencia GLOBAL
 * —la que vale para toda la celebración— la protege un índice único PARCIAL
 * aparte (`GuestPreference_global_key`, en la migración) que Prisma no sabe
 * usar como identificador. De ahí el intento de actualizar y, si no había nada,
 * crear: y si dos envíos simultáneos crean a la vez, el que pierde contra el
 * índice vuelve a actualizar, que es lo que quería hacer desde el principio.
 */
export async function setPreference(
  scope: TenantScope,
  eventId: string,
  guestId: string,
  input: PreferenceInput,
): Promise<PreferenceOutcome> {
  if (!isPreferenceKey(input.key)) return { ok: false, reason: 'bad_key' };

  const prisma = db(scope);
  const guest = await guestOf(scope, eventId, guestId);
  if (guest === null) return { ok: false, reason: 'not_found' };

  const actId = input.actId === undefined || input.actId === null ? null : input.actId;
  if (actId !== null) {
    const act = await prisma.eventAct.findFirst({
      where: { id: actId, eventId, event: scopedWhere(scope) },
      select: { id: true },
    });
    if (act === null) return { ok: false, reason: 'not_found' };
  }

  const value = input.value.trim().replace(/\s+/g, ' ');
  if (value.length > MAX_VALUE_LENGTH) return { ok: false, reason: 'bad_value' };

  const where = { guestId, eventId, actId, key: input.key };

  if (value.length === 0) {
    // Vaciar es RETIRAR lo dicho, y retirarlo borra la fila. Guardar una cadena
    // vacía dejaría en la base el rastro de que alguna vez se contestó algo
    // sobre la dieta de alguien, que es justo lo que no hay que guardar.
    await prisma.guestPreference.deleteMany({ where });
    return { ok: true };
  }

  const updated = await prisma.guestPreference.updateMany({ where, data: { value } });
  if (updated.count > 0) return { ok: true };

  try {
    await prisma.guestPreference.create({ data: { ...where, value } });
  } catch (error) {
    const again = await prisma.guestPreference.updateMany({ where, data: { value } });
    // Si tampoco hay nada que actualizar, el fallo no fue el índice único y
    // tiene que verse: tragárselo diría «guardado» sin haber guardado nada.
    if (again.count === 0) throw error;
  }
  return { ok: true };
}

/** Todo lo que ha dicho un invitado, para pintarle su formulario. */
export async function readPreferences(
  scope: TenantScope,
  eventId: string,
  guestId: string,
): Promise<PreferenceRow[] | null> {
  const guest = await guestOf(scope, eventId, guestId);
  if (guest === null) return null;

  const rows = await db(scope).guestPreference.findMany({
    where: { guestId, eventId },
    orderBy: [{ key: 'asc' }, { actId: 'asc' }],
    select: { actId: true, key: true, value: true, updatedAt: true },
  });

  // Una clave que ya no está en la lista no se devuelve: si mañana se retira
  // una pregunta, lo contestado deja de contarse aunque la fila siga ahí hasta
  // que alguien la borre.
  return rows
    .filter((row): row is typeof row & { key: PreferenceKey } => isPreferenceKey(row.key))
    .map((row) => ({ actId: row.actId, key: row.key, value: row.value, updatedAt: row.updatedAt }));
}

export interface PreferenceReport {
  key: PreferenceKey;
  /** El acto por el que se pregunta, o nulo para toda la celebración. */
  actId: string | null;
  /** Cuántos invitados entran en el recuento. */
  guests: number;
  /** De esos, cuántos han dicho algo. */
  answered: number;
  /** De más a menos: «12 sin gluten» va antes que «1 sin lactosa». */
  values: { value: string; count: number }[];
}

/**
 * Cuántos de cada valor, para dárselo al catering.
 *
 * Dos decisiones que no son obvias y que cambian el número:
 *
 *   1. **Lo del acto gana sobre lo general.** Quien dijo «vegetariano» para
 *      toda la boda y «sin gluten» para la cena cuenta UNA vez, y en la cena
 *      cuenta como sin gluten. Contar las dos filas daría más comidas que
 *      comensales; ignorar la general dejaría sin cenar a quien solo contestó
 *      una vez.
 *   2. **Con un acto, solo cuenta quien entra a ese acto**, con la misma regla
 *      que decide la agenda y la puerta (`lib/acts/access.ts`). El catering de
 *      la henna no compra para los cuatrocientos de la recepción.
 *
 * Lo que NO hace es filtrar por quién confirmó. Es a propósito: este informe
 * dice qué hay que PREPARAR, y quién viene es otra pregunta que el panel ya
 * contesta por su cuenta. Cruzar las dos aquí, en silencio, daría una cifra que
 * no se parece a ninguna de las dos y que nadie sabría explicar.
 */
export async function preferenceReport(
  scope: TenantScope,
  eventId: string,
  actId: string | null,
  key: string,
): Promise<PreferenceReport | null> {
  if (!isPreferenceKey(key)) return null;

  const prisma = db(scope);
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  if (event === null) return null;

  const act =
    actId === null
      ? null
      : await prisma.eventAct.findFirst({
          where: { id: actId, eventId, event: scopedWhere(scope) },
          select: {
            id: true,
            visibility: true,
            audiences: { select: { segmentId: true, mode: true } },
          },
        });
  if (actId !== null && act === null) return null;

  const [guests, rows] = await Promise.all([
    prisma.guest.findMany({
      where: { eventId, event: scopedWhere(scope) },
      select: {
        id: true,
        segments: { select: { segmentId: true } },
        actInvites: { select: { actId: true, excluded: true } },
      },
    }),
    prisma.guestPreference.findMany({
      // Con acto se traen las dos capas —la suya y la general— y se resuelven
      // abajo; sin acto, solo la general.
      where: {
        eventId,
        key,
        ...(actId === null ? { actId: null } : { OR: [{ actId }, { actId: null }] }),
      },
      select: { guestId: true, actId: true, value: true },
    }),
  ]);

  const general = new Map<string, string>();
  const specific = new Map<string, string>();
  for (const row of rows) {
    if (row.actId === null) general.set(row.guestId, row.value);
    else specific.set(row.guestId, row.value);
  }

  const counts = new Map<string, number>();
  let guestCount = 0;
  let answered = 0;

  for (const guest of guests) {
    if (act !== null) {
      const mine = new Set(guest.segments.map((row) => row.segmentId));
      const invite = guest.actInvites.find((row) => row.actId === act.id);
      if (!authorizes(act, invite, mine)) continue;
    }
    guestCount += 1;

    const value = specific.get(guest.id) ?? general.get(guest.id);
    if (value === undefined) continue;
    answered += 1;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const values = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    // A igualdad de cuenta, por el valor: una lista que cambia de orden en cada
    // recarga no se puede comparar con la que se imprimió ayer.
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return { key, actId, guests: guestCount, answered, values };
}
