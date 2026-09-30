import {
  EMBED_INIT_RETRY_MS,
  EMBED_INIT_TIMEOUT_MS,
  EMBED_PROTOCOL_VERSION,
  type GameLaunch,
  isOriginAllowed,
  readHelloMessage,
  type SessionMessage,
} from '@luciferus/protocol/embed'

export type EmbedErrorCode =
  | 'origin_not_allowed'
  | 'handshake_timeout'
  | 'internal_error'
  | 'game_disabled'

export type EmbedBridgeState =
  | { status: 'connecting' }
  | { status: 'ready'; sdkVersion: string }
  | { status: 'error'; code: EmbedErrorCode; message: string }

export type MessageEventLike = {
  data: unknown
  origin: string
  source: unknown
}

export type EmbedBridgeDeps = {
  launch: GameLaunch
  /** Собственный origin портала — с него игра будет ждать сообщения. */
  portalOrigin: string
  /** Отправить сообщение в iframe. */
  postToGame: (message: unknown, targetOrigin: string) => void
  /** Подписка на входящие сообщения. Возвращает функцию отписки. */
  listen: (handler: (event: MessageEventLike) => void) => () => void
  /** Проверка, что сообщение пришло именно из нашего iframe. */
  isFromGame: (event: MessageEventLike) => boolean
  setTimeoutFn: (handler: () => void, ms: number) => unknown
  clearTimeoutFn: (id: unknown) => void
  randomId: () => string
  onState?: (state: EmbedBridgeState) => void
  initTimeoutMs?: number
  retryMs?: number
}

export type EmbedBridge = {
  readonly state: EmbedBridgeState
  /** Ещё раз поздороваться. Полезно по событию `load` у iframe. */
  ping(): void
  /** Отправить в игру новый баланс. */
  pushBalance(balance: string): void
  destroy(): void
}

/**
 * Мост между порталом и игрой внутри iframe.
 *
 * Здесь живёт вся защита от подмены:
 * - сообщения принимаются только из нашего же iframe (`isFromGame`);
 * - origin игры обязан быть объявлен автором в манифесте;
 * - `nonce` должен совпасть с выданным — иначе это не ответ на наше приветствие;
 * - слаг игры должен совпадать с запущенной.
 *
 * Только после всех четырёх проверок игра получает сессию. Любая непройденная —
 * и игра остаётся без денег, а портал показывает причину.
 */
export function createEmbedBridge(deps: EmbedBridgeDeps): EmbedBridge {
  const { launch } = deps
  const allowedOrigins = launch.game.allowedOrigins
  const nonce = deps.randomId()
  const retryMs = deps.retryMs ?? EMBED_INIT_RETRY_MS
  const timeoutMs = deps.initTimeoutMs ?? EMBED_INIT_TIMEOUT_MS

  let state: EmbedBridgeState = { status: 'connecting' }
  let ready = false
  let destroyed = false
  let announcedOrigin: string | null = null
  let retryTimer: unknown = null
  let timeoutTimer: unknown = null

  const initMessage = {
    type: 'casino:init' as const,
    protocol: EMBED_PROTOCOL_VERSION,
    nonce,
    gameSlug: launch.game.slug,
    portalOrigin: deps.portalOrigin,
  }

  function setState(next: EmbedBridgeState): void {
    state = next
    deps.onState?.(next)
  }

  function stopTimers(): void {
    if (retryTimer !== null) deps.clearTimeoutFn(retryTimer)
    if (timeoutTimer !== null) deps.clearTimeoutFn(timeoutTimer)
    retryTimer = null
    timeoutTimer = null
  }

  function sendInit(): void {
    if (destroyed || ready) return

    // Целимся в каждый объявленный origin игры. Лишние просто не получат сообщение,
    // зато мы нигде не используем `*`.
    for (const origin of allowedOrigins) {
      deps.postToGame(initMessage, origin)
    }
  }

  function scheduleRetry(): void {
    if (destroyed || ready) return

    retryTimer = deps.setTimeoutFn(() => {
      sendInit()
      scheduleRetry()
    }, retryMs)
  }

  function buildSessionMessage(): SessionMessage {
    return {
      type: 'casino:session',
      protocol: EMBED_PROTOCOL_VERSION,
      nonce,
      gameSlug: launch.game.slug,
      apiUrl: launch.apiUrl,
      session: launch.session,
      player: {
        id: launch.player.id,
        username: launch.player.username,
        displayName: launch.player.displayName,
      },
      wallet: launch.wallet,
      limits: launch.game.limits,
    }
  }

  function handleMessage(event: MessageEventLike): void {
    if (destroyed) return
    if (!deps.isFromGame(event)) return

    const hello = readHelloMessage(event.data)
    if (!hello) return

    if (!isOriginAllowed(event.origin, allowedOrigins)) {
      // Не отвечаем: origin не объявлен, значит, сессию он не получит.
      stopTimers()
      setState({
        status: 'error',
        code: 'origin_not_allowed',
        message: `Игра ответила с origin ${event.origin}, которого нет в её манифесте`,
      })
      return
    }

    if (hello.nonce !== nonce) return
    if (hello.gameSlug !== launch.game.slug) return

    // Повторный hello (игра перезагрузилась внутри iframe) — просто подтверждаем сессию.
    if (ready) {
      deps.postToGame(buildSessionMessage(), event.origin)
      return
    }

    ready = true
    announcedOrigin = event.origin
    stopTimers()

    deps.postToGame(buildSessionMessage(), event.origin)
    setState({ status: 'ready', sdkVersion: hello.sdkVersion })
  }

  const unsubscribe = deps.listen(handleMessage)

  sendInit()
  scheduleRetry()

  timeoutTimer = deps.setTimeoutFn(() => {
    if (destroyed || ready) return
    stopTimers()

    const message = {
      type: 'casino:error',
      protocol: EMBED_PROTOCOL_VERSION,
      code: 'handshake_timeout' as const,
      message: 'Игра не ответила на приветствие портала',
    }

    for (const origin of allowedOrigins) {
      deps.postToGame(message, origin)
    }

    setState({
      status: 'error',
      code: 'handshake_timeout',
      message:
        'Игра не ответила за 10 секунд. Проверьте, что она подключила SDK и объявила свой origin',
    })
  }, timeoutMs)

  return {
    get state() {
      return state
    },

    ping() {
      sendInit()
    },

    pushBalance(balance: string) {
      // Баланс отправляем только после установленной сессии и всегда на проверенный origin.
      if (!ready || !announcedOrigin) return

      deps.postToGame(
        { type: 'casino:balance', protocol: EMBED_PROTOCOL_VERSION, balance },
        announcedOrigin,
      )
    },

    destroy() {
      destroyed = true
      stopTimers()
      unsubscribe()
    },
  }
}
