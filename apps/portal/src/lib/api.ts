import type {
  AuthResponse,
  LoginRequest,
  PublicUser,
  RegisterRequest,
} from '@luciferus/protocol/auth'
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
  method?: 'GET' | 'POST'
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

// ─── Каталог игр ─────────────────────────────────────────────────────────────────

export type GameCard = {
  slug: string
  title: string
  description: string
  categories: string[]
  tags: string[]
  volatility: string | null
  rtp: string | null
  fairMode: 'client' | 'provably-fair'
  limits: { minBet: number; maxBet: number; maxWin: number }
  thumbnailUrl: string | null
  embedUrl: string
  isStub: boolean
  providerSlug: string | null
  providerName: string | null
  providerVerified: boolean | null
}

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
    const response = await fetch(`${API_URL}/v1/games`, {
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
