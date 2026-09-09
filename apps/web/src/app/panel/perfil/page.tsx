import { redirect } from 'next/navigation';

import { saveProfileAction } from '@/app/panel/perfil/actions';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import { getAdminContext } from '@/lib/admin/context';
import { getSession } from '@/lib/auth/session';
import { LOCALE_NAMES } from '@/lib/create/options';
import { getPrisma } from '@/lib/db/client';
import { displayFont } from '@/lib/typography';
import { countriesFor, LOCALES } from '@citas/core';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ guardado?: string }>;
}

/**
 * Lo que cada persona edita de sí misma.
 *
 * Aparte del equipo a propósito: el equipo es «quién trabaja aquí y con qué
 * permiso», y lo decide quien administra. Esto es «cómo me llamo y cómo
 * trabajo», y lo decide cada uno. Mezclarlos es cómo se acaba dejando que
 * alguien se cambie el rol desde su propio perfil.
 */
export default async function ProfilePage({ searchParams }: PageProps) {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const { guardado } = await searchParams;
  const { dictionary, locale } = await getAdminContext(session.tenantId, session.locale);
  const copy = dictionary.admin.profile;

  const user = await getPrisma().user.findUnique({
    where: { id: session.userId },
    select: { name: true, phone: true, avatarUrl: true, country: true, locale: true },
  });
  const countries = countriesFor(locale);

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className={`${displayFont(locale)} text-3xl`}>{copy.title}</h1>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.intro}</p>
      </header>

      {guardado === '1' ? <p className="text-sm text-[#2f6b3a]">{copy.saved}</p> : null}

      <form action={saveProfileAction} className="flex max-w-xl flex-col gap-5">
        <div className="flex items-center gap-4">
          {/* La foto tal como saldrá, redonda y del tamaño real: un recorte malo
              se ve aquí y no en la cabecera. */}
          {user?.avatarUrl === null || user?.avatarUrl === undefined ? (
            <span className="grid size-16 place-items-center rounded-full bg-[#ddd6c6] text-xl text-[#6a6456]">
              {(user?.name ?? session.email).slice(0, 1).toUpperCase()}
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- una
            // dirección que escribe la persona, de cualquier origen.
            <img src={user.avatarUrl} alt="" className="size-16 rounded-full object-cover" />
          )}
          <span className="font-mono text-sm text-[#6a6456]" dir="ltr">
            {session.email}
          </span>
        </div>

        <Field label={copy.name}>
          <input name="name" defaultValue={user?.name ?? ''} maxLength={120} className={FIELD_CLASS} />
        </Field>

        <Field label={copy.avatar}>
          <input
            name="avatarUrl"
            defaultValue={user?.avatarUrl ?? ''}
            dir="ltr"
            className={FIELD_CLASS}
          />
        </Field>

        <Field label={copy.phone}>
          <input name="phone" defaultValue={user?.phone ?? ''} dir="ltr" inputMode="tel" className={FIELD_CLASS} />
        </Field>

        <Field label={copy.locale}>
          <select name="locale" defaultValue={user?.locale ?? locale} className={FIELD_CLASS}>
            {LOCALES.map((option) => (
              <option key={option} value={option}>
                {LOCALE_NAMES[option]}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex flex-col gap-2 text-sm text-[#23201a]">
          <span>{copy.country}</span>
          <select name="country" defaultValue={user?.country ?? ''} className={FIELD_CLASS}>
            <option value="">{copy.noCountry}</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name} · {country.dial}
              </option>
            ))}
          </select>
          <span className="text-xs text-[#6a6456]">{copy.countryHint}</span>
        </label>

        <button
          type="submit"
          className="self-start bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] hover:opacity-90"
        >
          {copy.save}
        </button>
      </form>
    </>
  );
}
