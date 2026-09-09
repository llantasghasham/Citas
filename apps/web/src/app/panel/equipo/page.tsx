import { redirect } from 'next/navigation';

import { addMemberAction } from '@/app/panel/actions';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import { getAdminContext } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { listMembers } from '@/lib/repositories/tenants';
import { displayFont, latinOnly } from '@/lib/typography';

const ROLES = ['TENANT_ADMIN', 'OPERATOR', 'ORGANIZER'] as const;

/** Who works in this office. Scoped, so no office sees another office's people. */
export default async function TeamPage() {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'tenant:staff') || session.tenantId === null) {
    redirect('/panel');
  }

  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.team;
  const members = await listMembers(scopeOf(session));

  return (
    <>
      <h1 className={`${displayFont(locale)} text-3xl`}>{copy.heading}</h1>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <thead>
            <tr className={`border-b border-[#c9bfa6] text-xs ${latinOnly(locale, 'uppercase tracking-[0.12em]')} text-[#8a6c22]`}>
              <th className="py-2 text-start">{copy.email}</th>
              <th className="py-2 text-start">{copy.role}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId} className="border-b border-[#ddd6c6]">
                <td className="py-3 font-mono text-xs" dir="ltr">{member.email}</td>
                <td className="py-3">{dictionary.admin.roles[member.role]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {members.length === 0 ? <p className="py-3 text-sm text-[#6a6456]">{copy.empty}</p> : null}
      </div>

      <form action={addMemberAction} className="flex max-w-md flex-col gap-4 border-t border-[#ddd6c6] pt-6">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.add}</h2>

        <Field label={copy.email}>
          <input type="email" name="email" required dir="ltr" className={FIELD_CLASS} />
        </Field>
        <Field label={copy.role}>
          <select name="role" className={FIELD_CLASS}>
            {ROLES.map((role) => (
              <option key={role} value={role}>{dictionary.admin.roles[role]}</option>
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
