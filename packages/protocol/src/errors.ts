import type { z } from 'zod'

/** Коды ошибок API. Портал показывает `message`, но ветвится по `error`. */
export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'insufficient_funds',
  'limit_exceeded',
  'rate_limited',
  'internal_error',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/** Единый формат ошибки всех эндпоинтов: `{ error, message, details? }`. */
export type ApiErrorBody = {
  error: ApiErrorCode
  message: string
  details?: unknown
}

export type FieldErrors = Record<string, string[]>

/** Превращает ошибку Zod в плоский список проблем по полям — в таком виде её ест форма. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {}

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_'
    const bucket = result[key] ?? []
    bucket.push(issue.message)
    result[key] = bucket
  }

  return result
}
