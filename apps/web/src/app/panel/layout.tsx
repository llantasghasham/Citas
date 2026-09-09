import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { signOutAction } from '@/app/entrar/actions';
import { setPanelLocaleAction } from '@/app/panel/actions-locale';
import { LOCALE_NAMES } from '@/lib/create/options';
import { LOCALES } from '@/lib/types';
import { getAdminContext } from '@/lib/admin/context';
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

  const links = [
    { href: '/panel', label: nav.events, visible: true },
    { href: '/panel/oficinas', label: nav.offices, visible: sessionCan(session, 'platform:manage') },
    { href: '/panel/equipo', label: nav.team, visible: sessionCan(session, 'tenant:staff') },
    { href: '/panel/facturacion', label: nav.billing, visible: sessionCan(session, 'billing:manage') },
    { href: '/panel/manual', label: nav.manual, visible: true },
    {
      href: '/panel/configuracion',
      label: nav.config,
      visible: sessionCan(session, 'platform:manage'),
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
      <header className="border-b border-[#ddd6c6]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-3 p-6">
          <span className={`${displayFont(locale)} text-xl`}>{tenant?.name ?? 'Citas'}</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="hover:underline">
                {link.label}
              </Link>
            ))}
          </nav>
          {/* Four buttons, no client JavaScript. The choice is the reader's and
              is remembered on their own account, not the office's. */}
          <form action={setPanelLocaleAction} className="flex items-center gap-x-3 ms-auto">
            {LOCALES.map((option) => (
              <button
                key={option}
                type="submit"
                name="locale"
                value={option}
                lang={option}
                aria-current={option === locale ? 'true' : undefined}
                className={
                  option === locale
                    ? 'text-xs text-[#8a6c22] underline underline-offset-4'
                    : 'text-xs text-[#6a6456] hover:text-[#23201a]'
                }
              >
                {LOCALE_NAMES[option]}
              </button>
            ))}
          </form>

          <form action={signOutAction}>
            <button type="submit" className="text-sm underline opacity-70 hover:opacity-100">
              {dictionary.admin.panel.signOut}
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 p-6 sm:p-8">{children}</main>
    </div>
  );
}
