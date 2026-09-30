'use server'

import { loginRequestSchema, registerRequestSchema } from '@luciferus/protocol/auth'
import { type FieldErrors, toFieldErrors } from '@luciferus/protocol/errors'
import { redirect } from 'next/navigation'
import {
  ApiRequestError,
  claimReloadBonus,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from './api'
import { clearSessionToken, getSessionToken, setSessionToken } from './session'

/**
 * Серверные действия портала.
 *
 * Токен сессии выдаёт API, но куку ставит портал — и делает это именно здесь,
 * на сервере. В браузер токен не попадает вообще.
 */

export type AuthFormState = {
  error?: string
  fieldErrors?: FieldErrors
  /** То, что пользователь уже ввёл: после ошибки форма не должна обнуляться. */
  values?: { username?: string; displayName?: string }
}

export type ReloadState = {
  error?: string
  success?: string
}

/** Разворачивает ошибку API в состояние формы, раскладывая проблемы по полям. */
function toFormState(error: unknown): AuthFormState {
  if (error instanceof ApiRequestError) {
    const fields = (error.details as { fields?: FieldErrors } | undefined)?.fields
    return fields ? { error: error.message, fieldErrors: fields } : { error: error.message }
  }

  return { error: 'Что-то пошло не так. Попробуйте ещё раз' }
}

function textValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)
  return typeof value === 'string' ? value : undefined
}

/**
 * Куда вернуть игрока после входа.
 *
 * Принимаем только относительный путь внутри портала: `next=//evil.com` —
 * это протокол-относительный URL, то есть редирект на чужой сайт. Классическая
 * дыра в формах входа, поэтому проверка явная.
 */
function safeNext(value: string | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  if (value.startsWith('/\\')) return null

  return value
}

export async function registerAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registerRequestSchema.safeParse({
    username: formData.get('username'),
    displayName: formData.get('displayName'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      values: {
        username: textValue(formData, 'username'),
        displayName: textValue(formData, 'displayName'),
      },
    }
  }

  let token: string

  try {
    const result = await registerRequest(parsed.data)
    token = result.session.token
  } catch (error) {
    return toFormState(error)
  }

  await setSessionToken(token)
  // redirect бросает служебное исключение — вызывать его можно только вне try/catch.
  redirect('/wallet?welcome=1')
}

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginRequestSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      values: { username: textValue(formData, 'username') },
    }
  }

  let token: string

  try {
    const result = await loginRequest(parsed.data)
    token = result.session.token
  } catch (error) {
    return toFormState(error)
  }

  await setSessionToken(token)
  redirect(safeNext(textValue(formData, 'next')) ?? '/wallet')
}

export async function logoutAction(): Promise<void> {
  const token = await getSessionToken()

  if (token) {
    try {
      await logoutRequest(token)
    } catch {
      // Сессия могла уже истечь или API лежать — выйти пользователь обязан в любом случае.
    }
  }

  await clearSessionToken()
  redirect('/')
}

export async function claimReloadAction(
  _prevState: ReloadState,
  _formData: FormData,
): Promise<ReloadState> {
  const token = await getSessionToken()
  if (!token) return { error: 'Сессия истекла — войдите заново' }

  try {
    const result = await claimReloadBonus(token)
    return { success: `Начислено. Баланс: ${result.balance}` }
  } catch (error) {
    if (error instanceof ApiRequestError) return { error: error.message }
    return { error: 'Не получилось дозаправиться. Попробуйте ещё раз' }
  }
}
