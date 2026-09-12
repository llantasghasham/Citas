import { redirect } from 'next/navigation';

import { revokeSuperadminAction, sendTestMailAction } from '@/app/panel/sistema/actions';
import { getAdminContext } from '@/lib/admin/context';
import { getSession, sessionCan } from '@/lib/auth/session';
import { readHealth, type HealthLevel } from '@/lib/system/health';
import { readStack } from '@/lib/system/versions';
import { displayFont } from '@/lib/typography';
import type { Dictionary } from '@citas/core';

export const dynamic = 'force-dynamic';

const LEVEL_CLASS: Record<HealthLevel, string> = {
  ok: 'text-[#2f6b3a]',
  warn: 'text-[#8a6c22]',
  fail: 'text-[#8c2f1e]',
};

const LEVEL_MARK: Record<HealthLevel, string> = { ok: '●', warn: '▲', fail: '■' };

/**
 * What this installation is running, and what is missing for it to work.
 *
 * Restricted to the superadmin: it names the environment variables that are
 * unset, which is a map of the machine's weak spots and not something an
 * office's staff needs.
 */
interface PageProps {
  searchParams: Promise<{ mail?: string; reason?: string; super?: string }>;
}

export default async function SystemPage({ searchParams }: PageProps) {
  const { mail, reason, super: superResult } = await searchParams;
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.system;
  const [stack, health] = await Promise.all([readStack(), readHealth()]);
  // Los de más salen de la comprobación que YA se hizo, no de otra consulta:
  // dos lecturas de lo mismo en la misma pantalla es cómo acaban enseñando
  // cosas distintas.
  const extras = (health.find((check) => check.key === 'extraSuperadmins')?.detail ?? '')
    .split('·')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes('@'));

  const levelLabel: Record<HealthLevel, string> = {
    ok: copy.health.ok,
    warn: copy.health.warn,
    fail: copy.health.fail,
  };

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className={`${displayFont(locale)} text-3xl`}>{copy.title}</h1>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.intro}</p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.health.heading}</h2>
        <ul className="flex flex-col gap-2">
          {health.map((check) => (
            <li
              key={check.key}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[#ddd6c6] pb-2 text-sm"
            >
              <span className={`${LEVEL_CLASS[check.level]} w-24`}>
                <span aria-hidden="true">{LEVEL_MARK[check.level]}</span> {levelLabel[check.level]}
              </span>
              <span className="text-[#23201a]">{copy.health.checks[check.key]}</span>
              <span className="font-mono text-xs text-[#6a6456]">
                <span dir="ltr">{check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Los que sobran, con un botón. Iba en ámbar y sin nada que pulsar, así
          que la cuenta de relleno del instalador llevaba meses mandando sobre
          todas las oficinas. Solo sale cuando hay alguno. */}
      {extras.length > 0 && (
        <section className="flex flex-col gap-3 border-t border-[#ddd6c6] pt-6">
          <h2 className={`${displayFont(locale)} text-xl`}>{copy.superadmins.heading}</h2>
          <p className="max-w-2xl text-sm text-[#6a6456]">{copy.superadmins.intro}</p>

          {superResult !== undefined && (
            <p
              role={superResult === 'ok' ? undefined : 'alert'}
              className={`text-sm ${superResult === 'ok' ? 'text-[#2f6b3a]' : 'text-[#8c2f1e]'}`}
            >
              {superMessage(copy.superadmins, superResult)}
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {extras.map((email) => (
              <li key={email} className="flex flex-wrap items-center gap-3 text-sm">
                <span dir="ltr" className="font-mono text-xs text-[#23201a]">
                  {email}
                </span>
                <form action={revokeSuperadminAction}>
                  <input type="hidden" name="email" value={email} />
                  <button
                    type="submit"
                    className="border border-[#8c2f1e] px-3 py-1.5 text-sm text-[#8c2f1e] hover:opacity-70"
                  >
                    {copy.superadmins.revoke}
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="max-w-2xl text-xs text-[#6a6456]">{copy.superadmins.note}</p>
        </section>
      )}

      <section className="flex flex-col gap-4 border-t border-[#ddd6c6] pt-6">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.mail.heading}</h2>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.mail.intro}</p>

        {mail === 'ok' ? (
          <div className="flex max-w-2xl flex-col gap-2">
            <p className="text-sm text-[#2f6b3a]">{copy.mail.ok}</p>
            {/* The provider's own receipt. "Sent" alone proves nothing: a
                server can accept a message and drop it without telling anyone. */}
            <code
              dir="ltr"
              className="block overflow-x-auto border border-[#ddd6c6] bg-white px-4 py-2 font-mono text-xs"
            >
              {reason ?? '—'}
            </code>
          </div>
        ) : mail === 'tooSoon' ? (
          <p className="text-sm text-[#8a6c22]">{copy.mail.tooSoon}</p>
        ) : mail === 'failed' ? (
          <div className="flex max-w-2xl flex-col gap-2">
            <p role="alert" className="text-sm text-[#8c2f1e]">
              {copy.mail.failed}
            </p>
            {/* The provider's own words. smtp.ts has already stripped the auth
                line, and without this there is nothing to diagnose with. */}
            <code
              dir="ltr"
              className="block overflow-x-auto border border-[#ddd6c6] bg-white px-4 py-2 font-mono text-xs"
            >
              {reason ?? '—'}
            </code>
          </div>
        ) : null}

        <form action={sendTestMailAction}>
          <button
            type="submit"
            className="border border-[#23201a] px-6 py-3 text-base text-[#23201a] hover:opacity-70"
          >
            {copy.mail.test}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.stack.heading}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#c9bfa6] text-xs text-[#8a6c22]">
                <th className="py-2 pe-6 text-start">{copy.stack.component}</th>
                <th className="py-2 pe-6 text-start">{copy.stack.version}</th>
                <th className="py-2 text-start">{copy.stack.purpose}</th>
              </tr>
            </thead>
            <tbody>
              {stack.map((entry) => (
                <tr key={entry.key} className="border-b border-[#ddd6c6]">
                  {/* Package names and version numbers are Latin either way:
                      marked as such so a right-to-left row does not mirror the
                      "@" of a scoped package or glue the number to the prose. */}
                  <td className="py-2 pe-6 text-[#23201a]">
                    <span dir="ltr">{entry.name}</span>
                  </td>
                  <td className="py-2 pe-6 font-mono text-xs">
                    <span dir="ltr">{entry.version ?? '—'}</span>
                  </td>
                  <td className="py-2 text-[#6a6456]">{copy.stack.purposes[entry.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4 border-t border-[#ddd6c6] pt-6">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.updates.heading}</h2>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.updates.intro}</p>
        <p className="max-w-2xl text-sm text-[#8c2f1e]">{copy.updates.warning}</p>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.updates.howTo}</p>

        <dl className="flex flex-col gap-3">
          <dt className="text-sm text-[#23201a]">{copy.updates.checkCommand}</dt>
          <dd>
            <code
              dir="ltr"
              className="block overflow-x-auto border border-[#ddd6c6] bg-white px-4 py-2 font-mono text-xs"
            >
              cd /www/wwwroot/citas &amp;&amp; npm outdated
            </code>
          </dd>
          <dt className="text-sm text-[#23201a]">{copy.updates.updateCommand}</dt>
          <dd>
            <code
              dir="ltr"
              className="block overflow-x-auto border border-[#ddd6c6] bg-white px-4 py-2 font-mono text-xs"
            >
              cd /www/wwwroot/citas &amp;&amp; npm install &lt;paquete&gt;@latest -w @citas/web &amp;&amp; npm run
              typecheck &amp;&amp; npm run build &amp;&amp; systemctl restart citas
            </code>
          </dd>
        </dl>
      </section>
    </>
  );
}

/** Qué pasó al intentar quitarle el mando a alguien. */
function superMessage(copy: Dictionary['admin']['system']['superadmins'], result: string): string {
  const messages: Record<string, string> = {
    ok: copy.ok,
    self: copy.self,
    configured: copy.configured,
    last: copy.last,
    notFound: copy.notFound,
    invalid: copy.invalid,
  };
  return messages[result] ?? copy.invalid;
}
