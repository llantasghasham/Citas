import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

const siteUrl = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Citas',
  description: 'Multilingual digital invitations',
};

/**
 * App shell. Each invitation carries its own `lang`/`dir` on the card root,
 * because a single shell serves all four locales.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="bg-[#f4efe6] text-[#3b3226]">{children}</body>
    </html>
  );
}
