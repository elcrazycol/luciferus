import { deriveRoundRandom, serverSeedHash } from '@luciferus/fairness'
import { parseDecimal, toDecimal } from '@luciferus/protocol/money'
import { CasinoError } from '../errors'
import type {
  FairRound,
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

type MockSeedPair = {
  serverSeed: string
  serverSeedHash: string
  clientSeed: string
  nonce: number
}

type MockState = {
  balance: string
  rounds: Record<string, MockRound>
  /** Локальная пара сидов: мок-режим тоже честный, просто сид никто не скрывает. */
  fair?: MockSeedPair
}

export type MockControls = {
  /** Начислить себе денег — только для мок-режима. */
  deposit(amount: number): string
  /** Стереть локальный кошелёк и начать заново. */
  reset(): string
  /** Раскрыть текущую пару сидов и начать новую. */
  rotate(): Promise<{ revealed: string; serverSeedHash: string }>
  /**
   * Текущая пара сидов целиком.
   *
   * В мок-режиме скрывать её не от кого: разработчик и есть владелец всего.
   * Нужно дев-панели и тестам, чтобы убедиться, что локальный commit-reveal честный.
   */
  seeds(): Promise<MockSeedPair>
}

export type { MockSeedPair }

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

  function localRandomHex(bytes: number): string {
    const buffer = new Uint8Array(bytes)
    crypto.getRandomValues(buffer)
    return Buffer.from(buffer).toString('hex')
  }

  /**
   * Локальная пара сидов.
   *
   * Мок-режим не притворяется: он делает ровно то же, что сервер — заводит
   * серверный сид, публикует его хэш и выводит случайность раунда через HMAC.
   * Разница только в том, что сид лежит рядом и никто его не скрывает.
   */
  async function ensureSeedPair(): Promise<MockSeedPair> {
    if (state.fair) return state.fair

    const serverSeed = localRandomHex(32)
    const pair: MockSeedPair = {
      serverSeed,
      serverSeedHash: await serverSeedHash(serverSeed),
      clientSeed: localRandomHex(8),
      nonce: 0,
    }

    commit({ ...state, fair: pair })
    return pair
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
        // Локально всегда можно получить случайность: это удобно для отладки игры.
        fairMode: 'provably-fair',
      }
    },

    async fairNext(input: { roundId: string }): Promise<FairRound> {
      const pair = await ensureSeedPair()
      const nonce = pair.nonce + 1

      commit({ ...state, fair: { ...pair, nonce } })

      return {
        roundId: input.roundId,
        nonce,
        serverSeedHash: pair.serverSeedHash,
        clientSeed: pair.clientSeed,
        random: await deriveRoundRandom({
          serverSeed: pair.serverSeed,
          clientSeed: pair.clientSeed,
          nonce,
        }),
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
        // Сброс кошелька не должен ломать уже сыгранные раунды: пару сидов оставляем.
        commit({
          balance: toDecimal(deps.startingBalance),
          rounds: {},
          ...(state.fair ? { fair: state.fair } : {}),
        })
        return state.balance
      },

      seeds(): Promise<MockSeedPair> {
        return ensureSeedPair()
      },

      /** Раскрыть текущую пару и начать новую — как кнопка «Сменить сид» в портале. */
      async rotate(): Promise<{ revealed: string; serverSeedHash: string }> {
        const current = await ensureSeedPair()
        const serverSeed = localRandomHex(32)

        commit({
          ...state,
          fair: {
            serverSeed,
            serverSeedHash: await serverSeedHash(serverSeed),
            clientSeed: localRandomHex(8),
            nonce: 0,
          },
        })

        return { revealed: current.serverSeed, serverSeedHash: current.serverSeedHash }
      },
    },
  }

  return transport
}
