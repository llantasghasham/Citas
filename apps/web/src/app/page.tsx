import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { ClosingCta } from '@/components/home/ClosingCta';
import { FaqList } from '@/components/home/FaqList';
import { FeatureGrid } from '@/components/home/FeatureGrid';
import { Hero } from '@/components/home/Hero';
import { PricingTable } from '@/components/home/PricingTable';
import { Section } from '@/components/home/Section';
import { Showcase } from '@/components/home/Showcase';
import { SiteFooter } from '@/components/home/SiteFooter';
import { SiteHeader } from '@/components/home/SiteHeader';
import { StepList } from '@/components/home/StepList';
import { SITE, shows } from '@/config/site';
import { getDictionary } from '@/lib/dictionary';
import { resolveHomeLocale } from '@/lib/home/locale';
import { loadShowcase } from '@/lib/home/showcase';
import { bodyFont } from '@/lib/typography';
import { LOCALES, type Invitation } from '@/lib/types';

// Reads the visitor's language and whatever is published right now, so
// `npm run build` needs no reachable database to compile.
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ lang?: string }>;
}

async function localeOf(searchParams: PageProps['searchParams']) {
  const [{ lang }, requestHeaders] = await Promise.all([searchParams, headers()]);
  return resolveHomeLocale(lang, requestHeaders.get('accept-language') ?? '');
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const locale = await localeOf(searchParams);
  const copy = getDictionary(locale).home;
  const title = `${copy.hero.titleLead} ${copy.hero.titleHighlight}`;

  return {
    title,
    description: copy.hero.subtitle,
    alternates: {
      canonical: '/',
      // The same page in four languages, each at its own address. Without this
      // a search engine has to guess which one to show a reader in Beirut.
      languages: Object.fromEntries(LOCALES.map((option) => [option, `/?lang=${option}`])),
    },
    openGraph: {
      type: 'website',
      siteName: SITE.brand,
      url: '/',
      title,
      description: copy.hero.subtitle,
      locale,
      // Drawn once by the same headless Chromium that draws the invitations
      // (npm run og:build) and served as a static file: this link gets pasted
      // into WhatsApp groups, and a preview that costs a render per paste is a
      // preview that stops appearing.
      images: [{ url: '/og/home.png', width: 1200, height: 630, alt: SITE.brand }],
    },
    twitter: { card: 'summary_large_image', title, description: copy.hero.subtitle },
  };
}

/**
 * The public face of the platform.
 *
 * What it shows — which blocks, which selling points, which plans — is decided
 * in `config/site.ts`; what it says lives in the four locale files. Neither is
 * ever edited here.
 */
export default async function HomePage({ searchParams }: PageProps) {
  const locale = await localeOf(searchParams);
  const dictionary = getDictionary(locale);
  const copy = dictionary.home;
  const direction = locale === 'ar' ? 'rtl' : 'ltr';

  // The showcase is a nicety, not the page: a data source that is not there
  // must not take the home page down with it.
  const invitations = shows('showcase') ? await demoInvitations() : [];

  return (
    <div dir={direction} lang={locale} className={`${bodyFont(locale)} bg-[#14120E] text-[#F4EFE6]`}>
      <SiteHeader dictionary={dictionary} locale={locale} />

      <main>
        <Hero dictionary={dictionary} locale={locale} />

        {shows('features') ? (
          <Section
            id="features"
            locale={locale}
            heading={copy.features.heading}
            subheading={copy.features.subheading}
          >
            <FeatureGrid dictionary={dictionary} locale={locale} />
          </Section>
        ) : null}

        {shows('steps') ? (
          <Section
            id="steps"
            locale={locale}
            heading={copy.steps.heading}
            subheading={copy.steps.subheading}
          >
            <StepList dictionary={dictionary} locale={locale} />
          </Section>
        ) : null}

        {shows('showcase') ? (
          <Section
            id="showcase"
            locale={locale}
            heading={copy.showcase.heading}
            subheading={copy.showcase.subheading}
          >
            <Showcase invitations={invitations} dictionary={dictionary} locale={locale} />
          </Section>
        ) : null}

        {shows('pricing') ? (
          <Section
            id="pricing"
            locale={locale}
            heading={copy.pricing.heading}
            subheading={copy.pricing.subheading}
          >
            <PricingTable dictionary={dictionary} locale={locale} />
          </Section>
        ) : null}

        {shows('faq') ? (
          <Section id="faq" locale={locale} heading={copy.faq.heading}>
            <FaqList dictionary={dictionary} locale={locale} />
          </Section>
        ) : null}

        {shows('closing') ? <ClosingCta dictionary={dictionary} locale={locale} /> : null}
      </main>

      <SiteFooter dictionary={dictionary} locale={locale} />
    </div>
  );
}

async function demoInvitations(): Promise<Invitation[]> {
  try {
    return await loadShowcase();
  } catch {
    return [];
  }
}
