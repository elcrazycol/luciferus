import { z } from 'zod'

/**
 * Типы операций в леджере. Список закрытый: `type` — это колонка в append-only
 * журнале, и опечатка в ней означает невосстановимую запись.
 */
export const LEDGER_TYPES = [
  'signup_bonus',
  'reload_bonus',
  'bet',
  'payout',
  'rollback',
  'sim_deposit',
  'sim_withdrawal',
  'admin_adjust',
] as const

export type LedgerType = (typeof LEDGER_TYPES)[number]

/** Человекочитаемые подписи для истории операций в кошельке. */
export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
  signup_bonus: 'Стартовый бонус',
  reload_bonus: 'Дозаправка баланса',
  bet: 'Ставка',
  payout: 'Выигрыш',
  rollback: 'Отмена раунда',
  sim_deposit: 'Депозит (симуляция)',
  sim_withdrawal: 'Вывод (симуляция)',
  admin_adjust: 'Корректировка администратором',
}

/**
 * Сумма ставки/выигрыша. Верхняя граница в миллион — не про экономику, а про то,
 * чтобы `numeric(18,2)` нельзя было переполнить снаружи.
 */
export const amountSchema = z
  .number()
  .positive('Сумма должна быть больше нуля')
  .max(1_000_000, 'Сумма слишком велика')
  .refine((value) => Number.isFinite(value), 'Сумма должна быть числом')

/** Идентификатор раунда внутри игры. Придумывает игра, портал только хранит. */
export const roundIdSchema = z
  .string()
  .trim()
  .min(1, 'Не указан раунд')
  .max(64, 'Идентификатор раунда длиннее 64 символов')

/**
 * Ключ идемпотентности. Нужен, чтобы ретрай запроса не списал деньги дважды:
 * если ключ уже встречался, операция не применяется повторно.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128, 'Ключ идемпотентности длиннее 128 символов')

/**
 * Метаданные операции, которые присылает игра.
 *
 * Ограничение по размеру — не паранойя: `meta` уезжает в `jsonb` в append-only
 * журнале и остаётся там навсегда, а писать туда может любой автор игры.
 */
export const metaSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => JSON.stringify(value).length <= 2_000,
    'Слишком большой объект meta (максимум 2000 символов)',
  )

const mutationBase = {
  roundId: roundIdSchema,
  idempotencyKey: idempotencyKeySchema.optional(),
  /** Игра, из которой пришла операция. Пока необязательна: SDK появится в фазе 2. */
  gameSlug: z.string().trim().max(64).optional(),
  meta: metaSchema.optional(),
}

export const betRequestSchema = z.object({ amount: amountSchema, ...mutationBase })
export const payoutRequestSchema = z.object({ amount: amountSchema, ...mutationBase })
export const rollbackRequestSchema = z.object({ ...mutationBase })

export type BetRequest = z.infer<typeof betRequestSchema>
export type PayoutRequest = z.infer<typeof payoutRequestSchema>
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>

export type LedgerEntryDto = {
  id: string
  type: LedgerType
  /** Знаковая сумма строкой: списание — со минусом. */
  amount: string
  balanceAfter: string
  roundId: string | null
  gameSlug: string | null
  createdAt: string
}

export type LedgerPage = {
  entries: LedgerEntryDto[]
  nextCursor: string | null
}

/** Результат любой операции, меняющей баланс. */
export type WalletOperationResult = {
  balance: string
  entry: LedgerEntryDto
  /** `true`, если операция уже была применена ранее и повторно не выполнялась. */
  idempotent: boolean
}

export type WalletSummary = {
  balance: string
  currency: string
  reload: {
    bonusAmount: string
    /**
     * Дозаправка доступна, только когда игрок всё слил (баланс ниже порога)
     * и кулдаун прошёл. Оба условия возвращаем явно, чтобы UI объяснил отказ.
     */
    available: boolean
    threshold: string
    availableAt: string | null
    cooldownMinutes: number
    /** Почему недоступна: `balance_above_threshold` | `cooldown` | null. */
    blockedBy: 'balance_above_threshold' | 'cooldown' | null
  }
}

export type WalletOverview = {
  wallet: WalletSummary
  recentEntries: LedgerEntryDto[]
}

export const ledgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Курсор — `id` последней полученной записи. */
  cursor: z.uuid().optional(),
})

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>
