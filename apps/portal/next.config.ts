import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Самодостаточная сборка: в образ попадают только нужные модули, а не весь
  // node_modules монорепы. Это же — рекомендованный способ деплоя Next.
  output: 'standalone',
  // @luciferus/* отдают TS-исходники напрямую, без шага сборки —
  // поэтому Next должен их транспилировать.
  transpilePackages: ['@luciferus/config', '@luciferus/protocol'],
}

export default nextConfig
