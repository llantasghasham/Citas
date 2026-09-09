import { redirect } from 'next/navigation';

import { getAdminContext } from '@/lib/admin/context';
import { getSession, sessionCan } from '@/lib/auth/session';
import { displayFont } from '@/lib/typography';
import { MANUAL_CHAPTERS } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The manual, inside the panel and in the office's own language.
 *
 * A PDF in a shared drive is a manual nobody opens. This one sits one click
 * from the work it describes, and it is translated like everything else: staff
 * in Beirut read it in Arabic.
 */
export default async function ManualPage() {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:read')) redirect('/panel');

  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.manual;

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className={`${displayFont(locale)} text-3xl`}>{copy.title}</h1>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.intro}</p>
      </header>

      <nav aria-label={copy.title}>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {MANUAL_CHAPTERS.map((chapter) => (
            <li key={chapter}>
              <a href={`#${chapter}`} className="text-[#8a6c22] underline">
                {copy.chapters[chapter].title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {MANUAL_CHAPTERS.map((chapter) => (
        <section
          key={chapter}
          id={chapter}
          className="flex scroll-mt-6 flex-col gap-3 border-t border-[#ddd6c6] pt-6"
        >
          <h2 className={`${displayFont(locale)} text-xl`}>{copy.chapters[chapter].title}</h2>
          <ul className="flex max-w-2xl flex-col gap-2">
            {copy.chapters[chapter].steps.map((step) => (
              <li key={step} className="flex gap-3 text-sm leading-relaxed text-[#4b4639]">
                <span aria-hidden="true" className="text-[#c9a227]">
                  ·
                </span>
                {step}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
