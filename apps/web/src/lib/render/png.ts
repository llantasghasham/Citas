import { getBrowser } from './browser';
import { allowedForCapture } from './origin';

/** The export size: a full-bleed story/WhatsApp frame. */
export const RENDER_WIDTH = 1080;
export const RENDER_HEIGHT = 1920;

/**
 * Screenshots the invitation's capture page. The PNG is produced by the same
 * engine that renders the web page, so Arabic shaping, ligatures and logical
 * properties come out exactly as a guest sees them in the browser.
 */
export async function renderInvitationPng(pageUrl: string): Promise<Uint8Array<ArrayBuffer>> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: RENDER_WIDTH,
      height: RENDER_HEIGHT,
      deviceScaleFactor: 1,
    });

    // El cinturón, además del tirante. La dirección de la página ya viene de un
    // origen fijo, pero la PÁGINA puede pedir lo que quiera: una imagen, una
    // fuente, una redirección. Aquí solo sale lo que cuelga de ese mismo
    // origen. Es una lista de permitidos y no de prohibidos a propósito: una
    // de prohibidos se salta con una redirección o con un nombre que resuelve
    // a una dirección privada.
    await page.setRequestInterception(true);
    page.on('request', (interceptable) => {
      if (allowedForCapture(interceptable.url())) {
        void interceptable.continue();
        return;
      }
      console.warn(`[render] petición bloqueada hacia ${interceptable.url()}`);
      void interceptable.abort('blockedbyclient');
    });

    const response = await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 30_000 });
    if (response !== null && !response.ok()) {
      throw new Error(`Capture page returned HTTP ${response.status()} for ${pageUrl}`);
    }
    // Local @font-face files must be fully loaded before the frame is captured.
    await page.evaluate(() => document.fonts.ready);
    // Copied into a plain ArrayBuffer-backed view so it can be used as a Blob part.
    return new Uint8Array(await page.screenshot({ type: 'png' }));
  } finally {
    await page.close();
  }
}
