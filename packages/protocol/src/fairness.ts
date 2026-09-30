import { z } from 'zod'

/**
 * Контракт проверяемой честности: то, что видит игрок и то, что присылает игра.
 *
 * Схема простая и намеренно плоская — её должен уметь повторить любой проверяющий
 * вручную, без нашего кода: серверный сид, клиентский сид, номер раунда.
 */

export const FAIR_ALGORITHM_LABELS: Record<string, string> = {
  'hmac-sha256:v1': 'HMAC-SHA256, сообщение «клиентский сид : номер раунда»',
}

/** Номер раунда. Начинается с единицы и только растёт. */
export const nonceSchema = z
  .number()
  .int('Номер раунда — целое число')
  .min(1, 'Нумерация раундов начинается с единицы')

/** Случайность раунда: 64 hex-символа. */
export const roundRandomSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/, 'Случайность раунда — ровно 64 hex-символа')

export const seedHashSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/, 'Хэш сида — ровно 64 hex-символа')

/**
 * То, что игра обязана приложить к ставке в проверяемом режиме.
 *
 * Именно эти три поля связывают раунд с опубликованным коммитом, и по ним игрок
 * потом проверяет, что исход не был подобран.
 */
export const fairClaimSchema = z.object({
  nonce: nonceSchema,
  serverSeedHash: seedHashSchema,
  random: roundRandomSchema,
  /** Игра может приложить своё — например, выпавшие символы. Показывается на странице проверки. */
  outcome: z.record(z.string(), z.unknown()).optional(),
})

export type FairClaim = z.infer<typeof fairClaimSchema>

/** Ответ `POST /v1/game/fair/next`: всё, что нужно игре для одного раунда. */
export type RoundStart = {
  nonce: number
  serverSeedHash: string
  clientSeed: string
  /** Готовая случайность раунда. Игра обязана использовать именно её. */
  random: string
  algorithm: string
}

/** Пара сидов глазами игрока. */
export type SeedPairDto = {
  id: string
  gameSlug: string
  gameTitle: string
  serverSeedHash: string
  clientSeed: string
  /** Последний выданный номер раунда. Растёт с каждым спином. */
  nonce: number
  algorithm: string
  /** Заполнено только у раскрытых пар. */
  serverSeed: string | null
  revealedAt: string | null
  createdAt: string
}

export const rotateSeedSchema = z.object({
  gameSlug: z.string().trim().min(1).max(64),
  /** Новый клиентский сид. Не задан — сгенерируем. */
  clientSeed: z.string().trim().min(1).max(64).optional(),
})

export type RotateSeedRequest = z.infer<typeof rotateSeedSchema>

export const setClientSeedSchema = z.object({
  gameSlug: z.string().trim().min(1).max(64),
  clientSeed: z.string().trim().min(1, 'Клиентский сид не может быть пустым').max(64),
})

export type SetClientSeedRequest = z.infer<typeof setClientSeedSchema>

export const verifyRoundSchema = z.object({
  serverSeed: z.string().min(1, 'Введите серверный сид').max(256),
  serverSeedHash: seedHashSchema,
  clientSeed: z.string().min(1, 'Введите клиентский сид').max(256),
  nonce: nonceSchema,
  random: roundRandomSchema,
})

export type VerifyRoundRequest = z.infer<typeof verifyRoundSchema>

export type VerifyRoundResponse = {
  /** Хэш раскрытого сида совпал с опубликованным коммитом. */
  seedMatchesCommit: boolean
  /** Случайность из журнала совпала с пересчитанной. */
  randomMatches: boolean
  /** Что получилось при пересчёте — показываем и при расхождении. */
  computedRandom: string
  /** Итог: обе проверки прошли. */
  verified: boolean
}

/** Один сыгранный раунд в проверяемом режиме. */
export type FairRoundDto = {
  roundId: string | null
  nonce: number | null
  random: string | null
  serverSeedHash: string | null
  clientSeed: string | null
  amount: string
  payout: string | null
  createdAt: string
  /** Пара раскрыта — раунд можно проверить прямо сейчас. */
  verifiable: boolean
  outcome: Record<string, unknown> | null
}

export type FairRoundsResponse = {
  rounds: FairRoundDto[]
  total: number
}

export type SeedPairsResponse = {
  active: SeedPairDto | null
  revealed: SeedPairDto[]
}

/** Разбирается ли пара: количество раундов и признак раскрытия. */
export function isSeedPairRevealed(pair: Pick<SeedPairDto, 'revealedAt'>): boolean {
  return pair.revealedAt !== null
}
