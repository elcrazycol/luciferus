import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { issueGameToken, verifyGameToken } from '../src/lib/signed-token'

const SECRET = 'test-secret-do-not-use-in-production'
const OTHER_SECRET = 'другой-секрет'

const baseClaims = {
  userId: 'user-1',
  gameId: 'game-1',
  gameSlug: 'lucky-7s',
  portalSessionId: 'session-1',
  ttlSeconds: 3600,
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** Подписывает произвольный payload тем же алгоритмом — чтобы собрать подделку. */
function signPayload(payload: string, secret = SECRET): string {
  const signature = createHmac('sha256', secret).update(payload).digest().toString('base64url')
  return `${payload}.${signature}`
}

describe('выпуск токена', () => {
  test('токен проверяется сразу после выпуска', () => {
    const token = issueGameToken(baseClaims, SECRET)
    const claims = verifyGameToken(token, SECRET)

    expect(claims).not.toBeNull()
    expect(claims?.sub).toBe('user-1')
    expect(claims?.gid).toBe('game-1')
    expect(claims?.slug).toBe('lucky-7s')
    expect(claims?.sid).toBe('session-1')
    expect(claims?.aud).toBe('game')
  })

  test('срок жизни соблюдается', () => {
    const now = 1_700_000_000_000
    const token = issueGameToken({ ...baseClaims, ttlSeconds: 60, now }, SECRET)

    expect(verifyGameToken(token, SECRET, { now })).not.toBeNull()
    expect(verifyGameToken(token, SECRET, { now: now + 59_000 })).not.toBeNull()
    // Ровно на границе токен уже мёртв.
    expect(verifyGameToken(token, SECRET, { now: now + 61_000 })).toBeNull()
  })

  test('два токена на одни и те же данные совпадают (детерминированность)', () => {
    const now = 1_700_000_000_000
    expect(issueGameToken({ ...baseClaims, now }, SECRET)).toBe(
      issueGameToken({ ...baseClaims, now }, SECRET),
    )
  })
})

describe('подделки', () => {
  test('чужой секрет не проходит', () => {
    const token = issueGameToken(baseClaims, OTHER_SECRET)
    expect(verifyGameToken(token, SECRET)).toBeNull()
  })

  test('изменённый payload ломает подпись', () => {
    const token = issueGameToken(baseClaims, SECRET)
    const [payload, signature] = token.split('.')

    // Подменяем пользователя, оставляя старую подпись.
    const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'))
    const forged = encode({ ...decoded, sub: 'admin-1' })

    expect(verifyGameToken(`${forged}.${signature}`, SECRET)).toBeNull()
  })

  test('подпись без секрета не подделывается перебором', () => {
    const payload = encode({
      v: 1,
      aud: 'game',
      sub: 'x',
      gid: 'y',
      slug: 'z',
      sid: 's',
      iat: 0,
      exp: 9_999_999_999,
    })
    expect(verifyGameToken(`${payload}.AAAA`, SECRET)).toBeNull()
  })

  test('токен с чужой аудиторией не принимается', () => {
    // Токен, выпущенный для портальных маршрутов, не должен работать как игровой.
    const payload = encode({
      v: 1,
      aud: 'portal',
      sub: 'user-1',
      gid: 'game-1',
      slug: 'lucky-7s',
      sid: 'session-1',
      iat: 0,
      exp: 9_999_999_999,
    })

    expect(verifyGameToken(signPayload(payload), SECRET)).toBeNull()
  })

  test('токен с неизвестной версией формата не принимается', () => {
    const payload = encode({
      v: 99,
      aud: 'game',
      sub: 'user-1',
      gid: 'game-1',
      slug: 'lucky-7s',
      sid: 'session-1',
      iat: 0,
      exp: 9_999_999_999,
    })

    expect(verifyGameToken(signPayload(payload), SECRET)).toBeNull()
  })

  test('подписанный, но неполный payload не принимается', () => {
    const payload = encode({ v: 1, aud: 'game', sub: 'user-1' })
    expect(verifyGameToken(signPayload(payload), SECRET)).toBeNull()
  })
})

describe('мусор на входе', () => {
  test('не бросает исключений ни на чём', () => {
    const garbage = [
      '',
      '.',
      '..',
      'нет-точки',
      'a.b',
      'a.b.c',
      `${encode({ v: 1 })}.`,
      '.подпись',
      'просто строка',
      Buffer.from('{}').toString('base64url'),
    ]

    for (const token of garbage) {
      expect(() => verifyGameToken(token, SECRET)).not.toThrow()
      expect(verifyGameToken(token, SECRET)).toBeNull()
    }
  })

  test('payload не из base64 не роняет проверку', () => {
    expect(verifyGameToken('!!!.???', SECRET)).toBeNull()
  })
})
