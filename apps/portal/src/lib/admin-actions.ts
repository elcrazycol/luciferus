'use server'

import { revalidatePath } from 'next/cache'
import { ApiRequestError, moderateGame } from './api'
import { getSessionToken } from './session'

export type ModerationState = {
  error?: string
  success?: string
}

const DECISIONS = ['approve', 'reject', 'disable'] as const
type Decision = (typeof DECISIONS)[number]

function isDecision(value: string): value is Decision {
  return (DECISIONS as readonly string[]).includes(value)
}

/** Решение модератора по одной игре. */
export async function moderateAction(
  _prevState: ModerationState,
  formData: FormData,
): Promise<ModerationState> {
  const token = await getSessionToken()
  if (!token) return { error: 'Сессия истекла — войдите заново' }

  const slug = String(formData.get('slug') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!isDecision(decision)) return { error: 'Неизвестное решение' }

  try {
    await moderateGame(token, slug, decision, note || undefined)
  } catch (error) {
    return { error: error instanceof ApiRequestError ? error.message : 'Не получилось' }
  }

  revalidatePath('/admin')
  revalidatePath('/games')
  revalidatePath(`/game/${slug}`)

  return {
    success:
      decision === 'approve'
        ? 'Игра опубликована'
        : decision === 'reject'
          ? 'Заявка отклонена, автор увидит причину'
          : 'Игра отключена и убрана из каталога',
  }
}
