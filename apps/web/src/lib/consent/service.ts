import type { ContactChannel, ConsentPurpose } from '@/generated/prisma/enums';
import { recordAudit } from '@/lib/audit';
import { looksLikeEmail, normalizeEmail } from '@/lib/auth/otp';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { toE164 } from '@/lib/guests/phone';

/**
 * El permiso para escribirle a alguien, la baja, y quién decide.
 *
 * Tener un teléfono en una hoja de cálculo no es un permiso, e importar
 * doscientos números de un Excel tampoco. Sin esto, cualquier canal —el de
 * ahora o el oficial del día de mañana— automatiza el mismo problema con mejor
 * letra.
 *
 * La regla vive en UN solo sitio (`mayContactMany`) y todo lo demás la llama,
 * por lo mismo que `authorizes` en `lib/acts/access.ts`: escrita dos veces
 * empieza idéntica y termina diciendo dos cosas distintas, y el único que se
 * entera es el invitado que recibe lo que no había pedido.
 *
 * Falla CERRADO: sin permiso vigente es que NO. Quedarse corto se arregla
 * pidiéndole el permiso a esa persona; pasarse no se arregla — el mensaje ya
 * salió.
 */

export type ContactDecision =
  | { ok: true }
  | { ok: false; reason: 'no_consent' | 'opted_out' | 'bad_contact' };

const ALLOWED: ContactDecision = { ok: true };

/**
 * El contacto tal y como se guarda, o nulo si no vale.
 *
 * El teléfono a E.164 con `toE164`, que es el mismo que normaliza la lista de
 * invitados: si aquí saliera otra cosa, el permiso se guardaría con una forma
 * del número y se preguntaría por otra — que es un «no» silencioso.
 *
 * `defaultCountry` es OPCIONAL y sin él solo se acepta un número ya
 * internacional. Adivinar el país de un `03 456 789` es adivinar a QUIÉN dio el
 * permiso, y un permiso atribuido al número equivocado es peor que ninguno:
 * quien lo tiene no lo dio, y a quien lo dio no se le puede escribir.
 */
export function normalizeContact(
  value: string,
  channel: ContactChannel,
  defaultCountry?: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (channel === 'email') {
    const email = normalizeEmail(trimmed);
    return looksLikeEmail(email) ? email : null;
  }

  // whatsapp y sms son el mismo número, escrito igual.
  if (defaultCountry === undefined || defaultCountry.length === 0) {
    const cleaned = trimmed.replace(/[^\d+]/g, '');
    const withPlus = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
    if (!withPlus.startsWith('+')) return null;
    // Ya lleva país: el que se le pase a `toE164` no lo usa, y así la forma
    // final la decide una sola función.
    return toE164(withPlus, '');
  }
  return toE164(trimmed, defaultCountry);
}

/**
 * Cómo se nombra un contacto en el historial: los últimos cuatro dígitos o el
 * dominio del correo.
 *
 * Basta para reconocerlo al mirar una línea y no repite el dato personal en
 * otra tabla — el `AuditLog` vive en la base del arrendador y lo lee gente que
 * no tiene por qué ver la agenda de una oficina.
 */
export function contactHint(contact: string, channel: ContactChannel): string {
  if (channel === 'email') {
    const at = contact.lastIndexOf('@');
    return at === -1 ? '@?' : contact.slice(at);
  }
  const digits = contact.replace(/\D/g, '');
  return `···${digits.slice(-4)}`;
}

export interface GrantInput {
  channel: ContactChannel;
  purpose: ConsentPurpose;
  contact: string;
  /** De dónde salió: «lista importada», «formulario», «lo dijo por teléfono»… */
  source: string;
  /** Qué texto se le enseñó. Cambiar el texto es un permiso nuevo. */
  textVersion?: string | null;
  /** Quién lo anotó. Nulo cuando lo dio la propia persona. */
  actorId?: string | null;
  defaultCountry?: string;
}

export type GrantResult =
  | { ok: true; id: string; contact: string }
  | { ok: false; reason: 'bad_contact' | 'bad_source' };

/**
 * Anota el permiso. Uno por canal y propósito, así que volver a darlo lo
 * REEMPLAZA en vez de acumular filas.
 *
 * Volver a darlo también levanta una revocación anterior, y eso es a propósito:
 * quien se dio de baja y vuelve a apuntarse puede hacerlo. Lo que NO levanta es
 * una baja (`OptOut`), que vive aparte justamente para sobrevivir a esto.
 */
export async function grantConsent(scope: TenantScope, input: GrantInput): Promise<GrantResult> {
  const contact = normalizeContact(input.contact, input.channel, input.defaultCountry);
  if (contact === null) return { ok: false, reason: 'bad_contact' };

  const source = input.source.trim();
  // Un permiso que no dice de dónde salió no se puede enseñar, y un permiso que
  // no se puede enseñar no sirve para lo único que hace falta: contestar a una
  // queja.
  if (source.length === 0) return { ok: false, reason: 'bad_source' };

  const textVersion = input.textVersion ?? null;
  const actorId = input.actorId ?? null;
  const now = new Date();

  const row = await db(scope).consent.upsert({
    where: {
      tenantId_channel_purpose_contact: {
        tenantId: scope.tenantId,
        channel: input.channel,
        purpose: input.purpose,
        contact,
      },
    },
    create: {
      ...scopedWhere(scope),
      channel: input.channel,
      purpose: input.purpose,
      contact,
      source,
      textVersion,
      actorId,
      grantedAt: now,
    },
    update: { source, textVersion, actorId, grantedAt: now, revokedAt: null },
    select: { id: true },
  });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'consent.grant',
    entity: 'Consent',
    entityId: row.id,
    metadata: {
      channel: input.channel,
      purpose: input.purpose,
      contact: contactHint(contact, input.channel),
      source,
    },
  });

  return { ok: true, id: row.id, contact };
}

export interface RevokeInput {
  channel: ContactChannel;
  purpose: ConsentPurpose;
  contact: string;
  actorId?: string | null;
  defaultCountry?: string;
}

export type RevokeResult =
  | { ok: true; revoked: number }
  | { ok: false; reason: 'bad_contact' };

/**
 * Retira el permiso. No borra la fila: quedarse con la fecha en que se dio y la
 * fecha en que se retiró es lo que permite contar lo que pasó entre las dos.
 *
 * Retirar el permiso NO es darse de baja. Para eso está `optOut`, y la
 * diferencia importa: esto se puede perder en la siguiente importación de la
 * lista, y una baja no.
 */
export async function revokeConsent(
  scope: TenantScope,
  input: RevokeInput,
): Promise<RevokeResult> {
  const contact = normalizeContact(input.contact, input.channel, input.defaultCountry);
  if (contact === null) return { ok: false, reason: 'bad_contact' };

  const actorId = input.actorId ?? null;
  const done = await db(scope).consent.updateMany({
    where: {
      ...scopedWhere(scope),
      channel: input.channel,
      purpose: input.purpose,
      contact,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  if (done.count > 0) {
    await recordAudit({
      tenantId: scope.tenantId,
      actorId,
      action: 'consent.revoke',
      entity: 'Consent',
      entityId: `${input.channel}:${input.purpose}`,
      metadata: {
        channel: input.channel,
        purpose: input.purpose,
        contact: contactHint(contact, input.channel),
      },
    });
  }

  return { ok: true, revoked: done.count };
}

export interface OptOutInput {
  channel: ContactChannel;
  contact: string;
  /** Nulo o ausente = para TODO. Con propósito = solo para eso. */
  purpose?: ConsentPurpose | null;
  reason?: string | null;
  actorId?: string | null;
  defaultCountry?: string;
}

export type OptOutResult = { ok: true; id: string } | { ok: false; reason: 'bad_contact' };

/**
 * La baja. Gana SIEMPRE sobre el permiso, y una baja sin propósito los tapa
 * todos.
 *
 * La escritura es `updateMany` y, si no había fila, `create` — y no un `upsert`
 * de Prisma, porque la clave de esta tabla lleva una columna que puede ser nula
 * y lo que la hace única de verdad son DOS índices parciales de la migración
 * (uno con propósito, otro sin él). El de sin propósito es el que impide que
 * «no me escribas nunca más» se guarde dos veces mientras dos operadores lo
 * anotan a la vez; aquí se atrapa ese choque y se vuelve a escribir sobre la
 * fila que ganó, en vez de reventarle la pantalla a quien llegó segundo.
 */
export async function optOut(scope: TenantScope, input: OptOutInput): Promise<OptOutResult> {
  const contact = normalizeContact(input.contact, input.channel, input.defaultCountry);
  if (contact === null) return { ok: false, reason: 'bad_contact' };

  const purpose = input.purpose ?? null;
  const reason = input.reason ?? null;
  const actorId = input.actorId ?? null;
  const prisma = db(scope);
  const key = { ...scopedWhere(scope), channel: input.channel, contact, purpose };

  // Al segundo intento ya no se perdona: si vuelve a fallar no fue una carrera
  // y el error tiene que salir, no quedarse en un «no se pudo» sin motivo.
  const id = (await writeOptOut(false)) ?? (await writeOptOut(true));
  if (id === null) throw new Error('No se pudo anotar la baja.');

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'consent.optout',
    entity: 'OptOut',
    entityId: id,
    metadata: {
      channel: input.channel,
      purpose: purpose ?? 'all',
      contact: contactHint(contact, input.channel),
      reason,
    },
  });

  return { ok: true, id };

  async function writeOptOut(last: boolean): Promise<string | null> {
    const existing = await prisma.optOut.findFirst({ where: key, select: { id: true } });
    if (existing !== null) {
      await prisma.optOut.update({
        where: { id: existing.id },
        data: { reason, actorId },
      });
      return existing.id;
    }
    try {
      const created = await prisma.optOut.create({
        data: { ...key, reason, actorId },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (last) throw error;
      return null;
    }
  }
}

/**
 * ¿Se le puede escribir a esta persona, por este canal, para esto?
 *
 * Es la función que decide, y el orden no es negociable:
 *
 *   1. Un contacto que no se puede normalizar no se mira contra nada: `bad_contact`.
 *   2. La BAJA gana siempre, y una baja sin propósito tapa todos.
 *   3. Solo entonces cuenta el permiso, y tiene que estar VIGENTE (`revokedAt` nulo).
 *   4. Si nada dice que sí, es que NO.
 */
export async function mayContact(
  scope: TenantScope,
  channel: ContactChannel,
  purpose: ConsentPurpose,
  contact: string,
): Promise<ContactDecision> {
  const decisions = await mayContactMany(scope, channel, purpose, [contact]);
  return decisions.get(contact) ?? { ok: false, reason: 'bad_contact' };
}

/**
 * Lo mismo, en bloque y en un número FIJO de consultas — dos, pase lo que pase.
 *
 * Es la que de verdad se usa: una campaña son cuatrocientos invitados, y
 * preguntar uno por uno son ochocientas consultas para decidir una cosa que se
 * decide con dos listas. El resultado va indexado por el contacto TAL COMO SE
 * PIDIÓ, sin normalizar, para que quien preguntó pueda casar cada respuesta con
 * su invitado sin repetir la normalización por su cuenta.
 */
export async function mayContactMany(
  scope: TenantScope,
  channel: ContactChannel,
  purpose: ConsentPurpose,
  contacts: readonly string[],
): Promise<Map<string, ContactDecision>> {
  const decisions = new Map<string, ContactDecision>();
  const normalized = new Map<string, string>();

  for (const raw of contacts) {
    const contact = normalizeContact(raw, channel);
    if (contact === null) {
      decisions.set(raw, { ok: false, reason: 'bad_contact' });
      continue;
    }
    normalized.set(raw, contact);
  }

  const lookup = [...new Set(normalized.values())];
  if (lookup.length === 0) return decisions;

  const prisma = db(scope);
  const [outs, grants] = await Promise.all([
    prisma.optOut.findMany({
      where: {
        ...scopedWhere(scope),
        channel,
        contact: { in: lookup },
        // Sin propósito tapa todo; con propósito, solo el suyo.
        OR: [{ purpose: null }, { purpose }],
      },
      select: { contact: true },
    }),
    prisma.consent.findMany({
      where: {
        ...scopedWhere(scope),
        channel,
        purpose,
        contact: { in: lookup },
        revokedAt: null,
      },
      select: { contact: true },
    }),
  ]);

  const barred = new Set(outs.map((row) => row.contact));
  const allowed = new Set(grants.map((row) => row.contact));

  for (const [raw, contact] of normalized) {
    if (barred.has(contact)) {
      decisions.set(raw, { ok: false, reason: 'opted_out' });
      continue;
    }
    decisions.set(raw, allowed.has(contact) ? ALLOWED : { ok: false, reason: 'no_consent' });
  }

  return decisions;
}

export interface ConsentSummary {
  channel: ContactChannel;
  purpose: ConsentPurpose;
  /** Los invitados del evento. `allowed + optedOut + missing` suma esto. */
  total: number;
  allowed: number;
  optedOut: number;
  missing: number;
  /**
   * De los que faltan, a cuántos no hay ni por dónde preguntarles: no tienen
   * contacto de este canal. Va aparte porque no se arregla con una llamada de
   * permiso, se arregla consiguiendo el número — son dos trabajos distintos.
   */
  noContact: number;
  /** Hasta 50 de los que faltan, CON NOMBRE. */
  sample: { id: string; name: string }[];
}

const SAMPLE_SIZE = 50;

/**
 * Cuántos invitados de un evento se pueden contactar, cuántos se dieron de baja
 * y a cuántos no se les ha pedido nada.
 *
 * Con NOMBRES y no solo con un número, por la misma razón que los envíos
 * fallidos de WhatsApp: «80 sin permiso» sobre doscientos preocupa y no deja
 * hacer nada, y a esos ochenta hay que pedirles permiso uno a uno.
 *
 * Devuelve nulo si el evento no es de esta oficina — que es lo mismo que si no
 * existiera, porque para esta oficina no existe.
 */
export async function consentSummary(
  scope: TenantScope,
  eventId: string,
  channel: ContactChannel = 'whatsapp',
  purpose: ConsentPurpose = 'invitation',
): Promise<ConsentSummary | null> {
  const prisma = db(scope);
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  if (event === null) return null;

  const guests = await prisma.guest.findMany({
    where: { eventId },
    select: { id: true, name: true, phone: true, email: true },
    orderBy: { name: 'asc' },
  });

  const contactOf = (guest: { phone: string | null; email: string | null }): string =>
    (channel === 'email' ? guest.email : guest.phone) ?? '';

  const decisions = await mayContactMany(
    scope,
    channel,
    purpose,
    guests.map(contactOf).filter((value) => value.length > 0),
  );

  const summary: ConsentSummary = {
    channel,
    purpose,
    total: guests.length,
    allowed: 0,
    optedOut: 0,
    missing: 0,
    noContact: 0,
    sample: [],
  };

  for (const guest of guests) {
    const contact = contactOf(guest);
    const decision =
      contact.length === 0
        ? ({ ok: false, reason: 'bad_contact' } as const)
        : (decisions.get(contact) ?? ({ ok: false, reason: 'bad_contact' } as const));

    if (decision.ok) {
      summary.allowed += 1;
      continue;
    }
    if (decision.reason === 'opted_out') {
      summary.optedOut += 1;
      continue;
    }
    summary.missing += 1;
    if (decision.reason === 'bad_contact') summary.noContact += 1;
    if (summary.sample.length < SAMPLE_SIZE) {
      summary.sample.push({ id: guest.id, name: guest.name });
    }
  }

  return summary;
}
