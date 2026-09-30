import { formatAmount } from '@luciferus/config/currency'
import {
  GAME_SORT_LABELS,
  GAME_SORTS,
  GAME_VOLATILITIES,
  GAME_VOLATILITY_LABELS,
  type GameCard,
  type GameFacets,
  type GameListQuery,
} from '@luciferus/protocol/game'
import type { Metadata } from 'next'
import Link from 'next/link'
import { GameCardTile } from '@/components/game-card'
import { ApiRequestError, buildCatalogQuery, listGames } from '@/lib/api'
import {
  CATALOG_PAGE_SIZE,
  type RawSearchParams,
  sanitizeCatalogParams,
} from '@/lib/catalog-params'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Каталог игр — LuciferusCasinos',
  description:
    'Все игры площадки: слоты, краш, настолки. Фильтры по категории, студии и волатильности.',
}

function FilterBar({ current, facets }: { current: GameListQuery; facets: GameFacets }) {
  const fieldClass =
    'rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 text-sm text-white outline-none focus:border-gold-500/60'

  return (
    // Обычная GET-форма: фильтры живут в адресе, работают без JavaScript и шарятся ссылкой.
    <form method="get" action="/games" className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
        <span className="text-[11px] tracking-wider text-white/40 uppercase">Поиск</span>
        <input
          type="search"
          name="search"
          defaultValue={current.search ?? ''}
          placeholder="Название или описание"
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] tracking-wider text-white/40 uppercase">Категория</span>
        <select name="category" defaultValue={current.category ?? ''} className={fieldClass}>
          <option value="">Все</option>
          {facets.categories.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label} ({category.count})
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] tracking-wider text-white/40 uppercase">Студия</span>
        <select name="provider" defaultValue={current.provider ?? ''} className={fieldClass}>
          <option value="">Все</option>
          {facets.providers.map((provider) => (
            <option key={provider.slug} value={provider.slug}>
              {provider.name} ({provider.count})
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] tracking-wider text-white/40 uppercase">Волатильность</span>
        <select name="volatility" defaultValue={current.volatility ?? ''} className={fieldClass}>
          <option value="">Любая</option>
          {GAME_VOLATILITIES.map((value) => (
            <option key={value} value={value}>
              {GAME_VOLATILITY_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] tracking-wider text-white/40 uppercase">Рандом</span>
        <select name="fairMode" defaultValue={current.fairMode ?? ''} className={fieldClass}>
          <option value="">Любой</option>
          <option value="provably-fair">Проверяемый</option>
          <option value="client">Доверенный</option>
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] tracking-wider text-white/40 uppercase">Сортировка</span>
        <select name="sort" defaultValue={current.sort} className={fieldClass}>
          {GAME_SORTS.map((value) => (
            <option key={value} value={value}>
              {GAME_SORT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="rounded-lg border border-gold-500/40 bg-gold-500/15 px-4 py-2 text-sm font-semibold text-gold-300 transition-colors hover:bg-gold-500/25"
      >
        Показать
      </button>

      <Link href="/games" className="px-2 py-2 text-sm text-white/40 hover:text-white">
        Сбросить
      </Link>
    </form>
  )
}

function Pagination({ current, total }: { current: GameListQuery; total: number }) {
  if (total <= CATALOG_PAGE_SIZE) return null

  const pages = Math.ceil(total / CATALOG_PAGE_SIZE)
  const page = Math.floor((current.offset ?? 0) / CATALOG_PAGE_SIZE)

  const href = (offset: number) => `/games?${buildCatalogQuery({ ...current, offset })}`

  return (
    <nav className="mt-8 flex items-center justify-center gap-3 text-sm">
      {page > 0 ? (
        <Link
          href={href(Math.max(0, (current.offset ?? 0) - CATALOG_PAGE_SIZE))}
          className="text-gold-300 hover:underline"
        >
          ← Назад
        </Link>
      ) : (
        <span className="text-white/20">← Назад</span>
      )}

      <span className="text-white/40">
        страница {page + 1} из {pages}
      </span>

      {page + 1 < pages ? (
        <Link
          href={href((current.offset ?? 0) + CATALOG_PAGE_SIZE)}
          className="text-gold-300 hover:underline"
        >
          Вперёд →
        </Link>
      ) : (
        <span className="text-white/20">Вперёд →</span>
      )}
    </nav>
  )
}

/** Сводка по каталогу: сколько всего и на какую сумму там выигрывали. */
function CatalogSummary({ games, total }: { games: GameCard[]; total: number }) {
  const biggest = games
    .map((game) => Number.parseFloat(game.stats.biggestWin ?? '0'))
    .reduce((max, value) => Math.max(max, value), 0)

  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-xs text-white/40">
      <span>
        Найдено игр: <b className="text-white/70">{total}</b>
      </span>
      <span>
        На этой странице ставок сделано:{' '}
        <b className="text-white/70">{games.reduce((sum, game) => sum + game.stats.plays, 0)}</b>
      </span>
      {biggest > 0 && (
        <span>
          Крупнейший выигрыш: <b className="text-gold-300">{formatAmount(biggest)}</b>
        </span>
      )}
    </div>
  )
}

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const current = sanitizeCatalogParams(await searchParams)

  let data: Awaited<ReturnType<typeof listGames>>
  try {
    data = await listGames(current)
  } catch (error) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
        <div className="rounded-2xl border border-ember-500/25 bg-ember-500/5 p-6">
          <h1 className="text-lg font-semibold text-white">Каталог недоступен</h1>
          <p className="mt-1 text-sm text-white/60">
            {error instanceof ApiRequestError ? error.message : 'API не ответил'}
          </p>
          <p className="mt-3 text-xs text-white/40">
            Запустите <code className="text-gold-300">bun run dev</code> и обновите страницу.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Каталог игр</h1>
          <p className="mt-1 text-sm text-white/50">
            Игры хостятся их авторами. Портал даёт им кошелёк, лимиты и проверяемый рандом.
          </p>
        </div>

        <Link
          href="/developers/submit"
          className="rounded-lg border border-gold-500/40 bg-gold-500/15 px-4 py-2 text-sm font-semibold text-gold-300 hover:bg-gold-500/25"
        >
          Добавить свою игру
        </Link>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-ink-900/50 p-4">
        <FilterBar current={current} facets={data.facets} />
      </div>

      <div className="mt-5">
        <CatalogSummary games={data.games} total={data.total} />
      </div>

      {data.games.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-ink-900/60 p-6 text-sm text-white/60">
          <p className="text-white/80">По этим фильтрам ничего не нашлось.</p>
          <p className="mt-2">
            Попробуйте{' '}
            <Link href="/games" className="text-gold-300 hover:underline">
              сбросить фильтры
            </Link>{' '}
            или{' '}
            <Link href="/developers/submit" className="text-gold-300 hover:underline">
              добавить свою игру
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.games.map((game) => (
            <GameCardTile key={game.slug} game={game} />
          ))}
        </div>
      )}

      <Pagination current={current} total={data.total} />
    </main>
  )
}
