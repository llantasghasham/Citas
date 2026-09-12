import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { signOutAction } from '@/app/entrar/actions';
import { getSession } from '@/lib/auth/session';
import { directoryDirection, getDirectoryDictionary } from '@citas/core';
import { panelLocale } from '@/lib/directory/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * El panel del proveedor, con su propio armazón.
 *
 * NO cuelga del layout del panel de oficina, y va en un grupo de rutas
 * —`(negocio)`— para conseguirlo sin cambiar la dirección: un grupo no aparece
 * en la URL pero sí corta la cadena de layouts. Un proveedor no es personal de
 * una oficina: no tiene eventos, ni invitados, ni facturación de bodas, y
 * enseñarle esa barra de navegación sería prometerle pantallas a las que no
 * puede entrar.
 *
 * Habla los CINCO idiomas del portal, incluido el francés, que el panel de
 * oficina no habla.
 */
export default async function ProviderPanelLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  // El idioma sale del perfil de quien entra. El `?lang=` lo tapa, y por eso el
  // enlace de cada pantalla lo arrastra.
  const locale = panelLocale(undefined, session.locale);
  const copy = getDirectoryDictionary(locale);

  return (
    <div
      dir={directoryDirection(locale)}
      lang={locale}
      className="flex min-h-[100dvh] flex-col bg-[#f4efe6] text-[#23201a]"
    >
      <header className="border-b border-[#ddd6c6] bg-[#fbf6ec]">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
          <span className="shrink-0 text-lg">{copy.panel.title}</span>

          <nav className="flex min-w-0 flex-wrap gap-x-5 gap-y-1 text-sm">
            <Link href="/panel/proveedor" className="hover:underline">
              {copy.panel.profile}
            </Link>
            <Link href="/panel/proveedor/medios" className="hover:underline">
              {copy.panel.media}
            </Link>
            <Link href="/panel/proveedor/estado" className="hover:underline">
              {copy.panel.state}
            </Link>
          </nav>

          <div className="ms-auto flex gap-x-4 text-xs">
            <Link href={`/d/${locale}`} className="opacity-70 hover:underline">
              {copy.nav.home}
            </Link>
            {/* Salir es una ESCRITURA —borra la fila de la sesión— así que es
                un formulario y no un enlace: un `GET` que cierra sesión lo
                dispara cualquier cosa que precargue enlaces. */}
            <form action={signOutAction}>
              <button type="submit" className="opacity-70 hover:underline">
                {copy.panel.signOut}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 py-8">
        {children}
      </main>
    </div>
  );
}
