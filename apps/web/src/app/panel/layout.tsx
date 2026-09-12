import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { UserMenu } from '@/components/panel/UserMenu';
import { getAdminContext } from '@/lib/admin/context';
import { loadSite } from '@/lib/home/site';
import { getSession, sessionCan } from '@/lib/auth/session';
import { bodyFont, displayFont } from '@/lib/typography';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The shell every panel screen shares: office language, direction and nav. */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const { dictionary, direction, locale, tenant } = await getAdminContext(
    session.tenantId,
    session.locale,
  );
  const nav = dictionary.admin.nav;
  const site = await loadSite();

  const links = [
    { href: '/panel', label: nav.events, visible: true },
    // Crear vive FUERA de `/panel` —se puede empezar un borrador sin sesión y
    // solo publicar la exige— pero es lo que una oficina entra a hacer, así que
    // tiene que estar en el menú y no solo en un botón dentro de la lista de
    // eventos. Sin esto, quien llegaba a `/crear` por el botón se quedaba sin
    // cabecera y sin manera de volver que no fuera el botón de atrás.
    { href: '/crear', label: nav.create, visible: sessionCan(session, 'event:write') },
    { href: '/panel/oficinas', label: nav.offices, visible: sessionCan(session, 'platform:manage') },
    { href: '/panel/equipo', label: nav.team, visible: sessionCan(session, 'tenant:staff') },
    { href: '/panel/facturacion', label: nav.billing, visible: sessionCan(session, 'billing:manage') },
    { href: '/panel/manual', label: nav.manual, visible: true },
    {
      // El administrador de una oficina entra a conectar SU WhatsApp; lo demás
      // de esa pantalla no lo ve.
      href: '/panel/configuracion',
      label: nav.config,
      visible: sessionCan(session, 'tenant:manage'),
    },
    // Names the environment variables that are unset, which is a map of the
    // machine's weak spots: the platform's own account only.
    { href: '/panel/sistema', label: nav.system, visible: sessionCan(session, 'platform:manage') },
  ].filter((link) => link.visible);

  return (
    <div
      dir={direction}
      lang={locale}
      className={`${bodyFont(locale)} min-h-[100dvh] bg-[#f4efe6] text-[#23201a]`}
    >
      {/* La cabecera no se imprime. Hay pantallas que se llevan al papel —el
          reparto de las mesas— y el nombre de la oficina con siete enlaces de
          menú ocupa el tercio de arriba de la primera hoja. */}
      <header className="border-b border-[#ddd6c6] print:hidden">
        <div className="mx-auto flex max-w-5xl items-center gap-x-5 p-5 sm:gap-x-6 sm:p-6">
          {/* El sello PEGADO al nombre, y el nombre una sola vez. La oficina
              manda sobre la marca: quien trabaja para una agencia quiere ver el
              nombre de SU agencia, no el de la plataforma.
              `shrink-0` para que el nombre no se parta cuando el menú aprieta. */}
          <span
            className={`${displayFont(locale)} flex shrink-0 items-center gap-2 text-xl`}
          >
            {site.logoUrl === null ? null : (
              // eslint-disable-next-line @next/next/no-img-element -- dirección
              // que escribe el operador, de cualquier origen.
              <img src={site.logoUrl} alt="" referrerPolicy="no-referrer" className="h-7 w-auto" />
            )}
            {tenant?.name ?? site.brand}
          </span>

          {/* Los enlaces se quedan con el hueco que sobra y se parten ELLOS si
              hace falta. Antes toda la fila era `flex-wrap`, así que el menú de
              la cuenta era lo primero que se caía a una segunda línea — y es lo
              que tiene que estar siempre al final, no lo que sobra. */}
          <nav className="flex min-w-0 flex-wrap gap-x-5 gap-y-1.5 text-sm">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="whitespace-nowrap hover:underline">
                {link.label}
              </Link>
            ))}
          </nav>
          {/* El idioma, el perfil y salir son lo mismo —cosas de quien está
              dentro, no del sitio— y van en un solo menú. Sueltos ocupaban
              media cabecera y se caían a una segunda línea en cuanto la
              oficina tenía un nombre largo. */}
          <UserMenu
            email={session.email}
            name={session.name}
            avatarUrl={session.avatarUrl}
            office={tenant?.name ?? null}
            role={session.role}
            locale={locale}
            dictionary={dictionary}
          />
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 p-6 sm:p-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
