import puppeteer, { type Browser } from 'puppeteer-core';

/**
 * We ship `puppeteer-core` and point it at a Chromium that is already on the
 * machine instead of downloading a second copy at install time.
 *
 * Discovery deliberately touches no filesystem API: a directory scan here makes
 * the bundler trace the entire project — sources and /public included — into the
 * server output. Instead we try to launch each candidate and keep the first that
 * starts. Set `CHROMIUM_PATH` when the browser lives somewhere else (a
 * Playwright-managed browser directory, for instance).
 */
const WELL_KNOWN_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
] as const;

function candidatePaths(): string[] {
  const configured = process.env['CHROMIUM_PATH'] ?? process.env['PUPPETEER_EXECUTABLE_PATH'];
  // An explicitly configured path is the only candidate: failing loudly beats
  // silently rendering with some other browser than the one that was asked for.
  if (configured !== undefined && configured.length > 0) return [configured];
  return [...WELL_KNOWN_PATHS];
}

async function launchBrowser(): Promise<Browser> {
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

  const candidates = candidatePaths();
  let lastError: unknown;

  for (const executablePath of candidates) {
    try {
      const browser = await puppeteer.launch({ executablePath, headless: true, args });
      browser.on('disconnected', () => {
        browserPromise = undefined;
      });
      return browser;
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(
    `No Chromium could be started. Tried: ${candidates.join(', ')}. ` +
      `Set CHROMIUM_PATH to a Chrome/Chromium binary.${detail}`,
  );
}

let browserPromise: Promise<Browser> | undefined;

/** One browser per process, reused across requests; pages are per request. */
export function getBrowser(): Promise<Browser> {
  if (browserPromise === undefined) {
    browserPromise = launchBrowser().catch((error: unknown) => {
      browserPromise = undefined;
      throw error;
    });
  }
  return browserPromise;
}
