import Link from 'next/link';

import type { PublicProvider } from '@/lib/directory/public';
import type { DirectoryDictionary, DirectoryLocale } from '@citas/core';

/**
 * Un negocio, en un cuadro.
 *
 * Sale en la portada del directorio y en el listado, y es el mismo archivo en
 * los dos sitios por la misma razón por la que la vista previa de una invitación
 * es el mismo `InvitationCard`: dos cuadros parecidos escritos aparte empiezan
 * iguales y acaban enseñando cosas distintas.
 */
export function ProviderCard({
  provider,
  locale,
  copy,
}: {
  provider: PublicProvider;
  locale: DirectoryLocale;
  copy: DirectoryDictionary;
}) {
  return (
    <li className="border border-[#ddd6c6] bg-white">
      <Link
        href={`/d/${locale}/p/${provider.slug}`}
        className="flex h-full flex-col gap-1 p-4 hover:bg-[#fbf6ec]"
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-base">{provider.name}</span>
          {provider.verified && (
            <span className="text-xs text-[#2f6b3a]">{copy.provider.verified}</span>
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

        {provider.tagline !== null && (
          <span className="mt-1 text-sm text-[#4b4638]">{provider.tagline}</span>
        )}

        {provider.capacity !== null && (
          <span className="mt-auto pt-2 text-xs text-[#6a6456]">
            {copy.provider.capacity.replace('{count}', String(provider.capacity))}
          </span>
        )}
      </Link>
    </li>
  );
}
