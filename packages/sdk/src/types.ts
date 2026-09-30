import type { SdkErrorCode } from '@luciferus/protocol/embed'

export type CasinoMode = 'portal' | 'mock'

export type CasinoPlayer = {
  id: string
  username: string
  displayName: string
}

export type CasinoLimits = {
  minBet: number
  maxBet: number
  maxWin: number
}

export type CasinoSnapshot = {
  mode: CasinoMode
  gameSlug: string | null
  player: CasinoPlayer | null
  /**
   * Баланс числом, а не строкой.
   *
   * На сервере деньги ходят строками, потому что там важна точность до копейки.
   * Здесь — граница с игровым кодом, который почти всегда делает с балансом
   * арифметику, и строка ему только мешает. Истина всё равно на сервере: после
   * каждой операции SDK берёт баланс из ответа, а не считает сам.
   */
  balance: number
  currency: string
  limits: CasinoLimits
}

export type RoundOptions = {
  /** Идентификатор раунда. Если не задан — SDK сгенерирует сам. */
  roundId?: string
  meta?: Record<string, unknown>
}

export type RoundResult = {
  balance: number
  /** Знаковая сумма операции: ставка отрицательная, выигрыш положительный. */
  amount: number
  roundId: string | null
  type: 'bet' | 'payout' | 'rollback'
  /** `true`, если это повтор ранее применённой операции и баланс не менялся. */
  idempotent: boolean
}

export type CasinoEventMap = {
  ready: CasinoSnapshot
  balance: { balance: number; delta: number }
  error: Error
}

export type CasinoEventListener<Event extends keyof CasinoEventMap> = (
  payload: CasinoEventMap[Event],
) => void

// ─── Транспорт: то, что SDK подменяет между порталом и мок-режимом ────────────────

export type TransportSession = {
  player: CasinoPlayer | null
  balance: string
  currency: string
  limits: CasinoLimits
}

export type TransportHandlers = {
  onBalance(balance: string): void
  onError(error: Error): void
}

export type WalletOperationInput = {
  amount: number
  roundId: string
  meta?: Record<string, unknown>
}

/** Отмена раунда суммы не несёт: возвращается ровно то, что было списано. */
export type RollbackInput = {
  roundId: string
  meta?: Record<string, unknown>
}

export type WalletOperationOutput = {
  balance: string
  amount: string
  roundId: string | null
  idempotent: boolean
}

/**
 * Транспорт отделяет логику SDK от источника денег.
 *
 * В портале это postMessage-хендшейк плюс HTTP к API; вне портала — локальный
 * кошелёк в localStorage, чтобы автор игры мог писать её, не поднимая портал.
 */
export type WalletTransport = {
  readonly mode: CasinoMode
  readonly gameSlug: string | null
  ready(handlers: TransportHandlers): Promise<TransportSession>
  bet(input: WalletOperationInput): Promise<WalletOperationOutput>
  payout(input: WalletOperationInput): Promise<WalletOperationOutput>
  rollback(input: RollbackInput): Promise<WalletOperationOutput>
  refresh(): Promise<{ balance: string }>
  dispose(): void
}

// ─── Минимальные типы окружения, чтобы SDK тестировался без DOM ──────────────────

export type MessageEventLike = {
  data: unknown
  origin: string
  source: unknown
}

export type WindowLike = {
  postMessage(message: unknown, targetOrigin: string): void
  addEventListener?(type: 'message', listener: (event: MessageEventLike) => void): void
  removeEventListener?(type: 'message', listener: (event: MessageEventLike) => void): void
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type ApiErrorPayload = {
  error?: SdkErrorCode
  message?: string
  details?: unknown
}
