import type { ActType } from '@/generated/prisma/enums';
import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { getDictionary } from '@/lib/dictionary';
import type { Locale } from '@/lib/types';

/**
 * Cómo se llama un acto en el idioma de QUIEN lo lee.
 *
 * Una boda de Beirut tiene invitados que leen árabe y primos que leen inglés, y
 * hasta aquí los dos veían exactamente el mismo texto: `EventAct.label` es UNO,
 * escrito por quien montó la boda. «حفلة الحناء» en la pantalla de alguien que
 * no lee árabe no es una invitación, es un enlace que no dice nada — y al revés,
 * «Henna party» en la de la tía tampoco. `ActTranslation` existía en el esquema
 * desde el principio y no lo leía nadie; esto es enchufarlo.
 *
 * TRADUCIR NO CONCEDE PERMISOS, y conviene que quede escrito donde se escribe
 * el código y no solo en un documento: el idioma es CÓMO se lee un acto, nunca
 * QUIÉN entra en él. Aquí no se decide ni una sola vez si alguien ve un acto —
 * eso lo decide `authorizes` en `lib/acts/access.ts`, y `resolveActNames` recibe
 * una lista que aquella función YA autorizó. Un acto que no esté en esa lista no
 * aparece por tener traducción, y uno traducido a cuatro idiomas no entra en la
 * agenda de nadie que no estuviera invitado.
 *
 * La otra mitad es la de siempre: el `actId` viaja en un campo oculto de un
 * formulario, así que es un dato del cliente. Se resuelve la OFICINA y el EVENTO
 * antes de escribir nada, y un acto de otra boda no encuentra fila — que es lo
 * mismo que responder «no existe».
 */

/** Lo mínimo de un acto para poder nombrarlo. Lo cumplen las tres formas que circulan. */
export interface NameableAct {
  id: string;
  type: ActType;
  label: string | null;
  venueName: string;
  venueAddress: string;
}

/** Una traducción tal y como se guarda, para pintarla en el editor. */
export interface ActTranslationRow {
  locale: Locale;
  label: string;
  description: string | null;
  venueName: string | null;
  venueAddress: string | null;
}

/** Lo que llega del formulario: cuatro campos de texto, sin recortar. */
export interface ActTranslationInput {
  label: string;
  description: string;
  venueName: string;
  venueAddress: string;
}

/**
 * El acto ya escrito en un idioma concreto.
 *
 * `name` sale de la PRIORIDAD de más abajo y nunca es una cadena vacía:
 * siempre hay algo que enseñar. `description` sí puede faltar, porque un
 * `EventAct` no tiene descripción propia — solo la tiene quien la escribió en
 * algún idioma.
 */
export interface ResolvedActName {
  name: string;
  description: string | null;
  venueName: string;
  venueAddress: string;
}

export type SetTranslationResult =
  | { ok: true; action: 'saved' | 'removed' }
  | { ok: false; reason: 'notFound' };

/** Que el acto sea de ESTE evento y el evento de ESTA oficina. Lo primero, siempre. */
async function ownedAct(
  scope: TenantScope,
  eventId: string,
  actId: string,
): Promise<string | null> {
  const act = await db(scope).eventAct.findFirst({
    where: { id: actId, eventId, event: scopedWhere(scope) },
    select: { id: true },
  });
  return act?.id ?? null;
}

/**
 * Las traducciones de UN acto, por idioma.
 *
 * Devuelve `null` cuando el acto no es de este evento o el evento no es de esta
 * oficina: no vacío, que se leería como «no tiene ninguna» y contaría que el
 * acto existe en otro sitio.
 */
export async function readTranslations(
  scope: TenantScope,
  eventId: string,
  actId: string,
): Promise<Map<Locale, ActTranslationRow> | null> {
  if ((await ownedAct(scope, eventId, actId)) === null) return null;

  const rows = await db(scope).actTranslation.findMany({
    where: { actId },
    select: { locale: true, label: true, description: true, venueName: true, venueAddress: true },
  });
  return new Map(rows.map((row) => [row.locale, row]));
}

/**
 * Las de TODOS los actos de un evento, en UNA consulta.
 *
 * El editor pinta ocho actos por cuatro idiomas; preguntando acto por acto eso
 * son ocho consultas para dibujar una pantalla. La forma de una sola fila sigue
 * siendo la de arriba, que es la que se usa cuando de verdad hace falta una.
 */
export async function readEventTranslations(
  scope: TenantScope,
  eventId: string,
): Promise<Map<string, Map<Locale, ActTranslationRow>> | null> {
  const prisma = db(scope);
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  if (event === null) return null;

  const rows = await prisma.actTranslation.findMany({
    where: { act: { eventId, event: scopedWhere(scope) } },
    select: {
      actId: true,
      locale: true,
      label: true,
      description: true,
      venueName: true,
      venueAddress: true,
    },
  });

  const byAct = new Map<string, Map<Locale, ActTranslationRow>>();
  for (const { actId, ...row } of rows) {
    const mine = byAct.get(actId) ?? new Map<Locale, ActTranslationRow>();
    mine.set(row.locale, row);
    byAct.set(actId, mine);
  }
  return byAct;
}

/**
 * Escribe —o borra— la traducción de un acto a un idioma.
 *
 * Un `label` vacío BORRA la fila y no guarda una traducción en blanco. La razón
 * no es de limpieza: `resolveActNames` da prioridad a la traducción sobre el
 * `label` del acto, así que una fila vacía guardada TAPARÍA el nombre bueno y
 * el invitado de ese idioma vería el del tipo — o nada. Borrar es volver a la
 * prioridad de abajo, que es exactamente lo que quiere quien vacía el campo.
 *
 * El resto de campos son opcionales de verdad: vacíos se guardan como nulos y
 * cada uno cae por su cuenta a lo que trae el acto.
 */
export async function setTranslation(
  scope: TenantScope,
  eventId: string,
  actId: string,
  locale: Locale,
  input: ActTranslationInput,
  actorId: string,
): Promise<SetTranslationResult> {
  if ((await ownedAct(scope, eventId, actId)) === null) return { ok: false, reason: 'notFound' };
  const prisma = db(scope);

  const label = input.label.trim();
  const optional = (value: string): string | null => {
    const text = value.trim();
    return text.length === 0 ? null : text;
  };

  if (label.length === 0) {
    await prisma.actTranslation.deleteMany({ where: { actId, locale } });
    // En el historial va QUÉ cambió y en qué idioma, jamás el texto: es
    // contenido de una boda y ya vive en su tabla.
    await recordAudit({
      tenantId: scope.tenantId,
      actorId,
      action: 'act.translation.remove',
      entity: 'ActTranslation',
      entityId: actId,
      metadata: { eventId, locale },
    });
    return { ok: true, action: 'removed' };
  }

  const data = {
    label,
    description: optional(input.description),
    venueName: optional(input.venueName),
    venueAddress: optional(input.venueAddress),
  };
  await prisma.actTranslation.upsert({
    where: { actId_locale: { actId, locale } },
    update: data,
    create: { actId, locale, ...data },
  });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'act.translation.set',
    entity: 'ActTranslation',
    entityId: actId,
    metadata: { eventId, locale },
  });
  return { ok: true, action: 'saved' };
}

/**
 * Los actos ya escritos en un idioma: nombre, descripción y sede.
 *
 * LA PRIORIDAD, y el orden importa:
 *
 *   1. La TRADUCCIÓN a ESE idioma. Es lo que alguien escribió pensando en quien
 *      lee ese idioma, así que manda sobre todo lo demás.
 *   2. El `label` del acto: cómo lo llama ESA familia. Es lo que había antes de
 *      que existieran las traducciones y sigue valiendo para todos los idiomas
 *      que nadie ha escrito.
 *   3. El nombre del TIPO, traducido en el diccionario. Nunca falta, y por eso
 *      `name` nunca sale vacío.
 *
 * Campo a campo y no en bloque: una traducción que solo pone el nombre no borra
 * la sede del acto, la hereda. La sede cae al acto, que es la de verdad; la
 * descripción no cae a ninguna parte porque un `EventAct` no tiene.
 *
 * Y otra vez, porque es lo que más fácil se olvida: esto NO autoriza. Recibe la
 * lista que `agendaFor` o `publicActs` ya decidieron y solo la escribe en un
 * idioma. Traducir no mete a nadie en una henna.
 */
export async function resolveActNames(
  scope: TenantScope,
  acts: readonly NameableAct[],
  locale: Locale,
): Promise<Map<string, ResolvedActName>> {
  const typeNames = getDictionary(locale).actTypes;
  const resolved = new Map<string, ResolvedActName>();
  if (acts.length === 0) return resolved;

  // Los ids salen de la lista ya autorizada, y aun así la consulta lleva la
  // oficina dentro: una fila de otra base no puede entrar por aquí.
  const rows = await db(scope).actTranslation.findMany({
    where: { locale, actId: { in: acts.map((act) => act.id) }, act: { event: scopedWhere(scope) } },
    select: { actId: true, label: true, description: true, venueName: true, venueAddress: true },
  });
  const mine = new Map(rows.map(({ actId, ...row }) => [actId, row]));

  for (const act of acts) {
    const translation = mine.get(act.id);
    const written = translation?.label.trim() ?? '';
    const own = act.label?.trim() ?? '';
    resolved.set(act.id, {
      name: written.length > 0 ? written : own.length > 0 ? own : typeNames[act.type],
      description: translation?.description ?? null,
      venueName: translation?.venueName ?? act.venueName,
      venueAddress: translation?.venueAddress ?? act.venueAddress,
    });
  }
  return resolved;
}
