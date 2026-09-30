import { currency } from '@luciferus/config'
import { eq } from 'drizzle-orm'
import { db } from './client'
import { games, gameVersions, ledger, providers, users, wallets } from './schema'

/**
 * Сиды для локальной разработки: два демо-аккаунта, сидированные боты для оживления
 * лобби, два провайдера и три игры-заглушки.
 *
 * Идемпотентны — можно гонять сколько угодно раз, повторные вставки пропускаются.
 */

export type SeedUser = {
  username: string
  displayName: string
  password: string
  role: 'player' | 'admin'
  isBot?: boolean
  balance: number
}

export const DEMO_USERS: SeedUser[] = [
  {
    username: 'admin',
    displayName: 'Администратор',
    password: 'admin',
    role: 'admin',
    balance: 250,
  },
  {
    username: 'player',
    displayName: 'Test Player',
    password: 'player',
    role: 'player',
    balance: 250,
  },
]

/**
 * Боты нужны, чтобы лента выигрышей и счётчики игроков не выглядели пустыми.
 * `is_bot = true` — в админке их видно и можно выключить, в лобби они неотличимы.
 */
export const BOT_PROFILES: SeedUser[] = [
  {
    username: 'lucky_lucifer',
    displayName: 'Lucky Lucifer',
    password: 'bot',
    role: 'player',
    isBot: true,
    balance: 8420.5,
  },
  {
    username: 'seven_sevens',
    displayName: 'Seven Sevens',
    password: 'bot',
    role: 'player',
    isBot: true,
    balance: 2310.0,
  },
  {
    username: 'bellagio_bob',
    displayName: 'Bellagio Bob',
    password: 'bot',
    role: 'player',
    isBot: true,
    balance: 640.25,
  },
  {
    username: 'spin_witch',
    displayName: 'Spin Witch',
    password: 'bot',
    role: 'player',
    isBot: true,
    balance: 1890.75,
  },
  {
    username: 'cold_hand',
    displayName: 'Cold Hand',
    password: 'bot',
    role: 'player',
    isBot: true,
    balance: 95.5,
  },
  {
    username: 'rocket_man',
    displayName: 'Rocket Man',
    password: 'bot',
    role: 'player',
    isBot: true,
    balance: 4310.0,
  },
  {
    username: 'quiet_grinder',
    displayName: 'Quiet Grinder',
    password: 'bot',
    role: 'player',
    isBot: true,
    balance: 320.1,
  },
  {
    username: 'jackpot_jane',
    displayName: 'Jackpot Jane',
    password: 'bot',
    role: 'player',
    isBot: true,
    balance: 12050.0,
  },
]

export type SeedProvider = {
  slug: string
  name: string
  url: string | null
  verified: boolean
}

export const SEED_PROVIDERS: SeedProvider[] = [
  {
    slug: 'luciferus-originals',
    name: 'Luciferus Originals',
    url: 'https://github.com/LuciferusCasinos',
    verified: true,
  },
  {
    slug: 'stub-studio',
    name: 'Stub Studio',
    url: 'https://example.com',
    verified: false,
  },
]

export type SeedGame = {
  slug: string
  title: string
  description: string
  providerSlug: string
  embedUrl: string
  categories: string[]
  tags: string[]
  fairMode: 'client' | 'provably-fair'
  volatility: 'low' | 'medium' | 'high'
  rtp: string
  limits: { minBet: number; maxBet: number; maxWin: number }
}

/**
 * Игры-заглушки. `embedUrl` ведёт на example.com — это честные пустышки: если открыть
 * такую игру в лобби, портал покажет «игра ещё не подключена». Реальные игры появятся,
 * когда будет SDK (фаза 2) и эталонный слот в `apps/example-game`.
 */
export const SEED_GAMES: SeedGame[] = [
  {
    slug: 'lucky-7s',
    title: 'Lucky 7s',
    description: 'Классический трёхбарабанный слот. Три семёрки — и вечер удался.',
    providerSlug: 'luciferus-originals',
    embedUrl: 'https://example.com/games/lucky-7s',
    categories: ['slots', 'classic'],
    tags: ['7s', 'classic', '3-reels'],
    fairMode: 'provably-fair',
    volatility: 'medium',
    rtp: '0.9600',
    limits: { minBet: 0.25, maxBet: 50, maxWin: 2500 },
  },
  {
    slug: 'crash-rocket',
    title: 'Crash Rocket',
    description: 'Кривая уходит вверх, ты жмёшь Cash Out. Кто остановится первым?',
    providerSlug: 'luciferus-originals',
    embedUrl: 'https://example.com/games/crash-rocket',
    categories: ['crash', 'multiplayer'],
    tags: ['crash', 'rocket', 'fast'],
    fairMode: 'provably-fair',
    volatility: 'high',
    rtp: '0.9700',
    limits: { minBet: 0.5, maxBet: 200, maxWin: 10000 },
  },
  {
    slug: 'blackjack-table',
    title: 'Blackjack Table',
    description: 'Двадцать одно, без дилера и без ставок. Просто покажи, что умеешь.',
    providerSlug: 'stub-studio',
    embedUrl: 'https://example.com/games/blackjack-table',
    categories: ['table', 'cards'],
    tags: ['blackjack', '21', 'cards'],
    fairMode: 'client',
    volatility: 'low',
    rtp: '0.9950',
    limits: { minBet: 1, maxBet: 500, maxWin: 2000 },
  },
]

async function ensureUser(input: SeedUser): Promise<{ id: string; created: boolean }> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, input.username))
    .limit(1)

  if (existing) return { id: existing.id, created: false }

  const passwordHash = await Bun.password.hash(input.password, { algorithm: 'argon2id' })
  const amount = input.balance.toFixed(2)

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        username: input.username,
        displayName: input.displayName,
        passwordHash,
        role: input.role,
        isBot: input.isBot ?? false,
      })
      .returning({ id: users.id })

    if (!user) throw new Error(`Не удалось создать пользователя ${input.username}`)

    await tx.insert(wallets).values({
      userId: user.id,
      balance: amount,
      currency: currency.code,
    })

    if (input.balance > 0) {
      await tx.insert(ledger).values({
        userId: user.id,
        type: 'signup_bonus',
        amount,
        balanceAfter: amount,
        idempotencyKey: `seed:signup:${user.id}`,
        meta: { source: 'seed' },
      })
    }

    return { id: user.id, created: true }
  })
}

async function ensureProvider(input: SeedProvider): Promise<string> {
  const [existing] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.slug, input.slug))
    .limit(1)

  if (existing) return existing.id

  const [created] = await db.insert(providers).values(input).returning({ id: providers.id })
  if (!created) throw new Error(`Не удалось создать провайдера ${input.slug}`)

  return created.id
}

async function ensureGame(input: SeedGame, providerId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.slug, input.slug))
    .limit(1)

  if (existing) return false

  const manifest = {
    slug: input.slug,
    title: input.title,
    version: '0.0.1',
    embed: input.embedUrl,
    origins: [],
    categories: input.categories,
    fairMode: input.fairMode,
    limits: input.limits,
    sdk: '^1.0.0',
  }

  await db.transaction(async (tx) => {
    const [game] = await tx
      .insert(games)
      .values({
        slug: input.slug,
        title: input.title,
        description: input.description,
        providerId,
        embedUrl: input.embedUrl,
        allowedOrigins: [],
        status: 'live',
        fairMode: input.fairMode,
        limits: input.limits,
        rtp: input.rtp,
        volatility: input.volatility,
        categories: input.categories,
        tags: input.tags,
        manifest,
        isStub: true,
      })
      .returning({ id: games.id })

    if (!game) throw new Error(`Не удалось создать игру ${input.slug}`)

    await tx.insert(gameVersions).values({
      gameId: game.id,
      version: '0.0.1',
      embedUrl: input.embedUrl,
      manifest,
      changelog: 'Заглушка из сидов',
    })
  })

  return true
}

export async function seed(): Promise<void> {
  console.log('🌱 Сею данные…')

  const providerIds = new Map<string, string>()
  for (const provider of SEED_PROVIDERS) {
    providerIds.set(provider.slug, await ensureProvider(provider))
  }
  console.log(`   провайдеры: ${SEED_PROVIDERS.length}`)

  let usersCreated = 0
  for (const profile of [...DEMO_USERS, ...BOT_PROFILES]) {
    const result = await ensureUser(profile)
    if (result.created) usersCreated += 1
  }
  console.log(
    `   пользователи: создано ${usersCreated}, всего ${DEMO_USERS.length + BOT_PROFILES.length}`,
  )

  let gamesCreated = 0
  for (const game of SEED_GAMES) {
    const providerId = providerIds.get(game.providerSlug)
    if (!providerId) throw new Error(`Провайдер ${game.providerSlug} не найден`)

    if (await ensureGame(game, providerId)) gamesCreated += 1
  }
  console.log(`   игры: создано ${gamesCreated}, всего ${SEED_GAMES.length}`)

  console.log('✅ Готово')
  console.log('   демо-аккаунты: admin/admin (админ), player/player (игрок)')
}

if (import.meta.main) {
  try {
    await seed()
  } catch (error) {
    console.error('❌ Не удалось засеять данные:', error)
    process.exit(1)
  }

  process.exit(0)
}
