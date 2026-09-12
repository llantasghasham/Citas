import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { PanelNotice } from '@/components/directory/PanelNotice';
import { ProviderStatus } from '@/components/directory/ProviderStatus';
import { getSession, sessionCan } from '@/lib/auth/session';
import { contactHref } from '@/lib/directory/contacts';
import { providerForReview } from '@/lib/directory/moderation';
import { panelLocale } from '@/lib/directory/session';
import { actorTimezone } from '@/lib/time/actor';
import { formatDateTime } from '@/lib/time/display';
import { getDirectoryDictionary } from '@citas/core';

import {
  approveAction,
  mediaAction,
  rejectAction,
  restoreAction,
  suspendAction,
  verifyAction,
} from '../actions';

interface Props {
  params: Promise<{ providerId: string }>;
  searchParams: Promise<{ error?: string; guardado?: string }>;
}

const BOTON = 'px-4 py-2 text-sm text-[#fbf6ec] hover:opacity-90';
const SECUNDARIO = 'border border-[#ddd6c6] bg-white px-3 py-1 text-xs hover:bg-[#f4efe6]';
const CAJA = 'w-full border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]';

/**
 * Una ficha, entera, para decidir sobre ella.
 *
 * Se enseña TODO lo que se va a publicar —los textos en cada idioma, las
 * categorías, los contactos y las fotos— porque una decisión tomada sobre un
 * resumen es una decisión tomada sobre otra cosa.
 */
export default async function ModerationDetailPage({ params, searchParams }: Props) {
  const [session, { providerId }, query] = await Promise.all([
    getSession(),
    params,
    searchParams,
  ]);
  if (session === null) redirect('/entrar');
  if (!sessionCan(session, 'directory:moderate')) redirect('/panel');

  const locale = panelLocale(undefined, session.locale);
  const copy = getDirectoryDictionary(locale);
  const fechaLocale = locale === 'fr' ? 'en' : locale;

  const [zone, provider] = await Promise.all([
    actorTimezone(session),
    providerForReview(providerId),
  ]);
  if (provider === null) notFound();

  const oculto = <input type="hidden" name="providerId" value={provider.id} />;

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-3">
        <Link href="/panel/moderacion" className="text-sm underline">
          {copy.moderation.title}
        </Link>
        <h1 className="text-2xl">{provider.legalName}</h1>
        <ProviderStatus status={provider.status} copy={copy} />
        {provider.verifiedAt !== null && (
          <span className="text-xs text-[#2f6b3a]">{copy.provider.verified}</span>
        )}
      </header>

      <PanelNotice params={query} copy={copy} />

      <dl className="grid gap-2 border border-[#ddd6c6] bg-white p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[#6a6456]">{copy.search.governorate}</dt>
          <dd>
            {copy.governorates[provider.governorate] ?? provider.governorate} ·{' '}
            {copy.districts[provider.district] ?? provider.district} · {provider.city}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[#6a6456]">{copy.provider.location}</dt>
          <dd>{provider.addressPublic ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#6a6456]">{copy.provider.capacity.replace('{count} ', '')}</dt>
          <dd>{provider.capacity ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#6a6456]">{copy.panel.categoriesTitle}</dt>
          <dd>
            {provider.categories
              .map((one) => copy.categories[one.category] ?? one.category)
              .join(' · ')}
          </dd>
        </div>
      </dl>

      {/* -------------------------------------------------- lo que se publicaría */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg">{copy.panel.translationsTitle}</h2>
        {provider.translations.length === 0 ? (
          <p className="text-sm text-[#8a3a22]">{copy.panel.errors.name}</p>
        ) : (
          provider.translations.map((one) => (
            <article key={one.locale} className="border border-[#ddd6c6] bg-white p-4">
              <h3 className="text-xs text-[#8a6c22]">{one.locale.toUpperCase()}</h3>
              <p className="text-base">{one.name}</p>
              {one.tagline !== null && <p className="text-sm text-[#4b4638]">{one.tagline}</p>}
              {one.description !== null && (
                <p className="mt-2 text-sm whitespace-pre-line text-[#4b4638]">{one.description}</p>
              )}
              {one.services.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                  {one.services.map((service) => (
                    <li key={service} className="border border-[#ddd6c6] px-2 py-1">
                      {service}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))
        )}
      </section>

      {provider.contacts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">{copy.panel.contactsTitle}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {provider.contacts.map((one) => {
              const href = contactHref(one.channel, one.value);
              return (
                <li key={one.channel} className="flex flex-wrap gap-x-2">
                  <span className="text-xs text-[#6a6456]">
                    {copy.channels[one.channel as keyof typeof copy.channels] ?? one.channel}
                  </span>
                  <span dir="ltr">{one.value}</span>
                  {!one.isPublic && <span className="text-xs text-[#6a6456]">·</span>}
                  {href !== null && one.isPublic && (
                    <a href={href} rel="nofollow noopener noreferrer" className="text-xs underline">
                      {copy.panel.public}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ----------------------------------------------------------- las fotos */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg">{copy.moderation.images}</h2>
        <ul className="flex flex-wrap gap-3">
          {provider.media.map((one) => (
            <li key={one.id} className="w-40 border border-[#ddd6c6] bg-white p-2">
              {one.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- bytes de
                // este proceso; quien modera los ve por la misma ruta que mira
                // el estado.
                <img
                  src={`/api/d/media/${one.id}`}
                  alt={one.altText ?? ''}
                  width={144}
                  height={144}
                  className="h-36 w-full object-cover"
                />
              ) : (
                <a
                  href={one.externalUrl ?? '#'}
                  rel="nofollow noopener noreferrer"
                  className="flex h-36 items-center justify-center bg-[#f4efe6] p-2 text-xs break-all underline"
                >
                  {one.externalUrl}
                </a>
              )}

              <div className="mt-1 flex flex-col gap-1">
                <ProviderStatus status={one.status} copy={copy} />
                {one.hiddenReason !== null && (
                  <span className="text-xs text-[#8a3a22]">{one.hiddenReason}</span>
                )}

                {(['approved', 'rejected', 'hidden'] as const).map((decision) => (
                  <form key={decision} action={mediaAction}>
                    {oculto}
                    <input type="hidden" name="mediaId" value={one.id} />
                    <input type="hidden" name="decision" value={decision} />
                    <button type="submit" className={`${SECUNDARIO} w-full`}>
                      {decision === 'approved'
                        ? copy.moderation.approve
                        : decision === 'rejected'
                          ? copy.moderation.reject
                          : copy.moderation.hide}
                    </button>
                  </form>
                ))}

                <form action={mediaAction}>
                  {oculto}
                  <input type="hidden" name="mediaId" value={one.id} />
                  <input type="hidden" name="decision" value="purge" />
                  <button type="submit" className={`${SECUNDARIO} w-full text-[#8a3a22]`}>
                    {copy.moderation.purge}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[#6a6456]">{copy.moderation.purgeHelp}</p>
      </section>

      {/* -------------------------------------------------------- las decisiones */}
      <section className="flex flex-col gap-4 border border-[#ddd6c6] bg-[#fbf6ec] p-4">
        <h2 className="text-lg">{copy.moderation.review}</h2>

        <div className="flex flex-wrap gap-2">
          <form action={approveAction}>
            {oculto}
            <button type="submit" className={`${BOTON} bg-[#2f6b3a]`}>
              {copy.moderation.approve}
            </button>
          </form>

          {provider.status === 'suspended' && (
            <form action={restoreAction}>
              {oculto}
              <button type="submit" className={`${BOTON} bg-[#8a6c22]`}>
                {copy.moderation.restore}
              </button>
            </form>
          )}

          <form action={verifyAction}>
            {oculto}
            <input type="hidden" name="verified" value={provider.verifiedAt === null ? '1' : '0'} />
            <button type="submit" className={`${BOTON} bg-[#8a6c22]`}>
              {provider.verifiedAt === null ? copy.moderation.verify : copy.moderation.unverify}
            </button>
          </form>
        </div>

        {/* Rechazar y suspender piden MOTIVO, y lo pide también el servicio: sin
            él, el proveedor vuelve a mandar lo mismo y la cola se llena de la
            misma ficha. */}
        <p className="text-xs text-[#6a6456]">{copy.moderation.noteRequired}</p>

        <form action={rejectAction} className="flex flex-col gap-2">
          {oculto}
          <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
            {copy.moderation.note}
            <textarea name="note" rows={2} maxLength={1000} className={CAJA} />
          </label>
          <button type="submit" className={`${BOTON} self-start bg-[#8a3a22]`}>
            {copy.moderation.reject}
          </button>
        </form>

        <form action={suspendAction} className="flex flex-col gap-2">
          {oculto}
          <label className="flex flex-col gap-1 text-xs text-[#6a6456]">
            {copy.moderation.note}
            <textarea name="note" rows={2} maxLength={1000} className={CAJA} />
          </label>
          <button type="submit" className={`${BOTON} self-start bg-[#8a3a22]`}>
            {copy.moderation.suspend}
          </button>
        </form>
      </section>

      {/* ------------------------------------------------------------ el historial */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg">{copy.moderation.history}</h2>
        <ul className="flex flex-col gap-1 text-xs text-[#6a6456]">
          {provider.reviews.map((one, index) => (
            <li key={`${one.createdAt.toISOString()}-${index}`}>
              {formatDateTime(one.createdAt, fechaLocale, zone)} · {one.action}
              {one.note === null ? '' : ` · ${one.note}`}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
