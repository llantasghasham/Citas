import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PanelNotice } from '@/components/directory/PanelNotice';
import { getSession, sessionCan } from '@/lib/auth/session';
import { openReports } from '@/lib/directory/reports';
import { panelLocale } from '@/lib/directory/session';
import { actorTimezone } from '@/lib/time/actor';
import { formatDateTime } from '@/lib/time/display';
import { getDirectoryDictionary } from '@citas/core';

import { resolveReportAction } from '../actions';

interface Props {
  searchParams: Promise<{ error?: string; guardado?: string }>;
}

const CAJA = 'w-full border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]';
const BOTON = 'px-4 py-2 text-sm text-[#fbf6ec] hover:opacity-90';

/**
 * Las denuncias abiertas.
 *
 * Lo que se enseña aquí y no en ningún otro sitio: el correo de quien denuncia.
 * Lo ve quien modera porque a una reclamación de derechos hay que poder
 * contestarle, y NO lo ve el proveedor — enseñarle a un negocio quién le
 * denunció es convertir un formulario en una represalia.
 */
export default async function ReportsPage({ searchParams }: Props) {
  const [session, query] = await Promise.all([getSession(), searchParams]);
  if (session === null) redirect('/entrar');
  if (!sessionCan(session, 'directory:moderate')) redirect('/panel');

  const locale = panelLocale(undefined, session.locale);
  const copy = getDirectoryDictionary(locale);
  const fechaLocale = locale === 'fr' ? 'en' : locale;
  const [zone, reports] = await Promise.all([actorTimezone(session), openReports()]);

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-3">
        <Link href="/panel/moderacion" className="text-sm underline">
          {copy.moderation.title}
        </Link>
        <h1 className="text-2xl">{copy.report.title}</h1>
        <span className="text-sm text-[#6a6456]">({reports.length})</span>
      </header>

      <PanelNotice params={query} copy={copy} />

      {reports.length === 0 ? (
        <p className="text-sm text-[#6a6456]">{copy.moderation.empty}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {reports.map((one) => (
            <li
              key={one.id}
              className={`flex flex-col gap-3 border p-4 ${
                one.reason === 'copyright'
                  ? 'border-[#8a3a22] bg-[#fbeee9]'
                  : 'border-[#ddd6c6] bg-white'
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`/panel/moderacion/${one.providerId}`} className="text-base underline">
                  {one.legalName}
                </Link>
                <span className="text-xs text-[#8a6c22]">
                  {copy.report.reasons[one.reason as keyof typeof copy.report.reasons] ?? one.reason}
                </span>
                <span className="text-xs text-[#6a6456]">
                  {formatDateTime(one.createdAt, fechaLocale, zone)}
                </span>
              </div>

              {one.mediaId !== null && (
                // eslint-disable-next-line @next/next/no-img-element -- bytes de
                // este proceso. Se sirve aunque esté oculta: quien modera tiene
                // que poder mirar justo lo que se denunció.
                <img
                  src={`/api/d/media/${one.mediaId}?t=1`}
                  alt=""
                  width={96}
                  height={96}
                  className="h-24 w-24 object-cover"
                />
              )}

              {one.message !== null && (
                <p className="text-sm whitespace-pre-line text-[#4b4638]">{one.message}</p>
              )}

              {one.reporterEmail !== null && (
                <p className="text-xs text-[#6a6456]" dir="ltr">
                  {one.reporterEmail}
                </p>
              )}

              <form action={resolveReportAction} className="flex flex-col gap-2">
                <input type="hidden" name="reportId" value={one.id} />
                <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
                  {copy.moderation.note}
                  <textarea name="note" rows={2} maxLength={1000} className={CAJA} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    name="outcome"
                    value="upheld"
                    className={`${BOTON} bg-[#8a3a22]`}
                  >
                    {copy.moderation.purge}
                  </button>
                  <button
                    type="submit"
                    name="outcome"
                    value="dismissed"
                    className={`${BOTON} bg-[#2f6b3a]`}
                  >
                    {copy.moderation.restore}
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
