import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { ListingCard } from '@/components/directory/ListingCard';
import { listPublicListings } from '@/lib/directory/listings';
import { categoryCounts, governorateCounts, groupsWithCounts, listProviders } from '@/lib/directory/public';
import { GOVERNORATE_KEYS } from '@/lib/directory/categories';
import { getDirectoryDictionary, isDirectoryLocale, DIRECTORY_LOCALES } from '@citas/core';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isDirectoryLocale(locale)) return {};
  const copy = getDirectoryDictionary(locale);

  return {
    title: copy.meta.title,
    description: copy.meta.description,
    alternates: {
      canonical: `/d/${locale}`,
      // Una dirección por idioma, y el árabe como la de por defecto: es el
      // idioma principal de este producto y el del mercado.
      languages: Object.fromEntries([
        ...DIRECTORY_LOCALES.map((one) => [one, `/d/${one}`]),
        ['x-default', '/d/ar'],
      ]),
    },
  };
}

/** La portada del directorio: por lo que se busca, y por dónde. */
export default async function DirectoryHome({ params }: Props) {
  const { locale } = await params;
  if (!isDirectoryLocale(locale)) notFound();

  const copy = getDirectoryDictionary(locale);
  const [categories, regions, featured, parties] = await Promise.all([
    categoryCounts(),
    governorateCounts(),
    listProviders(locale, { limit: 8 }),
    listPublicListings(locale, { limit: 6 }),
  ]);
  const groups = groupsWithCounts(categories);

  return (
    <>
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl">{copy.home.title}</h1>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.home.subtitle}</p>
      </section>

      {/* Las bodas y fiestas van ARRIBA, antes de las categorías: es lo que
          hace que esto no parezca un listín de teléfonos. Quien entra a
          organizar una boda mira primero cómo quedaron las de otros. */}
      {parties.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-4">
            <h2 className="text-xl">{copy.listing.browse}</h2>
            <Link href={`/d/${locale}/fiestas`} className="text-sm underline">
              {copy.search.submit}
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {parties.map((one) => (
              <ListingCard key={one.slug} listing={one} locale={locale} copy={copy} />
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-xl">{copy.home.browseByCategory}</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group.group} className="flex flex-col gap-2">
              <h3 className="text-sm text-[#8a6c22]">{copy.groups[group.group]}</h3>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {group.categories.map(({ category, count }) => (
                  <li key={category}>
                    <Link
                      href={`/d/${locale}/proveedores?categoria=${category}`}
                      className="hover:underline"
                    >
                      {copy.categories[category]}
                      {count > 0 && <span className="text-xs text-[#6a6456]"> ({count})</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl">{copy.home.browseByRegion}</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {GOVERNORATE_KEYS.map((governorate) => (
            <li key={governorate}>
              <Link
                href={`/d/${locale}/proveedores?region=${governorate}`}
                className="hover:underline"
              >
                {copy.governorates[governorate]}
                {(regions.get(governorate) ?? 0) > 0 && (
                  <span className="text-xs text-[#6a6456]"> ({regions.get(governorate)})</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl">{copy.home.featured}</h2>
        {featured.length === 0 ? (
          <p className="text-sm text-[#6a6456]">{copy.home.empty}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((provider) => (
              <li key={provider.slug} className="border border-[#ddd6c6] bg-white p-4">
                <Link href={`/d/${locale}/p/${provider.slug}`} className="flex flex-col gap-1">
                  <span className="text-base">
                    {provider.name}
                    {provider.verified && (
                      <span className="text-xs text-[#2f6b3a]"> · {copy.provider.verified}</span>
                    )}
                  </span>
                  {provider.primaryCategory !== null && (
                    <span className="text-xs text-[#8a6c22]">
                      {copy.categories[provider.primaryCategory]}
                    </span>
                  )}
                  <span className="text-xs text-[#6a6456]">
                    {provider.city} · {copy.governorates[provider.governorate]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
