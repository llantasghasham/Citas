import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

/**
 * Dibuja la marca en todos los tamaños que pide el sistema.
 *
 * Todo sale de DOS archivos: `public/brand/mark.svg` —geometría escrita a mano,
 * nunca una imagen generada— y `scripts/brand-logo.html`, que le añade el
 * nombre con la tipografía del proyecto. Lo demás de aquí es recortar y
 * componer, para que cambiar el logo sea cambiar el SVG y volver a ejecutar
 * esto, y no ir buscando doce PNG por el repositorio.
 *
 *   npm run brand:build --workspace @citas/web
 *
 * Los resultados se COMMITEAN: son archivos estáticos, y ni la web ni una
 * tienda de aplicaciones van a ejecutar Chromium para pedirlos.
 */

const INK = '#14120E';
const web = (path: string): string => resolve(process.cwd(), path);
const mobile = (path: string): string => resolve(process.cwd(), '../mobile', path);

/** El SVG a un cuadrado, con el margen que se le pida. */
async function markPng(size: number, padding = 0, source = 'public/brand/mark.svg'): Promise<Buffer> {
  const inner = size - padding * 2;
  // `density` alto: sharp rasteriza el SVG a esa resolución antes de escalar, y
  // con la de por defecto los bordes del arco salen dentados.
  const mark = await sharp(web(source), { density: 600 }).resize(inner, inner).png().toBuffer();
  if (padding === 0) return mark;

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: mark, left: padding, top: padding }])
    .png()
    .toBuffer();
}

/** La marca sobre el fondo oscuro de la casa. Lo que se ve en una pestaña. */
async function tile(size: number, padding: number): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: INK } })
    .composite([{ input: await markPng(size, padding), left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function write(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  const { width, height } = await sharp(data).metadata();
  console.log(`  ${path} (${width}x${height})`);
}

/** El logotipo con el nombre, fotografiado con las fuentes de verdad. */
async function buildLogo(executablePath: string): Promise<void> {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 720, height: 180, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(web('scripts/brand-logo.html')).href, {
      waitUntil: 'networkidle0',
    });
    await page.evaluateHandle('document.fonts.ready');
    // Sin fondo: va sobre la cabecera oscura, y un rectángulo propio sería un
    // parche visible en cuanto alguien cambie ese color.
    const shot = await page.screenshot({ type: 'png', omitBackground: true });
    await write(web('public/brand/logo.png'), Buffer.from(shot));
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const executablePath = process.env['CHROMIUM_PATH'];
  if (executablePath === undefined) {
    console.error('CHROMIUM_PATH is not set.');
    process.exitCode = 1;
    return;
  }

  console.log('La web:');
  await buildLogo(executablePath);
  await write(web('public/brand/icon.png'), await tile(256, 34));

  console.log('La app:');
  // iOS no admite transparencia en el icono, así que va con su fondo dentro.
  await write(mobile('assets/icon.png'), await tile(1024, 150));
  await write(mobile('assets/favicon.png'), await tile(48, 6));
  // Android compone tres capas. La de delante se recorta a un círculo que deja
  // fuera un tercio del lienzo: de ahí el margen tan grande.
  await write(
    mobile('assets/android-icon-background.png'),
    await sharp({ create: { width: 512, height: 512, channels: 4, background: INK } })
      .png()
      .toBuffer(),
  );
  await write(mobile('assets/android-icon-foreground.png'), await markPng(512, 150));
  // La capa monocroma la tiñe el sistema y solo mira la transparencia: se usa
  // el arco macizo, con la estrella calada, que es la silueta reconocible.
  await write(mobile('assets/android-icon-monochrome.png'), await markPng(432, 120));
  await write(mobile('assets/splash-icon.png'), await markPng(1024, 300));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
