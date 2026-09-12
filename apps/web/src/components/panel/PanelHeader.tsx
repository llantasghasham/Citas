import Link from 'next/link';

import { UserMenu } from '@/components/panel/UserMenu';
import { getAdminContext } from '@/lib/admin/context';
import type { AuthenticatedSession } from '@/lib/auth/session';
import { sessionCan } from '@/lib/auth/session';
import { loadSite } from '@/lib/home/site';
import { bodyFont, displayFont } from '@/lib/typography';

/**
 * La cabecera de quien ha entrado: la marca, el menú y la cuenta.
 *
 * Vive en un componente y no dentro del `layout` de `/panel` porque hay una
 * pantalla que la necesita y no está debajo de ese layout: `/crear`. Esa está
 * fuera a propósito —se puede empezar un borrador sin sesión, y lo que la exige
 * es publicar—, pero quien llega con la sesión abierta no tiene por qué notarlo:
 * al abrirla se quedaba sin menú, sin el nombre de su oficina y sin manera de
 * volver, y parecía que el sitio se había acabado.
 *
 * Dos cabeceras distintas habría sido peor que el problema: el día que se añada
 * un enlace al menú, una de las dos se queda atrás y nadie se entera hasta que
 * alguien pregunta por qué el suyo no lo tiene.
 */
export async function PanelHeader({ session }: { session: AuthenticatedSession }) {
  const { dictionary, direction, locale, tenant } = await getAdminContext(
    session.tenantId,
    session.locale,
  );
  const nav = dictionary.admin.nav;
  const site = await loadSite();

  const links = [
    { href: '/panel', label: nav.events, visible: true },
    // Crear vive FUERA de `/panel`, pero es lo que una oficina entra a hacer:
    // tiene que estar en el menú y no solo en un botón dentro de la lista.
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
    /* La cabecera no se imprime. Hay pantallas que se llevan al papel —el
       reparto de las mesas, los códigos de la puerta— y el nombre de la oficina
       con siete enlaces de menú ocupa el tercio de arriba de la primera hoja. */
    /* Lleva su PROPIA dirección y su propio idioma, y no los hereda de la
       página: `/crear` es un formulario que habla el idioma de la INVITACIÓN
       —elegir árabe lo pasa entero a árabe y a RTL— mientras que el menú, el
       nombre de la oficina y la cuenta son de quien está dentro. Una oficina de
       Beirut creando una invitación en inglés tiene que seguir viendo su menú en
       árabe y a la derecha. */
    <header
      dir={direction}
      lang={locale}
      className={`${bodyFont(locale)} border-b border-[#ddd6c6] bg-[#f4efe6] text-[#23201a] print:hidden`}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-x-5 p-5 sm:gap-x-6 sm:p-6">
        {/* El sello PEGADO al nombre, y el nombre una sola vez. La oficina manda
            sobre la marca: quien trabaja para una agencia quiere ver el nombre
            de SU agencia, no el de la plataforma.
            `shrink-0` para que el nombre no se parta cuando el menú aprieta. */}
        <span className={`${displayFont(locale)} flex shrink-0 items-center gap-2 text-xl`}>
          {site.logoUrl === null ? null : (
            // eslint-disable-next-line @next/next/no-img-element -- dirección
            // que escribe el operador, de cualquier origen.
            <img src={site.logoUrl} alt="" referrerPolicy="no-referrer" className="h-7 w-auto" />
          )}
          {tenant?.name ?? site.brand}
        </span>

        {/* Los enlaces se quedan con el hueco que sobra y se parten ELLOS si
            hace falta. Antes toda la fila era `flex-wrap`, así que el menú de la
            cuenta era lo primero que se caía a una segunda línea — y es lo que
            tiene que estar siempre al final, no lo que sobra. */}
        <nav className="flex min-w-0 flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="whitespace-nowrap hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>

        {/* El idioma, el perfil y salir son lo mismo —cosas de quien está
            dentro, no del sitio— y van en un solo menú. Sueltos ocupaban media
            cabecera y se caían a una segunda línea en cuanto la oficina tenía un
            nombre largo. */}
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
  );
}
