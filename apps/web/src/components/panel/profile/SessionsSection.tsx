import { closeOthersAction, closeSessionAction } from '@/app/panel/perfil/actions';
import type { SessionRow } from '@/lib/profile/sessions';
import { displayFont } from '@/lib/typography';
import type { Dictionary, Locale } from '@citas/core';

/**
 * Dónde está abierta esta cuenta ahora mismo.
 *
 * Una sesión de este sistema dura treinta días. Sin esta lista, «me parece que
 * dejé la sesión abierta en el ordenador de la agencia» se arreglaba esperando
 * un mes o entrando en la base de datos. Con ella, se arregla aquí.
 *
 * La hora se formatea con la zona que haya elegido la persona: leer «las 9:14»
 * en una zona que no es la suya es no poder reconocer si esa entrada fue suya.
 */
export function SessionsSection({
  sessions,
  timezone,
  notice,
  dictionary,
  locale,
}: {
  sessions: SessionRow[];
  timezone: string;
  /** `cerrada` o `cerradas`, si se acaba de cerrar alguna. */
  notice?: string;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.profile.sessions;

  const when = (value: Date): string =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(value);

  const others = sessions.filter((session) => !session.current).length;

  return (
    <section className="flex max-w-xl flex-col gap-5 border-t border-[#ddd6c6] pt-8">
      <div className="flex flex-col gap-2">
        <h2 className={`${displayFont(locale)} text-2xl`}>{copy.title}</h2>
        <p className="text-sm text-[#6a6456]">{copy.intro}</p>
      </div>

      {notice === undefined ? null : <p className="text-sm text-[#2f6b3a]">{copy.closed}</p>}

      <ul className="flex flex-col gap-3">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-[#ddd6c6] bg-white/60 p-4"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm">
                {session.device}
                {session.current ? (
                  <span className="text-[#2f6b3a]"> · {copy.current}</span>
                ) : null}
              </span>
              <span className="text-xs text-[#6a6456]">
                {copy.lastSeen}: {when(session.lastSeenAt)}
                {session.ip === null ? null : (
                  <>
                    {' · '}
                    <span className="font-mono" dir="ltr">
                      {session.ip}
                    </span>
                  </>
                )}
              </span>
            </span>

            {session.current ? null : (
              <form action={closeSessionAction} className="ms-auto">
                <input type="hidden" name="sessionId" value={session.id} />
                <button type="submit" className="text-sm underline text-[#8c2f1e]">
                  {copy.close}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {others === 0 ? null : (
        <form action={closeOthersAction}>
          <button
            type="submit"
            className="border border-[#23201a] px-5 py-2.5 text-sm hover:opacity-70"
          >
            {copy.closeOthers}
          </button>
        </form>
      )}
    </section>
  );
}
