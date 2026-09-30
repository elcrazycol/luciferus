import type {
  AuthResponse,
  LoginRequest,
  PublicUser,
  RegisterRequest,
} from '@luciferus/protocol/auth'
import type { GameLaunch } from '@luciferus/protocol/embed'
import type {
  FairRoundsResponse,
  SeedPairDto,
  SeedPairsResponse,
  VerifyRoundRequest,
  VerifyRoundResponse,
} from '@luciferus/protocol/fairness'
import type {
  GameCard,
  GameListQuery,
  GameListResponse,
  GameStatus,
  GameSubmission,
  GameUpdate,
  OwnGameCard,
  ProviderProfile,
} from '@luciferus/protocol/game'
import type { LedgerPage, WalletOperationResult, WalletOverview } from '@luciferus/protocol/wallet'

/**
 * Тонкий клиент API для серверного кода портала.
 *
 * Все запросы идут с сервера — браузер про API не знает. Это снимает вопрос
 * CORS и кросс-доменных кук в проде.
 */

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const DEFAULT_TIMEOUT_MS = 5000

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH'
  token?: string | null
  body?: unknown
  timeoutMs?: number
}

async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`

  let response: Response

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    throw new ApiRequestError(
      'API недоступен. Запустите `bun run dev` и проверьте инфраструктуру',
      503,
      'network_error',
      { cause: error instanceof Error ? error.message : String(error) },
    )
  }

  const payload = (await response.json().catch(() => null)) as {
    message?: string
    error?: string
    details?: unknown
  } | null

  if (!response.ok) {
    throw new ApiRequestError(
      payload?.message ?? `API ответил кодом ${response.status}`,
      response.status,
      payload?.error,
      payload?.details,
    )
  }

  return payload as T
}

// ─── Аккаунт ─────────────────────────────────────────────────────────────────────

export type MeResponse = { user: PublicUser; wallet: WalletOverview['wallet'] }

export function getMe(token: string): Promise<MeResponse> {
  return apiFetch<MeResponse>('/v1/auth/me', { token })
}

export function login(body: LoginRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/v1/auth/login', { method: 'POST', body })
}

export function register(body: RegisterRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/v1/auth/register', { method: 'POST', body })
}

export function logout(token: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/v1/auth/logout', { method: 'POST', token, body: {} })
}

// ─── Кошелёк ─────────────────────────────────────────────────────────────────────

export function getWalletOverview(token: string): Promise<WalletOverview> {
  return apiFetch<WalletOverview>('/v1/wallet', { token })
}

export function getLedger(token: string, limit = 20): Promise<LedgerPage> {
  return apiFetch<LedgerPage>(`/v1/wallet/ledger?limit=${limit}`, { token })
}

export function claimReloadBonus(
  token: string,
): Promise<WalletOperationResult & { nextAvailableAt: string }> {
  return apiFetch('/v1/wallet/reload-bonus', { method: 'POST', token, body: {} })
}

// ─── Запуск игры ─────────────────────────────────────────────────────────────────

/**
 * Всё для открытия игры: адрес iframe, игровой токен, баланс и лимиты.
 *
 * Токен игровой, а не портальный: он ограничен одной игрой и живёт два часа.
 * Портал передаёт его игре через postMessage — в адресной строке он не появляется.
 */
export function launchGame(token: string, slug: string): Promise<GameLaunch> {
  return apiFetch<GameLaunch>(`/v1/games/${encodeURIComponent(slug)}/launch`, { token })
}

// ─── Каталог, заявки, модерация ──────────────────────────────────────────────────

export type LobbyResult = {
  games: GameCard[]
  /** Дошёл ли ответ от API. Если нет — показываем инструкцию, а не пустой экран. */
  online: boolean
}

/**
 * Лобби не должно падать оттого, что бэкенд ещё не поднят: это самый частый
 * сценарий первого запуска. Поэтому здесь свой `fetch` с мягкой обработкой ошибок,
 * а не `apiFetch`, который бросает исключение.
 */
export async function fetchLobby(): Promise<LobbyResult> {
  try {
    const response = await fetch(`${API_URL}/v1/games?limit=8&sort=plays`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })

    if (!response.ok) return { games: [], online: false }

    const payload = (await response.json()) as { games?: GameCard[] }
    return { games: payload.games ?? [], online: true }
  } catch {
    return { games: [], online: false }
  }
}

/** Собирает query-строку каталога, выбрасывая пустые параметры. */
export function buildCatalogQuery(query: Partial<GameListQuery>): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }

  return params.toString()
}

export function listGames(query: Partial<GameListQuery> = {}): Promise<GameListResponse> {
  const search = buildCatalogQuery(query)
  return apiFetch<GameListResponse>(`/v1/games${search ? `?${search}` : ''}`)
}

export function getGame(slug: string): Promise<{ game: GameCard }> {
  return apiFetch<{ game: GameCard }>(`/v1/games/${encodeURIComponent(slug)}`)
}

export function getProvider(slug: string): Promise<{ provider: ProviderProfile }> {
  return apiFetch<{ provider: ProviderProfile }>(`/v1/providers/${encodeURIComponent(slug)}`)
}

export function submitGame(token: string, body: GameSubmission): Promise<{ game: OwnGameCard }> {
  return apiFetch('/v1/games', { method: 'POST', token, body })
}

export function patchGame(
  token: string,
  slug: string,
  body: GameUpdate,
): Promise<{ game: OwnGameCard }> {
  return apiFetch(`/v1/games/${encodeURIComponent(slug)}`, { method: 'PATCH', token, body })
}

export function getMyGames(token: string): Promise<{ games: OwnGameCard[]; total: number }> {
  return apiFetch('/v1/games/mine', { token })
}

// ─── Проверяемая честность ───────────────────────────────────────────────────────

export function getSeedPairs(token: string, gameSlug?: string): Promise<SeedPairsResponse> {
  const query = gameSlug ? `?gameSlug=${encodeURIComponent(gameSlug)}` : ''
  return apiFetch<SeedPairsResponse>(`/v1/fair/seeds${query}`, { token })
}

export function rotateSeeds(
  token: string,
  gameSlug: string,
  clientSeed?: string,
): Promise<{ revealed: SeedPairDto; current: SeedPairDto }> {
  return apiFetch('/v1/fair/rotate', {
    method: 'POST',
    token,
    body: clientSeed ? { gameSlug, clientSeed } : { gameSlug },
  })
}

export function setClientSeed(
  token: string,
  gameSlug: string,
  clientSeed: string,
): Promise<{ pair: SeedPairDto }> {
  return apiFetch('/v1/fair/client-seed', {
    method: 'POST',
    token,
    body: { gameSlug, clientSeed },
  })
}

/**
 * Проверка на сервере.
 *
 * Нужна только для удобства: настоящая проверка считается в браузере игрока
 * и не требует доверия к порталу.
 */
export function verifyRoundOnServer(
  token: string,
  body: VerifyRoundRequest,
): Promise<VerifyRoundResponse> {
  return apiFetch('/v1/fair/verify', { method: 'POST', token, body })
}

export function getFairRounds(
  token: string,
  gameSlug: string,
  limit = 20,
): Promise<FairRoundsResponse> {
  return apiFetch<FairRoundsResponse>(
    `/v1/fair/rounds?gameSlug=${encodeURIComponent(gameSlug)}&limit=${limit}`,
    { token },
  )
}

// ─── Админка ─────────────────────────────────────────────────────────────────────

export type AdminOverview = {
  games: { pending: number; live: number; disabled: number; drafts: number }
}

export type ModerationEntry = OwnGameCard & {
  authorUsername: string | null
  authorDisplayName: string | null
}

export function getAdminOverview(token: string): Promise<AdminOverview> {
  return apiFetch<AdminOverview>('/v1/admin/overview', { token })
}

export function getModerationQueue(
  token: string,
  status: GameStatus,
): Promise<{ games: ModerationEntry[]; total: number; status: string }> {
  return apiFetch(`/v1/admin/games?status=${status}`, { token })
}

export function moderateGame(
  token: string,
  slug: string,
  decision: 'approve' | 'reject' | 'disable',
  note?: string,
): Promise<{ game: OwnGameCard }> {
  return apiFetch(`/v1/admin/games/${encodeURIComponent(slug)}/moderate`, {
    method: 'POST',
    token,
    body: { decision, ...(note ? { note } : {}) },
  })
}

export function adjustUserBalance(
  token: string,
  userId: string,
  amount: number,
  note: string,
): Promise<WalletOperationResult> {
  return apiFetch(`/v1/admin/users/${encodeURIComponent(userId)}/balance`, {
    method: 'POST',
    token,
    body: { amount, note },
  })
}
