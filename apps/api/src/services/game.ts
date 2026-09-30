import { serverConfig } from '@luciferus/config'
import { db } from '@luciferus/db'
import { type GameLimits, games, sessions, users } from '@luciferus/db/schema'
import type { GameLaunch } from '@luciferus/protocol/embed'
import type { GameTokenClaims } from '@luciferus/protocol/embed-constants'
import { and, eq, isNull } from 'drizzle-orm'
import { AppError } from '../lib/errors'
import { issueGameToken, verifyGameToken } from '../lib/signed-token'
import { type AuthenticatedSession, toPublicUser } from './auth'
import { getWalletSummary } from './wallet'

/** Сколько живёт игровой токен. Дольше игровой сессии быть не должно. */
export const GAME_TOKEN_TTL_SECONDS = 2 * 60 * 60

export type GameRow = {
  id: string
  slug: string
  title: string
  embedUrl: string
  allowedOrigins: string[]
  limits: GameLimits
  fairMode: string
  status: string
}

export type GameContext = {
  claims: GameTokenClaims
  userId: string
  game: GameRow
}

export async function findLiveGameBySlug(slug: string): Promise<GameRow | null> {
  const [row] = await db
    .select({
      id: games.id,
      slug: games.slug,
      title: games.title,
      embedUrl: games.embedUrl,
      allowedOrigins: games.allowedOrigins,
      limits: games.limits,
      fairMode: games.fairMode,
      status: games.status,
    })
    .from(games)
    .where(and(eq(games.slug, slug), eq(games.status, 'live')))
    .limit(1)

  return row ?? null
}

/**
 * Выдаёт всё, что нужно порталу для запуска игры: адрес, игровой токен, баланс и лимиты.
 *
 * Игра без объявленных origin'ов запущена быть не может: порталу некуда адресовать
 * `casino:init`. Это не придирка, а следствие того, что мы нигде не постим в `*`.
 */
export async function createGameLaunch(
  slug: string,
  session: AuthenticatedSession,
): Promise<GameLaunch> {
  const game = await findLiveGameBySlug(slug)
  if (!game) throw AppError.notFound(`Игра «${slug}» не найдена или отключена`)

  if (game.allowedOrigins.length === 0) {
    throw AppError.conflict(
      'Игра не объявила ни одного origin в манифесте — портал не сможет с ней поздороваться',
      { allowedOrigins: [] },
    )
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1)
  if (!user) throw AppError.notFound('Пользователь не найден')

  const wallet = await getWalletSummary(user.id)

  const token = issueGameToken(
    {
      userId: user.id,
      gameId: game.id,
      gameSlug: game.slug,
      portalSessionId: session.sessionId,
      ttlSeconds: GAME_TOKEN_TTL_SECONDS,
    },
    serverConfig.gameSessionSecret,
  )

  return {
    game: {
      slug: game.slug,
      title: game.title,
      embedUrl: game.embedUrl,
      allowedOrigins: game.allowedOrigins,
      limits: game.limits,
      fairMode: game.fairMode === 'provably-fair' ? 'provably-fair' : 'client',
    },
    session: {
      token,
      expiresAt: new Date(Date.now() + GAME_TOKEN_TTL_SECONDS * 1000).toISOString(),
    },
    player: toPublicUser(user),
    wallet: { balance: wallet.balance, currency: wallet.currency },
    apiUrl: serverConfig.apiUrl,
  }
}

/**
 * Аутентифицирует запрос от игры.
 *
 * Проверяется три независимых условия, и все три обязательны:
 * 1. Подпись и срок токена — иначе его подделали.
 * 2. Сессия портала жива — иначе выход из аккаунта не отзывал бы доступ у игры,
 *    которая уже открыта в другой вкладке.
 * 3. Игра всё ещё включена, а игрок не заблокирован.
 */
export async function authenticateGameRequest(token: string | null): Promise<GameContext> {
  if (!token) throw AppError.unauthorized('Игра не передала токен')

  const claims = verifyGameToken(token, serverConfig.gameSessionSecret)
  if (!claims) throw AppError.unauthorized('Игровой токен недействителен или истёк')

  const [portalSession] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, claims.sid), isNull(sessions.revokedAt)))
    .limit(1)

  if (!portalSession) {
    throw AppError.unauthorized('Сессия портала завершена — откройте игру заново')
  }

  const [game] = await db
    .select({
      id: games.id,
      slug: games.slug,
      title: games.title,
      embedUrl: games.embedUrl,
      allowedOrigins: games.allowedOrigins,
      limits: games.limits,
      fairMode: games.fairMode,
      status: games.status,
    })
    .from(games)
    .where(eq(games.id, claims.gid))
    .limit(1)

  if (!game) throw AppError.notFound('Игра не найдена')
  if (game.status !== 'live') throw AppError.forbidden('Игра отключена')

  const [user] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1)

  if (!user) throw AppError.notFound('Игрок не найден')
  if (user.status !== 'active') throw AppError.forbidden('Аккаунт заблокирован')

  return { claims, userId: user.id, game }
}
