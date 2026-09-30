import { db } from '@luciferus/db'
import { games, ledger, providers } from '@luciferus/db/schema'
import {
  GAME_CATEGORY_LABELS,
  type GameCard,
  type GameFacets,
  type GameListQuery,
  type GameListResponse,
  type GameStats,
  type GameStatus,
  type OwnGameCard,
} from '@luciferus/protocol/game'
import { and, arrayContains, asc, count, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm'

/**
 * Публичное чтение каталога: список игр с фильтрами, статистикой и гранями.
 *
 * Статистика считается агрегатом по леджеру, а не хранится в отдельном счётчике.
 * Соблазн денормализовать велик, но счётчик расходится с журналом при первом же
 * сбое, и потом никто не знает, какому числу верить. Агрегат всегда честный,
 * а индекс `ledger_game_idx` делает его дешёвым.
 */

/**
 * Экранирует спецсимволы LIKE.
 *
 * Без этого поиск «100%» искал бы «100» + что угодно, а «a_b» совпадал бы с «axb».
 * Обратный слэш — стандартный символ экранирования в Postgres LIKE.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

const gameColumns = {
  id: games.id,
  slug: games.slug,
  title: games.title,
  description: games.description,
  categories: games.categories,
  tags: games.tags,
  volatility: games.volatility,
  rtp: games.rtp,
  fairMode: games.fairMode,
  limits: games.limits,
  thumbnailUrl: games.thumbnailUrl,
  embedUrl: games.embedUrl,
  allowedOrigins: games.allowedOrigins,
  isStub: games.isStub,
  status: games.status,
  moderationNote: games.moderationNote,
  submittedBy: games.submittedBy,
  createdAt: games.createdAt,
  updatedAt: games.updatedAt,
  providerSlug: providers.slug,
  providerName: providers.name,
  providerVerified: providers.verified,
}

export type EnrichedGameRow = {
  id: string
  slug: string
  title: string
  description: string
  categories: string[]
  tags: string[]
  volatility: string | null
  rtp: string | null
  fairMode: string
  limits: { minBet: number; maxBet: number; maxWin: number }
  thumbnailUrl: string | null
  embedUrl: string
  allowedOrigins: string[]
  isStub: boolean
  status: string
  moderationNote: string | null
  submittedBy: string | null
  createdAt: Date
  updatedAt: Date
  providerSlug: string | null
  providerName: string | null
  providerVerified: boolean | null
  statsPlays: number | null
  statsBiggestWin: string | null
  statsLastPlayedAt: Date | string | null
}

/** Подзапрос со статистикой: одна строка на игру, а не по строке на каждую ставку. */
function statsSubquery() {
  return db
    .select({
      gameId: ledger.gameId,
      plays: sql<number>`cast(count(*) filter (where ${ledger.type} = 'bet') as int)`.as('plays'),
      biggestWin: sql<
        string | null
      >`max(${ledger.amount}) filter (where ${ledger.type} = 'payout')`.as('biggest_win'),
      lastPlayedAt: sql<Date | null>`max(${ledger.createdAt})`.as('last_played_at'),
    })
    .from(ledger)
    .where(isNotNull(ledger.gameId))
    .groupBy(ledger.gameId)
    .as('game_stats')
}

/**
 * Приводит значение из агрегата к ISO-строке.
 *
 * Приходится принимать и `Date`, и `string`: в CTE со статистикой поле идёт через
 * сырой `sql`, то есть мимо типизации колонок Drizzle, и драйвер вправе отдать
 * его как есть. Границу лучше нормализовать здесь, чем падать в рантайме.
 */
function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toStats(row: EnrichedGameRow): GameStats {
  return {
    plays: Number(row.statsPlays ?? 0),
    biggestWin: row.statsBiggestWin,
    lastPlayedAt: toIsoOrNull(row.statsLastPlayedAt),
  }
}

export function toGameCard(row: EnrichedGameRow): GameCard {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    categories: row.categories,
    tags: row.tags,
    volatility: row.volatility,
    rtp: row.rtp,
    fairMode: row.fairMode === 'provably-fair' ? 'provably-fair' : 'client',
    limits: row.limits,
    thumbnailUrl: row.thumbnailUrl,
    embedUrl: row.embedUrl,
    allowedOrigins: row.allowedOrigins,
    providerSlug: row.providerSlug,
    providerName: row.providerName,
    providerVerified: row.providerVerified,
    isStub: row.isStub,
    // Игра без объявленного origin не запустится: порталу некуда адресовать приветствие.
    launchable: row.allowedOrigins.length > 0,
    stats: toStats(row),
    createdAt: row.createdAt.toISOString(),
  }
}

const selection = {
  ...gameColumns,
  statsPlays: sql<number | null>`game_stats.plays`,
  statsBiggestWin: sql<string | null>`game_stats.biggest_win`,
  statsLastPlayedAt: sql<Date | string | null>`game_stats.last_played_at`,
}

function buildFilters(query: GameListQuery) {
  const conditions = [eq(games.status, 'live')]

  if (query.category) conditions.push(arrayContains(games.categories, [query.category]))
  if (query.fairMode) conditions.push(eq(games.fairMode, query.fairMode))
  if (query.volatility) conditions.push(eq(games.volatility, query.volatility))
  if (query.provider) conditions.push(eq(providers.slug, query.provider))

  if (query.search) {
    const pattern = `%${escapeLike(query.search)}%`
    // По слагу ищем точным совпадением: его копируют целиком, а не набирают частями.
    const searchCondition = or(
      ilike(games.title, pattern),
      ilike(games.description, pattern),
      eq(games.slug, query.search.toLowerCase()),
    )
    if (searchCondition) conditions.push(searchCondition)
  }

  return and(...conditions)
}

function buildOrder(query: GameListQuery) {
  switch (query.sort) {
    case 'newest':
      return [desc(games.createdAt), asc(games.title)]
    case 'plays':
      // `nulls last` — иначе игры без ставок оказались бы вверху популярного списка.
      return [sql`game_stats.plays desc nulls last`, asc(games.title)]
    case 'rtp':
      return [sql`${games.rtp} desc nulls last`, asc(games.title)]
    default:
      return [asc(games.title)]
  }
}

export async function listGames(query: GameListQuery): Promise<GameListResponse> {
  const stats = statsSubquery()
  const where = buildFilters(query)

  const rows = await db
    .select(selection)
    .from(games)
    .leftJoin(providers, eq(games.providerId, providers.id))
    .leftJoin(stats, eq(games.id, stats.gameId))
    .where(where)
    .orderBy(...buildOrder(query))
    .limit(query.limit)
    .offset(query.offset)

  const [totalRow] = await db
    .select({ value: count() })
    .from(games)
    .leftJoin(providers, eq(games.providerId, providers.id))
    .where(where)

  return {
    games: (rows as EnrichedGameRow[]).map(toGameCard),
    total: Number(totalRow?.value ?? 0),
    limit: query.limit,
    offset: query.offset,
    facets: await getFacets(),
  }
}

/** Грани для панели фильтров: что вообще есть в каталоге и по сколько. */
export async function getFacets(): Promise<GameFacets> {
  const categoryRows = await db
    .select({
      value: sql<string>`unnest(${games.categories})`,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(games)
    .where(eq(games.status, 'live'))
    .groupBy(sql`unnest(${games.categories})`)
    .orderBy(sql`count(*) desc`)

  const providerRows = await db
    .select({
      slug: providers.slug,
      name: providers.name,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(games)
    .innerJoin(providers, eq(games.providerId, providers.id))
    .where(eq(games.status, 'live'))
    .groupBy(providers.slug, providers.name)
    .orderBy(sql`count(*) desc`)

  return {
    categories: categoryRows.map((row) => ({
      value: row.value,
      label: GAME_CATEGORY_LABELS[row.value as keyof typeof GAME_CATEGORY_LABELS] ?? row.value,
      count: Number(row.count),
    })),
    providers: providerRows.map((row) => ({
      slug: row.slug,
      name: row.name,
      count: Number(row.count),
    })),
  }
}

/** Публичная карточка + служебные поля: статус, заметка модератора, автор. */
export function toOwnGameCard(row: EnrichedGameRow): OwnGameCard {
  return {
    ...toGameCard(row),
    status: row.status as GameStatus,
    moderationNote: row.moderationNote,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Полная строка игры: единственный запрос, из которого собираются обе карточки. */
export async function findGameRowFull(slug: string): Promise<EnrichedGameRow | null> {
  const stats = statsSubquery()

  const [row] = await db
    .select(selection)
    .from(games)
    .leftJoin(providers, eq(games.providerId, providers.id))
    .leftJoin(stats, eq(games.id, stats.gameId))
    .where(eq(games.slug, slug))
    .limit(1)

  return row ? (row as EnrichedGameRow) : null
}

/** Публичная карточка одной игры. Статус здесь не важен: фильтрует вызывающий. */
export async function findGameCard(slug: string): Promise<GameCard | null> {
  const row = await findGameRowFull(slug)
  return row ? toGameCard(row) : null
}

/** Профиль студии: сколько игр и сколько раз в них играли. */
export async function findProviderProfile(slug: string) {
  const [provider] = await db
    .select({
      slug: providers.slug,
      name: providers.name,
      url: providers.url,
      verified: providers.verified,
    })
    .from(providers)
    .where(eq(providers.slug, slug))
    .limit(1)

  if (!provider) return null

  const [aggregate] = await db
    .select({
      gamesCount: sql<number>`cast(count(distinct ${games.id}) as int)`,
      plays: sql<number>`cast(count(${ledger.id}) filter (where ${ledger.type} = 'bet') as int)`,
    })
    .from(providers)
    .leftJoin(games, eq(games.providerId, providers.id))
    .leftJoin(ledger, eq(ledger.gameId, games.id))
    .where(eq(providers.slug, slug))

  return {
    ...provider,
    gamesCount: Number(aggregate?.gamesCount ?? 0),
    playsTotal: Number(aggregate?.plays ?? 0),
  }
}
