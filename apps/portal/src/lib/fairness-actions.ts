'use server'

import { revalidatePath } from 'next/cache'
import { ApiRequestError, rotateSeeds, setClientSeed } from './api'
import { getSessionToken } from './session'

/**
 * Управление парами сидов.
 *
 * Раскрытие необратимо: после него серверный сид становится публичным навсегда,
 * и именно это делает проверку возможной. Поэтому кнопка так и называется —
 * «раскрыть», а не «обновить».
 */

export type SeedsFormState = {
  error?: string
  success?: string
}

export async function rotateSeedsAction(
  _prevState: SeedsFormState,
  formData: FormData,
): Promise<SeedsFormState> {
  const token = await getSessionToken()
  if (!token) return { error: 'Сессия истекла — войдите заново' }

  const gameSlug = String(formData.get('gameSlug') ?? '')
  const clientSeed = String(formData.get('clientSeed') ?? '').trim()

  try {
    await rotateSeeds(token, gameSlug, clientSeed || undefined)
  } catch (error) {
    return { error: error instanceof ApiRequestError ? error.message : 'Не получилось раскрыть' }
  }

  revalidatePath('/fairness')
  return { success: 'Прошлый серверный сид раскрыт и сохранён ниже' }
}

export async function setClientSeedAction(
  _prevState: SeedsFormState,
  formData: FormData,
): Promise<SeedsFormState> {
  const token = await getSessionToken()
  if (!token) return { error: 'Сессия истекла — войдите заново' }

  const gameSlug = String(formData.get('gameSlug') ?? '')
  const clientSeed = String(formData.get('clientSeed') ?? '').trim()

  if (clientSeed.length < 1) return { error: 'Клиентский сид не может быть пустым' }
  if (clientSeed.length > 64) return { error: 'Клиентский сид длиннее 64 символов' }

  try {
    await setClientSeed(token, gameSlug, clientSeed)
  } catch (error) {
    return { error: error instanceof ApiRequestError ? error.message : 'Не получилось сменить' }
  }

  revalidatePath('/fairness')
  return { success: 'Клиентский сид обновлён — сервер обязан использовать новый' }
}
