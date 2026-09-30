import { serverConfig } from '@luciferus/config'
import { currency } from '@luciferus/config/currency'
import { db } from '@luciferus/db'
import { ledger, sessions, type User, users, wallets } from '@luciferus/db/schema'
import type {
  AuthResponse,
  LoginRequest,
  PublicUser,
  RegisterRequest,
  UserRole,
} from '@luciferus/protocol/auth'
import { and, eq, isNull } from 'drizzle-orm'
import { AppError, isUniqueViolation } from '../lib/errors'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_USER_AGENT_LENGTH = 255

export type SessionMeta = { ip?: string; userAgent?: string }

export type AuthenticatedSession = {
  sessionId: string
  user: PublicUser
  expiresAt: Date
}

export type CreatedSession = { token: string; expiresAt: string }

/**
 * Хэш, который подставляется, когда пользователя с таким логином нет.
 *
 * Нужен, чтобы вход не отвечал мгновенно на несуществующий логин: иначе по времени
 * ответа можно перебором узнать, какие аккаунты существуют.
 */
const DUMMY_PASSWORD_HASH = await Bun.password.hash('luciferus-dummy-password', {
  algorithm: 'argon2id',
})

function hashToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex')
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('hex')
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as UserRole,
    isBot: user.isBot,
    createdAt: user.createdAt.toISOString(),
  }
}

export async function createSession(
  userId: string,
  meta: SessionMeta = {},
): Promise<CreatedSession> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    expiresAt,
  })

  // Сырой токен отдаётся клиенту ровно один раз — в базе остаётся только его хэш.
  return { token, expiresAt: expiresAt.toISOString() }
}

export async function resolveSession(token: string): Promise<AuthenticatedSession | null> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .limit(1)

  if (!row) return null
  if (row.session.expiresAt.getTime() <= Date.now()) return null
  if (row.user.status !== 'active') return null

  return {
    sessionId: row.session.id,
    user: toPublicUser(row.user),
    expiresAt: row.session.expiresAt,
  }
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId))
}

/**
 * Регистрация. Пользователь, кошелёк и стартовый бонус создаются одной транзакцией:
 * состояние «аккаунт есть, а кошелька нет» невозможно по построению.
 */
export async function register(
  input: RegisterRequest,
  meta: SessionMeta = {},
): Promise<AuthResponse> {
  const passwordHash = await Bun.password.hash(input.password, { algorithm: 'argon2id' })
  const bonus = serverConfig.signupBonus > 0 ? serverConfig.signupBonus.toFixed(2) : '0.00'

  let user: User

  try {
    user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          username: input.username,
          displayName: input.displayName,
          passwordHash,
        })
        .returning()

      if (!created) throw new Error('Не удалось создать пользователя')

      await tx.insert(wallets).values({
        userId: created.id,
        balance: bonus,
        currency: currency.code,
      })

      if (serverConfig.signupBonus > 0) {
        await tx.insert(ledger).values({
          userId: created.id,
          type: 'signup_bonus',
          amount: bonus,
          balanceAfter: bonus,
          idempotencyKey: `signup:${created.id}`,
          meta: { source: 'registration' },
        })
      }

      return created
    })
  } catch (error) {
    // Гонку двух одновременных регистраций с одним логином ловит уникальный индекс.
    if (isUniqueViolation(error)) throw AppError.conflict('Такой логин уже занят')
    throw error
  }

  const session = await createSession(user.id, meta)
  return { user: toPublicUser(user), session }
}

export async function login(input: LoginRequest, meta: SessionMeta = {}): Promise<AuthResponse> {
  const [user] = await db.select().from(users).where(eq(users.username, input.username)).limit(1)

  // Проверяем пароль даже для несуществующего логина — ради постоянного времени ответа.
  const valid = await Bun.password.verify(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)

  if (!user || !valid) throw AppError.unauthorized('Неверный логин или пароль')
  if (user.status !== 'active') throw AppError.forbidden('Аккаунт заблокирован')

  const session = await createSession(user.id, meta)
  return { user: toPublicUser(user), session }
}
