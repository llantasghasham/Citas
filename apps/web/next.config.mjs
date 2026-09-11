/** @type {import('next').NextConfig} */
const nextConfig = {
  // puppeteer-core must stay a real Node dependency, not be bundled by Turbopack/webpack.
  serverExternalPackages: ['puppeteer-core'],
  // The shared package ships TypeScript source so the mobile app can consume it
  // too; Next compiles it as part of this app.
  transpilePackages: ['@citas/core'],

  experimental: {
    /**
     * Lo que puede pesar el envío de un formulario.
     *
     * Sin poner esto, Next corta en un mega. Y el código decía que aceptaba
     * ocho: una foto de teléfono de dos megas se rechazaba antes de llegar a
     * mirarse, con un error del framework en vez del mensaje que este proyecto
     * había escrito para ese caso. Dos límites distintos, y el que mandaba no
     * era el que estaba explicado.
     *
     * Se pone POR ENCIMA del mayor que comprueba el código —los ocho megas de
     * la foto de perfil— justo para que quien decida y quien lo explique sean
     * el mismo.
     */
    serverActions: { bodySizeLimit: '10mb' },
  },

  /**
   * Cabeceras de seguridad. No había ninguna.
   *
   * Van por grupos porque las tres partes de este sistema no se parecen:
   *
   *  - La INVITACIÓN es una página pública que se reenvía por WhatsApp y que
   *    carga imágenes y fuentes de este mismo origen. Se le pone una política
   *    de contenido cerrada y no se deja incrustar FUERA de este origen: una
   *    invitación dentro de un marco ajeno es la forma de enseñársela a alguien
   *    diciéndole que es de otro.
   *  - El PANEL tiene sesión, así que además de lo anterior no se le permite
   *    salir a ningún origen.
   *  - El LIENZO de captura (`/render/...`) lo abre Chromium contra el bucle
   *    local; si se le cierra el marco no pasa nada, y así no se le puede
   *    llegar por fuera tampoco.
   *
   * `unsafe-inline` en los estilos hace falta: Next escribe el CSS en línea y
   * las tarjetas llevan variables de color en `style`. Los SCRIPTS no lo
   * llevan, que es donde importa.
   */
  async headers() {
    const comunes = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // `SAMEORIGIN` y no `DENY`: la espera del código QR de WhatsApp vive en
      // un marco de este mismo origen, a propósito —su `<meta refresh>` tiene
      // que morir al salir de la pantalla— y `DENY` la habría dejado en blanco.
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
      },
      {
        // Un año, con subdominios: las oficinas cuelgan de subdominios y una de
        // ellas servida en claro dejaría la cookie de sesión al aire.
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          // Ver arriba: el marco del código QR es de este mismo origen.
          "frame-ancestors 'self'",
          "object-src 'none'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self'",
          // El mapa del salón y la pasarela de cobro se abren en otra pestaña,
          // nunca dentro: por eso no hay `frame-src`.
          'upgrade-insecure-requests',
        ].join('; '),
      },
    ];

    return [{ source: '/:path*', headers: comunes }];
  },
};

export default nextConfig;
