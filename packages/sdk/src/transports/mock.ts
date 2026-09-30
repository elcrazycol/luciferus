import { parseDecimal, toDecimal } from '@luciferus/protocol/money'
import { CasinoError } from '../errors'
import type {
  RollbackInput,
  StorageLike,
  TransportSession,
  WalletOperationInput,
  WalletOperationOutput,
  WalletTransport,
} from '../types'

const STORAGE_KEY = 'luciferus:mock-wallet:v1'

type MockRound = {
  bet: string
  payout: string | null
  rolledBack: boolean
}

type MockState = {
  balance: string
  rounds: Record<string, MockRound>
}

export type MockControls = {
  /** Начислить себе денег — только для мок-режима. */
  deposit(amount: number): string
  /** Стереть локальный кошелёк и начать заново. */
  reset(): string
}

export type MockTransportDeps = {
  storage: StorageLike
  startingBalance: number
  currency: string
  limits: { minBet: number; maxBet: number; maxWin: number }
}

/**
 * Транспорт «игры вне портала».
 *
 * Нужен, чтобы автор игры мог писать и отлаживать её, не поднимая портал и базу.
 * Кошелёк живёт в localStorage и ведёт себя как настоящий: ставка не уходит
 * в минус, выигрыш невозможен без ставки, повтор операции идемпотентен.
 *
 * Это не «заглушка для галочки»: расхождение поведения с сервером означало бы,
 * что игра работает локально и падает в портале.
 */
export function createMockTransport(deps: MockTransportDeps): WalletTransport & {
  controls: MockControls
} {
  function read(): MockState {
    try {
      const raw = deps.storage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<MockState>
        if (
          parsed &&
          typeof parsed.balance === 'string' &&
          parsed.rounds &&
          typeof parsed.rounds === 'object'
        ) {
          return parsed as MockState
        }
      }
    } catch {
      // Испорченный localStorage не должен ломать игру — начинаем заново.
    }

    return { balance: toDecimal(deps.startingBalance), rounds: {} }
  }

  function write(state: MockState): void {
    try {
      deps.storage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Приватный режим или переполненное хранилище: играем «в память».
    }
  }

  let state = read()

  function commit(next: MockState): void {
    state = next
    write(state)
  }

  function round(roundId: string): MockRound | null {
    return state.rounds[roundId] ?? null
  }

  function output(amount: string, roundId: string, idempotent: boolean): WalletOperationOutput {
    return { balance: state.balance, amount, roundId, idempotent }
  }

  function validateAmount(amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new CasinoError('bad_request', 'Сумма должна быть положительным числом')
    }
    if (amount < deps.limits.minBet) {
      throw new CasinoError('limit_exceeded', `Минимальная ставка — ${deps.limits.minBet}`)
    }
    if (amount > deps.limits.maxBet) {
      throw new CasinoError('limit_exceeded', `Максимальная ставка — ${deps.limits.maxBet}`)
    }
    return toDecimal(amount)
  }

  const transport: WalletTransport & { controls: MockControls } = {
    mode: 'mock',

    get gameSlug() {
      return null
    },

    async ready(): Promise<TransportSession> {
      return {
        player: { id: 'mock-player', username: 'local_dev', displayName: 'Локальный игрок' },
        balance: state.balance,
        currency: deps.currency,
        limits: deps.limits,
      }
    },

    async bet(input: WalletOperationInput): Promise<WalletOperationOutput> {
      const amount = validateAmount(input.amount)
      const existing = round(input.roundId)

      // Повтор той же ставки не должен списывать деньги дважды — та же логика,
      // что и на сервере, где её держит уникальный индекс леджера.
      if (existing) return output(existing.bet, input.roundId, true)

      if ((parseDecimal(state.balance) ?? 0) < (parseDecimal(amount) ?? 0)) {
        throw new CasinoError('insufficient_funds', 'Недостаточно CrazyBucks на балансе')
      }

      const balance = toDecimal((parseDecimal(state.balance) ?? 0) - (parseDecimal(amount) ?? 0))
      commit({
        balance,
        rounds: {
          ...state.rounds,
          [input.roundId]: { bet: `-${amount}`, payout: null, rolledBack: false },
        },
      })

      return output(`-${amount}`, input.roundId, false)
    },

    async payout(input: WalletOperationInput): Promise<WalletOperationOutput> {
      const amount = validateAmount(input.amount)
      const existing = round(input.roundId)

      if (!existing) {
        throw new CasinoError('conflict', 'Нельзя выплатить выигрыш за раунд без ставки')
      }
      if (existing.payout) return output(existing.payout, input.roundId, true)
      if (existing.rolledBack) {
        throw new CasinoError('conflict', 'Раунд был отменён — выигрыш по нему невозможен')
      }
      if (input.amount > deps.limits.maxWin) {
        throw new CasinoError(
          'limit_exceeded',
          `Максимальный выигрыш за раунд — ${deps.limits.maxWin}`,
        )
      }

      const balance = toDecimal((parseDecimal(state.balance) ?? 0) + (parseDecimal(amount) ?? 0))
      commit({
        balance,
        rounds: { ...state.rounds, [input.roundId]: { ...existing, payout: amount } },
      })

      return output(amount, input.roundId, false)
    },

    async rollback(input: RollbackInput): Promise<WalletOperationOutput> {
      const existing = round(input.roundId)

      if (!existing) {
        throw new CasinoError('conflict', 'Нечего отменять: в этом раунде не было ставки')
      }
      if (existing.rolledBack) return output(existing.bet.slice(1), input.roundId, true)
      if (existing.payout) {
        throw new CasinoError('conflict', 'Нельзя отменить раунд, по которому уже выплачен выигрыш')
      }

      const refund = existing.bet.startsWith('-') ? existing.bet.slice(1) : existing.bet
      const balance = toDecimal((parseDecimal(state.balance) ?? 0) + (parseDecimal(refund) ?? 0))
      commit({
        balance,
        rounds: { ...state.rounds, [input.roundId]: { ...existing, rolledBack: true } },
      })

      return output(refund, input.roundId, false)
    },

    async refresh() {
      return { balance: state.balance }
    },

    dispose() {
      // Локальному кошельку убирать за собой нечего.
    },

    controls: {
      deposit(amount: number): string {
        const value = toDecimal(Math.abs(amount))
        commit({
          ...state,
          balance: toDecimal((parseDecimal(state.balance) ?? 0) + (parseDecimal(value) ?? 0)),
        })
        return state.balance
      },

      reset(): string {
        commit({ balance: toDecimal(deps.startingBalance), rounds: {} })
        return state.balance
      },
    },
  }

  return transport
}
