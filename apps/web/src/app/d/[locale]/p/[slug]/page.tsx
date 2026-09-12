import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { contactHref } from '@/lib/directory/contacts';
import { providerBySlug } from '@/lib/directory/public';
import { getDirectoryDictionary, isDirectoryLocale, DIRECTORY_LOCALES } from '@citas/core';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isDirectoryLocale(locale)) return {};

  const provider = await providerBySlug(slug, locale);
  // Sin ficha no se inventa un título: la página va a ser un 404 y un 404 con
  // título de negocio es lo que acaba indexado.
  if (provider === null) return {};

  const copy = getDirectoryDictionary(locale);
  const description =
    provider.tagline ?? provider.description ?? `${provider.city}, ${copy.governorates[provider.governorate]}`;

  return {
    title: `${provider.name} · ${provider.city}`,
    description,
    alternates: {
      canonical: `/d/${locale}/p/${slug}`,
      // La MISMA ficha en cinco direcciones. El slug no cambia con el idioma —es
      // estable a propósito—, así que la alternativa es directa.
      languages: Object.fromEntries([
        ...DIRECTORY_LOCALES.map((one) => [one, `/d/${one}/p/${slug}`]),
        ['x-default', `/d/ar/p/${slug}`],
      ]),
    },
  };
}

/** La ficha de un negocio. */
export default async function ProviderPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isDirectoryLocale(locale)) notFound();

  const provider = await providerBySlug(slug, locale);
  // `providerBySlug` ya devuelve nulo para lo que está en revisión, rechazado o
  // suspendido: desde fuera, «todavía no publicado» y «no existe» se contestan
  // igual.
  if (provider === null) notFound();

  const copy = getDirectoryDictionary(locale);

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-xs text-[#8a6c22]">
          {provider.categories.map((category) => copy.categories[category]).join(' · ')}
        </p>
        <h1 className="text-3xl">{provider.name}</h1>
        {provider.tagline !== null && <p className="text-base text-[#4b4638]">{provider.tagline}</p>}

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6a6456]">
          <li>
            {provider.city} · {copy.districts[provider.district]} ·{' '}
            {copy.governorates[provider.governorate]}
          </li>
          {provider.verified && <li className="text-[#2f6b3a]">{copy.provider.verified}</li>}
          {provider.since !== null && (
            <li>{copy.provider.since.replace('{year}', String(provider.since))}</li>
          )}
          {provider.capacity !== null && (
            <li>{copy.provider.capacity.replace('{count}', String(provider.capacity))}</li>
          )}
        </ul>
      </header>

      <section className="flex flex-col gap-2">
        <p className="max-w-2xl whitespace-pre-line text-sm text-[#4b4638]">
          {provider.description ?? copy.provider.noDescription}
        </p>
      </section>

      {provider.services.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">{copy.provider.services}</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {provider.services.map((service) => (
              <li key={service} className="border border-[#ddd6c6] bg-white px-3 py-1">
                {service}
              </li>
            ))}
          </ul>
        </section>
      )}

      {provider.contacts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">{copy.provider.contact}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {provider.contacts.map((contact) => {
              const href = contactHref(contact.channel, contact.value);
              const label = copy.channels[contact.channel as keyof typeof copy.channels] ?? contact.channel;
              return (
                <li key={contact.channel} className="flex flex-wrap gap-x-2">
                  <span className="text-xs text-[#6a6456]">{label}</span>
                  {href === null ? (
                    <span>{contact.value}</span>
                  ) : (
                    // `noreferrer` a propósito: abrir la ficha de un salón no le
                    // cuenta a ese salón desde qué página se llegó.
                    <a
                      href={href}
                      rel="nofollow noopener noreferrer"
                      className="underline hover:no-underline"
                    >
                      {contact.value}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {provider.video !== null && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">{copy.provider.video}</h2>
          {/* Un ENLACE, no un marco incrustado. Meter el reproductor de YouTube
              en la página le entrega a Google la dirección IP de todo el que
              abre la ficha, aunque no le dé al play — es la misma razón por la
              que la foto de perfil no se dibuja desde fuera. */}
          <a
            href={provider.video}
            rel="nofollow noopener noreferrer"
            className="self-start underline hover:no-underline"
          >
            {provider.video}
          </a>
        </section>
      )}

      {provider.addressPublic !== null && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">{copy.provider.location}</h2>
          <p className="text-sm text-[#4b4638]">{provider.addressPublic}</p>
          {provider.lat !== null && provider.lng !== null && (
            <a
              href={`https://www.openstreetmap.org/?mlat=${provider.lat}&mlon=${provider.lng}#map=17/${provider.lat}/${provider.lng}`}
              rel="nofollow noopener noreferrer"
              className="self-start text-sm underline hover:no-underline"
            >
              {provider.addressPublic}
            </a>
          )}
        </section>
      )}

      <nav className="flex flex-wrap gap-x-6 border-t border-[#ddd6c6] pt-4 text-sm">
        <Link href={`/d/${locale}/proveedores`} className="underline hover:no-underline">
          {copy.nav.providers}
        </Link>
        {/* Discreto y presente. Sin un sitio donde decirlo, lo que llega es una
            llamada o nada — y «nada» quiere decir una ficha con un número
            equivocado publicada para siempre. */}
        <Link
          href={`/d/${locale}/p/${slug}/denunciar`}
          className="text-xs text-[#6a6456] underline hover:no-underline"
        >
          {copy.provider.report}
        </Link>
      </nav>
    </article>
  );
}
