import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  grantConsentAction,
  optOutAction,
} from '@/app/panel/eventos/[eventId]/permisos/actions';
import { getAdminContext } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { consentSummary } from '@/lib/consent/service';
import { displayFont } from '@/lib/typography';
import { interpolate } from '@citas/core';

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ error?: string }>;
}

const CONTROL =
  'h-10 border border-[#cdc6b6] bg-white px-3 text-sm text-[#23201a] outline-none focus-visible:border-[#8a6c22] focus-visible:ring-2 focus-visible:ring-[#c9a227]';
const BUTTON = 'h-10 border border-[#23201a] bg-white px-4 text-sm text-[#23201a] hover:opacity-70';
const LABEL = 'flex flex-col gap-1 text-sm text-[#6b6455]';

/**
 * Quién ha dado permiso para que se le escriba, y quién ha pedido que no.
 *
 * Existe porque la diferencia entre «tengo su teléfono» y «me dio permiso» no se
 * ve en ninguna otra pantalla, y es la que decide si un envío es una invitación
 * o es spam. Los que faltan salen CON NOMBRE: «ochenta sin permiso» sobre
 * doscientos preocupa y no deja hacer nada.
 */
export default async function ConsentPage({ params, searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:read') || session.tenantId === null) {
    redirect('/panel');
  }

  const { eventId } = await params;
  const { error } = await searchParams;
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.consent;

  const summary = await consentSummary(scopeOf(session), eventId);
  if (summary === null) redirect('/panel');

  const canWrite = sessionCan(session, 'event:write');

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={`/panel/eventos/${eventId}`} className="text-sm text-[#8a6c22] hover:underline">
          {copy.back}
        </Link>
        <h1 className={`${displayFont(locale)} text-3xl text-[#23201a]`}>{copy.heading}</h1>
        <p className="max-w-2xl text-sm text-[#6b6455]">{copy.intro}</p>
        <p className="max-w-2xl border border-[#c9a227] bg-[#fdfaf0] p-3 text-sm text-[#6b5a20]">
          {copy.warning}
        </p>
      </header>

      {error !== undefined && (
        <p className="border border-[#b3261e] bg-[#fdf2f1] p-3 text-sm text-[#b3261e]">
          {error === 'bad_source' ? copy.sourceLabel : copy.channelLabel}
        </p>
      )}

      <section className="flex flex-wrap gap-4 border border-[#ddd6c6] bg-white p-4">
        <p className="text-sm text-[#2e7d32]">
          {interpolate(copy.withConsent, { count: String(summary.allowed) })}
        </p>
        <p className="text-sm text-[#b3261e]">
          {interpolate(copy.optedOut, { count: String(summary.optedOut) })}
        </p>
        <p className="text-sm text-[#6b6455]">
          {interpolate(copy.without, { count: String(summary.missing) })}
        </p>
      </section>

      {summary.sample.length > 0 && (
        <section className="flex flex-col gap-2 border border-[#ddd6c6] bg-white p-4">
          <h2 className={`${displayFont(locale)} text-xl text-[#23201a]`}>{copy.without.split('{')[0]}</h2>
          <p className="text-sm text-[#6b6455]">
            {summary.sample.map((guest) => guest.name).join(' · ')}
          </p>
        </section>
      )}

      {canWrite && (
        <section className="flex flex-col gap-4 border border-[#ddd6c6] bg-white p-4">
          <form action={grantConsentAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="eventId" value={eventId} />
            <label className={`${LABEL} min-w-48`}>
              {copy.channelLabel}
              <select name="channel" className={CONTROL}>
                <option value="whatsapp">{copy.channels.whatsapp}</option>
                <option value="email">{copy.channels.email}</option>
                <option value="sms">{copy.channels.sms}</option>
              </select>
            </label>
            <label className={`${LABEL} min-w-48`}>
              {copy.purposeLabel}
              <select name="purpose" className={CONTROL}>
                <option value="invitation">{copy.purposes.invitation}</option>
                <option value="reminder">{copy.purposes.reminder}</option>
                <option value="marketing">{copy.purposes.marketing}</option>
              </select>
            </label>
            <label className={`${LABEL} min-w-56`}>
              {copy.channelLabel}
              <input name="contact" required className={CONTROL} />
            </label>
            <label className={`${LABEL} min-w-64 grow`}>
              {copy.sourceLabel}
              <input
                name="source"
                required
                placeholder={copy.sourcePlaceholder}
                className={CONTROL}
              />
            </label>
            <button type="submit" className={BUTTON}>
              {copy.grant}
            </button>
          </form>

          <form action={optOutAction} className="flex flex-wrap items-end gap-3 border-t border-[#efeadd] pt-4">
            <input type="hidden" name="eventId" value={eventId} />
            <label className={`${LABEL} min-w-48`}>
              {copy.channelLabel}
              <select name="channel" className={CONTROL}>
                <option value="whatsapp">{copy.channels.whatsapp}</option>
                <option value="email">{copy.channels.email}</option>
                <option value="sms">{copy.channels.sms}</option>
              </select>
            </label>
            <label className={`${LABEL} min-w-56`}>
              {copy.channelLabel}
              <input name="contact" required className={CONTROL} />
            </label>
            <label className={`${LABEL} min-w-64 grow`}>
              {copy.sourceLabel}
              <input name="reason" className={CONTROL} />
            </label>
            <button type="submit" className={BUTTON}>
              {copy.optOut}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
