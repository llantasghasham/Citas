import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { directoryLocaleFrom } from '@/lib/directory/locale';

/**
 * `/d` no es una página: es la puerta.
 *
 * Manda al idioma del navegador y ahí se queda. Se redirige en vez de servir el
 * portal aquí mismo porque una dirección por idioma es lo que un buscador puede
 * indexar y lo que hace que el enlace que alguien copia y pega lleve al idioma
 * en que lo estaba leyendo.
 *
 * La redirección es TEMPORAL —307, la de por defecto— y no permanente: depende
 * de una cabecera, y un 308 se lo guardaría el navegador para siempre. El
 * francés que abrió el portal una vez desde un móvil en árabe no volvería a ver
 * el suyo nunca.
 */
export default async function DirectoryEntry() {
  const requestHeaders = await headers();
  redirect(`/d/${directoryLocaleFrom(requestHeaders.get('accept-language') ?? '')}`);
}
