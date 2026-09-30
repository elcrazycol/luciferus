import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { app } from '../src/index'
import {
  assertDatabaseReachable,
  cleanupTestUsers,
  createTestUser,
  TEST_PASSWORD,
  uniqueUsername,
} from './helpers'

beforeAll(async () => {
  await assertDatabaseReachable()
  await cleanupTestUsers()
})

afterAll(async () => {
  await cleanupTestUsers()
})

function post(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

function get(path: string, token?: string) {
  return app.request(path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

describe('регистрация', () => {
  test('создаёт аккаунт, кошелёк и стартовый бонус', async () => {
    const username = uniqueUsername()
    const response = await post('/v1/auth/register', {
      username,
      displayName: 'Новый игрок',
      password: TEST_PASSWORD,
    })

    expect(response.status).toBe(201)

    const body = (await response.json()) as {
      user: { id: string; username: string; role: string }
      session: { token: string; expiresAt: string }
    }

    expect(body.user.username).toBe(username)
    expect(body.user.role).toBe('player')
    expect(body.session.token).toHaveLength(64)
    expect(new Date(body.session.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const me = await get('/v1/auth/me', body.session.token)
    expect(me.status).toBe(200)

    const profile = (await me.json()) as { wallet: { balance: string; currency: string } }
    expect(profile.wallet.balance).toBe('250.00')
    expect(profile.wallet.currency).toBe('CBK')
  })

  test('занятый логин — 409, регистр не важен', async () => {
    const username = uniqueUsername()
    const first = await post('/v1/auth/register', {
      username,
      displayName: 'Первый',
      password: TEST_PASSWORD,
    })
    expect(first.status).toBe(201)

    const second = await post('/v1/auth/register', {
      username: username.toUpperCase(),
      displayName: 'Второй',
      password: TEST_PASSWORD,
    })

    expect(second.status).toBe(409)
    const body = (await second.json()) as { error: string }
    expect(body.error).toBe('conflict')
  })

  test('слабый пароль — 400 со списком проблемных полей', async () => {
    const response = await post('/v1/auth/register', {
      username: uniqueUsername(),
      displayName: 'Игрок',
      password: 'short',
    })

    expect(response.status).toBe(400)

    const body = (await response.json()) as {
      error: string
      details: { fields: Record<string, string[]> }
    }

    expect(body.error).toBe('bad_request')
    expect(body.details.fields.password).toBeDefined()
  })

  test('невалидный JSON — 400, а не 500', async () => {
    const response = await app.request('/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{это не json',
    })

    expect(response.status).toBe(400)
  })
})

describe('вход и выход', () => {
  test('неверный пароль — 401 без подсказок о существовании логина', async () => {
    const { user } = await createTestUser()

    const wrongPassword = await post('/v1/auth/login', {
      username: user.username,
      password: 'совсем-не-тот-пароль',
    })
    const unknownUser = await post('/v1/auth/login', {
      username: uniqueUsername(),
      password: TEST_PASSWORD,
    })

    expect(wrongPassword.status).toBe(401)
    expect(unknownUser.status).toBe(401)

    // Сообщения обязаны совпадать, иначе по тексту можно перебирать логины.
    const a = (await wrongPassword.json()) as { message: string }
    const b = (await unknownUser.json()) as { message: string }
    expect(a.message).toBe(b.message)
  })

  test('верный пароль выдаёт новую сессию, отличную от прежней', async () => {
    const { user, session } = await createTestUser()

    const response = await post('/v1/auth/login', {
      username: user.username,
      password: TEST_PASSWORD,
    })

    expect(response.status).toBe(200)

    const body = (await response.json()) as { session: { token: string } }
    expect(body.session.token).not.toBe(session.token)

    // Обе сессии живут одновременно: вход с телефона не выкидывает с ноутбука.
    expect((await get('/v1/auth/me', session.token)).status).toBe(200)
    expect((await get('/v1/auth/me', body.session.token)).status).toBe(200)
  })

  test('выход отзывает только текущую сессию', async () => {
    const first = await createTestUser()
    const second = await post('/v1/auth/login', {
      username: first.user.username,
      password: TEST_PASSWORD,
    })
    const secondToken = ((await second.json()) as { session: { token: string } }).session.token

    const logout = await post('/v1/auth/logout', {}, first.session.token)
    expect(logout.status).toBe(200)

    expect((await get('/v1/auth/me', first.session.token)).status).toBe(401)
    expect((await get('/v1/auth/me', secondToken)).status).toBe(200)
  })
})

describe('доступ к защищённым маршрутам', () => {
  test('без токена — 401', async () => {
    expect((await get('/v1/auth/me')).status).toBe(401)
    expect((await get('/v1/wallet')).status).toBe(401)
  })

  test('мусорный токен — 401, а не 500', async () => {
    expect((await get('/v1/auth/me', 'not-a-real-token')).status).toBe(401)
    expect((await get('/v1/wallet', 'a'.repeat(64))).status).toBe(401)
    expect((await get('/v1/wallet', '../../etc/passwd')).status).toBe(401)
  })

  test('токен не подходит к чужому аккаунту', async () => {
    const { session } = await createTestUser()
    const response = await get('/v1/wallet', session.token)
    expect(response.status).toBe(200)

    const body = (await response.json()) as { wallet: { balance: string } }
    expect(body.wallet.balance).toBe('250.00')
  })
})
