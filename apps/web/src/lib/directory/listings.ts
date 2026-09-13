import { recordAudit } from '@/lib/audit';
import { controlDb } from '@/lib/db/client';
import type { TenantScope } from '@/lib/db/tenant';
import type { DirectoryLocale } from '@citas/core';

import { isDistrictOf, isGovernorate, type GovernorateKey } from './categories';
import { listingSlug } from './slug';

/**
 * La cara pública de una fiesta.
 *
 * Es una COPIA del evento, no una vista de él, y de ahí sale todo lo demás:
 *
 *   · Se ESCRIBE una vez, con lo que alguien decidió publicar. Corregir la boda
 *     privada no cambia lo publicado hasta que alguien lo decide otra vez — que
 *     es lo correcto para una página que ya se indexó y se compartió.
 *   · Despublicar es BORRAR la fila. No hay `where` del que fiarse.
 *   · Desde aquí no se puede llegar a un invitado: no hay clave foránea que
 *     lleve, y `sourceEventId` es un texto que nunca se consulta desde lo
 *     público. `db:check` lo comprueba en cada despliegue.
 */

export type ListingProblem =
  | 'title'
  | 'governorate'
  | 'district'
  | 'city'
  | 'date'
  | 'authorization'
  | 'notFound'
  | 'notDraft'
  | 'exists';

export const DATE_MODES = ['exact', 'month', 'season', 'hidden'] as const;
export type DateMode = (typeof DATE_MODES)[number];

export const CONTACT_MODES = ['none', 'form', 'whatsapp'] as const;
export type ContactMode = (typeof CONTACT_MODES)[number];

/**
 * Los tipos de fiesta, que son los MISMOS del producto (`EventType`).
 *
 * Se escriben otra vez aquí y no se importa el enum de Prisma porque el filtro
 * llega de una dirección: hay que comprobar que lo que viene es uno de estos
 * antes de meterlo en la consulta, y para eso hace falta una lista, no un tipo.
 */
export const EVENT_TYPES = ['wedding', 'graduation', 'birthday', 'baptism', 'memorial'] as const;
export type EventTypeName = (typeof EVENT_TYPES)[number];

export function isEventType(value: string): value is EventTypeName {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

export interface ListingInput {
  title: string;
  description: string;
  locale: string;
  eventType: EventTypeName;
  dateMode: string;
  /** `YYYY-MM-DD`, y solo cuando el modo es exacto. */
  date: string;
  governorate: string;
  district: string;
  city: string;
  venueName: string;
  contactMode: string;
}

function clean(value: string, max: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.find((one) => one === value) ?? fallback;
}

/**
 * Da de alta la publicación de una fiesta, en BORRADOR.
 *
 * La autorización es obligatoria desde el principio y se guarda entera —quién,
 * cuándo y CON QUÉ TEXTO— igual que el permiso para escribir por WhatsApp: un
 * permiso que no se puede enseñar no sirve para defenderse de una queja, que es
 * justo para lo que hace falta. Y la fiesta no es de la oficina.
 */
export async function createListing(
  scope: TenantScope,
  userId: string,
  eventId: string | null,
  input: ListingInput,
  authorization: { by: string; text: string },
): Promise<{ ok: true; id: string; slug: string } | { ok: false; problems: ListingProblem[] }> {
  const problems: ListingProblem[] = [];

  const title = clean(input.title, 140);
  if (title.length < 3) problems.push('title');

  if (!isGovernorate(input.governorate)) problems.push('governorate');
  else if (!isDistrictOf(input.governorate, input.district)) problems.push('district');

  const city = clean(input.city, 80);
  if (city.length < 2) problems.push('city');

  const dateMode = pick(input.dateMode, DATE_MODES, 'month');
  // Una fecha se comprueba contra el CALENDARIO, no contra una expresión: un 30
  // de febrero pasa el patrón y `Date.parse` lo corre al 2 de marzo sin
  // protestar. La base además exige que solo exista cuando el modo es exacto.
  let date: Date | null = null;
  if (dateMode === 'exact') {
    const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date.trim());
    if (parsed === null) problems.push('date');
    else {
      const [year, month, day] = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
      const candidate = new Date(Date.UTC(year, month - 1, day));
      if (
        candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() !== month - 1 ||
        candidate.getUTCDate() !== day
      ) {
        problems.push('date');
      } else {
        date = candidate;
      }
    }
  }

  const texto = authorization.text.trim().slice(0, 2000);
  const quien = authorization.by.trim().slice(0, 140);
  if (texto.length < 10 || quien.length < 2) problems.push('authorization');

  if (problems.length > 0) return { ok: false, problems };

  const prisma = controlDb();

  // Un evento tiene UNA publicación. Dos serían dos páginas de la misma boda
  // compitiendo entre sí en un buscador.
  if (eventId !== null) {
    const yaHay = await prisma.publicListing.findFirst({
      where: { sourceEventId: eventId },
      select: { id: true },
    });
    if (yaHay !== null) return { ok: false, problems: ['exists'] };
  }

  const ocupados = (
    await prisma.publicListing.findMany({ select: { slug: true }, take: 500 })
  ).map((one) => one.slug);

  const created = await prisma.publicListing.create({
    data: {
      slug: listingSlug(title, ocupados),
      locale: input.locale,
      status: 'draft',
      title,
      description: clean(input.description, 4000) || null,
      eventType: input.eventType,
      dateMode,
      date,
      governorate: input.governorate as GovernorateKey,
      district: input.district,
      city,
      venueName: clean(input.venueName, 140) || null,
      contactMode: pick(input.contactMode, CONTACT_MODES, 'none'),
      sourceEventId: eventId,
      tenantId: scope.tenantId,
      authorizedBy: quien,
      authorizedAt: new Date(),
      authorizationText: texto,
    },
    select: { id: true, slug: true },
  });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId: userId,
    action: 'listing.created',
    entity: 'PublicListing',
    entityId: created.id,
    // Qué se publicó y de qué boda salió. NUNCA el texto de la autorización ni
    // el nombre de quien la dio: eso ya está en su fila, y el historial no es
    // una segunda copia de un dato personal.
    metadata: { eventId, dateMode, eventType: input.eventType },
  });

  return { ok: true, id: created.id, slug: created.slug };
}

/** La publicación de un evento, para el panel de la oficina. */
export async function listingForEvent(scope: TenantScope, eventId: string) {
  return controlDb().publicListing.findFirst({
    // El `tenantId` en el WHERE: la publicación de la boda de OTRA oficina no se
    // lee desde aquí aunque se acierte el id del evento.
    where: { sourceEventId: eventId, tenantId: scope.tenantId },
    select: {
      id: true,
      slug: true,
      locale: true,
      status: true,
      title: true,
      description: true,
      eventType: true,
      dateMode: true,
      date: true,
      governorate: true,
      district: true,
      city: true,
      venueName: true,
      contactMode: true,
      submittedAt: true,
      publishedAt: true,
      rejectedNote: true,
      authorizedBy: true,
      authorizedAt: true,
    },
  });
}

/** Mandarla a revisión. Solo desde borrador o rechazada, como un proveedor. */
export async function submitListing(
  scope: TenantScope,
  userId: string,
  listingId: string,
): Promise<{ ok: true } | { ok: false; problems: ListingProblem[] }> {
  const prisma = controlDb();
  const row = await prisma.publicListing.findFirst({
    where: { id: listingId, tenantId: scope.tenantId },
    select: { status: true, authorizedAt: true },
  });
  if (row === null) return { ok: false, problems: ['notFound'] };
  if (row.status !== 'draft' && row.status !== 'rejected') {
    return { ok: false, problems: ['notDraft'] };
  }
  if (row.authorizedAt === null) return { ok: false, problems: ['authorization'] };

  await prisma.publicListing.update({
    where: { id: listingId },
    data: { status: 'pending_review', submittedAt: new Date(), rejectedNote: null },
  });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId: userId,
    action: 'listing.submitted',
    entity: 'PublicListing',
    entityId: listingId,
    metadata: {},
  });
  return { ok: true };
}

/**
 * Despublicar es BORRAR la fila.
 *
 * No es un `status` más: mientras la fila exista, sacarla de la calle depende de
 * que toda consulta pública se acuerde de filtrar. Borrada, no hay nada que
 * filtrar. Y lo que se pierde —el texto que alguien redactó— es una copia: el
 * evento privado sigue entero.
 */
export async function deleteListing(
  scope: TenantScope,
  userId: string,
  listingId: string,
): Promise<{ ok: true } | { ok: false; problems: ListingProblem[] }> {
  const done = await controlDb().publicListing.deleteMany({
    where: { id: listingId, tenantId: scope.tenantId },
  });
  if (done.count === 0) return { ok: false, problems: ['notFound'] };

  await recordAudit({
    tenantId: scope.tenantId,
    actorId: userId,
    action: 'listing.deleted',
    entity: 'PublicListing',
    entityId: listingId,
    metadata: {},
  });
  return { ok: true };
}

// ------------------------------------------------------------------ lo público

export interface PublicListingCard {
  slug: string;
  locale: string;
  title: string;
  description: string | null;
  eventType: string;
  dateMode: string;
  date: Date | null;
  governorate: GovernorateKey;
  district: string;
  city: string;
  venueName: string | null;
  providers: { slug: string; name: string; role: string }[];
}

const TARJETA = {
  slug: true,
  locale: true,
  title: true,
  description: true,
  eventType: true,
  dateMode: true,
  date: true,
  governorate: true,
  district: true,
  city: true,
  venueName: true,
  providers: {
    // Un salón puede no querer salir en la boda de otro. Hasta que lo confirme,
    // no aparece — y el proveedor tiene que estar publicado él mismo.
    where: { approvedByProvider: true, provider: { status: 'approved' as const } },
    select: {
      role: true,
      provider: {
        select: { slug: true, translations: { select: { locale: true, name: true } }, mainLocale: true },
      },
    },
  },
} as const;

type FilaTarjeta = {
  slug: string;
  locale: string;
  title: string;
  description: string | null;
  eventType: string;
  dateMode: string;
  date: Date | null;
  governorate: string;
  district: string;
  city: string;
  venueName: string | null;
  providers: {
    role: string;
    provider: {
      slug: string;
      mainLocale: string;
      translations: { locale: string; name: string }[];
    };
  }[];
};

function toCard(row: FilaTarjeta, locale: DirectoryLocale): PublicListingCard {
  return {
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    description: row.description,
    eventType: row.eventType,
    dateMode: row.dateMode,
    date: row.date,
    governorate: row.governorate as GovernorateKey,
    district: row.district,
    city: row.city,
    venueName: row.venueName,
    providers: row.providers.flatMap((one) => {
      const nombre =
        one.provider.translations.find((t) => t.locale === locale) ??
        one.provider.translations.find((t) => t.locale === one.provider.mainLocale);
      // Sin nombre en ningún idioma no hay a quién enlazar.
      if (nombre === undefined) return [];
      return [{ slug: one.provider.slug, name: nombre.name, role: one.role }];
    }),
  };
}

/** Las fiestas publicadas. Solo lo aprobado, lo más reciente primero. */
export async function listPublicListings(
  locale: DirectoryLocale,
  filters: { governorate?: string; eventType?: string; limit?: number } = {},
): Promise<PublicListingCard[]> {
  const rows = await controlDb().publicListing.findMany({
    where: {
      status: 'approved',
      ...(filters.governorate === undefined
        ? {}
        : { governorate: filters.governorate as GovernorateKey }),
      // Un tipo inventado no filtra: devolvería cero sin decir por qué, y el
      // enlace viejo de un buscador enseñaría una página vacía.
      ...(filters.eventType !== undefined && isEventType(filters.eventType)
        ? { eventType: filters.eventType }
        : {}),
    },
    orderBy: { publishedAt: 'desc' },
    take: Math.min(filters.limit ?? 40, 100),
    select: TARJETA,
  });
  return rows.map((row) => toCard(row, locale));
}

/** Una fiesta por su dirección. `null` si no existe o no está publicada. */
export async function listingBySlug(
  slug: string,
  locale: DirectoryLocale,
): Promise<PublicListingCard | null> {
  const row = await controlDb().publicListing.findFirst({
    where: { slug, status: 'approved' },
    select: TARJETA,
  });
  return row === null ? null : toCard(row, locale);
}

/** Todas las publicadas, para el mapa del sitio. */
export async function approvedListingSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  return controlDb().publicListing.findMany({
    where: { status: 'approved' },
    orderBy: { publishedAt: 'desc' },
    select: { slug: true, updatedAt: true },
  });
}
