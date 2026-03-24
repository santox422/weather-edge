import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Allow external packages that use native addons
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
