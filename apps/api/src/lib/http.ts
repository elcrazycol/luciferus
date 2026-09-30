import { toFieldErrors } from '@luciferus/protocol/errors'
import type { Context } from 'hono'
import type { z } from 'zod'
import { AppError } from './errors'

/**
 * Читает JSON из тела запроса и валидирует схемой.
 *
 * Единственный путь, которым внешние данные попадают в сервисы: без валидации
 * в базу не уходит ничего. Ошибки Zod превращаются в 400 со списком проблем по полям,
 * чтобы форма могла подсветить конкретные поля.
 */
export async function parseJson<Schema extends z.ZodType>(
  c: Context,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let raw: unknown

  try {
    raw = await c.req.json()
  } catch {
    throw AppError.badRequest('Тело запроса должно быть корректным JSON')
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    throw AppError.badRequest('Проверьте поля запроса', {
      fields: toFieldErrors(result.error),
    })
  }

  return result.data
}

/** Валидирует query-параметры тем же способом, что и тело запроса. */
export function parseQuery<Schema extends z.ZodType>(c: Context, schema: Schema): z.infer<Schema> {
  const result = schema.safeParse(c.req.query())
  if (!result.success) {
    throw AppError.badRequest('Проверьте параметры запроса', {
      fields: toFieldErrors(result.error),
    })
  }

  return result.data
}
