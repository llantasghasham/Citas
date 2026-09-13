import type { PublicProvider } from '@/lib/directory/public';
import type { DirectoryDictionary } from '@citas/core';

/**
 * Los datos estructurados de una ficha, para que un buscador entienda que esto
 * es un negocio y no un artículo.
 *
 * Solo para lo APROBADO y VERIFICADO. Aprobado quiere decir «no es spam»;
 * verificado quiere decir que alguien comprobó que el negocio existe y es de
 * quien dice. Decirle a Google que un negocio existe, con su dirección y su
 * teléfono, es afirmar algo — y afirmarlo de lo que nadie ha mirado es cómo se
 * acaba dando de alta un negocio inventado en el mapa de medio mundo.
 *
 * SIN `aggregateRating`. No hay reseñas en este producto, y unas estrellas
 * inventadas son a la vez una mentira y una penalización cuando el buscador se
 * da cuenta.
 */
export function ProviderJsonLd({
  provider,
  copy,
  url,
}: {
  provider: PublicProvider;
  copy: DirectoryDictionary;
  url: string;
}) {
  if (!provider.verified) return null;

  const telefono = provider.contacts.find((one) => one.channel === 'phone')?.value;
  const correo = provider.contacts.find((one) => one.channel === 'email')?.value;
  const web = provider.contacts.find((one) => one.channel === 'website')?.value;

  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: provider.name,
    ...(provider.description === null ? {} : { description: provider.description }),
    url,
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'LB',
      addressRegion: copy.governorates[provider.governorate] ?? provider.governorate,
      addressLocality: provider.city,
      // La calle solo si el propio negocio decidió publicarla. Quien hace
      // pasteles en su cocina no publica dónde vive, y esto no lo puede deshacer.
      ...(provider.addressPublic === null ? {} : { streetAddress: provider.addressPublic }),
    },
    ...(provider.lat === null || provider.lng === null
      ? {}
      : { geo: { '@type': 'GeoCoordinates', latitude: provider.lat, longitude: provider.lng } }),
    ...(telefono === undefined ? {} : { telephone: telefono }),
    ...(correo === undefined ? {} : { email: correo }),
    ...(web === undefined ? {} : { sameAs: [web] }),
    ...(provider.since === null ? {} : { foundingDate: String(provider.since) }),
  };

  return (
    <script
      type="application/ld+json"
      // `<` escapado: sin eso, un nombre con `</script>` dentro cierra la
      // etiqueta y lo que venga después se ejecuta. El nombre lo escribe el
      // proveedor, así que es texto de fuera.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
