import {
  EMBED_PROTOCOL_VERSION,
  type GameSessionPayload,
  type GameTokenClaims,
  type SdkErrorCode,
} from './embed-constants'

/**
 * Протокол встраивания игры в портал: сообщения между родительским окном (портал)
 * и iframe игры через `postMessage`.
 *
 * Принципы, которые здесь зафиксированы:
 *
 * 1. **Инициатор — портал.** Игра никогда не постит в `*`. Портал знает origin игры
 *    заранее (он объявлен автором) и адресует сообщения точно ему.
 * 2. **Ни одно сообщение не содержит секретов, пока origin не проверен.** `casino:init`
 *    не несёт ничего чувствительного — только одноразовый `nonce`.
 * 3. **Игра отвечает на `casino:init`, а не начинает разговор сама.** Так исключён
 *    сценарий, когда сторонняя страница-обёртка выпрашивает сессию.
 * 4. **`nonce` защищает от подмены.** Портал выдаёт сессию только тому `hello`,
 *    который вернул выданный им же `nonce`.
 *
 * Деньги ходят НЕ через postMessage, а запросами игры к `/v1/game/*` с игровым
 * токеном: операции должны быть идемпотентными и ретраибельными.
 *
 * Валидаторы написаны руками, без Zod, и живут в этом файле — их используют ОБЕ
 * стороны: и SDK в браузере, и портал. Zod здесь не подходит: SDK собирается в
 * бандл, который подключается к каждой игре, и валидатор на 400 КБ ему не нужен.
 * Проверки при этом полные: не «не упасть на мусоре», а «принять ровно то, что
 * описано контрактом». Строгая проверка данных от недоверенных источников остаётся
 * на Zod там, где она уместна, — на входе API.
 */

export * from './embed-constants'

export type InitMessage = {
  type: 'casino:init'
  protocol: number
  nonce: string
  gameSlug: string
  portalOrigin: string
}

export type HelloMessage = {
  type: 'casino:hello'
  protocol: number
  nonce: string
  gameSlug: string
  sdkVersion: string
  capabilities: string[]
}

export type SessionMessage = {
  type: 'casino:session'
  protocol: number
  nonce: string
  gameSlug: string
  apiUrl: string
  session: GameSessionPayload
  player: { id: string; username: string; displayName: string }
  wallet: { balance: string; currency: string }
  limits: { minBet: number; maxBet: number; maxWin: number }
  /** Режим честности игры: в проверяемом SDK обязан прикладывать данные раунда. */
  fairMode: 'client' | 'provably-fair'
}

export type BalanceMessage = {
  type: 'casino:balance'
  protocol: number
  balance: string
}

export type ErrorMessage = {
  type: 'casino:error'
  protocol: number
  code: 'origin_not_allowed' | 'handshake_timeout' | 'internal_error' | 'game_disabled'
  message: string
}

export type PortalMessage = InitMessage | SessionMessage | BalanceMessage | ErrorMessage
export type GameMessage = HelloMessage

export type SessionPayload = GameSessionPayload

// ─── Общие проверки ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Конверт протокола: версия и тип. Всё, что не проходит эту проверку, — не наше
 * сообщение, и его следует молча игнорировать, а не логировать (в окно летит
 * много постороннего: расширения браузера, дев-серверы HMR).
 */
export function isEmbedEnvelope(
  value: unknown,
): value is Record<string, unknown> & { type: string; protocol: number } {
  return isRecord(value) && value.protocol === EMBED_PROTOCOL_VERSION && isFilledString(value.type)
}

export function readInitMessage(value: unknown): InitMessage | null {
  if (!isEmbedEnvelope(value) || value.type !== 'casino:init') return null
  if (!isFilledString(value.nonce)) return null
  if (!isFilledString(value.gameSlug)) return null
  if (!isFilledString(value.portalOrigin)) return null

  return {
    type: 'casino:init',
    protocol: EMBED_PROTOCOL_VERSION,
    nonce: value.nonce,
    gameSlug: value.gameSlug,
    portalOrigin: value.portalOrigin,
  }
}

export function readHelloMessage(value: unknown): HelloMessage | null {
  if (!isEmbedEnvelope(value) || value.type !== 'casino:hello') return null
  if (!isFilledString(value.nonce)) return null
  if (!isFilledString(value.gameSlug)) return null
  if (!isFilledString(value.sdkVersion)) return null

  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.filter(isFilledString)
    : []

  return {
    type: 'casino:hello',
    protocol: EMBED_PROTOCOL_VERSION,
    nonce: value.nonce,
    gameSlug: value.gameSlug,
    sdkVersion: value.sdkVersion,
    capabilities,
  }
}

export function readSessionMessage(value: unknown): SessionMessage | null {
  if (!isEmbedEnvelope(value) || value.type !== 'casino:session') return null

  const session = isRecord(value.session) ? value.session : null
  const wallet = isRecord(value.wallet) ? value.wallet : null
  const player = isRecord(value.player) ? value.player : null
  const limits = isRecord(value.limits) ? value.limits : null

  if (!session || !isFilledString(session.token)) return null
  if (!isFilledString(value.apiUrl)) return null
  if (!wallet || !isFilledString(wallet.balance) || !isFilledString(wallet.currency)) return null
  if (!player || !isFilledString(player.id)) return null
  if (!limits) return null

  return {
    type: 'casino:session',
    protocol: EMBED_PROTOCOL_VERSION,
    nonce: isFilledString(value.nonce) ? value.nonce : '',
    gameSlug: isFilledString(value.gameSlug) ? value.gameSlug : '',
    apiUrl: value.apiUrl,
    session: {
      token: session.token,
      expiresAt: isFilledString(session.expiresAt) ? session.expiresAt : '',
    },
    player: {
      id: player.id,
      username: isFilledString(player.username) ? player.username : '',
      displayName: isFilledString(player.displayName) ? player.displayName : '',
    },
    wallet: { balance: wallet.balance, currency: wallet.currency },
    limits: {
      minBet: isFiniteNumber(limits.minBet) ? limits.minBet : 0,
      maxBet: isFiniteNumber(limits.maxBet) ? limits.maxBet : Number.MAX_SAFE_INTEGER,
      maxWin: isFiniteNumber(limits.maxWin) ? limits.maxWin : Number.MAX_SAFE_INTEGER,
    },
    fairMode: value.fairMode === 'provably-fair' ? 'provably-fair' : 'client',
  }
}

export function readBalanceMessage(value: unknown): BalanceMessage | null {
  if (!isEmbedEnvelope(value) || value.type !== 'casino:balance') return null
  if (!isFilledString(value.balance)) return null

  return { type: 'casino:balance', protocol: EMBED_PROTOCOL_VERSION, balance: value.balance }
}

// Словарь совпадает с SDK_ERROR_CODES: иначе SDK получил бы незнакомый код
// и превратил бы понятную ошибку в «internal_error».
const ERROR_CODES = [
  'origin_not_allowed',
  'handshake_timeout',
  'internal_error',
  'game_disabled',
] as const

export function readErrorMessage(value: unknown): ErrorMessage | null {
  if (!isEmbedEnvelope(value) || value.type !== 'casino:error') return null

  const code = ERROR_CODES.find((candidate) => candidate === value.code) ?? 'internal_error'

  return {
    type: 'casino:error',
    protocol: EMBED_PROTOCOL_VERSION,
    code,
    message: isFilledString(value.message) ? value.message : 'Портал отклонил запуск игры',
  }
}

/** Проверяет, что строка — корректный origin вида `https://example.com`. */
export function isOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.includes(origin)
}

// ─── Ответ `GET /v1/games/:slug/launch` ──────────────────────────────────────────

export type GameLaunch = {
  game: {
    slug: string
    title: string
    embedUrl: string
    allowedOrigins: string[]
    limits: { minBet: number; maxBet: number; maxWin: number }
    fairMode: 'client' | 'provably-fair'
  }
  session: SessionPayload
  player: {
    id: string
    username: string
    displayName: string
    role: string
    isBot: boolean
    createdAt: string
  }
  wallet: { balance: string; currency: string }
  apiUrl: string
}

export type { GameSessionPayload, GameTokenClaims, SdkErrorCode }
