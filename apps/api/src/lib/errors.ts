import type { ApiErrorBody, ApiErrorCode } from '@luciferus/protocol/errors'

/**
 * Ошибка, которую можно безопасно показать клиенту.
 *
 * Всё, что не `AppError`, считается багом и превращается в 500 с обезличенным
 * текстом — внутренние сообщения наружу не уходят.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ApiErrorCode, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
  }

  toBody(): ApiErrorBody {
    return this.details === undefined
      ? { error: this.code, message: this.message }
      : { error: this.code, message: this.message, details: this.details }
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('bad_request', message, 400, details)
  }

  static unauthorized(message = 'Нужно войти в аккаунт'): AppError {
    return new AppError('unauthorized', message, 401)
  }

  static forbidden(message = 'Недостаточно прав'): AppError {
    return new AppError('forbidden', message, 403)
  }

  static notFound(message: string): AppError {
    return new AppError('not_found', message, 404)
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError('conflict', message, 409, details)
  }

  /** 402 Payment Required — единственный честный код для «нет CrazyBucks». */
  static insufficientFunds(message = 'Недостаточно CrazyBucks на балансе'): AppError {
    return new AppError('insufficient_funds', message, 402)
  }

  static limitExceeded(message: string, details?: unknown): AppError {
    return new AppError('limit_exceeded', message, 422, details)
  }

  static rateLimited(message: string, retryAfterSeconds: number): AppError {
    return new AppError('rate_limited', message, 429, { retryAfterSeconds })
  }
}

/** Код нарушения уникальности в Postgres. */
export const PG_UNIQUE_VIOLATION = '23505'

/**
 * Ищет код ошибки Postgres по цепочке `cause`.
 *
 * Drizzle оборачивает ошибку драйвера в `DrizzleQueryError`, поэтому `23505`
 * лежит не на самом исключении, а на его причине. Ходим по цепочке с ограничением
 * глубины, чтобы не зациклиться на самореферентных ошибках.
 */
function hasPostgresCode(error: unknown, code: string, depth = 0): boolean {
  if (depth > 5 || typeof error !== 'object' || error === null) return false

  if ((error as { code?: unknown }).code === code) return true

  return hasPostgresCode((error as { cause?: unknown }).cause, code, depth + 1)
}

export function isUniqueViolation(error: unknown): boolean {
  return hasPostgresCode(error, PG_UNIQUE_VIOLATION)
}
