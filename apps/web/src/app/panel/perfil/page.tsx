import { redirect } from 'next/navigation';

import { saveProfileAction } from '@/app/panel/perfil/actions';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import { Avatar } from '@/components/panel/profile/Avatar';
import { PasswordSection } from '@/components/panel/profile/PasswordSection';
import { SessionsSection } from '@/components/panel/profile/SessionsSection';
import { getAdminContext } from '@/lib/admin/context';
import { getSession } from '@/lib/auth/session';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';
import { LOCALE_NAMES } from '@/lib/create/options';
import { getPrisma } from '@/lib/db/client';
import { avatarSrc, MAX_AVATAR_BYTES } from '@/lib/profile/avatar';
import { listSessions } from '@/lib/profile/sessions';
import { nowIn, timezones } from '@/lib/profile/timezones';
import { displayFont } from '@/lib/typography';
import { COUNTRIES, countriesFor, interpolate, LOCALES } from '@citas/core';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    guardado?: string;
    foto?: string;
    clave?: string;
    sesion?: string;
  }>;
}

/**
 * Lo que cada persona edita de sí misma.
 *
 * Aparte del equipo a propósito: el equipo es «quién trabaja aquí y con qué
 * permiso», y lo decide quien administra. Esto es «cómo me llamo y cómo
 * trabajo», y lo decide cada uno. Mezclarlos es cómo se acaba dejando que
 * alguien se cambie el rol desde su propio perfil.
 *
 * Tres bloques, y los tres son de la persona: sus datos, su contraseña y dónde
 * tiene la cuenta abierta. Sin JavaScript de cliente, como el resto.
 */
export default async function ProfilePage({ searchParams }: PageProps) {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const params = await searchParams;
  const { dictionary, locale } = await getAdminContext(session.tenantId, session.locale);
  const copy = dictionary.admin.profile;

  const user = await getPrisma().user.findUnique({
    where: { id: session.userId },
    select: {
      name: true,
      phone: true,
      avatarUrl: true,
      avatarVersion: true,
      country: true,
      locale: true,
      timezone: true,
      passwordHash: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  const countries = countriesFor(locale);
  const photo = user === null ? null : avatarSrc(session.userId, user);

  // La zona con la que se leen las horas de esta pantalla: la elegida, la del
  // país que maneja, o la del servidor.
  const countryZone = COUNTRIES.find((entry) => entry.code === user?.country)?.timezone ?? null;
  const zone =
    user?.timezone ??
    countryZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Solo el superadministrador y quien administra una oficina pueden tener
  // contraseña. Es la misma regla que aplica `npm run auth:password`, y la
  // acción vuelve a comprobarla: esconder el bloque no es un permiso.
  const mayHavePassword = session.isSuperadmin || session.role === 'TENANT_ADMIN';

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className={`${displayFont(locale)} text-3xl`}>{copy.title}</h1>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.intro}</p>
      </header>

      {params.guardado === '1' ? <p className="text-sm text-[#2f6b3a]">{copy.saved}</p> : null}
      {params.foto === undefined ? null : (
        <p role="alert" className="text-sm text-[#8c2f1e]">
          {params.foto === 'tooBig'
            ? interpolate(copy.photo.tooBig, { mb: String(Math.round(MAX_AVATAR_BYTES / 1024 / 1024)) })
            : copy.photo.notAnImage}
        </p>
      )}

      <form action={saveProfileAction} className="flex max-w-xl flex-col gap-6">
        <div className="flex flex-wrap items-center gap-5">
          {/* La foto tal como saldrá, redonda: un recorte malo se ve aquí y no
              en la cabecera, que es donde ya no tiene arreglo. */}
          <Avatar src={photo} name={user?.name ?? session.email} size={96} />

          <div className="flex min-w-60 flex-1 flex-col gap-2">
            <Field label={copy.photo.label} hint={copy.photo.hint}>
              {/* `image/*` a secas, y a propósito. Enumerar `image/heic` haría
                  que un iPhone mandara el HEIC tal cual, y el descodificador de
                  este servidor no trae HEVC —es una cuestión de patentes, no de
                  configuración—, así que la mitad del mercado vería «ese
                  archivo no es una imagen» subiendo una foto perfectamente
                  buena. Sin enumerarlo, iOS la convierte a JPEG al enviarla. */}
              <input type="file" name="avatar" accept="image/*" className={FIELD_CLASS} />
            </Field>

            {photo === null ? null : (
              <label className="flex items-center gap-2 text-sm text-[#8c2f1e]">
                <input type="checkbox" name="removeAvatar" value="1" />
                {copy.photo.remove}
              </label>
            )}
          </div>
        </div>

        {/* El correo es con lo que se entra. Se enseña porque hace falta saber
            con qué cuenta se está, y no se edita porque cambiarlo aquí, sin
            confirmar el nuevo, es cómo alguien que se cuela una vez se queda
            con la cuenta para siempre. */}
        <div className="flex flex-col gap-2 text-sm text-[#23201a]">
          <span>
            {copy.email}
            <span className="opacity-60"> · {copy.emailHint}</span>
          </span>
          {/* Un `<p>` y no un campo apagado: un recuadro que parece un campo y
              no deja escribir se intenta rellenar tres veces antes de creerlo. */}
          <p className="border border-[#ddd6c6] bg-[#efe9dd] px-4 py-3 font-mono text-sm" dir="ltr">
            {session.email}
          </p>
        </div>

        <Field label={copy.name}>
          <input name="name" defaultValue={user?.name ?? ''} maxLength={120} className={FIELD_CLASS} />
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

        <Field label={copy.country} hint={copy.countryHint}>
          <select name="country" defaultValue={user?.country ?? ''} className={FIELD_CLASS}>
            <option value="">{copy.noCountry}</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name} · {country.dial}
              </option>
            ))}
          </select>
        </Field>

        <Field label={copy.timezone} hint={copy.timezoneHint}>
          <select name="timezone" defaultValue={user?.timezone ?? ''} className={FIELD_CLASS}>
            <option value="">
              {copy.timezoneAuto}
              {countryZone === null ? '' : ` · ${countryZone}`}
            </option>
            {zoneGroups(locale).map((group) => (
              <optgroup key={group.region} label={group.region}>
                {group.zones.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        <button
          type="submit"
          className="self-start bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] hover:opacity-90"
        >
          {copy.save}
        </button>
      </form>

      {mayHavePassword ? (
        <PasswordSection
          hasPassword={user?.passwordHash != null}
          minLength={MIN_PASSWORD_LENGTH}
          {...(params.clave === undefined ? {} : { result: params.clave })}
          dictionary={dictionary}
          locale={locale}
        />
      ) : null}

      <SessionsSection
        sessions={await listSessions(session.userId, session.sessionId)}
        timezone={zone}
        {...(params.sesion === undefined ? {} : { notice: params.sesion })}
        dictionary={dictionary}
        locale={locale}
      />
    </>
  );
}

interface ZoneGroup {
  region: string;
  zones: { id: string; label: string }[];
}

/**
 * Las cuatrocientas y pico zonas, agrupadas por continente.
 *
 * Una lista plana de cuatrocientas líneas no se recorre; agrupada, se salta
 * directamente a «America» o a «Asia». Y cada una lleva la hora que marca ahí
 * ahora mismo, porque «Asia/Beirut» no le dice a nadie si es la suya y
 * «Asia/Beirut · 14:05» sí.
 */
function zoneGroups(locale: string): ZoneGroup[] {
  const groups = new Map<string, { id: string; label: string }[]>();

  for (const id of timezones()) {
    const region = id.includes('/') ? (id.split('/')[0] ?? id) : id;
    const city = (id.includes('/') ? id.slice(id.indexOf('/') + 1) : id).replaceAll('_', ' ');
    const clock = nowIn(id, locale);

    const list = groups.get(region) ?? [];
    list.push({ id, label: clock === '' ? city : `${city} · ${clock}` });
    groups.set(region, list);
  }

  return [...groups.entries()].map(([region, zones]) => ({ region, zones }));
}
