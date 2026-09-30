import { expect } from 'bun:test'
import { serverConfig } from '@luciferus/config'
import { db } from '@luciferus/db'
import { games, ledger, providers, users, wallets } from '@luciferus/db/schema'
import type { AuthResponse } from '@luciferus/protocol/auth'
import type { ApiErrorCode } from '@luciferus/protocol/errors'
import type { GameStatus } from '@luciferus/protocol/game'
import { eq, like, sql } from 'drizzle-orm'
import { AppError } from '../src/lib/errors'
import { issueGameToken } from '../src/lib/signed-token'
import { register, resolveSession } from '../src/services/auth'

/**
 * Префикс тестовых аккаунтов. Без подчёркивания — в SQL `LIKE` символ `_`
 * означает «любой один символ», и `test_%` неожиданно совпал бы с `testX...`.
 */
const TEST_PREFIX = 'spec'

const TEST_PASSWORD = 'spec-password-123'

let counter = 0

export function uniqueUsername(): string {
  counter += 1
  return `${TEST_PREFIX}${Date.now().toString(36)}${counter}`
}

/** Падает с понятной подсказкой, если Postgres не поднят, вместо загадочных таймаутов. */
export async function assertDatabaseReachable(): Promise<void> {
  try {
    await db.execute(sql`select 1`)
  } catch (error) {
    throw new Error('Тесты требуют Postgres. Запустите: bun run infra:up && bun run db:migrate', {
      cause: error,
    })
  }
}

export async function cleanupTestUsers(): Promise<void> {
  // Кошельки, сессии и леджер уходят каскадом по внешним ключам.
  await db.delete(users).where(like(users.username, `${TEST_PREFIX}%`))
}

/**
 * Игра для тестов. Объявленный origin по умолчанию есть — иначе её нельзя
 * запустить, а именно запуск чаще всего и проверяется.
 */
export async function createTestGame(
  options: {
    allowedOrigins?: string[]
    limits?: { minBet: number; maxBet: number; maxWin: number }
    fairMode?: 'client' | 'provably-fair'
  } = {},
): Promise<{ id: string; slug: string; embedUrl: string }> {
  const slug = `spec-game-${Math.random().toString(36).slice(2, 10)}`

  const [game] = await db
    .insert(games)
    .values({
      slug,
      title: `Тестовая игра ${slug}`,
      embedUrl: 'https://game.test/',
      allowedOrigins: options.allowedOrigins ?? ['https://game.test'],
      status: 'live',
      limits: options.limits ?? { minBet: 0.1, maxBet: 100, maxWin: 5000 },
      fairMode: options.fairMode ?? 'client',
    })
    .returning({ id: games.id, slug: games.slug, embedUrl: games.embedUrl })

  if (!game) throw new Error('Не удалось создать тестовую игру')

  return game
}

export async function cleanupTestGames(): Promise<void> {
  await db.delete(games).where(like(games.slug, 'spec-game-%'))
  // Студии авторов из тестов создаются автоматически и уходят следом.
  await db.delete(providers).where(like(providers.slug, 'u-spec%'))
}

/**
 * Явно выставляет статус игры.
 *
 * Нужно, потому что начальный статус заявки зависит от `AUTO_APPROVE_GAMES`,
 * а тесты обязаны вести себя одинаково и в CI, и на машине разработчика.
 */
export async function setGameStatus(slug: string, status: GameStatus): Promise<void> {
  await db.update(games).set({ status }).where(eq(games.slug, slug))
}

/** Полный цикл: игрок + сессия + игра + игровой токен. */
export async function createGameFixture(
  options: {
    allowedOrigins?: string[]
    limits?: { minBet: number; maxBet: number; maxWin: number }
    fairMode?: 'client' | 'provably-fair'
  } = {},
) {
  const { user, session } = await createTestUser()
  const game = await createTestGame(options)

  const resolved = await resolveSession(session.token)
  if (!resolved) throw new Error('Не удалось разобрать созданную сессию')

  const gameToken = issueGameToken(
    {
      userId: user.id,
      gameId: game.id,
      gameSlug: game.slug,
      portalSessionId: resolved.sessionId,
      ttlSeconds: 3600,
    },
    serverConfig.gameSessionSecret,
  )

  return { user, session, game, gameToken, sessionId: resolved.sessionId }
}

export async function createTestUser(): Promise<AuthResponse> {
  return register({
    username: uniqueUsername(),
    displayName: 'Тестовый игрок',
    password: TEST_PASSWORD,
  })
}

export { TEST_PASSWORD }

export async function balanceOf(userId: string): Promise<string> {
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1)
  if (!wallet) throw new Error(`Кошелёк ${userId} не найден`)
  return wallet.balance
}

export async function ledgerOf(userId: string) {
  return db.select().from(ledger).where(eq(ledger.userId, userId))
}

/**
 * Проверяет, что операция упала ожидаемым `AppError` с нужным кодом.
 * Падение по другой причине (или успех) — это провал теста, а не «ну почти».
 */
export async function expectAppError(
  promise: Promise<unknown>,
  code: ApiErrorCode,
): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    const appError = error as AppError
    expect(appError.code).toBe(code)
    return appError
  }

  throw new Error(`Ожидалась ошибка «${code}», но операция прошла успешно`)
}
