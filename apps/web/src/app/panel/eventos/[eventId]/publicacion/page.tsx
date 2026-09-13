import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PanelNotice } from '@/components/directory/PanelNotice';
import { ProviderStatus } from '@/components/directory/ProviderStatus';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import {
  CONTACT_MODES,
  DATE_MODES,
  EVENT_TYPES,
  listingForEvent,
} from '@/lib/directory/listings';
import { GOVERNORATES, GOVERNORATE_KEYS } from '@/lib/directory/categories';
import { panelLocale } from '@/lib/directory/session';
import { DIRECTORY_LOCALES, getDirectoryDictionary } from '@citas/core';

import { createListingAction, deleteListingAction, submitListingAction } from './actions';

interface Props {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ error?: string; creado?: string; guardado?: string; enviado?: string }>;
}

const CAJA = 'w-full border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]';
const ETIQUETA = 'flex flex-col gap-1 text-xs text-[#6a6456]';
const BOTON = 'self-start px-5 py-2 text-sm text-[#fbf6ec] hover:opacity-90';

/**
 * Publicar una boda en el directorio.
 *
 * Lo que se escribe aquí es una COPIA: un documento aparte con su texto, su
 * región y su fecha, que alguien redactó y autorizó. Corregir la boda después no
 * cambia lo publicado — que es lo correcto para una página que ya se compartió—,
 * y quitarla de la web BORRA esa copia sin tocar el evento ni sus invitados.
 *
 * La autorización no es un adorno: la fiesta no es de la oficina. Se guarda
 * quién, cuándo y CON QUÉ TEXTO, igual que el permiso para escribir por
 * WhatsApp, porque un permiso que no se puede enseñar no sirve para defenderse
 * de una queja.
 */
export default async function PublicationPage({ params, searchParams }: Props) {
  const [session, { eventId }, query] = await Promise.all([getSession(), params, searchParams]);
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }

  const scope = scopeOf(session);
  const locale = panelLocale(undefined, session.locale);
  const copy = getDirectoryDictionary(locale);

  // El evento privado, SOLO para rellenar el formulario la primera vez. Lo que
  // se publique después sale de la copia, no de aquí.
  const event = await db(scope).event.findFirst({
    where: { id: eventId, tenantId: scope.tenantId },
    select: { id: true, type: true, date: true, venueName: true, venueAddress: true },
  });
  if (event === null) redirect('/panel');

  const listing = await listingForEvent(scope, eventId);

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-3">
        <Link href={`/panel/eventos/${eventId}`} className="text-sm underline">
          ←
        </Link>
        <h1 className="text-2xl">{copy.listing.title}</h1>
        {listing !== null && <ProviderStatus status={listing.status} copy={copy} />}
      </header>

      <PanelNotice params={query} copy={copy} />
      <p className="max-w-2xl text-sm text-[#6a6456]">{copy.listing.help}</p>

      {listing === null ? (
        <form
          action={createListingAction}
          className="flex flex-col gap-3 border border-[#ddd6c6] bg-[#fbf6ec] p-4"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="eventType" value={event.type} />

          <label className={ETIQUETA}>
            {copy.listing.listingTitle}
            <input name="title" required maxLength={140} className={CAJA} />
          </label>

          <label className={ETIQUETA}>
            {copy.listing.description}
            <textarea name="description" rows={4} maxLength={4000} className={CAJA} />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={ETIQUETA}>
              {copy.panel.mainLocale}
              <select name="locale" defaultValue={locale} className={CAJA}>
                {DIRECTORY_LOCALES.map((one) => (
                  <option key={one} value={one}>
                    {one.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className={ETIQUETA}>
              {copy.listing.eventType}
              {/* Se enseña, no se elige: el tipo lo decide el evento, igual que
                  decide la plantilla. Un memorial publicado como cumpleaños es
                  el mismo error que un memorial con la plantilla de fiesta. */}
              <span className="border border-[#ddd6c6] bg-[#f4efe6] px-3 py-2 text-sm">
                {copy.listing.eventTypes[event.type as (typeof EVENT_TYPES)[number]]}
              </span>
            </label>

            <label className={ETIQUETA}>
              {copy.listing.dateMode}
              <select name="dateMode" defaultValue="month" className={CAJA}>
                {DATE_MODES.map((one) => (
                  <option key={one} value={one}>
                    {copy.listing.dateModes[one]}
                  </option>
                ))}
              </select>
            </label>

            <label className={ETIQUETA}>
              {copy.listing.date}
              {/* Solo se guarda si el modo es «el día exacto», y lo impide
                  también la base. */}
              <input
                type="date"
                name="date"
                defaultValue={event.date ?? ''}
                className={CAJA}
              />
            </label>

            <label className={ETIQUETA}>
              {copy.search.governorate}
              <select name="governorate" defaultValue="beirut" className={CAJA}>
                {GOVERNORATE_KEYS.map((one) => (
                  <option key={one} value={one}>
                    {copy.governorates[one]}
                  </option>
                ))}
              </select>
            </label>

            <label className={ETIQUETA}>
              {copy.search.district}
              <select name="district" defaultValue="beirut" className={CAJA}>
                {GOVERNORATE_KEYS.map((governorate) => (
                  <optgroup key={governorate} label={copy.governorates[governorate]}>
                    {GOVERNORATES[governorate].map((district) => (
                      <option key={district} value={district}>
                        {copy.districts[district]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label className={ETIQUETA}>
              {copy.panel.city}
              <input name="city" required maxLength={80} className={CAJA} />
            </label>

            <label className={ETIQUETA}>
              {copy.listing.contactMode}
              <select name="contactMode" defaultValue="none" className={CAJA}>
                {CONTACT_MODES.map((one) => (
                  <option key={one} value={one}>
                    {copy.listing.contactModes[one]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className={ETIQUETA}>
            {copy.listing.venueName}
            <input
              name="venueName"
              defaultValue=""
              placeholder={event.venueName ?? ''}
              maxLength={140}
              className={CAJA}
            />
            <span className="opacity-70">{copy.listing.venueHelp}</span>
          </label>

          <fieldset className="flex flex-col gap-3 border border-[#8a6c22] p-3">
            <legend className="px-1 text-sm text-[#8a6c22]">{copy.listing.authorizationTitle}</legend>
            <p className="text-xs text-[#6a6456]">{copy.listing.authorizationHelp}</p>
            <label className={ETIQUETA}>
              {copy.listing.authorizedBy}
              <input name="authorizedBy" required maxLength={140} className={CAJA} />
            </label>
            <label className={ETIQUETA}>
              {copy.listing.authorizationText}
              <textarea name="authorizationText" required rows={3} maxLength={2000} className={CAJA} />
            </label>
          </fieldset>

          <button type="submit" className={`${BOTON} bg-[#8a6c22]`}>
            {copy.listing.create}
          </button>
        </form>
      ) : (
        <>
          <dl className="flex flex-col gap-2 border border-[#ddd6c6] bg-white p-4 text-sm">
            <div>
              <dt className="text-xs text-[#6a6456]">{copy.listing.listingTitle}</dt>
              <dd>{listing.title}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#6a6456]">{copy.search.governorate}</dt>
              <dd>
                {copy.governorates[listing.governorate] ?? listing.governorate} · {listing.city}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#6a6456]">{copy.listing.dateMode}</dt>
              <dd>{copy.listing.dateModes[listing.dateMode]}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#6a6456]">{copy.listing.authorizedBy}</dt>
              <dd>{listing.authorizedBy ?? '—'}</dd>
            </div>
            {listing.status === 'approved' && (
              <div>
                <dt className="text-xs text-[#6a6456]">{copy.listing.publicUrl}</dt>
                <dd>
                  <Link
                    href={`/d/${listing.locale}/f/${listing.slug}`}
                    className="underline hover:no-underline"
                  >
                    /d/{listing.locale}/f/{listing.slug}
                  </Link>
                </dd>
              </div>
            )}
          </dl>

          {listing.rejectedNote !== null && listing.rejectedNote.length > 0 && (
            <section className="flex flex-col gap-2 border border-[#8a3a22] bg-[#fbeee9] p-4">
              <h2 className="text-sm text-[#8a3a22]">{copy.panel.rejectedNote}</h2>
              <p className="text-sm whitespace-pre-line">{listing.rejectedNote}</p>
            </section>
          )}

          <div className="flex flex-wrap gap-3">
            {(listing.status === 'draft' || listing.status === 'rejected') && (
              <form action={submitListingAction}>
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="listingId" value={listing.id} />
                <button type="submit" className={`${BOTON} bg-[#8a6c22]`}>
                  {copy.listing.submit}
                </button>
              </form>
            )}

            <form action={deleteListingAction} className="flex flex-col gap-1">
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="listingId" value={listing.id} />
              <button type="submit" className={`${BOTON} bg-[#8a3a22]`}>
                {copy.listing.remove}
              </button>
              <span className="text-xs text-[#6a6456]">{copy.listing.removeHelp}</span>
            </form>
          </div>

          <p className="text-xs text-[#6a6456]">{copy.listing.submitHelp}</p>
        </>
      )}
    </>
  );
}
