import type { Metadata } from 'next';

import { getAdminContext } from '@/lib/admin/context';
import { bodyFont, displayFont } from '@/lib/typography';

import { requestCodeAction, signInWithPasswordAction, verifyCodeAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

interface PageProps {
  searchParams: Promise<{ email?: string; sent?: string; error?: string; password?: string }>;
}

const FIELD =
  'w-full border border-[#cdc6b6] bg-white px-4 py-3 text-base text-[#23201a] outline-none focus-visible:border-[#8a6c22] focus-visible:ring-2 focus-visible:ring-[#c9a227]';
const BUTTON =
  'w-full bg-[#23201a] px-4 py-3 text-base text-[#f4efe6] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a6c22]';

/**
 * Staff sign-in: a one-time code by email, which is how the end client and the
 * office's staff always get in.
 *
 * The password form is a third step, reachable only from the code screen, and
 * only an account that has been given a password can pass it — the platform's
 * own account and an office's administrator. It exists because the machine's
 * owner cannot be locked out by a mail server they do not control, which is
 * exactly what happened here. Failing it says the same thing as failing a code,
 * so nobody can use it to map which addresses exist.
 */
export default async function SignInPage({ searchParams }: PageProps) {
  const { email = '', sent, error, password } = await searchParams;
  const { dictionary, direction, locale, tenant } = await getAdminContext();
  const copy = dictionary.admin.signIn;
  const passwordStep = password === '1';
  const codeStep = sent === '1' && !passwordStep;

  return (
    <main
      dir={direction}
      lang={locale}
      className={`${bodyFont(locale)} flex min-h-[100dvh] items-center justify-center bg-[#f4efe6] p-6`}
    >
      <div className="flex w-full max-w-md flex-col gap-6 border border-[#ddd6c6] bg-[#fbf8f1] p-8">
        <header className="flex flex-col gap-2">
          <h1 className={`${displayFont(locale)} text-3xl text-[#23201a]`}>{copy.title}</h1>
          {tenant === null ? null : (
            <p className="text-sm text-[#6a6456]">{tenant.name}</p>
          )}
        </header>

        {passwordStep ? (
          <form action={signInWithPasswordAction} className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-[#6a6456]">{copy.passwordHint}</p>
            {error === '1' ? (
              <p role="alert" className="text-sm text-[#8c2f1e]">
                {copy.invalid}
              </p>
            ) : null}

            <input type="hidden" name="email" value={email} />
            <label className="flex flex-col gap-2 text-sm text-[#23201a]">
              {copy.passwordLabel}
              <input
                className={FIELD}
                type="password"
                name="password"
                autoComplete="current-password"
                dir="ltr"
                required
                autoFocus
              />
            </label>

            <button type="submit" className={BUTTON}>
              {copy.passwordSubmit}
            </button>
            <a
              href={`/entrar?email=${encodeURIComponent(email)}&sent=1`}
              className="text-center text-sm text-[#6a6456] underline"
            >
              {copy.codeLink}
            </a>
          </form>
        ) : codeStep ? (
          <form action={verifyCodeAction} className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-[#6a6456]">{copy.sent}</p>
            {error === '1' ? (
              <p role="alert" className="text-sm text-[#8c2f1e]">
                {copy.invalid}
              </p>
            ) : null}

            <input type="hidden" name="email" value={email} />
            <label className="flex flex-col gap-2 text-sm text-[#23201a]">
              {copy.codeLabel}
              <input
                className={`${FIELD} tracking-[0.5em]`}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
              />
            </label>

            <button type="submit" className={BUTTON}>
              {copy.verify}
            </button>
            <a href="/entrar" className="text-center text-sm text-[#6a6456] underline">
              {copy.otherEmail}
            </a>
            <a
              href={`/entrar?email=${encodeURIComponent(email)}&password=1`}
              className="text-center text-sm text-[#6a6456] underline"
            >
              {copy.passwordLink}
            </a>
          </form>
        ) : (
          <form action={requestCodeAction} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm text-[#23201a]">
              {copy.emailLabel}
              <input
                className={FIELD}
                type="email"
                name="email"
                defaultValue={email}
                autoComplete="email"
                dir="ltr"
                required
                autoFocus
              />
            </label>
            <p className="text-sm text-[#6a6456]">{copy.emailHint}</p>
            <button type="submit" className={BUTTON}>
              {copy.send}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
