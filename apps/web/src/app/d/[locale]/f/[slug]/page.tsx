import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { listingWhen } from '@/components/directory/ListingCard';
import { listingBySlug } from '@/lib/directory/listings';
import { getDirectoryDictionary, isDirectoryLocale, DIRECTORY_LOCALES } from '@citas/core';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isDirectoryLocale(locale)) return {};

  const listing = await listingBySlug(slug, locale);
  if (listing === null) return {};

  const copy = getDirectoryDictionary(locale);
  const description = listing.description ?? `${listing.city}, ${copy.governorates[listing.governorate]}`;

  return {
    title: listing.title,
    description,
    alternates: {
      canonical: `/d/${locale}/f/${slug}`,
      languages: Object.fromEntries([
        ...DIRECTORY_LOCALES.map((one) => [one, `/d/${one}/f/${slug}`]),
        ['x-default', `/d/ar/f/${slug}`],
      ]),
    },
    openGraph: { type: 'article', title: listing.title, description, locale },
  };
}

/**
 * Una fiesta publicada.
 *
 * Lo que se ve aquí es la COPIA, y solo la copia: no hay forma de llegar desde
 * esta página a la lista de invitados, a las confirmaciones ni a las mesas de
 * esa boda, porque no hay clave foránea que lleve. `db:check` lo comprueba en
 * cada despliegue.
 */
export default async function ListingPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isDirectoryLocale(locale)) notFound();

  const listing = await listingBySlug(slug, locale);
  // «No publicada» y «no existe» se contestan igual.
  if (listing === null) notFound();

  const copy = getDirectoryDictionary(locale);
  const cuando = listingWhen(listing, locale, copy);

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs text-[#8a6c22]">
          {copy.listing.eventTypes[listing.eventType as 'wedding']}
        </p>
        <h1 className="text-3xl">{listing.title}</h1>
        <p className="text-xs text-[#6a6456]">
          {listing.city} · {copy.districts[listing.district] ?? listing.district} ·{' '}
          {copy.governorates[listing.governorate]}
          {cuando === null ? '' : ` · ${cuando}`}
        </p>
        {listing.venueName !== null && (
          <p className="text-sm text-[#4b4638]">{listing.venueName}</p>
        )}
      </header>

      {listing.description !== null && (
        <p className="max-w-2xl whitespace-pre-line text-sm text-[#4b4638]">
          {listing.description}
        </p>
      )}

      {listing.providers.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">{copy.listing.whoTookPart}</h2>
          {/* Solo los que CONFIRMARON que quieren salir, y solo si su propia
              ficha está publicada. Un salón puede no querer aparecer en la boda
              de otro. */}
          <ul className="flex flex-col gap-1 text-sm">
            {listing.providers.map((one) => (
              <li key={one.slug} className="flex flex-wrap gap-x-2">
                <span className="text-xs text-[#8a6c22]">
                  {copy.categories[one.role] ?? one.role}
                </span>
                <Link href={`/d/${locale}/p/${one.slug}`} className="underline hover:no-underline">
                  {one.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="border-t border-[#ddd6c6] pt-4 text-sm">
        <Link href={`/d/${locale}/fiestas`} className="underline hover:no-underline">
          {copy.listing.browse}
        </Link>
      </nav>
    </article>
  );
}
