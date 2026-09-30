import { currency } from '@luciferus/config/currency'
import { economy } from '@luciferus/config/economy'
import type { Casino } from './core'
import { createCasino } from './core'
import { createDevPanel } from './dev-panel'
import { createMockTransport, createPostMessageTransport } from './transports'
import type { FetchLike, StorageLike, WindowLike } from './types'

export const SDK_VERSION = '1.0.0'

/** Возможности этой сборки. Уезжают в `casino:hello`, чтобы портал мог их учесть. */
const CAPABILITIES = ['wallet', 'mock', 'balance-push']

export type BootstrapOptions = {
  win: Window
  /** Выключить отладочную панель (например, на проде игры). */
  devPanel?: boolean
  sdkVersion?: string
}

function isDevPanelEnabled(win: Window, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit

  const override = new URLSearchParams(win.location.search).get('casino-devtools')
  if (override === '0') return false
  return true
}

/**
 * Собирает SDK поверх реального окна браузера.
 *
 * Логика выбора транспорта: если мы внутри фрейма — пробуем договориться с порталом,
 * иначе сразу работаем на локальном кошельке. Провал хендшейка не оставляет игру
 * без денег, но обязательно подсвечивается в панели.
 */
export function bootstrap(options: BootstrapOptions): Casino {
  const { win } = options
  const sdkVersion = options.sdkVersion ?? SDK_VERSION

  const storage = win.localStorage as StorageLike

  const mockTransport = createMockTransport({
    storage,
    startingBalance: economy.signupBonus,
    currency: currency.symbol,
    limits: {
      minBet: 0.1,
      maxBet: economy.defaultMaxBet,
      maxWin: economy.defaultMaxWin,
    },
  })

  const embedded = win.parent !== win
  const parentWindow = embedded ? (win.parent as unknown as WindowLike) : null

  const portalTransport = createPostMessageTransport({
    self: win as unknown as WindowLike,
    parent: parentWindow,
    fetchFn: win.fetch.bind(win) as unknown as FetchLike,
    setTimeoutFn: (handler, ms) => win.setTimeout(handler, ms),
    clearTimeoutFn: (id) => win.clearTimeout(id as number),
    sdkVersion,
    capabilities: CAPABILITIES,
  })

  const casino = createCasino({
    portalTransport,
    mockTransport,
    randomId: () => win.crypto.randomUUID(),
  })

  if (isDevPanelEnabled(win, options.devPanel)) {
    casino.ready().then(() => {
      createDevPanel({
        casino,
        mockControls: mockTransport.controls,
        doc: win.document,
        sdkVersion,
      })
    })
  }

  return casino
}

let singleton: Casino | null = null

/** Единственный экземпляр SDK на страницу. Повторные вызовы возвращают тот же объект. */
export function getCasino(): Casino {
  singleton ??= bootstrap({ win: window })
  return singleton
}

declare global {
  interface Window {
    Casinos?: Casino
  }
}

// Auto-init: игра просто подключает скрипт и сразу получает `window.Casinos`.
if (typeof window !== 'undefined' && !window.Casinos) {
  window.Casinos = getCasino()
}

export { type Casino, createCasino } from './core'
export { CasinoError } from './errors'
export type * from './types'
