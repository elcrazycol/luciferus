import { z } from 'zod'

/**
 * Контракт каталога игр и заявки на публикацию.
 *
 * Типы карточки игры нужны сразу трём сторонам: API их отдаёт, портал рисует,
 * а форма регистрации заполняет. Держать три копии — значит гарантированно
 * получить расхождение, поэтому здесь один источник.
 */

export const GAME_STATUSES = ['draft', 'pending', 'live', 'disabled'] as const
export type GameStatus = (typeof GAME_STATUSES)[number]

/** Человекочитаемые названия статусов для интерфейса. */
export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  draft: 'Черновик',
  pending: 'На модерации',
  live: 'Опубликована',
  disabled: 'Отключена',
}

export const GAME_CATEGORIES = [
  'slots',
  'classic',
  'crash',
  'table',
  'cards',
  'multiplayer',
  'live',
] as const
export type GameCategory = (typeof GAME_CATEGORIES)[number]

export const GAME_CATEGORY_LABELS: Record<GameCategory, string> = {
  slots: 'Слоты',
  classic: 'Классика',
  crash: 'Краш',
  table: 'Столы',
  cards: 'Карты',
  multiplayer: 'Мультиплеер',
  live: 'Лайв',
}

export const GAME_VOLATILITIES = ['low', 'medium', 'high'] as const
export type GameVolatility = (typeof GAME_VOLATILITIES)[number]

export const GAME_VOLATILITY_LABELS: Record<GameVolatility, string> = {
  low: 'низкая волатильность',
  medium: 'средняя волатильность',
  high: 'высокая волатильность',
}

export const FAIR_MODES = ['client', 'provably-fair'] as const
export type FairMode = (typeof FAIR_MODES)[number]

/**
 * Приводит строку к origin: `https://game.example/` → `https://game.example`.
 * Возвращает `null`, если это не origin (есть путь, query или hash).
 *
 * Вынесено в функцию, потому что используется и в валидации заявки, и в сервисах,
 * и в тестах — расхождение здесь означало бы, что игра «проходит» проверку формы,
 * но не запускается.
 */
export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '')

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    // Если origin не совпал со строкой, значит, в ней есть лишнее: путь или параметры.
    if (url.origin !== trimmed) return null

    return trimmed
  } catch {
    return null
  }
}

export const originSchema = z
  .string()
  .trim()
  .max(255, 'Origin длиннее 255 символов')
  .refine(
    (value) => normalizeOrigin(value) !== null,
    'Origin — это схема, хост и порт, без пути. Например: https://my-game.example',
  )

export const gameSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Слаг короче 3 символов')
  .max(48, 'Слаг длиннее 48 символов')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Только латиница, цифры и дефис между ними')

export const gameLimitsSchema = z
  .object({
    minBet: z.number().positive('Минимальная ставка должна быть больше нуля').max(1_000_000),
    maxBet: z.number().positive().max(1_000_000),
    maxWin: z.number().positive().max(10_000_000),
  })
  .refine((limits) => limits.maxBet >= limits.minBet, {
    message: 'Максимальная ставка не может быть меньше минимальной',
    path: ['maxBet'],
  })
  .refine((limits) => limits.maxWin >= limits.maxBet, {
    message: 'Максимальный выигрыш не может быть меньше максимальной ставки',
    path: ['maxWin'],
  })

const httpUrl = (maxLength: number) =>
  z
    .url('Нужен полный адрес, например https://my-game.example/play')
    .max(maxLength)
    .refine(
      (value) => value.startsWith('http://') || value.startsWith('https://'),
      'Адрес должен быть http или https',
    )

export const gameSubmissionSchema = z
  .object({
    slug: gameSlugSchema,
    title: z.string().trim().min(2, 'Название короче 2 символов').max(64),
    description: z.string().trim().max(300, 'Описание длиннее 300 символов').default(''),
    embedUrl: httpUrl(500),
    origins: z
      .array(originSchema)
      .min(1, 'Объявите хотя бы один origin игры')
      .max(5, 'Не больше 5 origin`ов'),
    categories: z.array(z.enum(GAME_CATEGORIES)).max(4).default([]),
    tags: z.array(z.string().trim().min(1).max(24)).max(8, 'Не больше 8 тегов').default([]),
    fairMode: z.enum(FAIR_MODES).default('client'),
    volatility: z.enum(GAME_VOLATILITIES).optional(),
    limits: gameLimitsSchema,
    thumbnailUrl: httpUrl(500).optional(),
  })
  /**
   * Ключевая проверка заявки: origin страницы игры обязан быть среди объявленных.
   *
   * Порталу некуда адресовать приветствие, если он не совпадает, — игра просто
   * не запустится. Лучше отклонить такую заявку на входе, чем отдать в каталог
   * игру с неактивной кнопкой «Играть».
   */
  .refine(
    (game) => {
      const embedOrigin = normalizeOrigin(new URL(game.embedUrl).origin)
      return embedOrigin !== null && game.origins.some((o) => normalizeOrigin(o) === embedOrigin)
    },
    {
      message: 'Origin адреса игры должен быть среди объявленных origin`ов',
      path: ['origins'],
    },
  )

export type GameSubmission = z.infer<typeof gameSubmissionSchema>

/** Что можно поменять после публикации. Слаг и fairMode — нет. */
export const gameUpdateSchema = z.object({
  title: z.string().trim().min(2).max(64).optional(),
  description: z.string().trim().max(300).optional(),
  embedUrl: httpUrl(500).optional(),
  origins: z.array(originSchema).min(1).max(5).optional(),
  categories: z.array(z.enum(GAME_CATEGORIES)).max(4).optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  volatility: z.enum(GAME_VOLATILITIES).optional(),
  limits: gameLimitsSchema.optional(),
  thumbnailUrl: httpUrl(500).optional(),
})

export type GameUpdate = z.infer<typeof gameUpdateSchema>

export const GAME_SORTS = ['title', 'newest', 'plays', 'rtp'] as const
export type GameSort = (typeof GAME_SORTS)[number]

export const GAME_SORT_LABELS: Record<GameSort, string> = {
  title: 'По названию',
  newest: 'Новые',
  plays: 'Популярные',
  rtp: 'По RTP',
}

export const gameListQuerySchema = z.object({
  category: z.enum(GAME_CATEGORIES).optional(),
  provider: z.string().trim().max(48).optional(),
  fairMode: z.enum(FAIR_MODES).optional(),
  volatility: z.enum(GAME_VOLATILITIES).optional(),
  search: z.string().trim().max(64).optional(),
  sort: z.enum(GAME_SORTS).default('title'),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  offset: z.coerce.number().int().min(0).max(5_000).default(0),
})

export type GameListQuery = z.infer<typeof gameListQuerySchema>

export type GameStats = {
  /** Сколько раз в игре сделали ставку. */
  plays: number
  /** Самый крупный выигрыш за всё время. */
  biggestWin: string | null
  lastPlayedAt: string | null
}

/**
 * Карточка игры — то, что видит каталог.
 *
 * `launchable` считает сервер, а не портал: признак «игра объявила origin»
 * должен быть один на всех, иначе каталог и страница запуска разойдутся.
 */
export type GameCard = {
  slug: string
  title: string
  description: string
  categories: string[]
  tags: string[]
  volatility: string | null
  rtp: string | null
  fairMode: FairMode
  limits: { minBet: number; maxBet: number; maxWin: number }
  thumbnailUrl: string | null
  embedUrl: string
  allowedOrigins: string[]
  providerSlug: string | null
  providerName: string | null
  providerVerified: boolean | null
  isStub: boolean
  launchable: boolean
  stats: GameStats
  createdAt: string
}

/** Карточка для владельца и админа: плюс статус и заметка модератора. */
export type OwnGameCard = GameCard & {
  status: GameStatus
  moderationNote: string | null
  updatedAt: string
}

export type GameFacets = {
  categories: Array<{ value: string; label: string; count: number }>
  providers: Array<{ slug: string; name: string; count: number }>
}

export type GameListResponse = {
  games: GameCard[]
  total: number
  limit: number
  offset: number
  facets: GameFacets
}

export type ProviderProfile = {
  slug: string
  name: string
  url: string | null
  verified: boolean
  gamesCount: number
  /** Сколько раз в сумме играли в игры этого студия. */
  playsTotal: number
}
