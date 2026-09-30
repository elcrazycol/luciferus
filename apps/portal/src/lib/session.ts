import { cookies } from 'next/headers'

/**
 * Сессионная кука живёт на домене портала, а не API.
 *
 * Так прод не зависит от того, на одном домене портал и API или на разных:
 * браузер общается только с порталом, а портал ходит в API с Bearer-токеном.
 * Токен наружу из серверного кода не уходит и в JavaScript на клиенте не попадает.
 */
const SESSION_COOKIE = 'luciferus_session'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? null
}

export async function setSessionToken(token: string): Promise<void> {
  const store = await cookies()

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export async function clearSessionToken(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
