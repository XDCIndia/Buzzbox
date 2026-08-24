import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  // Prevent Next.js from inferring a parent workspace root from monorepo traversal, which
  // changes the standalone output path layout and breaks systemd start paths.
  outputFileTracingRoot: path.join(__dirname),
  async redirects() {
    return [
      {
        source: '/agents',
        destination: '/agents/squads',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
