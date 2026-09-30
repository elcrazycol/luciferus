import { serverConfig } from '@luciferus/config'
import { economy } from '@luciferus/config/economy'
import { db } from '@luciferus/db'
import { games, ledger, wallets } from '@luciferus/db/schema'
import { negateDecimal, toDecimal } from '@luciferus/protocol/money'
import type {
  LedgerEntryDto,
  LedgerPage,
  LedgerType,
  WalletOperationResult,
  WalletSummary,
} from '@luciferus/protocol/wallet'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { AppError } from '../lib/errors'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type LedgerRow = typeof ledger.$inferSelect
type WalletRow = typeof wallets.$inferSelect
type Limits = { minBet: number; maxBet: number; maxWin: number }

const PORTAL_SCOPE = 'portal'

// ─── Вспомогательное ─────────────────────────────────────────────────────────────

/**
 * Берёт кошелёк под блокировку строки.
 *
 * Это единственная причина, по которой здесь нет гонок: пока транзакция не
 * завершится, вторая параллельная операция того же игрока ждёт на этой строке.
 * Без блокировки две одновременные ставки обе увидели бы достаточный баланс
 * и увели его в минус.
 */
async function lockWallet(tx: Transaction, userId: string): Promise<WalletRow> {
  const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for('update')

  if (!wallet) throw AppError.notFound('Кошелёк не найден')
  return wallet
}

function gameSlugOf(row: LedgerRow): string | null {
  const slug = row.meta?.gameSlug
  return typeof slug === 'string' ? slug : null
}

function toEntryDto(row: LedgerRow): LedgerEntryDto {
  return {
    id: row.id,
    type: row.type as LedgerType,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    roundId: row.roundId,
    gameSlug: gameSlugOf(row),
    createdAt: row.createdAt.toISOString(),
  }
}

/** Состояние раунда по журналу: что по нему уже произошло. */
async function roundState(
  tx: Transaction,
  userId: string,
  roundId: string,
  gameId: string | null,
): Promise<{ bet: LedgerRow | null; payout: LedgerRow | null; rollback: LedgerRow | null }> {
  const rows = await tx
    .select()
    .from(ledger)
    .where(
      and(
        eq(ledger.userId, userId),
        eq(ledger.roundId, roundId),
        gameId ? eq(ledger.gameId, gameId) : undefined,
      ),
    )

  return {
    bet: rows.find((row) => row.type === 'bet') ?? null,
    payout: rows.find((row) => row.type === 'payout') ?? null,
    rollback: rows.find((row) => row.type === 'rollback') ?? null,
  }
}

async function resolveLimits(
  gameSlug?: string,
): Promise<{ gameId: string | null; limits: Limits }> {
  if (!gameSlug) {
    return {
      gameId: null,
      limits: {
        minBet: 0.01,
        maxBet: economy.defaultMaxBet,
        maxWin: economy.defaultMaxWin,
      },
    }
  }

  const [game] = await db
    .select({ id: games.id, limits: games.limits })
    .from(games)
    .where(eq(games.slug, gameSlug))
    .limit(1)

  if (!game) throw AppError.notFound(`Игра «${gameSlug}» не найдена`)

  return { gameId: game.id, limits: game.limits }
}

/**
 * Ключ идемпотентности по умолчанию.
 *
 * Детерминированный: ретрай того же раунда даёт тот же ключ, и операция не
 * применяется дважды. Если игра присылает свой ключ — используется он.
 */
function defaultKey(type: LedgerType, userId: string, roundId: string, gameSlug?: string): string {
  return `${type}:${userId}:${gameSlug ?? PORTAL_SCOPE}:${roundId}`
}

// ─── Ядро: единственный путь изменения баланса ───────────────────────────────────

type ApplyEntryInput = {
  userId: string
  type: LedgerType
  idempotencyKey: string
  /** Готовая знаковая сумма или функция, вычисляющая её внутри транзакции. */
  amount: string | ((tx: Transaction) => Promise<string>)
  roundId?: string | null
  gameId?: string | null
  meta?: Record<string, unknown>
  /** Запретить уход баланса в минус. Для ставок — true, для выигрышей и бонусов — false. */
  requireFunds: boolean
}

/**
 * Применяет одну операцию к балансу. Любое движение денег в системе идёт через эту
 * функцию — прямых `UPDATE wallets` в обход леджера не существует.
 */
async function applyEntry(input: ApplyEntryInput): Promise<WalletOperationResult> {
  return db.transaction(async (tx) => {
    const wallet = await lockWallet(tx, input.userId)

    // Проверка идемпотентности идёт ПОСЛЕ блокировки: иначе параллельный ретрай
    // проскочил бы мимо ещё не закоммиченной записи и списал деньги дважды.
    const [existing] = await tx
      .select()
      .from(ledger)
      .where(eq(ledger.idempotencyKey, input.idempotencyKey))
      .limit(1)

    if (existing) {
      return {
        balance: wallet.balance,
        entry: toEntryDto(existing),
        idempotent: true,
      }
    }

    // Сумма может зависеть от состояния раунда (возврат ставки) — считаем её
    // уже под блокировкой.
    const amount = typeof input.amount === 'string' ? input.amount : await input.amount(tx)

    if (input.requireFunds) {
      // Считает Postgres над numeric. Прогонять баланс через JS-числа нельзя.
      const [check] = await tx
        .select({ enough: sql<boolean>`${wallets.balance} + ${amount}::numeric >= 0` })
        .from(wallets)
        .where(eq(wallets.userId, input.userId))

      if (!check?.enough) throw AppError.insufficientFunds()
    }

    const [updated] = await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${amount}::numeric`, updatedAt: new Date() })
      .where(eq(wallets.userId, input.userId))
      .returning({ balance: wallets.balance })

    if (!updated) throw AppError.notFound('Кошелёк не найден')

    const [entry] = await tx
      .insert(ledger)
      .values({
        userId: input.userId,
        type: input.type,
        amount,
        balanceAfter: updated.balance,
        idempotencyKey: input.idempotencyKey,
        roundId: input.roundId ?? null,
        gameId: input.gameId ?? null,
        meta: input.meta ?? {},
      })
      .returning()

    if (!entry) throw new Error('Не удалось записать операцию в леджер')

    return {
      balance: updated.balance,
      entry: toEntryDto(entry),
      idempotent: false,
    }
  })
}

// ─── Публичные операции ──────────────────────────────────────────────────────────

export type MutationInput = {
  userId: string
  amount: number
  roundId: string
  idempotencyKey?: string
  gameSlug?: string
  meta?: Record<string, unknown>
}

export async function placeBet(input: MutationInput): Promise<WalletOperationResult> {
  const { gameId, limits } = await resolveLimits(input.gameSlug)

  if (input.amount < limits.minBet) {
    throw AppError.limitExceeded(`Минимальная ставка — ${limits.minBet}`, {
      minBet: limits.minBet,
    })
  }

  if (input.amount > limits.maxBet) {
    throw AppError.limitExceeded(`Максимальная ставка — ${limits.maxBet}`, {
      maxBet: limits.maxBet,
    })
  }

  return applyEntry({
    userId: input.userId,
    type: 'bet',
    amount: negateDecimal(toDecimal(input.amount)),
    idempotencyKey:
      input.idempotencyKey ?? defaultKey('bet', input.userId, input.roundId, input.gameSlug),
    roundId: input.roundId,
    gameId,
    meta: { ...input.meta, gameSlug: input.gameSlug ?? null },
    requireFunds: true,
  })
}

export async function payOut(input: MutationInput): Promise<WalletOperationResult> {
  const { gameId, limits } = await resolveLimits(input.gameSlug)

  if (input.amount > limits.maxWin) {
    throw AppError.limitExceeded(`Максимальный выигрыш за раунд — ${limits.maxWin}`, {
      maxWin: limits.maxWin,
    })
  }

  return applyEntry({
    userId: input.userId,
    type: 'payout',
    idempotencyKey:
      input.idempotencyKey ?? defaultKey('payout', input.userId, input.roundId, input.gameSlug),
    roundId: input.roundId,
    gameId,
    meta: { ...input.meta, gameSlug: input.gameSlug ?? null },
    requireFunds: false,
    // Проверки раунда выполняются только для новой операции: повтор с тем же
    // ключом выходит раньше, по идемпотентности, и конфликта не получает.
    amount: async (tx: Transaction) => {
      const state = await roundState(tx, input.userId, input.roundId, gameId)

      if (!state.bet) {
        throw AppError.conflict('Нельзя выплатить выигрыш за раунд, в котором не было ставки')
      }
      if (state.payout) {
        throw AppError.conflict('Выигрыш за этот раунд уже выплачен')
      }
      if (state.rollback) {
        throw AppError.conflict('Раунд был отменён — выигрыш по нему невозможен')
      }

      return toDecimal(input.amount)
    },
  })
}

export type RollbackInput = {
  userId: string
  roundId: string
  idempotencyKey?: string
  gameSlug?: string
  reason?: string
}

/** Отмена раунда: возвращает ставку игроку. Например, если игра упала в середине спина. */
export async function rollbackRound(input: RollbackInput): Promise<WalletOperationResult> {
  const { gameId } = await resolveLimits(input.gameSlug)

  return applyEntry({
    userId: input.userId,
    type: 'rollback',
    idempotencyKey:
      input.idempotencyKey ?? defaultKey('rollback', input.userId, input.roundId, input.gameSlug),
    roundId: input.roundId,
    gameId,
    meta: { ...(input.reason ? { reason: input.reason } : {}), gameSlug: input.gameSlug ?? null },
    requireFunds: false,
    amount: async (tx) => {
      const state = await roundState(tx, input.userId, input.roundId, gameId)

      if (!state.bet) {
        throw AppError.conflict('Нечего отменять: в этом раунде не было ставки')
      }
      if (state.rollback) {
        throw AppError.conflict('Раунд уже отменён')
      }
      if (state.payout) {
        throw AppError.conflict('Нельзя отменить раунд, по которому уже выплачен выигрыш')
      }

      // Возвращаем ровно то, что было списано: сумму берём из журнала, а не из запроса.
      return negateDecimal(state.bet.amount)
    },
  })
}

// ─── Чтение ──────────────────────────────────────────────────────────────────────

export async function getWalletSummary(userId: string): Promise<WalletSummary> {
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1)
  if (!wallet) throw AppError.notFound('Кошелёк не найден')

  const threshold = economy.reloadThreshold
  const balance = Number.parseFloat(wallet.balance)
  const cooldownUntil = wallet.reloadAvailableAt?.getTime() ?? 0
  const cooldownActive = cooldownUntil > Date.now()

  const blockedBy =
    balance >= threshold ? 'balance_above_threshold' : cooldownActive ? 'cooldown' : null

  return {
    balance: wallet.balance,
    currency: wallet.currency,
    reload: {
      bonusAmount: serverConfig.reloadBonus.toFixed(2),
      available: blockedBy === null,
      threshold: threshold.toFixed(2),
      availableAt: wallet.reloadAvailableAt?.toISOString() ?? null,
      cooldownMinutes: serverConfig.reloadCooldownMinutes,
      blockedBy,
    },
  }
}

export async function getLedger(
  userId: string,
  options: { limit: number; cursor?: string },
): Promise<LedgerPage> {
  const conditions = [eq(ledger.userId, userId)]

  if (options.cursor) {
    const [anchor] = await db
      .select({ createdAt: ledger.createdAt })
      .from(ledger)
      .where(eq(ledger.id, options.cursor))
      .limit(1)

    // Несуществующий курсор не ошибка — просто отдаём первую страницу.
    if (anchor) conditions.push(lt(ledger.createdAt, anchor.createdAt))
  }

  const rows = await db
    .select()
    .from(ledger)
    .where(and(...conditions))
    .orderBy(desc(ledger.createdAt))
    .limit(options.limit + 1)

  const hasMore = rows.length > options.limit
  const page = hasMore ? rows.slice(0, options.limit) : rows

  return {
    entries: page.map(toEntryDto),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  }
}

/**
 * Дозаправка баланса. Сделана отдельно от `applyEntry`, потому что помимо баланса
 * обновляет кулдаун — и оба изменения должны быть атомарны вместе с проверкой.
 */
export async function claimReloadBonus(
  userId: string,
): Promise<WalletOperationResult & { nextAvailableAt: string }> {
  const bonus = serverConfig.reloadBonus
  if (bonus <= 0) throw AppError.conflict('Дозаправка отключена на этой площадке')

  const amount = toDecimal(bonus)
  const cooldownMs = serverConfig.reloadCooldownMinutes * 60_000
  const threshold = economy.reloadThreshold

  return db.transaction(async (tx) => {
    const wallet = await lockWallet(tx, userId)
    const now = Date.now()

    if (Number.parseFloat(wallet.balance) >= threshold) {
      throw AppError.conflict(`Дозаправка доступна только когда баланс ниже ${threshold}`)
    }

    const cooldownUntil = wallet.reloadAvailableAt?.getTime() ?? 0
    if (cooldownUntil > now) {
      const seconds = Math.ceil((cooldownUntil - now) / 1000)
      throw AppError.rateLimited(`Следующая дозаправка через ${seconds} с`, seconds)
    }

    const nextAvailableAt = new Date(now + cooldownMs)
    const [updated] = await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} + ${amount}::numeric`,
        reloadAvailableAt: nextAvailableAt,
        updatedAt: new Date(),
      })
      .where(eq(wallets.userId, userId))
      .returning({ balance: wallets.balance })

    if (!updated) throw AppError.notFound('Кошелёк не найден')

    // Ключ включает момент следующей доступности — каждая дозаправка уникальна,
    // но повторный запрос из той же попытки не создаст вторую запись.
    const [entry] = await tx
      .insert(ledger)
      .values({
        userId,
        type: 'reload_bonus',
        amount,
        balanceAfter: updated.balance,
        idempotencyKey: `reload:${userId}:${nextAvailableAt.getTime()}`,
        meta: { source: 'reload_bonus' },
      })
      .returning()

    if (!entry) throw new Error('Не удалось записать дозаправку в леджер')

    return {
      balance: updated.balance,
      entry: toEntryDto(entry),
      idempotent: false,
      nextAvailableAt: nextAvailableAt.toISOString(),
    }
  })
}
