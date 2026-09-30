import { z } from 'zod'

/**
 * Логин — часть URL профиля и ключ для входа, поэтому только латиница, цифры
 * и подчёркивание, в нижнем регистре. Приводим к нижнему регистру сами, чтобы
 * `Player` и `player` не оказались двумя разными аккаунтами.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Логин короче 3 символов')
  .max(32, 'Логин длиннее 32 символов')
  .regex(/^[a-z0-9_]+$/, 'Только латиница, цифры и подчёркивание')

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Имя не может быть пустым')
  .max(32, 'Имя длиннее 32 символов')

export const passwordSchema = z
  .string()
  .min(8, 'Пароль короче 8 символов')
  .max(128, 'Пароль длиннее 128 символов')

export const registerRequestSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
})

export const loginRequestSchema = z.object({
  username: usernameSchema,
  // На входе длину не проверяем: требование «минимум 8» относится к регистрации.
  // Здесь важно не подсказывать атакующему, существует ли такой логин.
  password: z.string().min(1, 'Введите пароль').max(128),
})

export type RegisterRequest = z.infer<typeof registerRequestSchema>
export type LoginRequest = z.infer<typeof loginRequestSchema>

export type UserRole = 'player' | 'admin'

/** Публичное представление пользователя: без хэша пароля и прочих внутренностей. */
export type PublicUser = {
  id: string
  username: string
  displayName: string
  role: UserRole
  isBot: boolean
  createdAt: string
}

export type SessionCreated = {
  /** Сырой токен. Показывается клиенту ровно один раз — в БД лежит только хэш. */
  token: string
  expiresAt: string
}

export type AuthResponse = {
  user: PublicUser
  session: SessionCreated
}
