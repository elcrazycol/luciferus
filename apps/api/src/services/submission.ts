import { serverConfig } from '@luciferus/config'
import { db } from '@luciferus/db'
import { games, gameVersions, providers, users } from '@luciferus/db/schema'
import type { GameStatus, GameSubmission, GameUpdate, OwnGameCard } from '@luciferus/protocol/game'
import { normalizeOrigin } from '@luciferus/protocol/game'
import { count, desc, eq } from 'drizzle-orm'
import { AppError, isUniqueViolation } from '../lib/errors'
import { findGameRowFull, toOwnGameCard } from './catalog'

/**
 * Авторская сторона: заявка на публикацию, обновление и очередь модерации.
 *
 * Каждая публикация создаёт запись в `game_versions`. Это не бюрократия ради
 * бюрократии: когда игра «сломалась после обновления», нужно уметь ответить,
 * что именно было задеплоено и когда.
 */

/** Слаг студии автора выводится из логина: одна студия на аккаунт. */
function providerSlugFor(username: string): string {
  return `u-${username}`
}

async function ensureAuthorProvider(userId: string): Promise<string> {
  const [user] = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw AppError.notFound('Пользователь не найден')

  const slug = providerSlugFor(user.username)

  const [existing] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.slug, slug))
    .limit(1)

  if (existing) return existing.id

  const [created] = await db
    .insert(providers)
    .values({ slug, name: user.displayName, verified: false })
    .onConflictDoNothing()
    .returning({ id: providers.id })

  if (created) return created.id

  // Гонка двух одновременных заявок: провайдер уже создан параллельным запросом.
  const [raced] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.slug, slug))
    .limit(1)

  if (!raced) throw new Error('Не удалось создать студию автора')
  return raced.id
}

/** Приводит origin'ы к каноническому виду: `https://a.example/` и `https://a.example` — одно и то же. */
function normalizeOrigins(origins: readonly string[]): string[] {
  const normalized = origins
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => origin !== null)

  return [...new Set(normalized)]
}

function toManifest(input: GameSubmission, origins: string[]) {
  return {
    slug: input.slug,
    title: input.title,
    version: '1.0.0',
    embed: input.embedUrl,
    origins,
    categories: input.categories,
    fairMode: input.fairMode,
    limits: input.limits,
    ...(input.volatility ? { volatility: input.volatility } : {}),
    sdk: '^1.0.0',
    ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
  }
}

function initialStatus(): GameStatus {
  // Локально удобно не ждать модерации; в проде флаг всегда выключен.
  return serverConfig.autoApproveGames ? 'live' : 'pending'
}

async function findOwnRow(slug: string, userId: string, role: string) {
  const row = await findGameRowFull(slug)
  if (!row) throw AppError.notFound(`Игра «${slug}» не найдена`)

  if (row.submittedBy !== userId && role !== 'admin') {
    throw AppError.forbidden('Это не ваша игра')
  }

  return row
}

export async function submitGame(userId: string, input: GameSubmission): Promise<OwnGameCard> {
  const providerId = await ensureAuthorProvider(userId)
  const origins = normalizeOrigins(input.origins)
  const status = initialStatus()
  const manifest = toManifest(input, origins)

  try {
    await db.transaction(async (tx) => {
      const [game] = await tx
        .insert(games)
        .values({
          slug: input.slug,
          title: input.title,
          description: input.description,
          providerId,
          embedUrl: input.embedUrl,
          allowedOrigins: origins,
          status,
          statusChangedAt: new Date(),
          fairMode: input.fairMode,
          limits: input.limits,
          volatility: input.volatility ?? null,
          categories: input.categories,
          tags: input.tags,
          thumbnailUrl: input.thumbnailUrl ?? null,
          manifest,
          submittedBy: userId,
          isStub: false,
        })
        .returning({ id: games.id })

      if (!game) throw new Error('Не удалось создать игру')

      await tx.insert(gameVersions).values({
        gameId: game.id,
        version: '1.0.0',
        embedUrl: input.embedUrl,
        manifest,
        changelog: 'Первая публикация',
      })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict(`Слаг «${input.slug}» уже занят`)
    }
    throw error
  }

  return requireOwnGame(input.slug, userId, 'player')
}

export async function requireOwnGame(
  slug: string,
  userId: string,
  role: string,
): Promise<OwnGameCard> {
  return toOwnGameCard(await findOwnRow(slug, userId, role))
}

export async function listOwnGames(userId: string): Promise<OwnGameCard[]> {
  const rows = await db
    .select({ slug: games.slug })
    .from(games)
    .where(eq(games.submittedBy, userId))
    .orderBy(desc(games.updatedAt))

  const cards: OwnGameCard[] = []

  for (const row of rows) {
    const full = await findGameRowFull(row.slug)
    if (full) cards.push(toOwnGameCard(full))
  }

  return cards
}

/**
 * Обновление игры.
 *
 * Смена адреса, origin'ов или лимитов отправляет игру обратно на модерацию:
 * нельзя незаметно подменить содержимое уже одобренной игры. Косметика
 * (название, описание, теги) статус не трогает.
 */
export async function updateGame(
  slug: string,
  userId: string,
  role: string,
  update: GameUpdate,
): Promise<OwnGameCard> {
  const row = await findOwnRow(slug, userId, role)

  const nextOrigins = update.origins ? normalizeOrigins(update.origins) : undefined

  const changesContent =
    update.embedUrl !== undefined || nextOrigins !== undefined || update.limits !== undefined

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(games)
      .set({
        ...(update.title === undefined ? {} : { title: update.title }),
        ...(update.description === undefined ? {} : { description: update.description }),
        ...(update.embedUrl === undefined ? {} : { embedUrl: update.embedUrl }),
        ...(nextOrigins === undefined ? {} : { allowedOrigins: nextOrigins }),
        ...(update.categories === undefined ? {} : { categories: update.categories }),
        ...(update.tags === undefined ? {} : { tags: update.tags }),
        ...(update.volatility === undefined ? {} : { volatility: update.volatility }),
        ...(update.limits === undefined ? {} : { limits: update.limits }),
        ...(update.thumbnailUrl === undefined ? {} : { thumbnailUrl: update.thumbnailUrl }),
        // Админ меняет игру без повторной модерации: он и есть модератор.
        ...(changesContent && role !== 'admin'
          ? { status: 'pending', statusChangedAt: new Date(), moderationNote: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(games.id, row.id))
      .returning({ id: games.id, embedUrl: games.embedUrl })

    if (!updated) throw AppError.notFound('Игра не найдена')

    // Версия фиксируется только при изменении содержимого: правка описания
    // не должна плодить версии деплоя.
    if (changesContent) {
      const [latest] = await tx
        .select({ version: gameVersions.version })
        .from(gameVersions)
        .where(eq(gameVersions.gameId, row.id))
        .orderBy(desc(gameVersions.publishedAt))
        .limit(1)

      await tx.insert(gameVersions).values({
        gameId: row.id,
        version: bumpVersion(latest?.version ?? '1.0.0'),
        embedUrl: updated.embedUrl,
        manifest: { slug, ...update },
        changelog: 'Обновление',
      })
    }
  })

  return requireOwnGame(slug, userId, role)
}

/** `1.2.0` → `1.3.0`. Просто и предсказуемо: минор растёт при каждом деплое. */
export function bumpVersion(version: string): string {
  const [major = '1', minor = '0'] = version.split('.')
  const nextMinor = Number.parseInt(minor, 10)
  return `${major}.${Number.isFinite(nextMinor) ? nextMinor + 1 : 1}.0`
}

// ─── Модерация ───────────────────────────────────────────────────────────────────

export type ModerationRow = OwnGameCard & {
  authorUsername: string | null
  authorDisplayName: string | null
}

/** Очередь модерации: по умолчанию то, что ждёт решения. */
export async function listModerationQueue(status: GameStatus): Promise<ModerationRow[]> {
  const rows = await db
    .select({
      slug: games.slug,
      authorUsername: users.username,
      authorDisplayName: users.displayName,
    })
    .from(games)
    .leftJoin(users, eq(games.submittedBy, users.id))
    .where(eq(games.status, status))
    .orderBy(desc(games.updatedAt))
    .limit(100)

  const result: ModerationRow[] = []

  for (const row of rows) {
    const full = await findGameRowFull(row.slug)
    if (!full) continue

    result.push({
      ...toOwnGameCard(full),
      authorUsername: row.authorUsername,
      authorDisplayName: row.authorDisplayName,
    })
  }

  return result
}

export async function countByStatus(status: GameStatus): Promise<number> {
  const [row] = await db.select({ value: count() }).from(games).where(eq(games.status, status))
  return Number(row?.value ?? 0)
}

export type ModerationDecision = 'approve' | 'reject' | 'disable'

export async function moderateGame(
  slug: string,
  decision: ModerationDecision,
  note: string | null,
): Promise<OwnGameCard> {
  const row = await findGameRowFull(slug)
  if (!row) throw AppError.notFound(`Игра «${slug}» не найдена`)

  const status: GameStatus =
    decision === 'approve' ? 'live' : decision === 'reject' ? 'draft' : 'disabled'

  await db
    .update(games)
    .set({ status, statusChangedAt: new Date(), moderationNote: note, updatedAt: new Date() })
    .where(eq(games.id, row.id))

  const updated = await findGameRowFull(slug)
  if (!updated) throw AppError.notFound(`Игра «${slug}» не найдена`)

  return toOwnGameCard(updated)
}
