import Link from 'next/link';

import type { PublicListingCard } from '@/lib/directory/listings';
import type { DirectoryDictionary, DirectoryLocale } from '@citas/core';

/**
 * Cómo se dice la fecha de una fiesta publicada.
 *
 * El día exacto solo si quien la publicó lo eligió. Por defecto sale el mes, y
 * la razón es concreta: la fecha exacta de una fiesta que aún no ha ocurrido es
 * una invitación a que aparezca gente que nadie llamó.
 */
export function listingWhen(
  listing: PublicListingCard,
  locale: DirectoryLocale,
  copy: DirectoryDictionary,
): string | null {
  if (listing.date === null) {
    return listing.dateMode === 'hidden' ? null : copy.listing.dateModes[listing.dateMode as 'month'];
  }
  // `Intl` habla los cinco; el francés no está en el `Locale` del producto pero
  // sí en el navegador de cualquiera.
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    listing.date,
  );
}

/** Una fiesta, en un cuadro. La misma en la portada y en el listado. */
export function ListingCard({
  listing,
  locale,
  copy,
}: {
  listing: PublicListingCard;
  locale: DirectoryLocale;
  copy: DirectoryDictionary;
}) {
  const cuando = listingWhen(listing, locale, copy);

  return (
    <li className="border border-[#ddd6c6] bg-white">
      <Link
        href={`/d/${locale}/f/${listing.slug}`}
        className="flex h-full flex-col gap-1 p-4 hover:bg-[#fbf6ec]"
      >
        <span className="text-xs text-[#8a6c22]">
          {copy.listing.eventTypes[listing.eventType as 'wedding']}
        </span>
        <span className="text-base">{listing.title}</span>
        <span className="text-xs text-[#6a6456]">
          {listing.city} · {copy.governorates[listing.governorate]}
          {cuando === null ? '' : ` · ${cuando}`}
        </span>
        {listing.providers.length > 0 && (
          <span className="mt-auto pt-2 text-xs text-[#6a6456]">
            {listing.providers.map((one) => one.name).join(' · ')}
          </span>
        )}
      </Link>
    </li>
  );
}
