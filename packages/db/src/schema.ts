import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Схема БД LuciferusCasinos.
 *
 * Источник правды по балансу — таблица `ledger`. `wallets.balance` — материализованный
 * кэш, который обновляется в ТОЙ ЖЕ транзакции, что и запись в леджер (см. PLAN.md §3.2).
 *
 * Здесь описаны таблицы фаз 0–3. Таблицы следующих фаз (rounds, seed_pairs, chat_messages,
 * promotions, missions, vip_levels, transactions, leaderboards, audit_log) добавятся
 * вместе со своими сервисами, чтобы схема не опережала код.
 */

// ─── Игроки ──────────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** player | admin */
    role: text('role').notNull().default('player'),
    /** active | suspended */
    status: text('status').notNull().default('active'),
    /** Сидированный «игрок» для оживления лобби. В UI неотличим, в админке виден. */
    isBot: boolean('is_bot').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_username_uq').on(t.username), index('users_role_idx').on(t.role)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 от токена сессии. Сам токен в БД не хранится. */
    tokenHash: text('token_hash').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
)

// ─── Кошелёк ─────────────────────────────────────────────────────────────────────

export const wallets = pgTable('wallets', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  balance: numeric('balance', { precision: 18, scale: 2 }).notNull().default('0'),
  currency: text('currency').notNull().default('CBK'),
  reloadAvailableAt: timestamp('reload_available_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Журнал всех движений баланса. Append-only: строки никогда не обновляются и не удаляются.
 *
 * `amount` знаковый: ставка — отрицательная, выигрыш — положительная.
 * `idempotencyKey` защищает от двойного списания при ретраях: уникальный индекс
 * превращает повторную операцию в no-op.
 */
export const ledger = pgTable(
  'ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id').references(() => games.id, { onDelete: 'set null' }),
    /** Идентификатор раунда внутри игры (`r-42`, `crash-7`). */
    roundId: text('round_id'),
    /** signup_bonus | reload_bonus | bet | win | rollback | sim_deposit | sim_withdrawal | admin_adjust */
    type: text('type').notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    balanceAfter: numeric('balance_after', { precision: 18, scale: 2 }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ledger_idempotency_key_uq').on(t.idempotencyKey),
    index('ledger_user_created_idx').on(t.userId, t.createdAt),
    index('ledger_round_idx').on(t.roundId),
  ],
)

// ─── Каталог игр ──────────────────────────────────────────────────────────────────

/** Студия/автор игры. Может быть как «Luciferus Originals», так и сторонним человеком. */
export const providers = pgTable(
  'providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    url: text('url'),
    avatarUrl: text('avatar_url'),
    verified: boolean('verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('providers_slug_uq').on(t.slug)],
)

export type GameLimits = {
  minBet: number
  maxBet: number
  maxWin: number
}

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    /** URL игры. Хостится автором, портал грузит его в iframe. */
    embedUrl: text('embed_url').notNull(),
    /**
     * Origin'ы, с которых разрешён postMessage-хендшейк. Порталу отвечает только
     * на них, никогда на `*`.
     */
    allowedOrigins: text('allowed_origins')
      .array()
      .notNull()
      .$defaultFn(() => []),
    /** draft | pending | live | disabled */
    status: text('status').notNull().default('pending'),
    /** client | provably-fair */
    fairMode: text('fair_mode').notNull().default('client'),
    limits: jsonb('limits').$type<GameLimits>().notNull().default({
      minBet: 0.1,
      maxBet: 100,
      maxWin: 5000,
    }),
    /** Заявленный RTP. Честность не гарантирует, но в UI красиво. */
    rtp: numeric('rtp', { precision: 5, scale: 4 }),
    /** low | medium | high */
    volatility: text('volatility'),
    categories: text('categories')
      .array()
      .notNull()
      .$defaultFn(() => []),
    tags: text('tags')
      .array()
      .notNull()
      .$defaultFn(() => []),
    thumbnailUrl: text('thumbnail_url'),
    /** Полный casino.game.json, как его прислал автор. */
    manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull().default({}),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    /** Игра из сидов (заглушка), а не от реального автора. */
    isStub: boolean('is_stub').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('games_slug_uq').on(t.slug),
    index('games_status_idx').on(t.status),
    index('games_provider_idx').on(t.providerId),
  ],
)

export const gameVersions = pgTable(
  'game_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    embedUrl: text('embed_url').notNull(),
    manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull().default({}),
    changelog: text('changelog'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('game_versions_game_version_uq').on(t.gameId, t.version)],
)

// ─── Типы строк ───────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type Wallet = typeof wallets.$inferSelect
export type LedgerEntry = typeof ledger.$inferSelect
export type NewLedgerEntry = typeof ledger.$inferInsert
export type Provider = typeof providers.$inferSelect
export type Game = typeof games.$inferSelect
export type NewGame = typeof games.$inferInsert
export type GameVersion = typeof gameVersions.$inferSelect
