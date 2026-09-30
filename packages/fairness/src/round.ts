import { hmacSha256Hex, sha256Hex } from './digest'

/**
 * Проверяемая честность раунда: commit-reveal на HMAC-SHA256.
 *
 * Схема ровно такая, как у настоящих казино, и работает в обе стороны:
 *
 * 1. Сервер создаёт пару сидов и **сразу публикует** `sha256(serverSeed)` — это
 *    commit. Сам `serverSeed` скрыт.
 * 2. Клиентский сид виден игроку, и он может его менять.
 * 3. Для каждого раунда берётся `random = HMAC_SHA256(serverSeed, clientSeed:nonce)`.
 *    Номер `nonce` растёт с каждым раундом и не повторяется.
 * 4. Игрок нажимает «раскрыть» — сервер показывает `serverSeed`. Теперь любой может
 *    проверить: хэш совпадает с опубликованным, а `random` каждого раунда совпадает
 *    с пересчитанным.
 *
 * Что это доказывает:
 * - **Сервер не мог подкрутить исход** после того, как объявил хэш: подобрать другой
 *   `serverSeed` с тем же хэшем невозможно.
 * - **Сервер не мог подкрутить исход под клиентский сид**: если игрок его меняет,
 *   сервер обязан использовать новый, а пересчёт после раскрытия это покажет.
 *
 * Чего это НЕ доказывает: что игра честно отобразила полученное случайное число.
 * Это уже ответственность игры, поэтому полученный `random` фиксируется в журнале
 * раунда и его видно на странице проверки.
 */

/** Версия алгоритма. Хранится рядом с парой сидов: смена формата не сломает старые раунды. */
export const FAIR_ALGORITHM = 'hmac-sha256:v1'

/**
 * Сообщение, которое подписывается.
 *
 * Формат — часть контракта: изменив его, вы сломаете проверку всех прошлых раундов,
 * поэтому при смене формата нужно поднимать версию алгоритма.
 */
export function roundMessage(clientSeed: string, nonce: number): string {
  return `${clientSeed}:${nonce}`
}

/** Публикуемый коммит: хэш серверного сида. */
export function serverSeedHash(serverSeed: string): Promise<string> {
  return sha256Hex(serverSeed)
}

export type RoundDerivation = {
  serverSeed: string
  clientSeed: string
  nonce: number
}

/** Случайность раунда: 64 hex-символа, выведенные из серверного и клиентского сидов. */
export function deriveRoundRandom(input: RoundDerivation): Promise<string> {
  return hmacSha256Hex(input.serverSeed, roundMessage(input.clientSeed, input.nonce))
}

// ─── Вывод значений из случайности раунда ────────────────────────────────────────

/**
 * Разворачивает 64 hex-символа в `count` чисел в диапазоне [0, 1).
 *
 * Хэш делится на равные куски; каждый кусок читается как целое и делится на своё
 * максимуме. Куски не пересекаются, поэтому последовательность детерминирована:
 * те же сиды и nonce всегда дают те же числа.
 *
 * Ограничение: кусков не больше, чем помещается в хэш (минимум 4 hex-символа на
 * число, то есть до 16 значений). Игре, которой нужно больше, следует вывести
 * дополнительную случайность сама и зафиксировать её в журнале раунда.
 */
export function randomFloats(randomHex: string, count: number): number[] {
  const hex = randomHex.trim().toLowerCase()

  if (count <= 0) return []
  if (!/^[0-9a-f]+$/.test(hex)) {
    throw new TypeError('Случайность раунда должна быть hex-строкой')
  }

  // Кусков не меньше четырёх hex-символов (16 бит): меньшая точность уже заметна
  // на распределении исходов.
  const chunkSize = Math.min(8, Math.max(4, Math.floor(hex.length / count)))

  if (count * chunkSize > hex.length) {
    throw new RangeError(
      `Из ${hex.length} hex-символов нельзя вывести ${count} значений без потери точности`,
    )
  }

  const max = 16 ** chunkSize

  return Array.from({ length: count }, (_, index) => {
    const chunk = hex.slice(index * chunkSize, (index + 1) * chunkSize)
    return Number.parseInt(chunk, 16) / max
  })
}

export type WeightedItem<Item> = {
  item: Item
  weight: number
}

/**
 * Выбирает элемент по весам из одного числа [0, 1).
 *
 * Так игры превращают случайность раунда в исход: таблица весов остаётся у игры,
 * а случайность приходит от портала. Проверяющий может повторить выбор сам —
 * функция детерминирована.
 */
export function pickWeighted<Item>(items: readonly WeightedItem<Item>[], float: number): Item {
  if (items.length === 0) throw new RangeError('Нужен хотя бы один элемент')

  const total = items.reduce((sum, entry) => sum + entry.weight, 0)
  if (!(total > 0)) throw new RangeError('Сумма весов должна быть положительной')

  const clamped = Math.min(Math.max(float, 0), 0.999999999)
  let roll = clamped * total

  for (const entry of items) {
    roll -= entry.weight
    if (roll < 0) return entry.item
  }

  // Достижимо только на границе округления — отдаём последний.
  const last = items[items.length - 1]
  if (!last) throw new RangeError('Нужен хотя бы один элемент')

  return last.item
}

// ─── Проверка ────────────────────────────────────────────────────────────────────

export type RoundVerification = {
  /** Хэш раскрытого сида совпадает с опубликованным коммитом. */
  seedMatchesCommit: boolean
  /** Пересчитанная случайность совпадает с той, что записана в журнале раунда. */
  randomMatches: boolean
  /** Что получилось при пересчёте — показываем даже при расхождении. */
  computedRandom: string
}

export type RoundVerificationInput = {
  serverSeed: string
  serverSeedHash: string
  clientSeed: string
  nonce: number
  /** Случайность, зафиксированная в журнале раунда. */
  claimedRandom: string
}

/**
 * Полная проверка одного раунда.
 *
 * Ничего не бросает и не «доверяет» входным данным: обе проверки независимы, и
 * вызывающий сам решает, что считать успехом. Если хэш не сошёлся — считайте
 * недействительным всё, что бы ни показала вторая проверка.
 */
export async function verifyRound(input: RoundVerificationInput): Promise<RoundVerification> {
  const computedHash = await serverSeedHash(input.serverSeed)
  const computedRandom = await deriveRoundRandom({
    serverSeed: input.serverSeed,
    clientSeed: input.clientSeed,
    nonce: input.nonce,
  })

  return {
    seedMatchesCommit: computedHash === input.serverSeedHash.toLowerCase(),
    randomMatches: computedRandom === input.claimedRandom.toLowerCase(),
    computedRandom,
  }
}
