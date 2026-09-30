'use server'

import { type FieldErrors, toFieldErrors } from '@luciferus/protocol/errors'
import { gameSubmissionSchema } from '@luciferus/protocol/game'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ApiRequestError, submitGame } from './api'
import { getSessionToken } from './session'

/**
 * Отправка заявки на публикацию.
 *
 * Тот же принцип, что и у входа: ввод проверяется схемой из протокола, поэтому
 * форма и API отсекают одно и то же. Пользователю возвращаются ошибки по полям,
 * а не одна общая.
 */

export type SubmitFormState = {
  error?: string
  fieldErrors?: FieldErrors
  /** То, что уже введено: после ошибки форма не должна обнуляться. */
  values?: Record<string, string>
}

const TEXT_FIELDS = [
  'slug',
  'title',
  'description',
  'embedUrl',
  'origins',
  'tags',
  'fairMode',
  'volatility',
  'thumbnailUrl',
  'minBet',
  'maxBet',
  'maxWin',
] as const

function textValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {}

  for (const field of TEXT_FIELDS) {
    const value = formData.get(field)
    if (typeof value === 'string') values[field] = value
  }

  return values
}

export async function submitGameAction(
  _prevState: SubmitFormState,
  formData: FormData,
): Promise<SubmitFormState> {
  const token = await getSessionToken()
  if (!token) return { error: 'Сессия истекла — войдите заново' }

  const raw = {
    slug: formData.get('slug'),
    title: formData.get('title'),
    description: formData.get('description') ?? '',
    embedUrl: formData.get('embedUrl'),
    // По одному origin на строку: так их удобнее вставлять списком.
    origins: String(formData.get('origins') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    categories: formData.getAll('categories').map(String),
    // Теги — через запятую, как принято в описаниях.
    tags: String(formData.get('tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    fairMode: formData.get('fairMode') ?? 'client',
    ...(formData.get('volatility') ? { volatility: formData.get('volatility') } : {}),
    limits: {
      minBet: Number(formData.get('minBet')),
      maxBet: Number(formData.get('maxBet')),
      maxWin: Number(formData.get('maxWin')),
    },
    ...(formData.get('thumbnailUrl') ? { thumbnailUrl: formData.get('thumbnailUrl') } : {}),
  }

  const parsed = gameSubmissionSchema.safeParse(raw)

  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error), values: textValues(formData) }
  }

  let slug: string

  try {
    const { game } = await submitGame(token, parsed.data)
    slug = game.slug
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.message : 'Не удалось отправить заявку'
    return { error: message, values: textValues(formData) }
  }

  revalidatePath('/developers/games')
  // redirect бросает служебное исключение — только вне try/catch.
  redirect(`/developers/games?submitted=${encodeURIComponent(slug)}`)
}
