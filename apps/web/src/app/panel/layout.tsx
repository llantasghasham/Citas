import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { PanelHeader } from '@/components/panel/PanelHeader';
import { getAdminContext } from '@/lib/admin/context';
import { getSession } from '@/lib/auth/session';
import { bodyFont } from '@/lib/typography';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The shell every panel screen shares: office language, direction and nav. */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const { direction, locale } = await getAdminContext(session.tenantId, session.locale);

  return (
    <div
      dir={direction}
      lang={locale}
      className={`${bodyFont(locale)} min-h-[100dvh] bg-[#f4efe6] text-[#23201a]`}
    >
      {/* La cabecera vive en su propio componente porque `/crear` también la
          necesita y no cuelga de este layout. Dos copias serían dos menús que un
          día dicen cosas distintas. */}
      <PanelHeader session={session} />

      <main className="mx-auto flex max-w-4xl flex-col gap-8 p-6 sm:p-8 print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}
