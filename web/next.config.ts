import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The repo root holds its own lockfile for the engine in `src/`; without
  // this Next infers that as the workspace root and warns on every build.
  outputFileTracingRoot: path.join(import.meta.dirname, '..'),
  // `pg` opens TCP sockets and must not be traced into the client bundle or
  // bundled into the server runtime — it stays a plain Node require.
  serverExternalPackages: ['pg'],
  eslint: {
    dirs: ['app', 'components', 'lib'],
  },
};

export default nextConfig;
