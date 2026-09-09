import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import puppeteer from 'puppeteer-core';

/**
 * Renders the home page's share card to public/og/home.png.
 *
 * Drawn by the same headless Chromium that draws the invitations, from HTML and
 * the project's own local fonts — never a generated picture. Run it again after
 * editing scripts/og-home.html and commit the result: it is a static file, so a
 * visitor's share preview costs nothing at request time.
 *
 *   npm run og:build --workspace @citas/web
 */
const SIZE = { width: 1200, height: 630 };

async function main(): Promise<void> {
  const source = resolve(process.cwd(), 'scripts/og-home.html');
  const target = resolve(process.cwd(), 'public/og/home.png');
  await mkdir(dirname(target), { recursive: true });

  const executablePath = process.env['CHROMIUM_PATH'];
  if (executablePath === undefined) {
    console.error('CHROMIUM_PATH is not set.');
    process.exitCode = 1;
    return;
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ ...SIZE, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle0' });
    // The fonts are declared `font-display: block` elsewhere for the same
    // reason: a screenshot must never capture a fallback face.
    await page.evaluateHandle('document.fonts.ready');
    await page.screenshot({ path: target, type: 'png' });
    console.log(`Wrote ${target} (${SIZE.width}x${SIZE.height}).`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
