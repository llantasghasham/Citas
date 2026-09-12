import { controlDb } from '@/lib/db/client';
import type { DirectoryLocale } from '@citas/core';

import { CATEGORY_GROUPS, type Category, type GovernorateKey } from './categories';

/**
 * Lo que ve la calle.
 *
 * Cada consulta de aquí lleva `status: 'approved'` en el WHERE, y eso no es una
 * comodidad: un proveedor en `pending_review`, `rejected` o `suspended` NO
 * aparece — ni en un listado, ni en una búsqueda, ni en su propia dirección.
 * Poner el filtro en la capa de datos y no en cada pantalla es lo que hace que
 * una pantalla nueva nazca bien sin que nadie se acuerde.
 *
 * Y no hay ni una consulta que salga de estas tablas: no se puede llegar desde
 * aquí a un invitado, a una confirmación ni a una mesa, porque no hay clave
 * foránea que lleve. `db:check` lo comprueba en cada despliegue.
 */

export interface PublicProvider {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  services: string[];
  categories: Category[];
  primaryCategory: Category | null;
  governorate: GovernorateKey;
  district: string;
  city: string;
  addressPublic: string | null;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  since: number | null;
  verified: boolean;
  contacts: { channel: string; value: string }[];
  media: { id: string; altText: string | null; width: number | null; height: number | null }[];
  video: string | null;
}

/**
 * Lo que se pide de una ficha, escrito UNA vez.
 *
 * El listado y el perfil enseñan lo mismo con distinto detalle, y si cada uno
 * trajera sus columnas, el día que se publique un campo nuevo saldría en una
 * pantalla y no en la otra. Lo que cambia entre las dos es CUÁNTAS filas, no qué
 * columnas.
 */
const FICHA = {
  slug: true,
  governorate: true,
  district: true,
  city: true,
  addressPublic: true,
  lat: true,
  lng: true,
  capacity: true,
  since: true,
  verifiedAt: true,
  mainLocale: true,
  translations: {
    select: { locale: true, name: true, tagline: true, description: true, services: true },
  },
  categories: { select: { category: true, isPrimary: true } },
  contacts: { where: { isPublic: true }, select: { channel: true, value: true } },
  // Las imágenes y el vídeo salen de la MISMA relación y se separan abajo:
  // Prisma no deja pedir dos veces la misma con filtros distintos, y forzar dos
  // consultas por proveedor para eso sería una por cada fila del listado.
  media: {
    where: { status: 'approved' as const },
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      kind: true,
      altText: true,
      width: true,
      height: true,
      externalUrl: true,
    },
  },
} as const;

type FilaFicha = {
  slug: string;
  governorate: string;
  district: string;
  city: string;
  addressPublic: string | null;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  since: number | null;
  verifiedAt: Date | null;
  mainLocale: string;
  translations: {
    locale: string;
    name: string;
    tagline: string | null;
    description: string | null;
    services: string[];
  }[];
  categories: { category: string; isPrimary: boolean }[];
  contacts: { channel: string; value: string }[];
  media: {
    id: string;
    kind: string;
    altText: string | null;
    width: number | null;
    height: number | null;
    externalUrl: string | null;
  }[];
};

/**
 * El nombre en el idioma pedido, y si no lo hay, en el suyo.
 *
 * La misma prioridad que los actos: traducción del idioma → la del idioma
 * principal del negocio → nada. No se traduce solo: lo escribe el proveedor o no
 * está.
 */
function pick<T extends { locale: string }>(
  rows: T[],
  wanted: string,
  fallback: string,
): T | undefined {
  return rows.find((row) => row.locale === wanted) ?? rows.find((row) => row.locale === fallback);
}

/**
 * De fila a ficha. Devuelve `null` cuando no hay nombre en ningún idioma: sin
 * nombre no hay ficha que enseñar, y un cuadro vacío en el listado es peor que
 * una fila de menos.
 */
function toPublic(row: FilaFicha, locale: DirectoryLocale): PublicProvider | null {
  const translation = pick(row.translations, locale, row.mainLocale);
  if (translation === undefined) return null;

  return {
    slug: row.slug,
    name: translation.name,
    tagline: translation.tagline,
    description: translation.description,
    services: translation.services,
    categories: row.categories.map((link) => link.category as Category),
    primaryCategory:
      (row.categories.find((link) => link.isPrimary)?.category as Category | undefined) ?? null,
    governorate: row.governorate as GovernorateKey,
    district: row.district,
    city: row.city,
    addressPublic: row.addressPublic,
    lat: row.lat,
    lng: row.lng,
    capacity: row.capacity,
    since: row.since,
    verified: row.verifiedAt !== null,
    contacts: row.contacts,
    media: row.media
      .filter((item) => item.kind === 'image')
      .map((item) => ({
        id: item.id,
        altText: item.altText,
        width: item.width,
        height: item.height,
      })),
    video: row.media.find((item) => item.kind === 'video')?.externalUrl ?? null,
  };
}

export interface ListFilters {
  category?: string;
  governorate?: string;
  district?: string;
  /** Texto libre: busca en el nombre, el lema y la descripción de CUALQUIER idioma. */
  query?: string;
  limit?: number;
}

/** El listado público: solo lo aprobado, los verificados primero. */
export async function listProviders(
  locale: DirectoryLocale,
  filters: ListFilters = {},
): Promise<PublicProvider[]> {
  const rows = await controlDb().provider.findMany({
    where: {
      status: 'approved',
      ...(filters.governorate === undefined
        ? {}
        : { governorate: filters.governorate as GovernorateKey }),
      ...(filters.district === undefined ? {} : { district: filters.district }),
      ...(filters.category === undefined
        ? {}
        : { categories: { some: { category: filters.category } } }),
      // Busca en TODOS los idiomas de la ficha, no solo en el que se está
      // leyendo: quien escribe «Mtein» en la casilla lo escribe como lo vio en
      // un cartel, no en el idioma en que tiene puesto el navegador.
      ...(filters.query === undefined
        ? {}
        : {
            translations: {
              some: {
                OR: [
                  { name: { contains: filters.query, mode: 'insensitive' as const } },
                  { tagline: { contains: filters.query, mode: 'insensitive' as const } },
                  { description: { contains: filters.query, mode: 'insensitive' as const } },
                ],
              },
            },
          }),
    },
    orderBy: [{ verifiedAt: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }],
    take: Math.min(filters.limit ?? 60, 120),
    select: FICHA,
  });

  return rows.flatMap((row) => {
    const ficha = toPublic(row, locale);
    return ficha === null ? [] : [ficha];
  });
}

/**
 * Una ficha por su dirección. `null` si no existe O si no está aprobada: las dos
 * cosas se contestan igual, porque decir «existe pero está en revisión» es
 * contar algo de un negocio que todavía no ha decidido publicarse.
 */
export async function providerBySlug(
  slug: string,
  locale: DirectoryLocale,
): Promise<PublicProvider | null> {
  const row = await controlDb().provider.findFirst({
    where: { slug, status: 'approved' },
    select: FICHA,
  });
  return row === null ? null : toPublic(row, locale);
}

/** Todas las direcciones publicadas, para el mapa del sitio. */
export async function approvedSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  return controlDb().provider.findMany({
    where: { status: 'approved' },
    orderBy: { publishedAt: 'desc' },
    select: { slug: true, updatedAt: true },
  });
}

/** Cuántos hay aprobados en cada categoría, para no enseñar grupos vacíos. */
export async function categoryCounts(): Promise<Map<string, number>> {
  const rows = await controlDb().providerCategoryLink.groupBy({
    by: ['category'],
    where: { provider: { status: 'approved' } },
    _count: { category: true },
  });
  return new Map(rows.map((row) => [row.category, row._count.category]));
}

/** Cuántos hay en cada gobernación. */
export async function governorateCounts(): Promise<Map<string, number>> {
  const rows = await controlDb().provider.groupBy({
    by: ['governorate'],
    where: { status: 'approved' },
    _count: { governorate: true },
  });
  return new Map(rows.map((row) => [row.governorate, row._count.governorate]));
}

/** Los grupos con las categorías que tienen a alguien. */
export function groupsWithCounts(counts: Map<string, number>): {
  group: keyof typeof CATEGORY_GROUPS;
  categories: { category: Category; count: number }[];
}[] {
  return Object.entries(CATEGORY_GROUPS).map(([group, list]) => ({
    group: group as keyof typeof CATEGORY_GROUPS,
    categories: (list as readonly Category[]).map((category) => ({
      category,
      count: counts.get(category) ?? 0,
    })),
  }));
}
