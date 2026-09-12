import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { ProviderCard } from '@/components/directory/ProviderCard';
import {
  CATEGORY_GROUPS,
  GOVERNORATES,
  GOVERNORATE_KEYS,
  isCategory,
  isDistrictOf,
  isGovernorate,
  type CategoryGroup,
} from '@/lib/directory/categories';
import { listProviders } from '@/lib/directory/public';
import { getDirectoryDictionary, isDirectoryLocale, DIRECTORY_LOCALES } from '@citas/core';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ categoria?: string; region?: string; distrito?: string; q?: string }>;
}

/**
 * Lo que el visitante pidió, ya limpio.
 *
 * Nada de lo que llega en la dirección se usa sin pasar por aquí. No es
 * paranoia de inyección —Prisma parametriza— sino que una categoría inventada
 * devolvería cero resultados sin decir por qué, y el enlace de un buscador con
 * un parámetro viejo enseñaría una página vacía en vez de la lista entera.
 */
function cleanFilters(raw: {
  categoria?: string;
  region?: string;
  distrito?: string;
  q?: string;
}) {
  const category = raw.categoria !== undefined && isCategory(raw.categoria) ? raw.categoria : null;
  const governorate =
    raw.region !== undefined && isGovernorate(raw.region) ? raw.region : null;
  // Un distrito solo vale DENTRO de su gobernación: «tripoli» con «south» no es
  // una búsqueda, es un enlace mal copiado.
  const district =
    governorate !== null && raw.distrito !== undefined && isDistrictOf(governorate, raw.distrito)
      ? raw.distrito
      : null;
  const query = raw.q === undefined || raw.q.trim().length === 0 ? null : raw.q.trim().slice(0, 80);

  return { category, governorate, district, query };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isDirectoryLocale(locale)) return {};
  const copy = getDirectoryDictionary(locale);

  return {
    title: `${copy.nav.providers} · ${copy.meta.title}`,
    description: copy.meta.description,
    alternates: {
      // La canónica es la lista SIN filtros a propósito: cada combinación de
      // categoría, región y texto es una dirección distinta con casi el mismo
      // contenido, y son miles. Lo que un buscador debe indexar son la portada y
      // las fichas, no el producto cartesiano de las casillas.
      canonical: `/d/${locale}/proveedores`,
      languages: Object.fromEntries([
        ...DIRECTORY_LOCALES.map((one) => [one, `/d/${one}/proveedores`]),
        ['x-default', '/d/ar/proveedores'],
      ]),
    },
  };
}

/** El listado, con sus casillas. Sin JavaScript de cliente: es un GET. */
export default async function ProvidersPage({ params, searchParams }: Props) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);
  if (!isDirectoryLocale(locale)) notFound();

  const copy = getDirectoryDictionary(locale);
  const filters = cleanFilters(raw);

  const providers = await listProviders(locale, {
    ...(filters.category === null ? {} : { category: filters.category }),
    ...(filters.governorate === null ? {} : { governorate: filters.governorate }),
    ...(filters.district === null ? {} : { district: filters.district }),
    ...(filters.query === null ? {} : { query: filters.query }),
  });

  // Los distritos que se ofrecen son los de la gobernación elegida. Sin
  // JavaScript no hay forma de rellenar la segunda casilla al tocar la primera,
  // así que se rellena al recargar: elegir región y pulsar «Buscar» deja la
  // lista de distritos puesta.
  const districts = filters.governorate === null ? [] : GOVERNORATES[filters.governorate];

  return (
    <>
      <h1 className="text-2xl">{copy.nav.providers}</h1>

      <form method="get" className="flex flex-col gap-3 border border-[#ddd6c6] bg-[#fbf6ec] p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
            {copy.search.submit}
            <input
              type="search"
              name="q"
              defaultValue={filters.query ?? ''}
              placeholder={copy.search.placeholder}
              maxLength={80}
              className="border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
            {copy.search.category}
            <select
              name="categoria"
              defaultValue={filters.category ?? ''}
              className="border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]"
            >
              <option value="">{copy.search.anyCategory}</option>
              {(Object.keys(CATEGORY_GROUPS) as CategoryGroup[]).map((group) => (
                <optgroup key={group} label={copy.groups[group]}>
                  {CATEGORY_GROUPS[group].map((category) => (
                    <option key={category} value={category}>
                      {copy.categories[category]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
            {copy.search.governorate}
            <select
              name="region"
              defaultValue={filters.governorate ?? ''}
              className="border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]"
            >
              <option value="">{copy.search.anyRegion}</option>
              {GOVERNORATE_KEYS.map((governorate) => (
                <option key={governorate} value={governorate}>
                  {copy.governorates[governorate]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
            {copy.search.district}
            <select
              name="distrito"
              defaultValue={filters.district ?? ''}
              disabled={districts.length === 0}
              className="border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a] disabled:opacity-50"
            >
              <option value="">{copy.search.anyRegion}</option>
              {districts.map((district) => (
                <option key={district} value={district}>
                  {copy.districts[district]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="submit"
          className="self-start bg-[#8a6c22] px-5 py-2 text-sm text-[#fbf6ec] hover:opacity-90"
        >
          {copy.search.submit}
        </button>
      </form>

      <p className="text-sm text-[#6a6456]">
        {copy.search.results.replace('{count}', String(providers.length))}
      </p>

      {providers.length === 0 ? (
        <p className="text-sm text-[#6a6456]">{copy.search.none}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <ProviderCard key={provider.slug} provider={provider} locale={locale} copy={copy} />
          ))}
        </ul>
      )}
    </>
  );
}
