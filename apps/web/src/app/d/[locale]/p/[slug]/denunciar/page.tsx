import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { providerBySlug } from '@/lib/directory/public';
import { REPORT_REASONS } from '@/lib/directory/reports';
import { getDirectoryDictionary, isDirectoryLocale } from '@citas/core';

import { fileReportAction } from './actions';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ gracias?: string; error?: string; foto?: string }>;
}

/**
 * Un formulario de denuncia NO se indexa. No tiene contenido que buscar y sí
 * tiene el nombre de un negocio al lado de la palabra «denunciar», que es
 * exactamente lo que no debe salir en un buscador.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const CAJA = 'w-full border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]';

/** Denunciar una ficha. Público y sin cuenta, como el resto del portal. */
export default async function ReportPage({ params, searchParams }: Props) {
  const [{ locale, slug }, query] = await Promise.all([params, searchParams]);
  if (!isDirectoryLocale(locale)) notFound();

  const provider = await providerBySlug(slug, locale);
  // No se puede denunciar lo que no está publicado — ni averiguar por aquí si
  // existe.
  if (provider === null) notFound();

  const copy = getDirectoryDictionary(locale);

  if (query.gracias !== undefined) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl">{copy.report.title}</h1>
        <p className="border border-[#2f6b3a] bg-[#eef6ef] px-4 py-3 text-sm text-[#2f6b3a]">
          {copy.report.thanks}
        </p>
        <Link href={`/d/${locale}/p/${slug}`} className="self-start text-sm underline">
          {provider.name}
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl">{copy.report.title}</h1>
      <p className="text-sm text-[#6a6456]">{provider.name}</p>
      <p className="max-w-2xl text-sm text-[#4b4638]">{copy.report.intro}</p>

      {query.error !== undefined && (
        <p className="border border-[#8a3a22] bg-[#fbeee9] px-4 py-2 text-sm text-[#8a3a22]">
          {query.error === 'tooMany'
            ? copy.report.tooMany
            : query.error === 'email'
              ? copy.report.emailRequired
              : query.error}
        </p>
      )}

      <form action={fileReportAction} className="flex flex-col gap-3 border border-[#ddd6c6] bg-[#fbf6ec] p-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="slug" value={slug} />
        {/* Cuando se llega desde una foto concreta. El servicio comprueba que
            esa foto sea de ESTA ficha: un id de otro negocio no tumba nada. */}
        {query.foto !== undefined && <input type="hidden" name="mediaId" value={query.foto} />}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs text-[#6a6456]">{copy.report.reason}</legend>
          {REPORT_REASONS.map((reason, index) => (
            <label key={reason} className="flex items-start gap-2 text-sm">
              <input type="radio" name="reason" value={reason} required defaultChecked={index === 0} />
              {copy.report.reasons[reason]}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.report.message}
          <textarea name="message" rows={4} maxLength={2000} className={CAJA} />
        </label>

        <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {copy.report.email}
          <input type="email" name="reporterEmail" maxLength={200} dir="ltr" className={CAJA} />
          {/* Obligatorio SOLO en la de derechos, y se dice aquí para que no
              parezca que se pide siempre: quien avisa de un número equivocado no
              tiene por qué dejar su correo. */}
          <span className="opacity-70">{copy.report.emailRequired}</span>
        </label>

        <button
          type="submit"
          className="self-start bg-[#8a6c22] px-5 py-2 text-sm text-[#fbf6ec] hover:opacity-90"
        >
          {copy.report.submit}
        </button>
      </form>
    </section>
  );
}
