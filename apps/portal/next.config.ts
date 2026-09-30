import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @luciferus/* отдают TS-исходники напрямую, без шага сборки —
  // поэтому Next должен их транспилировать.
  transpilePackages: ['@luciferus/config', '@luciferus/protocol'],
}

export default nextConfig
