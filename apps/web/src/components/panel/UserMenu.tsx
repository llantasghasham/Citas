import Link from 'next/link';

import { signOutAction } from '@/app/entrar/actions';
import { setPanelLocaleAction } from '@/app/panel/actions-locale';
import { Avatar } from '@/components/panel/profile/Avatar';
import { LOCALE_NAMES } from '@/lib/create/options';
import { LOCALES, type Dictionary, type Locale } from '@/lib/types';
import type { Role } from '@/generated/prisma/enums';

/**
 * La cuenta, en un solo sitio.
 *
 * Antes eran tres cosas sueltas en la cabecera —el idioma, la foto y «Salir»—
 * y en cuanto la oficina tenía un nombre largo se caían a una segunda línea.
 * Peor que feo: «Salir» suelto y subrayado, al lado de los enlaces de
 * navegación, se pulsa sin querer.
 *
 * Van juntas porque son lo mismo: cosas de QUIEN está dentro, no del sitio. Es
 * la esquina que cualquiera busca cuando quiere cambiar algo suyo o irse.
 *
 * Se abre con `<details>`, un desplegable de verdad del navegador: sin
 * JavaScript de cliente, como el resto del proyecto, y con teclado y lector de
 * pantalla funcionando sin escribir una línea para ello.
 */
export function UserMenu({
  email,
  name,
  avatarUrl,
  office,
  role,
  locale,
  dictionary,
}: {
  email: string;
  name: string | null;
  avatarUrl: string | null;
  /** La oficina en la que se está trabajando ahora mismo. */
  office: string | null;
  role: Role | null;
  locale: Locale;
  dictionary: Dictionary;
}) {
  const copy = dictionary.admin.panel;
  const shown = name ?? email;

  return (
    <details className="relative ms-auto">
      <summary
        aria-label={shown}
        className="flex cursor-pointer list-none items-center gap-2 py-1 text-[#6a6456] hover:text-[#23201a]"
      >
        <Avatar src={avatarUrl} name={shown} size={30} />
        {/* El nombre desaparece en pantallas estrechas y queda la foto: en un
            teléfono, la cabecera no tiene sitio para las dos cosas. */}
        <span className="hidden max-w-32 truncate text-sm sm:inline">{shown}</span>
        <Chevron />
      </summary>

      {/* Colgado del borde de FIN, que en árabe es el izquierdo: `end-0` lo
          resuelve solo en las dos direcciones. */}
      <div className="absolute end-0 z-30 mt-2 flex min-w-56 flex-col border border-[#ddd6c6] bg-[#f4efe6] py-1 shadow-[0_8px_24px_-12px_rgba(35,32,26,0.5)]">
        {/* Con qué cuenta se está trabajando. En un sistema donde la misma
            persona entra como la oficina y como la plataforma, verlo evita
            configurar la agencia equivocada. */}
        <div className="flex flex-col gap-0.5 border-b border-[#ddd6c6] px-4 pb-3 pt-2">
          {name === null ? null : <span className="text-sm">{name}</span>}
          <span className="truncate font-mono text-xs text-[#6a6456]" dir="ltr">
            {email}
          </span>
          <span className="text-xs text-[#6a6456]">
            {office ?? copy.noOffice}
            {role === null ? '' : ` · ${dictionary.admin.roles[role]}`}
          </span>
        </div>

        <Link
          href="/panel/perfil"
          className="px-4 py-2 text-sm text-[#23201a] hover:bg-[#e9e2d3]"
        >
          {dictionary.admin.nav.profile}
        </Link>

        <form
          action={setPanelLocaleAction}
          className="flex flex-col border-t border-[#ddd6c6] pt-1"
        >
          <span className="flex items-center gap-2 px-4 pb-1 pt-1 text-xs text-[#6a6456]">
            <Globe />
            {copy.language}
          </span>
          {LOCALES.map((option) => (
            <button
              key={option}
              type="submit"
              name="locale"
              value={option}
              lang={option}
              aria-current={option === locale ? 'true' : undefined}
              className={`px-4 py-2 text-start text-sm hover:bg-[#e9e2d3] ${
                option === locale ? 'text-[#8a6c22]' : 'text-[#23201a]'
              }`}
            >
              {LOCALE_NAMES[option]}
            </button>
          ))}
        </form>

        <form action={signOutAction} className="border-t border-[#ddd6c6] pt-1">
          <button
            type="submit"
            className="w-full px-4 py-2 text-start text-sm text-[#8c2f1e] hover:bg-[#e9e2d3]"
          >
            {copy.signOut}
          </button>
        </form>
      </div>
    </details>
  );
}

/** La punta de flecha que dice «esto se abre». Dos trazos, sin fuente de iconos. */
function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Un mundo, para que la sección del idioma se reconozca de un vistazo. */
function Globe() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  );
}
