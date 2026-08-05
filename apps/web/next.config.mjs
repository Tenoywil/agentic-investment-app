/**
 * Static-export build: Next prerenders the marketing + onboarding shell to plain
 * HTML/CSS/JS in ./out, which Vercel serves statically — the same delivery model
 * as the prototype it replaces, so flipping the deployment carries no SSR risk.
 * (SSR + middleware session-gate is a later upgrade once the Vercel project's
 * root directory is pointed at apps/web.)
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  transpilePackages: ['@ccn/ui'],
  images: { unoptimized: true },
};

export default nextConfig;
