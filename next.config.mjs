/** @type {import('next').NextConfig} */
const nextConfig = {
  // puppeteer-core must stay a real Node dependency, not be bundled by Turbopack/webpack.
  serverExternalPackages: ['puppeteer-core'],
};

export default nextConfig;
