import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import puppeteer, { type Browser } from 'puppeteer-core';

/**
 * We ship `puppeteer-core` and point it at a Chromium that is already on the
 * machine (CI image, Docker layer, or a Playwright browsers directory) instead
 * of downloading a second copy at install time.
 */
function findChromium(): string {
  const fromEnv = process.env['CHROMIUM_PATH'] ?? process.env['PUPPETEER_EXECUTABLE_PATH'];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;

  const browsersRoot = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/opt/pw-browsers';
  if (existsSync(browsersRoot)) {
    const candidates = readdirSync(browsersRoot)
      .filter((entry) => entry.startsWith('chromium'))
      .sort()
      .flatMap((entry) => [
        join(browsersRoot, entry, 'chrome-linux', 'chrome'),
        join(browsersRoot, entry, 'chrome-linux', 'headless_shell'),
      ]);
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found !== undefined) return found;
  }

  const wellKnown = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const installed = wellKnown.find((candidate) => existsSync(candidate));
  if (installed !== undefined) return installed;

  throw new Error(
    'No Chromium executable found. Set CHROMIUM_PATH to a Chrome/Chromium binary.',
  );
}

let browserPromise: Promise<Browser> | undefined;

/** One browser per process, reused across requests; pages are per request. */
export function getBrowser(): Promise<Browser> {
  if (browserPromise === undefined) {
    const args = [
      '--disable-dev-shm-usage',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      '--hide-scrollbars',
    ];
    // Chromium refuses to run its sandbox as root; only then do we drop it.
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      args.push('--no-sandbox');
    }

    browserPromise = puppeteer
      .launch({ executablePath: findChromium(), headless: true, args })
      .then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = undefined;
        });
        return browser;
      })
      .catch((error: unknown) => {
        browserPromise = undefined;
        throw error;
      });
  }
  return browserPromise;
}
