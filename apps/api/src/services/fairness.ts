import { db } from '@luciferus/db'
import { games, type LedgerEntry, ledger, type SeedPair, seedPairs } from '@luciferus/db/schema'
import {
  deriveRoundRandom,
  FAIR_ALGORITHM,
  serverSeedHash,
  verifyRound as verifyRoundCore,
} from '@luciferus/fairness'
import type {
  FairClaim,
  FairRoundDto,
  FairRoundsResponse,
  SeedPairDto,
  SeedPairsResponse,
  VerifyRoundResponse,
} from '@luciferus/protocol/fairness'
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { AppError } from '../lib/errors'
import { findLiveGameBySlug, type GameRow } from './game'

/**
 * Проверяемая честность: commit-reveal.
 *
 * Роли распределены так:
 * - **сервер** держит скрытый `serverSeed` и публикует его хэш;
 * - **сервер же** считает случайность раунда и отдаёт её игре — у игры нет и не
 *   должно быть серверного сида, иначе она могла бы предсказывать раунды;
 * - **игре** остаётся превратить случайность в исход;
 * - **игрок** после раскрытия сида может пересчитать всё сам.
 *
 * Главная гарантия держится не на доверии к игре, а на проверке: сервер знает
 * свой сид, поэтому может убедиться, что игра использовала именно ту случайность,
 * которую ей выдали. Подсунуть своё число игра не может — это ловится до списания
 * ставки.
 */

const SERVER_SEED_BYTES = 32
const CLIENT_SEED_BYTES = 8

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Buffer.from(buffer).toString('hex')
}

export function generateServerSeed(): string {
  return randomHex(SERVER_SEED_BYTES)
}

/** Клиентский сид короткий: игрок его видит и может ввести свой. */
export function generateClientSeed(): string {
  return randomHex(CLIENT_SEED_BYTES)
}

async function requireGame(gameSlug: string): Promise<GameRow> {
  const game = await findLiveGameBySlug(gameSlug)
  if (!game) throw AppError.notFound(`Игра «${gameSlug}» не найдена или отключена`)
  return game
}

function requireProvablyFair(game: GameRow): void {
  if (game.fairMode !== 'provably-fair') {
    throw AppError.conflict(
      `Игра «${game.slug}» объявлена как client: исход считает сама игра, проверять нечего`,
    )
  }
}

/**
 * Текущая пара сидов игрока в конкретной игре, с созданием при необходимости.
 *
 * Гонка двух одновременных запросов разрешается уникальным индексом на активную
 * пару: второй INSERT ничего не вставит, и мы просто перечитаем созданное.
 */
export async function getOrCreateActivePair(userId: string, gameId: string): Promise<SeedPair> {
  const [existing] = await db
    .select()
    .from(seedPairs)
    .where(
      and(eq(seedPairs.userId, userId), eq(seedPairs.gameId, gameId), isNull(seedPairs.revealedAt)),
    )
    .limit(1)

  if (existing) return existing

  const serverSeed = generateServerSeed()

  const [created] = await db
    .insert(seedPairs)
    .values({
      userId,
      gameId,
      serverSeed,
      serverSeedHash: await serverSeedHash(serverSeed),
      clientSeed: generateClientSeed(),
      algorithm: FAIR_ALGORITHM,
    })
    .onConflictDoNothing()
    .returning()

  if (created) return created

  const [raced] = await db
    .select()
    .from(seedPairs)
    .where(
      and(eq(seedPairs.userId, userId), eq(seedPairs.gameId, gameId), isNull(seedPairs.revealedAt)),
    )
    .limit(1)

  if (!raced) throw new Error('Не удалось создать пару сидов')
  return raced
}

export type StartedRound = {
  nonce: number
  serverSeedHash: string
  clientSeed: string
  random: string
  algorithm: string
}

/**
 * Выдаёт игре всё для одного раунда.
 *
 * Номер раунда увеличивается одним атомарным `UPDATE ... RETURNING`: между
 * «прочитать» и «записать» не остаётся окна, в которое могли бы влезть два
 * одновременных спина с одним номером.
 */
export async function startRound(userId: string, gameSlug: string): Promise<StartedRound> {
  const game = await requireGame(gameSlug)
  requireProvablyFair(game)

  const pair = await getOrCreateActivePair(userId, game.id)

  const [updated] = await db
    .update(seedPairs)
    .set({ nonce: sql`${seedPairs.nonce} + 1` })
    .where(and(eq(seedPairs.id, pair.id), isNull(seedPairs.revealedAt)))
    .returning()

  if (!updated) {
    throw AppError.conflict('Пара сидов была раскрыта в момент спина — начните раунд заново')
  }

  const random = await deriveRoundRandom({
    serverSeed: updated.serverSeed,
    clientSeed: updated.clientSeed,
    nonce: updated.nonce,
  })

  return {
    nonce: updated.nonce,
    serverSeedHash: updated.serverSeedHash,
    clientSeed: updated.clientSeed,
    random,
    algorithm: updated.algorithm,
  }
}

export type ValidatedClaim = {
  pairId: string
  clientSeed: string
}

/**
 * Проверяет заявление игры о случайности раунда.
 *
 * Здесь игра лишается возможности подкрутить исход: сервер знает свой сид, поэтому
 * пересчитывает случайность сам и сравнивает. Несовпадение — отказ до списания
 * ставки, а не после.
 */
export async function validateClaim(input: {
  userId: string
  game: GameRow
  claim: FairClaim
}): Promise<ValidatedClaim> {
  const [pair] = await db
    .select()
    .from(seedPairs)
    .where(
      and(
        eq(seedPairs.userId, input.userId),
        eq(seedPairs.gameId, input.game.id),
        eq(seedPairs.serverSeedHash, input.claim.serverSeedHash),
      ),
    )
    .limit(1)

  if (!pair) {
    throw AppError.conflict(
      'Хэш сида не совпадает ни с одной вашей парой: игра подставила свою случайность',
    )
  }

  if (input.claim.nonce > pair.nonce) {
    throw AppError.conflict('Игра использовала номер раунда, который ей не выдавали')
  }

  const expected = await deriveRoundRandom({
    serverSeed: pair.serverSeed,
    clientSeed: pair.clientSeed,
    nonce: input.claim.nonce,
  })

  if (expected !== input.claim.random) {
    throw AppError.conflict('Случайность раунда не совпадает с выводом из ваших сидов')
  }

  return { pairId: pair.id, clientSeed: pair.clientSeed }
}

// ─── Управление парами сидов ─────────────────────────────────────────────────────

function toSeedPairDto(pair: SeedPair, game: { slug: string; title: string }): SeedPairDto {
  const revealed = pair.revealedAt !== null

  return {
    id: pair.id,
    gameSlug: game.slug,
    gameTitle: game.title,
    serverSeedHash: pair.serverSeedHash,
    clientSeed: pair.clientSeed,
    nonce: pair.nonce,
    algorithm: pair.algorithm,
    // Серверный сид показывается только у раскрытой пары: у текущей он и есть секрет.
    serverSeed: revealed ? pair.serverSeed : null,
    revealedAt: pair.revealedAt?.toISOString() ?? null,
    createdAt: pair.createdAt.toISOString(),
  }
}

export async function listSeedPairs(userId: string, gameSlug?: string): Promise<SeedPairsResponse> {
  const conditions = [eq(seedPairs.userId, userId)]
  if (gameSlug) conditions.push(eq(games.slug, gameSlug))

  const rows = await db
    .select({ pair: seedPairs, slug: games.slug, title: games.title })
    .from(seedPairs)
    .innerJoin(games, eq(games.id, seedPairs.gameId))
    .where(and(...conditions))
    .orderBy(desc(seedPairs.createdAt))
    .limit(50)

  const pairs = rows.map((row) => toSeedPairDto(row.pair, { slug: row.slug, title: row.title }))

  return {
    active: pairs.find((pair) => pair.revealedAt === null) ?? null,
    revealed: pairs.filter((pair) => pair.revealedAt !== null),
  }
}

export type RotateResult = {
  revealed: SeedPairDto
  current: SeedPairDto
}

/** Раскрывает текущую пару и заводит новую. Клиентский сид можно задать свой. */
export async function rotateSeedPair(
  userId: string,
  gameSlug: string,
  clientSeed?: string,
): Promise<RotateResult> {
  const game = await requireGame(gameSlug)
  requireProvablyFair(game)

  const active = await getOrCreateActivePair(userId, game.id)

  // Хэш считаем до транзакции: держать соединение с базой во время криптографии незачем.
  const nextServerSeed = generateServerSeed()
  const nextHash = await serverSeedHash(nextServerSeed)

  const { revealed, created } = await db.transaction(async (tx) => {
    const [revealedPair] = await tx
      .update(seedPairs)
      .set({ revealedAt: new Date() })
      .where(eq(seedPairs.id, active.id))
      .returning()

    if (!revealedPair) throw new Error('Не удалось раскрыть пару сидов')

    const [newPair] = await tx
      .insert(seedPairs)
      .values({
        userId,
        gameId: game.id,
        serverSeed: nextServerSeed,
        serverSeedHash: nextHash,
        clientSeed: clientSeed ?? generateClientSeed(),
        algorithm: FAIR_ALGORITHM,
      })
      .returning()

    if (!newPair) throw new Error('Не удалось создать новую пару сидов')

    return { revealed: revealedPair, created: newPair }
  })

  const gameRef = { slug: game.slug, title: game.title }

  return {
    revealed: toSeedPairDto(revealed, gameRef),
    current: toSeedPairDto(created, gameRef),
  }
}

export async function setClientSeed(
  userId: string,
  gameSlug: string,
  clientSeed: string,
): Promise<SeedPairDto> {
  const game = await requireGame(gameSlug)
  const pair = await getOrCreateActivePair(userId, game.id)

  const [updated] = await db
    .update(seedPairs)
    .set({ clientSeed })
    .where(eq(seedPairs.id, pair.id))
    .returning()

  if (!updated) throw new Error('Не удалось сменить клиентский сид')

  return toSeedPairDto(updated, { slug: game.slug, title: game.title })
}

// ─── Проверка раундов ────────────────────────────────────────────────────────────

export async function verifyRound(input: {
  serverSeed: string
  serverSeedHash: string
  clientSeed: string
  nonce: number
  random: string
}): Promise<VerifyRoundResponse> {
  const result = await verifyRoundCore({
    serverSeed: input.serverSeed,
    serverSeedHash: input.serverSeedHash,
    clientSeed: input.clientSeed,
    nonce: input.nonce,
    claimedRandom: input.random,
  })

  return {
    seedMatchesCommit: result.seedMatchesCommit,
    randomMatches: result.randomMatches,
    computedRandom: result.computedRandom,
    verified: result.seedMatchesCommit && result.randomMatches,
  }
}

/**
 * Последние раунды игрока с данными для проверки.
 *
 * Данные лежат в журнале операций, а не в отдельной таблице раундов: ставка и
 * выплата уже там, и дублировать их значило бы завести второй источник правды,
 * который рано или поздно разойдётся с первым.
 */
export async function listFairRounds(
  userId: string,
  gameSlug: string,
  limit = 20,
): Promise<FairRoundsResponse> {
  const game = await requireGame(gameSlug)

  // Берём журнал по игре целиком и группируем по раундам: данные честности лежат
  // только на ставке, а выплату нужно подтянуть из того же раунда.
  const rows = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.gameId, game.id)))
    .orderBy(desc(ledger.createdAt))
    .limit(limit * 4)

  const byRound = new Map<string, { bet: LedgerEntry | null; payout: LedgerEntry | null }>()

  for (const row of rows) {
    if (!row.roundId) continue

    const bucket = byRound.get(row.roundId) ?? { bet: null, payout: null }
    if (row.type === 'bet' && !bucket.bet) bucket.bet = row
    if (row.type === 'payout' && !bucket.payout) bucket.payout = row

    byRound.set(row.roundId, bucket)
  }

  // Проверить раунд можно только тогда, когда его пара раскрыта. Иначе на странице
  // появилась бы кнопка «проверить» без сида, которым проверять.
  const revealedHashes = new Set(
    (
      await db
        .select({ hash: seedPairs.serverSeedHash })
        .from(seedPairs)
        .where(
          and(
            eq(seedPairs.userId, userId),
            eq(seedPairs.gameId, game.id),
            isNotNull(seedPairs.revealedAt),
          ),
        )
    ).map((row) => row.hash),
  )

  const rounds: FairRoundDto[] = []

  for (const [roundId, bucket] of byRound) {
    const fair = (bucket.bet?.meta as { fair?: Record<string, unknown> } | null)?.fair
    if (!bucket.bet || !fair) continue

    const serverSeedHash = typeof fair.serverSeedHash === 'string' ? fair.serverSeedHash : null

    rounds.push({
      roundId,
      nonce: typeof fair.nonce === 'number' ? fair.nonce : null,
      random: typeof fair.random === 'string' ? fair.random : null,
      serverSeedHash,
      clientSeed: typeof fair.clientSeed === 'string' ? fair.clientSeed : null,
      amount: bucket.bet.amount,
      payout: bucket.payout?.amount ?? null,
      createdAt: bucket.bet.createdAt.toISOString(),
      verifiable: serverSeedHash !== null && revealedHashes.has(serverSeedHash),
      outcome: (fair.outcome as Record<string, unknown> | undefined) ?? null,
    })
  }

  rounds.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const page = rounds.slice(0, limit)
  return { rounds: page, total: page.length }
}
