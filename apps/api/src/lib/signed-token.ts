import { createHmac, timingSafeEqual } from 'node:crypto'
import type { GameTokenClaims } from '@luciferus/protocol/embed-constants'

/**
 * Подписанный токен для игры.
 *
 * Это НЕ JWT. У JWT есть заголовок с полем `alg`, который атакующий может
 * подменить (`alg: none` и прочие классические дыры). Здесь заголовка нет вовсе:
 * алгоритм зашит в код, подписывается ровно одна строка, и никакой информации из
 * токена до проверки подписи не используется.
 *
 * Формат: `base64url(JSON payload) + '.' + base64url(HMAC-SHA256(secret, payload))`
 *
 * Смысл токена: дать игре право тратить деньги ровно одного игрока ровно в одной
 * игре и ровно ограниченное время. Украсть его у игры бессмысленно — она и так
 * распоряжается только этим.
 */

const TOKEN_VERSION = 1

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(payload: string, secret: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(payload).digest())
}

/** Сравнение за постоянное время: иначе подпись можно подобрать по времени ответа. */
function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function isClaims(value: unknown): value is GameTokenClaims {
  if (typeof value !== 'object' || value === null) return false
  const claims = value as Record<string, unknown>

  return (
    claims.v === TOKEN_VERSION &&
    claims.aud === 'game' &&
    typeof claims.sub === 'string' &&
    typeof claims.gid === 'string' &&
    typeof claims.slug === 'string' &&
    typeof claims.sid === 'string' &&
    typeof claims.iat === 'number' &&
    typeof claims.exp === 'number'
  )
}

export type IssueGameTokenInput = {
  userId: string
  gameId: string
  gameSlug: string
  portalSessionId: string
  ttlSeconds: number
  now?: number
}

export function issueGameToken(input: IssueGameTokenInput, secret: string): string {
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000)

  const claims: GameTokenClaims = {
    v: TOKEN_VERSION,
    aud: 'game',
    sub: input.userId,
    gid: input.gameId,
    slug: input.gameSlug,
    sid: input.portalSessionId,
    iat: issuedAt,
    exp: issuedAt + input.ttlSeconds,
  }

  const payload = base64UrlEncode(JSON.stringify(claims))
  return `${payload}.${sign(payload, secret)}`
}

/** Возвращает разобранные claims или `null`. Никогда не бросает. */
export function verifyGameToken(
  token: string,
  secret: string,
  options: { now?: number } = {},
): GameTokenClaims | null {
  const separator = token.indexOf('.')
  if (separator <= 0) return null

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (!payload || !signature) return null

  // Подпись проверяется ДО разбора содержимого: до этого момента payload — просто мусор.
  if (!safeEqual(signature, sign(payload, secret))) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(base64UrlDecode(payload))
  } catch {
    return null
  }

  if (!isClaims(parsed)) return null

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000)
  if (parsed.exp <= nowSeconds) return null

  return parsed
}
