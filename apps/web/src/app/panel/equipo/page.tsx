import { redirect } from 'next/navigation';

import { addMemberAction } from '@/app/panel/actions';
import { updateMemberAction } from '@/app/panel/equipo/actions';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import { getAdminContext } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { LOCALE_NAMES } from '@/lib/create/options';
import { listMembers } from '@/lib/repositories/tenants';
import { displayFont, latinOnly } from '@/lib/typography';
import { countriesFor, LOCALES } from '@citas/core';

export const dynamic = 'force-dynamic';

const ROLES = ['TENANT_ADMIN', 'OPERATOR', 'ORGANIZER'] as const;

interface PageProps {
  searchParams: Promise<{ guardado?: string; added?: string }>;
}

/**
 * Quién trabaja en esta oficina, con qué permiso y cómo trabaja.
 *
 * Filtrado por oficina, así que ninguna ve la gente de otra. Cada fila se
 * guarda por su cuenta: cambiar el idioma de una persona no reescribe el rol de
 * las demás, y una pantalla con un solo botón para veinte filas es una pantalla
 * en la que se cambia lo que no se quería.
 *
 * Lo que NO está aquí es la foto ni el teléfono: eso lo escribe cada uno en su
 * perfil. Quien administra reparte permisos, no rellena datos ajenos.
 */
export default async function TeamPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'tenant:staff') || session.tenantId === null) {
    redirect('/panel');
  }

  const { guardado } = await searchParams;
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.team;
  const members = await listMembers(scopeOf(session));
  const countries = countriesFor(locale);

  return (
    <>
      <h1 className={`${displayFont(locale)} text-3xl`}>{copy.heading}</h1>
      {guardado === '1' ? <p className="text-sm text-[#2f6b3a]">{dictionary.admin.config.saved}</p> : null}

      {members.length === 0 ? (
        <p className="text-sm text-[#6a6456]">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {members.map((member) => (
            <li key={member.userId}>
              <form
                action={updateMemberAction}
                className="flex flex-col gap-3 border border-[#ddd6c6] bg-white/60 p-4"
              >
                <input type="hidden" name="userId" value={member.userId} />

                <div className="flex items-center gap-3">
                  {member.avatarUrl === null ? (
                    <span className="grid size-9 place-items-center rounded-full bg-[#ddd6c6] text-sm text-[#6a6456]">
                      {(member.name ?? member.email).slice(0, 1).toUpperCase()}
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- una
                    // dirección que escribió esa persona en su perfil.
                    <img src={member.avatarUrl} alt="" className="size-9 rounded-full object-cover" />
                  )}
                  <span className="flex flex-col">
                    {member.name === null ? null : <span className="text-sm">{member.name}</span>}
                    <span className="font-mono text-xs text-[#6a6456]" dir="ltr">
                      {member.email}
                    </span>
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className={`flex flex-col gap-1 text-xs ${latinOnly(locale, 'tracking-[0.02em]')} text-[#6a6456]`}>
                    {copy.role}
                    <select name="role" defaultValue={member.role} className={FIELD_CLASS}>
                      {/* Un superadministrador aparece con su rol y no se
                          reasigna desde aquí: no sale de una membresía. */}
                      {member.role === 'SUPERADMIN' ? (
                        <option value="SUPERADMIN">{dictionary.admin.roles.SUPERADMIN}</option>
                      ) : (
                        ROLES.map((role) => (
                          <option key={role} value={role}>
                            {dictionary.admin.roles[role]}
                          </option>
                        ))
                      )}
                    </select>
                  </label>

                  <label className={`flex flex-col gap-1 text-xs ${latinOnly(locale, 'tracking-[0.02em]')} text-[#6a6456]`}>
                    {copy.locale}
                    <select name="locale" defaultValue={member.locale} className={FIELD_CLASS}>
                      {LOCALES.map((option) => (
                        <option key={option} value={option}>
                          {LOCALE_NAMES[option]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className={`flex flex-col gap-1 text-xs ${latinOnly(locale, 'tracking-[0.02em]')} text-[#6a6456]`}>
                    {copy.country}
                    <select name="country" defaultValue={member.country ?? ''} className={FIELD_CLASS}>
                      <option value="">{dictionary.admin.profile.noCountry}</option>
                      {countries.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name} · {country.dial}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <button
                  type="submit"
                  className="self-start border border-[#23201a] px-4 py-2 text-sm hover:opacity-70"
                >
                  {copy.save}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={addMemberAction} className="flex max-w-md flex-col gap-4 border-t border-[#ddd6c6] pt-6">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.add}</h2>

        <Field label={copy.email}>
          <input type="email" name="email" required dir="ltr" className={FIELD_CLASS} />
        </Field>
        <Field label={copy.role}>
          <select name="role" className={FIELD_CLASS}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {dictionary.admin.roles[role]}
              </option>
            ))}
          </select>
        </Field>

        <button type="submit" className="bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] hover:opacity-90">
          {copy.add}
        </button>
      </form>
    </>
  );
}
