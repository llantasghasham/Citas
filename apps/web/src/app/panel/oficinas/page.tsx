import { redirect } from 'next/navigation';

import { createOfficeAction } from '@/app/panel/actions';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import { getAdminContext } from '@/lib/admin/context';
import { getSession, sessionCan } from '@/lib/auth/session';
import { PLAN_CATALOGUE, planLabel } from '@/lib/billing/plans';
import { LOCALE_NAMES } from '@/lib/create/options';
import { listOffices } from '@/lib/repositories/tenants';
import { displayFont } from '@/lib/typography';
import { LOCALES } from '@/lib/types';

/** Platform-wide: only the superadmin sees other people's offices. */
export default async function OfficesPage() {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.offices;
  const offices = await listOffices();

  return (
    <>
      <h1 className={`${displayFont(locale)} text-3xl`}>{copy.heading}</h1>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#c9bfa6] text-xs uppercase tracking-[0.12em] text-[#8a6c22]">
              <th className="py-2 text-start">{copy.name}</th>
              <th className="py-2 text-start">{copy.subdomain}</th>
              <th className="py-2 text-start">{copy.plan}</th>
              <th className="py-2 text-start">{copy.status}</th>
              <th className="py-2 text-end">{dictionary.admin.events.heading}</th>
            </tr>
          </thead>
          <tbody>
            {offices.map((office) => (
              <tr key={office.id} className="border-b border-[#ddd6c6]">
                <td className="py-3">{office.name}</td>
                <td className="py-3 font-mono text-xs">{office.subdomain}</td>
                <td className="py-3">{office.tier === null ? '—' : planLabel(office.tier, dictionary)}</td>
                <td className="py-3 text-[#6a6456]">{office.status}</td>
                <td className="py-3 text-end tabular-nums">{office.events}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {offices.length === 0 ? <p className="py-3 text-sm text-[#6a6456]">{copy.empty}</p> : null}
      </div>

      <form action={createOfficeAction} className="flex max-w-md flex-col gap-4 border-t border-[#ddd6c6] pt-6">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.create}</h2>

        <Field label={copy.name}>
          <input name="name" required maxLength={120} className={FIELD_CLASS} />
        </Field>
        <Field label={copy.subdomain}>
          <input name="subdomain" required maxLength={32} dir="ltr" pattern="[a-z0-9-]+" className={FIELD_CLASS} />
        </Field>
        <Field label={copy.defaultLocale}>
          <select name="defaultLocale" className={FIELD_CLASS}>
            {LOCALES.map((option) => (
              <option key={option} value={option}>{LOCALE_NAMES[option]}</option>
            ))}
          </select>
        </Field>
        <Field label={copy.plan}>
          <select name="tier" className={FIELD_CLASS}>
            {PLAN_CATALOGUE.map((plan) => (
              <option key={plan.tier} value={plan.tier}>{planLabel(plan.tier, dictionary)}</option>
            ))}
          </select>
        </Field>

        <button type="submit" className="bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] hover:opacity-90">
          {copy.create}
        </button>
      </form>
    </>
  );
}
