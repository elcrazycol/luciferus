import {
  EMBED_INIT_TIMEOUT_MS,
  EMBED_PROTOCOL_VERSION,
  isEmbedEnvelope,
  readBalanceMessage,
  readErrorMessage,
  readInitMessage,
  readSessionMessage,
  SDK_ERROR_CODES,
  type SdkErrorCode,
} from '@luciferus/protocol/embed'
import { parseDecimal, toDecimal } from '@luciferus/protocol/money'
import { CasinoError } from '../errors'
import type {
  FairRound,
  FetchLike,
  MessageEventLike,
  RollbackInput,
  TransportHandlers,
  TransportSession,
  WalletOperationInput,
  WalletOperationOutput,
  WalletTransport,
  WindowLike,
} from '../types'

export type PostMessageTransportDeps = {
  /** Окно игры: здесь слушаем сообщения портала. */
  self: WindowLike
  /** Родительское окно. `null` — игра открыта не во фрейме. */
  parent: WindowLike | null
  fetchFn: FetchLike
  setTimeoutFn: (handler: () => void, ms: number) => unknown
  clearTimeoutFn: (id: unknown) => void
  sdkVersion: string
  capabilities?: string[]
  /** Таймаут ожидания сессии. В тестах уменьшается. */
  initTimeoutMs?: number
}

type ActiveSession = {
  token: string
  apiUrl: string
  expiresAt: string
}

/**
 * Транспорт «игра внутри портала»: хендшейк через postMessage, деньги — по HTTP.
 *
 * Хендшейк инициирует портал, а не игра. Так у игры нет причин постить в `*`:
 * она вообще не знает, кто её открыл, пока портал сам не представится. Проверка
 * `event.source === window.parent` гарантирует, что разговор идёт с тем, кто нас
 * встроил, а сверка `event.origin` с `portalOrigin` — что это портал.
 */
export function createPostMessageTransport(deps: PostMessageTransportDeps): WalletTransport | null {
  if (!deps.parent || typeof deps.self.addEventListener !== 'function') return null

  const timeoutMs = deps.initTimeoutMs ?? EMBED_INIT_TIMEOUT_MS

  let portalOrigin: string | null = null
  let session: ActiveSession | null = null
  let gameSlug: string | null = null
  let handlers: TransportHandlers | null = null
  let disposed = false

  let resolveReady: ((value: TransportSession) => void) | null = null
  let rejectReady: ((reason: Error) => void) | null = null
  let timer: unknown = null

  function post(message: Record<string, unknown>): void {
    // Целимся только в проверенный origin портала. `*` не используется нигде.
    if (!portalOrigin) return
    deps.parent?.postMessage(message, portalOrigin)
  }

  function settleReady(value: TransportSession): void {
    if (timer !== null) deps.clearTimeoutFn(timer)
    timer = null

    if (!resolveReady) return

    const resolve = resolveReady
    resolveReady = null
    rejectReady = null
    resolve(value)
  }

  function failReady(error: Error): void {
    if (timer !== null) deps.clearTimeoutFn(timer)
    timer = null

    if (rejectReady) {
      const reject = rejectReady
      resolveReady = null
      rejectReady = null
      reject(error)
      return
    }

    // Хендшейк уже прошёл, а портал прислал ошибку позже (например, игру выключили).
    handlers?.onError(error)
  }

  function onMessage(event: MessageEventLike): void {
    if (disposed) return
    // Разговариваем только с тем окном, которое нас встроило.
    if (event.source !== deps.parent) return

    // `init` не содержит секретов, поэтому его можно обработать до того, как мы
    // узнали origin портала — иначе узнать его было бы неоткуда.
    const init = readInitMessage(event.data)
    if (init) {
      portalOrigin = init.portalOrigin

      post({
        type: 'casino:hello',
        protocol: EMBED_PROTOCOL_VERSION,
        nonce: init.nonce,
        gameSlug: init.gameSlug,
        sdkVersion: deps.sdkVersion,
        capabilities: deps.capabilities ?? [],
      })
      return
    }

    if (!isEmbedEnvelope(event.data)) return

    // Всё остальное несёт данные — принимаем только с origin портала.
    if (!portalOrigin || event.origin !== portalOrigin) return

    const sessionMessage = readSessionMessage(event.data)
    if (sessionMessage) {
      session = {
        token: sessionMessage.session.token,
        apiUrl: sessionMessage.apiUrl,
        expiresAt: sessionMessage.session.expiresAt,
      }
      gameSlug = sessionMessage.gameSlug

      settleReady({
        player: sessionMessage.player,
        balance: sessionMessage.wallet.balance,
        currency: sessionMessage.wallet.currency,
        limits: sessionMessage.limits,
        fairMode: sessionMessage.fairMode,
      })
      return
    }

    const balanceMessage = readBalanceMessage(event.data)
    if (balanceMessage) {
      handlers?.onBalance(balanceMessage.balance)
      return
    }

    const errorMessage = readErrorMessage(event.data)
    if (errorMessage) {
      failReady(new CasinoError(mapCode(errorMessage.code), errorMessage.message))
    }
  }

  async function callApi(path: string, init: RequestInit): Promise<unknown> {
    if (!session) throw new CasinoError('not_ready', 'Игра ещё не получила сессию от портала')

    let response: Response
    try {
      response = await deps.fetchFn(`${session.apiUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.token}`,
          ...(init.headers ?? {}),
        },
      })
    } catch {
      throw new CasinoError('network_error', 'Не удалось связаться с API портала')
    }

    const payload: unknown = await response.json().catch(() => null)

    if (!response.ok) {
      const body = typeof payload === 'object' && payload !== null ? payload : {}
      const record = body as Record<string, unknown>

      throw new CasinoError(
        mapCode(record.error),
        typeof record.message === 'string'
          ? record.message
          : `API портала ответил ${response.status}`,
        { status: response.status, details: record.details },
      )
    }

    return payload
  }

  function toOutput(payload: unknown): WalletOperationOutput {
    const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
      string,
      unknown
    >
    const entry = (
      typeof body.entry === 'object' && body.entry !== null ? body.entry : {}
    ) as Record<string, unknown>

    return {
      balance: typeof body.balance === 'string' ? body.balance : '0',
      amount: typeof entry.amount === 'string' ? entry.amount : '0',
      roundId: typeof entry.roundId === 'string' ? entry.roundId : null,
      idempotent: body.idempotent === true,
    }
  }

  return {
    mode: 'portal',

    get gameSlug() {
      return gameSlug
    },

    ready(nextHandlers) {
      handlers = nextHandlers

      return new Promise<TransportSession>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject

        deps.self.addEventListener?.('message', onMessage)

        timer = deps.setTimeoutFn(() => {
          failReady(
            new CasinoError(
              'handshake_timeout',
              `Портал не ответил за ${Math.round(timeoutMs / 1000)} с. Проверьте, что origin игры объявлен в манифесте`,
            ),
          )
        }, timeoutMs)
      })
    },

    async fairNext(input: { roundId: string }): Promise<FairRound> {
      const payload = await callApi('/v1/game/fair/next', { method: 'POST', body: '{}' })
      const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
        string,
        unknown
      >

      if (typeof body.nonce !== 'number' || typeof body.random !== 'string') {
        throw new CasinoError('internal_error', 'Портал вернул некорректную случайность раунда')
      }

      return {
        roundId: input.roundId,
        nonce: body.nonce,
        serverSeedHash: typeof body.serverSeedHash === 'string' ? body.serverSeedHash : '',
        clientSeed: typeof body.clientSeed === 'string' ? body.clientSeed : '',
        random: body.random,
      }
    },

    async bet(input: WalletOperationInput) {
      return toOutput(
        await callApi('/v1/game/bet', {
          method: 'POST',
          body: JSON.stringify({
            amount: input.amount,
            roundId: input.roundId,
            ...(input.meta ? { meta: input.meta } : {}),
            // В корне тела, а не в meta: сервер проверяет это до списания денег.
            ...(input.fair ? { fair: input.fair } : {}),
          }),
        }),
      )
    },

    async payout(input: WalletOperationInput) {
      return toOutput(
        await callApi('/v1/game/payout', {
          method: 'POST',
          body: JSON.stringify({
            amount: input.amount,
            roundId: input.roundId,
            ...(input.meta ? { meta: input.meta } : {}),
          }),
        }),
      )
    },

    async rollback(input: RollbackInput) {
      return toOutput(
        await callApi('/v1/game/rollback', {
          method: 'POST',
          body: JSON.stringify({
            roundId: input.roundId,
            ...(input.meta ? { meta: input.meta } : {}),
          }),
        }),
      )
    },

    async refresh() {
      const payload = await callApi('/v1/game/balance', { method: 'GET' })
      const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
        string,
        unknown
      >

      return { balance: typeof body.balance === 'string' ? body.balance : '0' }
    },

    dispose() {
      disposed = true
      if (timer !== null) deps.clearTimeoutFn(timer)
      timer = null
      deps.self.removeEventListener?.('message', onMessage)
    },
  }
}

/** Код из ответа API или сообщения портала → код ошибки SDK. */
function mapCode(value: unknown, fallback: SdkErrorCode = 'internal_error'): SdkErrorCode {
  return typeof value === 'string' && (SDK_ERROR_CODES as readonly string[]).includes(value)
    ? (value as SdkErrorCode)
    : fallback
}

/** Приводит строку баланса к двум знакам, отсекая мусор. */
export function normalizeBalance(value: string): string {
  return toDecimal(parseDecimal(value) ?? 0)
}
