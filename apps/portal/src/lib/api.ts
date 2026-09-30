/**
 * Типы карточки игры. Пока описаны руками; когда появится packages/protocol (фаза 2),
 * их будет отдавать общая Zod-схема, и ручной дубль исчезнет.
 */
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

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export type LobbyResult = {
  games: GameCard[]
  /** Дошёл ли ответ от API. Если нет — показываем инструкцию, а не пустой экран. */
  online: boolean
}

export async function fetchLobby(): Promise<LobbyResult> {
  try {
    const response = await fetch(`${API_URL}/v1/games`, {
      // Лобби должно показывать актуальный каталог, кэш здесь только мешает.
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })

    if (!response.ok) return { games: [], online: false }

    const payload = (await response.json()) as { games?: GameCard[] }
    return { games: payload.games ?? [], online: true }
  } catch {
    // API лежит, база не поднята — это нормальный сценарий первого запуска.
    return { games: [], online: false }
  }
}
