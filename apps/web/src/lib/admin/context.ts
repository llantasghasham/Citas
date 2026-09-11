import { headers } from 'next/headers';

import { getSession } from '@/lib/auth/session';
import { getDictionary } from '@/lib/dictionary';
import { getTenantById, getTenantByHost, type CurrentTenant } from '@/lib/tenancy/current';
import { LOCALES, type Dictionary, type Direction, type Locale } from '@/lib/types';
import { setting } from '@/lib/settings';

export interface AdminContext {
  locale: Locale;
  direction: Direction;
  dictionary: Dictionary;
  tenant: CurrentTenant | null;
  host: string;
  ip: string | null;
}

function asLocale(value: string | undefined): Locale {
  return LOCALES.find((candidate) => candidate === value) ?? 'es';
}

/**
 * The host the visitor actually asked for.
 *
 * `host` alone is not reliable: on the requests a Server Action triggers, Next
 * rewrites it to the bare origin and only `x-forwarded-host` still carries the
 * office's subdomain. This header is trusted, which means the origin server must
 * only be reachable through the proxy that sets it — never exposed directly.
 */
export function requestHost(requestHeaders: Headers): string {
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? '';
}

/**
 * La dirección con la que se ESCRIBEN los enlaces que salen de aquí: el de pago
 * de la pareja, el personal del invitado, el aviso que le damos al proveedor.
 *
 * Manda lo configurado en el panel. La cabecera la escribe QUIEN LLAMA, y solo
 * es de fiar si el origen está de verdad detrás del proxy — que es la condición
 * que este proyecto se impone y que un despliegue mal atado rompe sin avisar.
 * Un enlace de pago apuntando a un dominio ajeno es exactamente el correo que
 * le roba el dinero a una pareja.
 *
 * Cuando no hay nada configurado se cae a la cabecera, pero NO a cualquier
 * cabecera: tiene que tener forma de nombre de dominio público, y en producción
 * además tiene que ser un dominio que esta instalación conozca —el suyo o el de
 * una oficina—. Una cabecera inventada deja de escribir enlaces en vez de
 * escribirlos mal, que es la única de las dos que se puede arreglar después.
 */
export async function canonicalOrigin(requestHeaders: Headers): Promise<string> {
  const configured = (await setting('NEXT_PUBLIC_SITE_URL'))?.trim();
  if (configured !== undefined && configured.length > 0) {
    try {
      return new URL(configured).origin;
    } catch {
      // Una dirección mal escrita en el panel no puede dejar sin enlaces al
      // sistema entero: se sigue con la cabecera y se anota.
      console.warn(`[config] NEXT_PUBLIC_SITE_URL no es una dirección válida: ${configured}`);
    }
  }

  const host = requestHost(requestHeaders);
  if (!isPublicHost(host)) {
    throw new Error(
      'No hay una dirección del sitio configurada y la cabecera de la petición no sirve ' +
        'para escribir un enlace. Póngala en /panel/configuracion.',
    );
  }

  if (process.env.NODE_ENV === 'production' && !(await knownHost(host))) {
    throw new Error(
      `La petición llega con el host "${host}", que esta instalación no conoce. ` +
        'Póngale la dirección del sitio en /panel/configuracion.',
    );
  }

  return `https://${host}`;
}

/**
 * Forma de nombre de dominio público: letras, dígitos, guiones y puntos, con
 * una extensión de verdad. Fuera el bucle local, las direcciones IP y el puerto
 * — un enlace que mande a una pareja a `127.0.0.1` no es un enlace.
 */
function isPublicHost(host: string): boolean {
  const bare = host.trim().toLowerCase();
  if (bare.length === 0 || bare.length > 253) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(bare)) return false;
  if (/^\d+(\.\d+)*$/.test(bare)) return false;
  return !bare.endsWith('.localhost') && bare !== 'localhost';
}

/** Si este dominio es el de la instalación o el de alguna de sus oficinas. */
async function knownHost(host: string): Promise<boolean> {
  const bare = host.toLowerCase();
  const configured = (await setting('NEXT_PUBLIC_SITE_URL'))?.trim();
  if (configured !== undefined && configured.length > 0) {
    try {
      const known = new URL(configured).host.toLowerCase();
      if (bare === known || bare.endsWith(`.${known}`)) return true;
    } catch {
      // Ya se anotó arriba.
    }
  }
  return (await getTenantByHost(bare)) !== null;
}

/** First hop in the forwarding chain, which is the client we can name. */
export function clientIp(requestHeaders: Headers): string | null {
  const forwarded = requestHeaders.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() ?? null;
}

/**
 * Staff screens speak the reader's language, falling back to the office's: an
 * office in Beirut sees its panel in Arabic, right to left, exactly like the
 * invitations it produces, and anyone who prefers another language switches it
 * for themselves without changing it for everybody.
 *
 * Once someone is signed in, the office comes from their session and not from
 * the host — an office is part of who you are, and must not change because a
 * header changed. The host only decides which office's sign-in page you land on.
 */
export async function getAdminContext(
  sessionTenantId?: string | null,
  readerLocale?: Locale,
): Promise<AdminContext> {
  const requestHeaders = await headers();
  const host = requestHost(requestHeaders);
  const tenant =
    sessionTenantId === undefined || sessionTenantId === null
      ? await getTenantByHost(host)
      : await getTenantById(sessionTenantId);
  // The person's own choice wins over the office's default. Two colleagues at
  // the same desk can read the panel in different languages, which in Beirut is
  // the normal case and not an edge one.
  //
  // Read from the session here rather than taken from each caller: seven panel
  // pages ask for this context, and one of them forgetting to pass it is a page
  // whose chrome is in Arabic and whose body is in Spanish. `getSession` is
  // cached per request, so asking costs nothing.
  const reader = readerLocale ?? (await getSession())?.locale;
  const locale = reader ?? asLocale(tenant?.defaultLocale);

  return {
    locale,
    direction: locale === 'ar' ? 'rtl' : 'ltr',
    dictionary: getDictionary(locale),
    tenant,
    host,
    ip: clientIp(requestHeaders),
  };
}
