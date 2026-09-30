import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @luciferus/config отдаёт TS-исходники напрямую, без шага сборки —
  // поэтому Next должен их транспилировать.
  transpilePackages: ['@luciferus/config'],
}

export default nextConfig
