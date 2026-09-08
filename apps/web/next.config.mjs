/** @type {import('next').NextConfig} */
const nextConfig = {
  // puppeteer-core must stay a real Node dependency, not be bundled by Turbopack/webpack.
  serverExternalPackages: ['puppeteer-core'],
  // The shared package ships TypeScript source so the mobile app can consume it
  // too; Next compiles it as part of this app.
  transpilePackages: ['@citas/core'],
};

export default nextConfig;
