import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { signOutAction } from '@/app/entrar/actions';
import { getAdminContext } from '@/lib/admin/context';
import { getSession } from '@/lib/auth/session';
import { bodyFont, displayFont } from '@/lib/typography';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Proves the whole chain: session, office and role, all resolved on the server. */
export default async function PanelPage() {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const { dictionary, direction, locale, tenant } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.panel;

  const rows: { label: string; value: string }[] = [
    { label: copy.signedInAs, value: session.email },
    { label: copy.office, value: tenant?.name ?? copy.noOffice },
    {
      label: copy.role,
      value: session.role === null ? '—' : dictionary.admin.roles[session.role],
    },
  ];

  return (
    <main
      dir={direction}
      lang={locale}
      className={`${bodyFont(locale)} mx-auto flex min-h-[100dvh] max-w-2xl flex-col gap-8 bg-[#f4efe6] p-8`}
    >
      <h1 className={`${displayFont(locale)} text-3xl text-[#23201a]`}>{copy.title}</h1>

      <dl className="flex flex-col border-t border-[#ddd6c6]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-1 border-b border-[#ddd6c6] py-4 sm:flex-row sm:items-baseline sm:gap-6"
          >
            <dt className="text-sm text-[#6a6456] sm:w-40">{row.label}</dt>
            <dd className="text-base text-[#23201a]">{row.value}</dd>
          </div>
        ))}
      </dl>

      <form action={signOutAction}>
        <button
          type="submit"
          className="border border-[#23201a] px-4 py-2 text-sm text-[#23201a] transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a6c22]"
        >
          {copy.signOut}
        </button>
      </form>
    </main>
  );
}
