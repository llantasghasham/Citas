import Link from 'next/link';
import { redirect } from 'next/navigation';

import { readActs } from '@/lib/acts/service';
import { getAdminContext } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import {
  PREFERENCE_KEYS,
  preferenceReport,
  type PreferenceKey,
  type PreferenceReport,
} from '@/lib/checkin/preferences';
import { displayFont } from '@/lib/typography';
import { interpolate, type Dictionary } from '@citas/core';

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ acto?: string }>;
}

const CONTROL =
  'h-10 border border-[#cdc6b6] bg-white px-3 text-sm text-[#23201a] outline-none focus-visible:border-[#8a6c22] focus-visible:ring-2 focus-visible:ring-[#c9a227]';

/**
 * Lo que hay que preparar: cocina, traslados, accesibilidad y fotos.
 *
 * Es la hoja que se le pasa al catering y a quien monta el salón, y por eso son
 * RECUENTOS y no una lista de nombres. «Doce sin gluten» es lo que se compra;
 * quién es cada uno de los doce no hace falta para comprar, y esto son datos de
 * salud de gente que no tiene cuenta aquí (la razón larga está en
 * `lib/checkin/preferences.ts`).
 *
 * El recuento lo hace el servidor con dos reglas que cambian el número y que
 * explica `preferenceReport`: cada invitado cuenta UNA vez, y lo que dijo para
 * un acto manda sobre lo que dijo para toda la celebración. Aquí no se suma
 * nada: sumar en dos sitios es cómo dos pantallas acaban dando cifras
 * distintas.
 *
 * Sin JavaScript de cliente: elegir el acto es un `GET` con su `?acto=`.
 */
export default async function PreferencesPage({ params, searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:read') || session.tenantId === null) {
    redirect('/panel');
  }

  const { eventId } = await params;
  const { acto } = await searchParams;
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.preferences;

  const acts = await readActs(scopeOf(session), eventId);
  if (acts === null) redirect('/panel');

  // Vacío —o un id que no es de este evento— significa toda la celebración, que
  // además es la pregunta de por defecto: una boda de un solo acto ES la
  // celebración entera.
  const chosen = acts.find((act) => act.id === acto) ?? null;

  const reports = await Promise.all(
    PREFERENCE_KEYS.map((key) =>
      preferenceReport(scopeOf(session), eventId, chosen?.id ?? null, key),
    ),
  );
  // Solo sale `null` si el evento no es de esta oficina, y entonces no sale
  // ninguno: los cuatro se preguntan contra el mismo evento.
  if (reports.some((report) => report === null)) redirect('/panel');

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={`/panel/eventos/${eventId}`} className="text-sm text-[#8a6c22] hover:underline">
          {copy.back}
        </Link>
        <h1 className={`${displayFont(locale)} text-3xl text-[#23201a]`}>{copy.heading}</h1>
        <p className="max-w-2xl text-sm text-[#6b6455]">{copy.intro}</p>
      </header>

      {acts.length > 0 && (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-[#6b6455]">
            {copy.actLabel}
            <select name="acto" defaultValue={chosen?.id ?? ''} className={`${CONTROL} min-w-56`}>
              <option value="">{copy.wholeEvent}</option>
              {acts.map((act) => (
                <option key={act.id} value={act.id}>
                  {act.label ?? dictionary.actTypes[act.type]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-10 border border-[#23201a] bg-white px-4 text-sm text-[#23201a] hover:opacity-70"
          >
            {copy.show}
          </button>
        </form>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {reports.map((report) =>
          report === null ? null : (
            <Card key={report.key} copy={copy} guestCopy={dictionary.preferences} report={report} />
          ),
        )}
      </div>
    </>
  );
}

function Card({
  copy,
  guestCopy,
  report,
}: {
  copy: Dictionary['admin']['preferences'];
  guestCopy: Dictionary['preferences'];
  report: PreferenceReport;
}) {
  return (
    <section className="flex flex-col gap-2 border border-[#ddd6c6] bg-white p-4">
      <h2 className="text-lg text-[#23201a]">{guestCopy.keys[report.key]}</h2>
      <p className="text-sm text-[#6b6455]">
        {interpolate(copy.answered, {
          answered: String(report.answered),
          guests: String(report.guests),
        })}
      </p>

      {report.values.length === 0 ? (
        <p className="text-sm text-[#6b6455]">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {report.values.map((row) => (
            <li key={row.value} className="flex items-baseline justify-between gap-3 text-sm">
              {/* Lo guardado es el código; el nombre lo pone el MISMO
                  diccionario que se lo enseñó al invitado, para que la cocina y
                  el invitado lean la misma palabra. */}
              <span>{label(guestCopy, report.key, row.value)}</span>
              <span className="text-[#23201a]">
                {interpolate(copy.people, { count: String(row.count) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * El nombre de una respuesta, o el código si ya no lo tiene.
 *
 * Cae al código a propósito: una fila guardada con una opción que mañana se
 * retire de la lista tiene que seguir viéndose. Enseñar un hueco sería restar
 * comensales sin decirlo.
 */
function label(copy: Dictionary['preferences'], key: PreferenceKey, value: string): string {
  const options: Record<string, string> = copy.options[key];
  return options[value] ?? value;
}
