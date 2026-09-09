import { redirect } from 'next/navigation';

import { getAdminContext } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { listEvents, type EventSummary } from '@/lib/repositories/events';
import { displayFont, latinOnly } from '@/lib/typography';

/** Proves the whole chain: session, office and role, all resolved on the server. */
export default async function PanelPage() {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const { dictionary, locale, tenant } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.panel;

  const rows: { label: string; value: string }[] = [
    { label: copy.signedInAs, value: session.email },
    { label: copy.office, value: tenant?.name ?? copy.noOffice },
    {
      label: copy.role,
      value: session.role === null ? '—' : dictionary.admin.roles[session.role],
    },
  ];

  const events: EventSummary[] =
    session.tenantId !== null && sessionCan(session, 'event:read')
      ? await listEvents(scopeOf(session))
      : [];
  const eventCopy = dictionary.admin.events;

  return (
    <>
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

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3">
          <h2 className={`${displayFont(locale)} text-2xl text-[#23201a]`}>{eventCopy.heading}</h2>
          {/* The one thing an office signs in to do, and until now it was only
              reachable by typing the address. */}
          {sessionCan(session, 'event:write') ? (
            <a
              href="/crear"
              className="bg-[#23201a] px-5 py-2.5 text-sm text-[#f4efe6] transition-opacity hover:opacity-90 ms-auto"
            >
              {eventCopy.create}
            </a>
          ) : null}
        </div>

        {events.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#6a6456]">{eventCopy.empty}</p>
            {sessionCan(session, 'event:write') ? (
              <p className="text-sm text-[#6a6456]">{eventCopy.createHint}</p>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className={`border-b border-[#c9bfa6] text-xs ${latinOnly(locale, 'uppercase tracking-[0.12em]')} text-[#8a6c22]`}>
                  <th className="py-2 text-start">{eventCopy.event}</th>
                  <th className="py-2 text-start">{eventCopy.date}</th>
                  <th className="py-2 text-end tabular-nums">{eventCopy.attending}</th>
                  <th className="py-2 text-end tabular-nums">{eventCopy.tentative}</th>
                  <th className="py-2 text-end tabular-nums">{eventCopy.declined}</th>
                  <th className="py-2 text-end">{eventCopy.guests}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b border-[#ddd6c6]">
                    <td className="py-3 text-[#23201a]">{event.title}</td>
                    <td className="py-3 tabular-nums text-[#6a6456]">{event.date}</td>
                    <td className="py-3 text-end tabular-nums text-[#23201a]">{event.attending}</td>
                    <td className="py-3 text-end tabular-nums text-[#6a6456]">{event.tentative}</td>
                    <td className="py-3 text-end tabular-nums text-[#6a6456]">{event.declined}</td>
                    <td className="py-3 text-end">
                      <a
                        className="underline text-[#8a6c22]"
                        href={`/panel/eventos/${event.id}`}
                        title={eventCopy.download}
                      >
                        {event.guests}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </>
  );
}
