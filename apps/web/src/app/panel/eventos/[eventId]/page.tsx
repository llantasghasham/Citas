import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { importGuestsAction } from '@/app/panel/eventos/actions';
import { VersionsSection } from '@/components/panel/VersionsSection';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import { getAdminContext, requestHost } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { LOCALE_NAMES } from '@/lib/create/options';
import { COUNTRY_CODES } from '@/lib/guests/phone';
import { toWaMe } from '@/lib/guests/phone';
import { listGuestsWithLinks } from '@/lib/repositories/guests';
import { displayFont } from '@/lib/typography';
import { getDictionary, interpolate, plural, LOCALES, type Locale } from '@citas/core';

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{
    added?: string;
    skipped?: string;
    error?: string;
    version?: string;
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
  const { added, skipped, error, version } = await searchParams;
  const addedLocale = LOCALES.find((candidate) => candidate === version);
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.guests;

  const event = await listGuestsWithLinks(scopeOf(session), eventId);
  if (event === null) redirect('/panel');

  const origin = `https://${requestHost(await headers())}`;
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
                <tr className="border-b border-[#c9bfa6] text-xs uppercase tracking-[0.12em] text-[#8a6c22]">
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
                <select name="country" className={FIELD_CLASS} defaultValue="+961">
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
