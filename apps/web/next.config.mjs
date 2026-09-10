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
};

export default nextConfig;
