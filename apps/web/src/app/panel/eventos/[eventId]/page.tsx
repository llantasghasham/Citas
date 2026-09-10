import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { importGuestsAction } from '@/app/panel/eventos/actions';
import { PackagesSection } from '@/components/panel/PackagesSection';
import { WhatsappSendSection } from '@/components/panel/WhatsappSendSection';
import { VersionsSection } from '@/components/panel/VersionsSection';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import { getAdminContext, requestHost } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { enabledMethods, listPackageOrders } from '@/lib/billing/checkout';
import { getPrisma } from '@/lib/db/client';
import { listConnections, listFailed, queueStats, scheduledBatch } from '@/lib/whatsapp/connections';
import { guestAllowanceFor } from '@/lib/billing/packages';
import { LOCALE_NAMES } from '@/lib/create/options';
import { COUNTRY_CODES } from '@/lib/guests/phone';
import { toWaMe } from '@/lib/guests/phone';
import { listGuestsWithLinks } from '@/lib/repositories/guests';
import { displayFont, latinOnly } from '@/lib/typography';
import { findCountry, getDictionary, interpolate, plural, LOCALES, type Locale } from '@citas/core';

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{
    added?: string;
    skipped?: string;
    error?: string;
    version?: string;
    limite?: string;
    cabe?: string;
    hay?: string;
    pedidos?: string;
    vendido?: string;
    efectivo?: string;
    encolados?: string;
    sinTelefono?: string;
  }>;
}

/**
 * One event's guest list: import it, then send each guest their own link.
 *
 * The WhatsApp button is a plain `wa.me` link, not an API integration: it opens
 * the operator's own WhatsApp with the message already written. No approved
 * templates, no per-message fee, no verified number — and the office keeps
 * sending from the number its clients already know.
 */
export default async function EventGuestsPage({ params, searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:read') || session.tenantId === null) {
    redirect('/panel');
  }

  const { eventId } = await params;
  const {
    added,
    skipped,
    error,
    version,
    limite,
    cabe,
    hay,
    pedidos,
    vendido,
    efectivo,
    encolados,
    sinTelefono,
  } = await searchParams;
  const addedLocale = LOCALES.find((candidate) => candidate === version);
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.guests;

  const event = await listGuestsWithLinks(scopeOf(session), eventId);
  if (event === null) redirect('/panel');

  // Cuánto tiene pagado esta boda y qué se le ha vendido. Va aquí, junto a la
  // lista que no cabe, y no en la facturación de la oficina.
  const canSell = sessionCan(session, 'billing:manage');
  const [allowance, sold, methods, connections, whatsappStats, scheduled, failed, actor] =
    await Promise.all([
      guestAllowanceFor(session.tenantId, eventId),
      listPackageOrders(scopeOf(session), eventId),
      enabledMethods(),
      listConnections(scopeOf(session)),
      queueStats(scopeOf(session), eventId),
      scheduledBatch(scopeOf(session), eventId),
      listFailed(scopeOf(session), eventId),
      getPrisma().user.findUnique({
        where: { id: session.userId },
        select: { timezone: true },
      }),
    ]);

  // Con qué reloj se escribe y se lee una hora de envío: el de esta persona, el
  // del país que maneja, o el del servidor. El mismo orden que su perfil.
  const actorZone =
    actor?.timezone ??
    findCountry(session.country)?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;

  const origin = `https://${requestHost(await headers())}`;
  const defaultDial =
    COUNTRY_CODES.find((code) => code === findCountry(session.country)?.dial) ?? '+961';
  const opened = event.guests.filter((guest) => guest.openedAt !== null).length;
  // How many guests are waiting for each language, so the versions section can
  // say which one to write next instead of offering four equal boxes.
  const guestsByLocale = Object.fromEntries(
    LOCALES.map((option) => [
      option,
      event.guests.filter((guest) => guest.locale === option).length,
    ]),
  ) as Record<Locale, number>;
  const canWrite = sessionCan(session, 'event:write');

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className={`${displayFont(locale)} text-3xl`}>{event.title}</h1>
        <p className="text-sm text-[#6a6456]">
          {interpolate(copy.openedCount, {
            opened: String(opened),
            total: String(event.guests.length),
          })}
        </p>
      </header>

      {added === undefined ? null : (
        <p className="text-sm text-[#8a6c22]">
          {plural(locale, copy.imported, Number.parseInt(added, 10) || 0)}
          {skipped === undefined || skipped === '0'
            ? ''
            : ` ${plural(locale, copy.skipped, Number.parseInt(skipped, 10) || 0)}`}
        </p>
      )}
      {addedLocale === undefined ? null : (
        <p className="text-sm text-[#8a6c22]">
          {interpolate(dictionary.admin.versions.added, {
            language: LOCALE_NAMES[addedLocale],
          })}
        </p>
      )}
      {limite === '1' ? (
        <div role="alert" className="flex flex-col gap-1 border border-[#8c2f1e] bg-[#fdf4f2] p-4">
          <p className="text-sm text-[#8c2f1e]">{copy.limitTitle}</p>
          <p className="text-sm text-[#6a6456]">
            {interpolate(copy.limitDetail, {
              cabe: cabe ?? '—',
              hay: hay ?? '—',
              pedidos: pedidos ?? '—',
            })}
          </p>
          <p className="text-sm text-[#6a6456]">{copy.limitHint}</p>
        </div>
      ) : null}
      {encolados === undefined ? null : (
        <p className="text-sm text-[#2f6b3a]">
          {interpolate(dictionary.admin.whatsapp.queuedDone, {
            queued: encolados,
            skipped: sinTelefono ?? '0',
          })}
        </p>
      )}
      {efectivo === '1' ? (
        <p className="text-sm text-[#2f6b3a]">{dictionary.admin.packages.markCashDone}</p>
      ) : null}
      {error === '1' ? (
        <p role="alert" className="text-sm text-[#8c2f1e]">
          {dictionary.create.errorInvalid}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-4">
          <h2 className={`${displayFont(locale)} text-2xl`}>{copy.heading}</h2>
          <a className="text-sm underline text-[#8a6c22]" href={`/api/events/${eventId}/guests`}>
            {copy.exportCsv}
          </a>
        </div>

        {event.guests.length === 0 ? (
          <p className="text-sm text-[#6a6456]">{copy.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className={`border-b border-[#c9bfa6] text-xs ${latinOnly(locale, 'uppercase tracking-[0.12em]')} text-[#8a6c22]`}>
                  <th className="py-2 text-start">{copy.name}</th>
                  <th className="py-2 text-start">{copy.phone}</th>
                  <th className="py-2 text-start">{copy.language}</th>
                  <th className="py-2 text-start">{copy.opened}</th>
                  <th className="py-2 text-start">{copy.reply}</th>
                  <th className="py-2 text-end">{copy.sendWhatsapp}</th>
                </tr>
              </thead>
              <tbody>
                {event.guests.map((guest) => {
                  const link = `${origin}/g/${guest.token}`;
                  // Each guest is written to in their own language, not the office's.
                  const message = interpolate(
                    getDictionary(guest.locale).share.whatsappMessage,
                    { name: guest.name, link },
                  );
                  const reply = dictionary.rsvpForm;
                  const replyLabel =
                    guest.status === 'attending'
                      ? reply.attending
                      : guest.status === 'declined'
                        ? reply.declined
                        : guest.status === 'tentative'
                          ? reply.tentative
                          : copy.pending;

                  return (
                    <tr key={guest.id} className="border-b border-[#ddd6c6]">
                      <td className="py-3">{guest.name}</td>
                      <td className="py-3 font-mono text-xs" dir="ltr">
                        {guest.phone ?? '—'}
                      </td>
                      {/* What they will really open. When nobody wrote their
                          language they get the original, and the office should
                          see that before the list goes out, not after. */}
                      <td className="py-3">
                        {LOCALE_NAMES[guest.locale]}
                        {guest.version !== null && guest.version.locale !== guest.locale ? (
                          <span className="block text-xs text-[#8c2f1e]">
                            {interpolate(copy.fallbackWarning, {
                              language: LOCALE_NAMES[guest.locale],
                              fallback: LOCALE_NAMES[guest.version.locale],
                            })}{' '}
                            {/* Straight to the form that fixes it: the warning
                                and the cure were in different halves of the page. */}
                            <a href="#idiomas" className="underline">
                              {copy.fallbackFix}
                            </a>
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3 text-[#6a6456]">
                        {guest.openedAt === null
                          ? copy.notOpened
                          : guest.openedAt.toISOString().slice(0, 10)}
                      </td>
                      <td className="py-3">{replyLabel}</td>
                      <td className="py-3 text-end">
                        {guest.phone === null ? (
                          <a className="text-xs underline text-[#8a6c22]" href={link}>
                            {copy.link}
                          </a>
                        ) : (
                          <a
                            className="text-xs underline text-[#8a6c22]"
                            href={`https://wa.me/${toWaMe(guest.phone)}?text=${encodeURIComponent(message)}`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {copy.sendWhatsapp}
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <PackagesSection
        eventId={eventId}
        channel={event.channel}
        allowance={allowance}
        sold={sold}
        {...(vendido === undefined ? {} : { justSold: vendido })}
        origin={origin}
        dictionary={dictionary}
        locale={locale}
        canSell={canSell}
        cashEnabled={methods.includes('cash')}
      />

      {canWrite ? (
        <WhatsappSendSection
          eventId={eventId}
          connections={connections}
          stats={whatsappStats}
          scheduled={scheduled}
          reminderDays={event.reminderDaysBefore}
          failed={failed}
          timezone={actorZone}
          dictionary={dictionary}
          locale={locale}
        />
      ) : null}

      <VersionsSection
        eventId={eventId}
        versions={event.versions}
        guestsByLocale={guestsByLocale}
        dictionary={dictionary}
        locale={locale}
        canWrite={canWrite}
      />

      {canWrite ? (
        <form
          action={importGuestsAction}
          encType="multipart/form-data"
          className="flex max-w-xl flex-col gap-4 border-t border-[#ddd6c6] pt-6"
        >
          <h2 className={`${displayFont(locale)} text-xl`}>{copy.import}</h2>
          <p className="text-sm text-[#6a6456]">{copy.importHint}</p>
          <input type="hidden" name="eventId" value={eventId} />

          <Field label={copy.pasteLabel}>
            <textarea
              name="list"
              className={`${FIELD_CLASS} min-h-40 font-mono text-xs`}
              dir="ltr"
              placeholder={'Karim Haddad, 03 456 789, ar\nJames Whitaker, +44 7700 900123, en'}
            />
          </Field>

          <Field label={copy.fileLabel}>
            <input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" className={FIELD_CLASS} />
          </Field>

          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="sm:flex-1">
              <Field label={copy.countryLabel}>
                {/* El prefijo por defecto sale del país de quien importa, no
                    de una constante: quien trabaja en Costa Rica pega listas
                    ticas y no debería tener que cambiarlo cada vez. */}
                <select name="country" className={FIELD_CLASS} defaultValue={defaultDial}>
                  {COUNTRY_CODES.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="sm:flex-1">
              <Field label={dictionary.create.localeLabel}>
                <select name="locale" className={FIELD_CLASS} defaultValue={locale}>
                  {LOCALES.map((option) => (
                    <option key={option} value={option}>{LOCALE_NAMES[option]}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <button type="submit" className="bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] hover:opacity-90">
            {copy.add}
          </button>
        </form>
      ) : null}
    </>
  );
}
