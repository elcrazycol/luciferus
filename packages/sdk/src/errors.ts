import type { SdkErrorCode } from '@luciferus/protocol/embed-constants'

/**
 * Ошибка, которую отдаёт SDK.
 *
 * `code` стабилен и предназначен для ветвления в коде игры (`error.code === 'insufficient_funds'`),
 * `message` — для показа человеку.
 */
export class CasinoError extends Error {
  readonly code: SdkErrorCode
  readonly status?: number
  readonly details?: unknown

  constructor(
    code: SdkErrorCode,
    message: string,
    options: { status?: number; details?: unknown } = {},
  ) {
    super(message)
    this.name = 'CasinoError'
    this.code = code
    this.status = options.status
    this.details = options.details
  }
}

/** Превращает любой пойманный мусор в `CasinoError`, чтобы у игры был один тип ошибки. */
export function toCasinoError(error: unknown, fallbackMessage: string): CasinoError {
  if (error instanceof CasinoError) return error

  return new CasinoError('internal_error', error instanceof Error ? error.message : fallbackMessage)
}
