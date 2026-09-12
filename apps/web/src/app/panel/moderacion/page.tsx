import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession, sessionCan } from '@/lib/auth/session';
import { mediaQueue, reviewQueue } from '@/lib/directory/moderation';
import { panelLocale } from '@/lib/directory/session';
import { actorTimezone } from '@/lib/time/actor';
import { formatDateTime } from '@/lib/time/display';
import { getDirectoryDictionary } from '@citas/core';

/**
 * La cola de moderación.
 *
 * Lo más viejo ARRIBA, y lo atrasado marcado en rojo — la misma decisión que los
 * buzones de SINPE caídos, y por la misma razón: una avería que desde fuera se
 * ve igual que si no pasara nada tiene que verse desde dentro a la primera.
 *
 * El plazo se mide en horas HÁBILES (`lib/directory/clock.ts`): un perfil
 * mandado un viernes por la tarde no está atrasado el sábado por la mañana, y
 * una pantalla que se pone roja cada lunes es una alarma que deja de significar
 * nada.
 */
export default async function ModerationQueuePage() {
  const session = await getSession();
  if (session === null) redirect('/entrar');
  // En el servidor, en la pantalla Y en cada acción. Que no se pinte no impide
  // que alguien mande el formulario.
  if (!sessionCan(session, 'directory:moderate')) redirect('/panel');

  const locale = panelLocale(undefined, session.locale);
  const copy = getDirectoryDictionary(locale);
  const fechaLocale = locale === 'fr' ? 'en' : locale;
  const [zone, perfiles, medios] = await Promise.all([
    actorTimezone(session),
    reviewQueue(),
    mediaQueue(),
  ]);

  return (
    <>
      <h1 className="text-2xl">{copy.moderation.title}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">
          {copy.moderation.queue}
          <span className="text-sm text-[#6a6456]"> ({perfiles.length})</span>
        </h2>

        {perfiles.length === 0 ? (
          <p className="text-sm text-[#6a6456]">{copy.moderation.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {perfiles.map((one) => (
              <li
                key={one.id}
                className={`border p-3 ${
                  one.overdue ? 'border-[#8a3a22] bg-[#fbeee9]' : 'border-[#ddd6c6] bg-white'
                }`}
              >
                <Link href={`/panel/moderacion/${one.id}`} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-base">{one.legalName}</span>
                    {one.overdue ? (
                      <span className="text-xs text-[#8a3a22]">{copy.moderation.overdue}</span>
                    ) : (
                      <span className="text-xs text-[#6a6456]">
                        {copy.moderation.hoursLeft.replace('{count}', String(one.hoursLeft))}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-[#6a6456]">
                    {one.city} · {copy.governorates[one.governorate] ?? one.governorate} ·{' '}
                    {copy.moderation.waiting.replace(
                      '{date}',
                      formatDateTime(one.submittedAt, fechaLocale, zone),
                    )}
                  </span>
                  <span className="text-xs text-[#6a6456]">
                    {copy.moderation.images}: {one.images} · {copy.moderation.languages}:{' '}
                    {one.translations}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">
          {copy.moderation.mediaQueue}
          <span className="text-sm text-[#6a6456]"> ({medios.length})</span>
        </h2>

        {medios.length === 0 ? (
          <p className="text-sm text-[#6a6456]">{copy.moderation.empty}</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {medios.map((one) => (
              <li key={one.id} className="w-32 border border-[#ddd6c6] bg-white p-2">
                <Link href={`/panel/moderacion/${one.providerId}`} className="flex flex-col gap-1">
                  {one.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- son
                    // bytes de este mismo proceso, con su comprobación dentro.
                    <img
                      src={`/api/d/media/${one.id}?t=1`}
                      alt=""
                      width={112}
                      height={112}
                      className="h-28 w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-28 items-center justify-center bg-[#f4efe6] text-xs">
                      {copy.provider.video}
                    </span>
                  )}
                  <span className="truncate text-xs text-[#6a6456]">{one.legalName}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
