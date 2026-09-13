import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  directoryDirection,
  getDirectoryDictionary,
  isDirectoryLocale,
  DIRECTORY_LOCALES,
} from '@citas/core';

/**
 * El armazón del portal público.
 *
 * El idioma sale DEL SEGMENTO de la dirección, nunca de una cookie, y eso no es
 * una preferencia de estilo: es lo que permite una dirección canónica por
 * idioma —que es lo que necesita un buscador— y lo que hace que la respuesta
 * dependa solo de la URL, y por tanto se pueda cachear en el proxy.
 *
 * Aquí NO se lee la sesión. Ni para saludar. Leer la cookie de sesión es lo que
 * convierte una página que todo el mundo comparte en una página distinta para
 * cada visitante.
 */
interface Props {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function DirectoryLayout({ children, params }: Props) {
  const { locale } = await params;
  // Un idioma que no existe es un 404, no un respaldo silencioso: si
  // `/d/de/proveedores` devolviera la página en árabe, un buscador indexaría la
  // misma página bajo infinitas direcciones.
  if (!isDirectoryLocale(locale)) notFound();

  const copy = getDirectoryDictionary(locale);
  const direction = directoryDirection(locale);

  return (
    <div
      dir={direction}
      lang={locale}
      className="flex min-h-[100dvh] flex-col bg-[#f4efe6] text-[#23201a]"
    >
      <header className="border-b border-[#ddd6c6] bg-[#fbf6ec]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 sm:px-6">
          <Link href={`/d/${locale}`} className="shrink-0 text-lg">
            {copy.nav.home}
          </Link>
          <nav className="flex min-w-0 flex-wrap gap-x-5 gap-y-1 text-sm">
            <Link href={`/d/${locale}/fiestas`} className="hover:underline">
              {copy.nav.parties}
            </Link>
            <Link href={`/d/${locale}/proveedores`} className="hover:underline">
              {copy.nav.providers}
            </Link>
            {/* La puerta de entrada de quien viene a PAGAR por estar aquí. Sin
                un enlace visible desde la calle, el directorio solo lo puede
                rellenar quien ya sabe que existe. Lleva a `/entrar` si no hay
                sesión, que es lo correcto: publicar exige cuenta. */}
            <Link href="/panel/proveedor/nuevo" className="hover:underline">
              {copy.panel.newTitle}
            </Link>
          </nav>

          {/* Los cinco idiomas, cada uno a SU dirección. No es un conmutador que
              guarda una cookie: es un enlace, que es lo que un buscador puede
              seguir y lo que hace que compartir la página la comparta en el
              idioma en que se estaba leyendo. */}
          <ul className="ms-auto flex flex-wrap gap-x-3 text-xs">
            {DIRECTORY_LOCALES.map((one) => (
              <li key={one}>
                <Link
                  href={`/d/${one}`}
                  hrefLang={one}
                  className={one === locale ? 'underline' : 'opacity-70 hover:underline'}
                >
                  {one.toUpperCase()}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-5 py-8 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-[#ddd6c6] px-5 py-6 text-xs text-[#6a6456] sm:px-6">
        <p className="mx-auto max-w-5xl">{copy.meta.description}</p>
      </footer>
    </div>
  );
}
