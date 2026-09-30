import { parseDecimal, toDecimal } from '@luciferus/protocol/money'
import { CasinoError, toCasinoError } from './errors'
import type {
  CasinoEventListener,
  CasinoEventMap,
  CasinoLimits,
  CasinoMode,
  CasinoPlayer,
  CasinoSnapshot,
  FairClaimInput,
  FairMode,
  FairRound,
  RoundOptions,
  RoundResult,
  TransportHandlers,
  TransportSession,
  WalletTransport,
} from './types'

export type HistoryEntry = RoundResult & { at: number }

export type CreateCasinoDeps = {
  /** Транспорт портала. `null`, если игра открыта не во фрейме. */
  portalTransport: WalletTransport | null
  /** Локальный кошелёк: используется, когда портала нет или хендшейк провалился. */
  mockTransport: WalletTransport
  randomId: () => string
  historyLimit?: number
}

type CasinoState = {
  mode: CasinoMode
  gameSlug: string | null
  fairMode: FairMode
  player: CasinoPlayer | null
  balance: number
  currency: string
  limits: CasinoLimits
}

const EMPTY_LIMITS: CasinoLimits = { minBet: 0, maxBet: 0, maxWin: 0 }

/**
 * Ядро SDK: то, что видит автор игры.
 *
 * Ядро не знает, откуда берутся деньги — этим занимается транспорт. Оно держит
 * состояние, рассылает события и следит за тем, чтобы баланс всегда брался из
 * ответа источника, а не досчитывался на клиенте.
 */
export function createCasino(deps: CreateCasinoDeps) {
  const historyLimit = deps.historyLimit ?? 25

  const state: CasinoState = {
    mode: 'mock',
    gameSlug: null,
    fairMode: 'client',
    player: null,
    balance: 0,
    currency: '',
    limits: EMPTY_LIMITS,
  }

  const listeners: { [Event in keyof CasinoEventMap]: Set<CasinoEventListener<Event>> } = {
    ready: new Set(),
    balance: new Set(),
    error: new Set(),
  }

  const history: HistoryEntry[] = []

  let activeTransport: WalletTransport = deps.mockTransport
  let handshakeError: CasinoError | null = null
  let readySnapshot: CasinoSnapshot | null = null

  function emit<Event extends keyof CasinoEventMap>(
    event: Event,
    payload: CasinoEventMap[Event],
  ): void {
    for (const listener of listeners[event]) {
      try {
        listener(payload)
      } catch (error) {
        // Падение чужого обработчика не должно ломать SDK.
        console.error('[casino] ошибка в обработчике события', event, error)
      }
    }

    if (event === 'error' && listeners.error.size === 0) {
      // Молча проглоченная ошибка — худший вариант для отладки.
      console.warn('[casino] ошибка без обработчика:', payload)
    }
  }

  function pushHistory(entry: RoundResult): void {
    history.unshift({ ...entry, at: Date.now() })
    if (history.length > historyLimit) history.length = historyLimit
  }

  function setBalance(next: string): void {
    state.balance = parseDecimal(next) ?? state.balance
  }

  function snapshot(): CasinoSnapshot {
    return {
      mode: state.mode,
      gameSlug: state.gameSlug,
      fairMode: state.fairMode,
      player: state.player,
      balance: state.balance,
      currency: state.currency,
      limits: state.limits,
    }
  }

  function applySession(
    mode: CasinoMode,
    gameSlug: string | null,
    session: TransportSession,
  ): void {
    state.mode = mode
    state.gameSlug = gameSlug ?? activeTransport.gameSlug
    state.player = session.player
    state.currency = session.currency
    state.limits = session.limits
    state.fairMode = session.fairMode
    setBalance(session.balance)
  }

  const transportHandlers: TransportHandlers = {
    onBalance(balance) {
      const previous = state.balance
      setBalance(balance)
      emit('balance', { balance: state.balance, delta: state.balance - previous })
    },
    onError(error) {
      emit('error', toCasinoError(error, 'Ошибка со стороны портала'))
    },
  }

  /**
   * Хендшейк. Если портал не ответил — переходим на локальный кошелёк, чтобы игра
   * осталась играбельной, но ошибку обязательно показываем: молча играть с
   * фейковым балансом внутри портала — худшее, что здесь может случиться.
   */
  const boot = (async (): Promise<void> => {
    if (deps.portalTransport) {
      try {
        const session = await deps.portalTransport.ready(transportHandlers)
        activeTransport = deps.portalTransport
        applySession('portal', deps.portalTransport.gameSlug, session)
        readySnapshot = snapshot()
        emit('ready', readySnapshot)
        return
      } catch (error) {
        handshakeError = toCasinoError(error, 'Не удалось договориться с порталом')
        deps.portalTransport.dispose()
        emit('error', handshakeError)
      }
    }

    activeTransport = deps.mockTransport
    const session = await deps.mockTransport.ready(transportHandlers)
    applySession('mock', null, session)
    readySnapshot = snapshot()
    emit('ready', readySnapshot)
  })()

  function assertReady(): void {
    if (!readySnapshot) {
      throw new CasinoError('not_ready', 'SDK ещё не готов. Дождитесь Casinos.ready()')
    }
  }

  /**
   * Разбирает опции раунда на части запроса.
   *
   * Данные честности уезжают отдельным полем и ТОЛЬКО со ставкой: на номере раунда
   * стоит уникальный индекс «одна ставка на номер», и выплата того же раунда его
   * бы нарушила.
   */
  function buildInput(options: RoundOptions): {
    meta?: Record<string, unknown>
    fair?: FairClaimInput
  } {
    return {
      ...(options.meta ? { meta: options.meta } : {}),
      ...(options.fair
        ? {
            fair: {
              nonce: options.fair.nonce,
              serverSeedHash: options.fair.serverSeedHash,
              random: options.fair.random,
              ...(options.fair.outcome ? { outcome: options.fair.outcome } : {}),
            },
          }
        : {}),
    }
  }

  function normalizeAmount(amount: number, label: string): number {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new CasinoError('bad_request', `${label} должна быть положительным числом`)
    }
    return amount
  }

  async function perform(
    type: RoundResult['type'],
    amount: number | null,
    options: RoundOptions,
  ): Promise<RoundResult> {
    await boot
    assertReady()

    const roundId = options.roundId ?? api.roundId()
    const previous = state.balance

    try {
      const input = buildInput(options)

      // Данные честности нужны только ставке — исход фиксируется вместе с ней.
      const result =
        type === 'bet'
          ? await activeTransport.bet({ amount: amount ?? 0, roundId, ...input })
          : type === 'payout'
            ? await activeTransport.payout({
                amount: amount ?? 0,
                roundId,
                ...(input.meta ? { meta: input.meta } : {}),
              })
            : await activeTransport.rollback({
                roundId,
                ...(input.meta ? { meta: input.meta } : {}),
              })

      setBalance(result.balance)

      const round: RoundResult = {
        balance: state.balance,
        amount: parseDecimal(result.amount) ?? 0,
        roundId: result.roundId,
        type,
        idempotent: result.idempotent,
      }

      pushHistory(round)
      emit('balance', { balance: state.balance, delta: state.balance - previous })
      return round
    } catch (error) {
      const casinoError = toCasinoError(error, 'Операция с балансом не удалась')
      emit('error', casinoError)
      throw casinoError
    }
  }

  const api = {
    /** Режим работы: `portal` — деньги настоящие (в смысле сервера), `mock` — локальные. */
    get mode(): CasinoMode {
      return state.mode
    },

    get isInsidePortal(): boolean {
      return state.mode === 'portal'
    },

    get gameSlug(): string | null {
      return state.gameSlug
    },

    get player(): CasinoPlayer | null {
      return state.player
    },

    /** Текущий баланс. Всегда из последнего ответа источника, не досчитан локально. */
    get balance(): number {
      return state.balance
    },

    get currency(): string {
      return state.currency
    },

    get limits(): CasinoLimits {
      return state.limits
    },

    /** Режим честности игры, как её объявил автор. */
    get fairMode(): FairMode {
      return state.fairMode
    },

    /** Заполняется, если хендшейк провалился и SDK ушёл в мок-режим. */
    get handshakeError(): CasinoError | null {
      return handshakeError
    },

    /** Последние операции — для дев-панели и отладки. */
    get history(): readonly HistoryEntry[] {
      return history
    },

    on<Event extends keyof CasinoEventMap>(
      event: Event,
      listener: CasinoEventListener<Event>,
    ): () => void {
      listeners[event].add(listener)
      return () => listeners[event].delete(listener)
    },

    /** Дожидается завершения хендшейка. Ошибки хендшейка не роняют промис. */
    ready(): Promise<CasinoSnapshot> {
      return boot.then(() => snapshot())
    },

    roundId(): string {
      try {
        return deps.randomId()
      } catch {
        return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      }
    },

    bet(amount: number, options: RoundOptions = {}): Promise<RoundResult> {
      // Проверяем до запроса: иначе игра получит от сервера невнятную ошибку,
      // хотя проблема очевидна уже здесь.
      if (state.fairMode === 'provably-fair' && !options.fair) {
        return Promise.reject(
          new CasinoError(
            'bad_request',
            'Игра в проверяемом режиме: сначала Casinos.fair.start(), потом ставка',
          ),
        )
      }

      return perform('bet', normalizeAmount(amount, 'Ставка'), options)
    },

    /**
     * Запрашивает случайность на раунд.
     *
     * Вызывать перед каждой ставкой в проверяемом режиме: номер раунда нельзя
     * переиспользовать, иначе сервер отклонит ставку как повтор.
     */
    async fairStart(roundId?: string): Promise<FairRound> {
      await boot
      return activeTransport.fairNext({ roundId: roundId ?? api.roundId() })
    },

    payout(amount: number, options: RoundOptions = {}): Promise<RoundResult> {
      return perform('payout', normalizeAmount(amount, 'Выплата'), options)
    },

    rollback(options: RoundOptions = {}): Promise<RoundResult> {
      return perform('rollback', null, options)
    },

    /** Перечитать баланс с сервера — например, после возврата игрока во вкладку. */
    async refresh(): Promise<number> {
      await boot
      const { balance } = await activeTransport.refresh()
      setBalance(balance)
      return state.balance
    },

    /** Только для мок-режима: начислить себе денег. В портале недоступно. */
    depositForTesting(amount: number): number {
      if (state.mode !== 'mock') {
        throw new CasinoError('forbidden', 'Начислить деньги можно только в мок-режиме')
      }

      const mock = deps.mockTransport as WalletTransport & {
        controls?: { deposit(amount: number): string }
      }

      if (!mock.controls) {
        throw new CasinoError('internal_error', 'Мок-транспорт не поддерживает начисление')
      }

      setBalance(mock.controls.deposit(amount))
      return state.balance
    },

    /** Человекочитаемый баланс: `1420.5` → `C$1,420.50`. */
    formatBalance(value: number = state.balance): string {
      const formatted = toDecimal(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      return `${state.currency || 'C$'}${formatted}`
    },
  }

  return api
}

export type Casino = ReturnType<typeof createCasino>
