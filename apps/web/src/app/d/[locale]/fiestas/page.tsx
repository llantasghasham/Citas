import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { ListingCard } from '@/components/directory/ListingCard';
import { GOVERNORATE_KEYS, isGovernorate } from '@/lib/directory/categories';
import { EVENT_TYPES, isEventType, listPublicListings } from '@/lib/directory/listings';
import { getDirectoryDictionary, isDirectoryLocale, DIRECTORY_LOCALES } from '@citas/core';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ region?: string; tipo?: string }>;
}

const CAJA = 'border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isDirectoryLocale(locale)) return {};
  const copy = getDirectoryDictionary(locale);

  return {
    title: `${copy.listing.browse} · ${copy.meta.title}`,
    description: copy.meta.description,
    alternates: {
      canonical: `/d/${locale}/fiestas`,
      languages: Object.fromEntries([
        ...DIRECTORY_LOCALES.map((one) => [one, `/d/${one}/fiestas`]),
        ['x-default', '/d/ar/fiestas'],
      ]),
    },
  };
}

/** Las bodas y fiestas publicadas. Un GET, sin JavaScript de cliente. */
export default async function ListingsPage({ params, searchParams }: Props) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);
  if (!isDirectoryLocale(locale)) notFound();

  const copy = getDirectoryDictionary(locale);
  const region = raw.region !== undefined && isGovernorate(raw.region) ? raw.region : null;
  const tipo = raw.tipo !== undefined && isEventType(raw.tipo) ? raw.tipo : null;

  const listings = await listPublicListings(locale, {
    ...(region === null ? {} : { governorate: region }),
    ...(tipo === null ? {} : { eventType: tipo }),
  });

  return (
    <>
      <h1 className="text-2xl">{copy.listing.browse}</h1>

      <form method="get" className="flex flex-wrap items-end gap-3 border border-[#ddd6c6] bg-[#fbf6ec] p-4">
        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.listing.eventType}
          <select name="tipo" defaultValue={tipo ?? ''} className={CAJA}>
            <option value="">{copy.search.anyCategory}</option>
            {EVENT_TYPES.map((one) => (
              <option key={one} value={one}>
                {copy.listing.eventTypes[one]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.search.governorate}
          <select name="region" defaultValue={region ?? ''} className={CAJA}>
            <option value="">{copy.search.anyRegion}</option>
            {GOVERNORATE_KEYS.map((one) => (
              <option key={one} value={one}>
                {copy.governorates[one]}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" className="bg-[#8a6c22] px-5 py-2 text-sm text-[#fbf6ec] hover:opacity-90">
          {copy.search.submit}
        </button>
      </form>

      <p className="text-sm text-[#6a6456]">
        {copy.search.results.replace('{count}', String(listings.length))}
      </p>

      {listings.length === 0 ? (
        <p className="text-sm text-[#6a6456]">{copy.listing.empty}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((one) => (
            <ListingCard key={one.slug} listing={one} locale={locale} copy={copy} />
          ))}
        </ul>
      )}
    </>
  );
}
