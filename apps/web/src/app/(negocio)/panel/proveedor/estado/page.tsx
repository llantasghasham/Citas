import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PanelNotice } from '@/components/directory/PanelNotice';
import { ProviderStatus } from '@/components/directory/ProviderStatus';
import { getSession } from '@/lib/auth/session';
import { readProviderDetail } from '@/lib/directory/service';
import { currentProviderScope, panelLocale } from '@/lib/directory/session';
import { actorTimezone } from '@/lib/time/actor';
import { formatDate } from '@/lib/time/display';
import { getDirectoryDictionary } from '@citas/core';

import { submitForReviewAction } from '../actions';

interface Props {
  searchParams: Promise<{ p?: string; error?: string; enviado?: string }>;
}

/**
 * En qué punto está: borrador, en revisión, publicado o rechazado — y qué toca
 * hacer en cada uno.
 *
 * Es la pantalla que evita la pregunta «¿por qué no sale mi negocio?», que es la
 * que llega por teléfono cuando no existe.
 */
export default async function ProviderStatePage({ searchParams }: Props) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (session === null) redirect('/entrar');

  const locale = panelLocale(undefined, session.locale);
  const copy = getDirectoryDictionary(locale);

  const scope = await currentProviderScope(session.userId, params.p);
  if (scope === null) redirect('/panel/proveedor');

  const provider = await readProviderDetail(scope);
  if (provider === null) redirect('/panel/proveedor');

  // En SU zona. `toISOString()` sería UTC, y para quien administra en Beirut una
  // fecha de la tarde sale con el día cambiado.
  const zone = await actorTimezone(session);

  // Mandar a revisión solo desde borrador o rechazado: volver a mandar algo ya
  // publicado lo sacaría del directorio mientras alguien lo mira otra vez.
  const puedeEnviar = provider.status === 'draft' || provider.status === 'rejected';

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-2xl">{copy.panel.state}</h1>
        <ProviderStatus status={provider.status} copy={copy} />
      </header>

      <PanelNotice params={params} copy={copy} />

      <dl className="flex flex-col gap-2 border border-[#ddd6c6] bg-white p-4 text-sm">
        {provider.submittedAt !== null && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-xs text-[#6a6456]">{copy.panel.statusPending}</dt>
            <dd>
              {copy.panel.reviewClock.replace(
                '{date}',
                // En SU zona y en SU idioma. Un `toISOString()` aquí sería la
                // fecha en UTC, que para quien administra en Beirut puede ser
                // el día anterior.
                formatDate(provider.submittedAt, locale, zone),
              )}
            </dd>
          </div>
        )}
        {provider.publishedAt !== null && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-xs text-[#6a6456]">{copy.panel.statusApproved}</dt>
            <dd>
              {formatDate(provider.publishedAt, locale, zone)}
            </dd>
          </div>
        )}
        {provider.verifiedAt !== null && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-xs text-[#6a6456]">{copy.provider.verified}</dt>
            <dd>
              {formatDate(provider.verifiedAt, locale, zone)}
            </dd>
          </div>
        )}
      </dl>

      {provider.rejectedNote !== null && provider.rejectedNote.length > 0 && (
        <section className="flex flex-col gap-2 border border-[#8a3a22] bg-[#fbeee9] p-4">
          <h2 className="text-sm text-[#8a3a22]">{copy.panel.rejectedNote}</h2>
          <p className="text-sm whitespace-pre-line">{provider.rejectedNote}</p>
        </section>
      )}

      {provider.status === 'approved' && (
        <p className="text-sm">
          <Link href={`/d/${locale}/p/${provider.slug}`} className="underline hover:no-underline">
            /d/{locale}/p/{provider.slug}
          </Link>
        </p>
      )}

      {puedeEnviar && (
        <form
          action={submitForReviewAction}
          className="flex flex-col gap-3 border border-[#ddd6c6] bg-[#fbf6ec] p-4"
        >
          <input type="hidden" name="providerId" value={provider.id} />
          <p className="text-sm text-[#6a6456]">{copy.panel.submitHelp}</p>
          <button
            type="submit"
            className="self-start bg-[#8a6c22] px-5 py-2 text-sm text-[#fbf6ec] hover:opacity-90"
          >
            {copy.panel.submit}
          </button>
        </form>
      )}
    </>
  );
}
