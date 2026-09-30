import { economy } from './economy'

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === 'true' || value === '1'
}

/**
 * Конфиг серверной части. Читается один раз при импорте модуля, поэтому в
 * скриптах (миграции, сиды) корневой `.env` должен быть загружен ДО импорта
 * этого файла — в `packages/db` это делает `src/env.ts`.
 */
export const serverConfig = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',

  port: int(process.env.PORT, 3001),
  portalUrl: process.env.PORTAL_URL ?? 'http://localhost:3000',
  apiUrl: process.env.API_URL ?? 'http://localhost:3001',

  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://luciferus:luciferus@localhost:55432/luciferus',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:56379',

  /** Секрет для подписи игровых сессионных токенов (фаза 2). */
  gameSessionSecret: process.env.GAME_SESSION_SECRET ?? 'dev-only-change-me',

  /** Локально удобно пропускать модерацию новых игр. В проде — всегда false. */
  autoApproveGames: bool(process.env.AUTO_APPROVE_GAMES, false),
  /** Сидированные боты в лобби, чтобы лента выигрышей не была пустой. */
  lobbyBots: bool(process.env.LOBBY_BOTS, true),

  signupBonus: int(process.env.SIGNUP_BONUS, economy.signupBonus),
  reloadBonus: int(process.env.RELOAD_BONUS, economy.reloadBonus),
  reloadCooldownMinutes: int(process.env.RELOAD_COOLDOWN_MINUTES, economy.reloadCooldownMinutes),
} as const

export type ServerConfig = typeof serverConfig

/** Предупреждает в логах, если прод запущен с небезопасными значениями по умолчанию. */
export function assertProductionSafety(): string[] {
  if (!serverConfig.isProduction) return []

  const warnings: string[] = []
  if (serverConfig.gameSessionSecret === 'dev-only-change-me') {
    warnings.push(
      'GAME_SESSION_SECRET не изменён — игровые токены подписаны публично известным ключом',
    )
  }
  if (serverConfig.autoApproveGames) {
    warnings.push('AUTO_APPROVE_GAMES=true в проде — модерация игр отключена')
  }
  return warnings
}
