import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PanelNotice } from '@/components/directory/PanelNotice';
import { ProviderStatus } from '@/components/directory/ProviderStatus';
import { getSession } from '@/lib/auth/session';
import { listingsForProvider } from '@/lib/directory/listings';
import { currentProviderScope, panelLocale } from '@/lib/directory/session';
import { getDirectoryDictionary } from '@citas/core';

import { setAppearanceAction } from '../actions';

interface Props {
  searchParams: Promise<{ p?: string; error?: string; guardado?: string }>;
}

const BOTON = 'px-4 py-2 text-sm text-[#fbf6ec] hover:opacity-90';

/**
 * Las fiestas donde han apuntado a este negocio.
 *
 * Existe porque el permiso es SUYO. La oficina que organiza la boda dice quién
 * participó; si eso bastara para publicarlo, un salón aparecería en la página de
 * la boda de un cliente sin que nadie se lo preguntara — y hay quien no quiere,
 * por el motivo que sea. Aquí lo decide, y puede retirarlo después.
 */
export default async function ProviderPartiesPage({ searchParams }: Props) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (session === null) redirect('/entrar');

  const locale = panelLocale(undefined, session.locale);
  const copy = getDirectoryDictionary(locale);

  const scope = await currentProviderScope(session.userId, params.p);
  if (scope === null) redirect('/panel/proveedor');

  const invitaciones = await listingsForProvider(scope.providerId);

  return (
    <>
      <h1 className="text-2xl">{copy.listing.invitedTo}</h1>
      <PanelNotice params={params} copy={copy} />
      <p className="text-sm text-[#6a6456]">{copy.listing.invitedHelp}</p>

      {invitaciones.length === 0 ? (
        <p className="text-sm text-[#6a6456]">{copy.listing.noInvitations}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invitaciones.map((one) => (
            <li
              key={one.listingId}
              className="flex flex-col gap-2 border border-[#ddd6c6] bg-white p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-base">{one.title}</span>
                <span className="text-xs text-[#8a6c22]">
                  {copy.listing.eventTypes[one.eventType as 'wedding']}
                </span>
                {/* El estado de la FIESTA, no el suyo: una boda que todavía está
                    en revisión no se ve aunque él ya haya dicho que sí. */}
                <ProviderStatus status={one.listingStatus} copy={copy} />
              </div>

              <span className="text-xs text-[#6a6456]">
                {one.city} · {copy.governorates[one.governorate] ?? one.governorate} ·{' '}
                {copy.categories[one.role] ?? one.role}
              </span>

              {one.approvedByProvider && one.listingStatus === 'approved' && (
                <Link
                  href={`/d/${one.locale}/f/${one.slug}`}
                  className="self-start text-xs underline hover:no-underline"
                >
                  /d/{one.locale}/f/{one.slug}
                </Link>
              )}

              <form action={setAppearanceAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="providerId" value={scope.providerId} />
                <input type="hidden" name="listingId" value={one.listingId} />
                {one.approvedByProvider ? (
                  <button
                    type="submit"
                    name="appear"
                    value="0"
                    className={`${BOTON} bg-[#8a3a22]`}
                  >
                    {copy.listing.dontAppear}
                  </button>
                ) : (
                  <button
                    type="submit"
                    name="appear"
                    value="1"
                    className={`${BOTON} bg-[#2f6b3a]`}
                  >
                    {copy.listing.appear}
                  </button>
                )}
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
