import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { documentLanguage } from '@/lib/i18n/document';

import './globals.css';

const siteUrl = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Citas',
  description: 'Multilingual digital invitations',
};

/**
 * Nothing in this application can be prerendered, and it is said here rather
 * than left to each route to remember.
 *
 * `documentLanguage()` below reads cookies and headers, so any segment Next
 * still treats as static throws the moment it renders. That already cost one
 * deploy: `/render/[slug]` kept a `generateStaticParams`, stayed static, and
 * the failure surfaced as WhatsApp previews answering 500 — a page no guest
 * ever opens, breaking the one thing every guest sees.
 */
export const dynamic = 'force-dynamic';

/**
 * App shell.
 *
 * One shell serves four languages, so `lang` and `dir` cannot be constants:
 * an Arabic invitation announced as English is read out wrong by a screen
 * reader and indexed wrong by a search engine. Which language this page is in
 * is worked out in `documentLanguage()`, because a root layout never sees the
 * params of the page inside it.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, direction } = await documentLanguage();

  return (
    <html lang={locale} dir={direction}>
      <body className="bg-[#f4efe6] text-[#3b3226]">{children}</body>
    </html>
  );
}
