# 🎰 LuciferusCasinos

Опенсорсная платформа-обёртка «онлайн-казино» на **фейковом балансе**. Выглядит и ведёт
себя как настоящее казино, но денег здесь нет: валюта — **C$ (CrazyBucks)**, и она ничего
не стоит.

Главная идея: **портал — это хост и кошелёк, а не игровой движок.** Свою игру можно
написать на чём угодно, задеплоить куда угодно и подключить к платформе одной строкой.

```html
<script src="http://localhost:3000/sdk/v1.js" async></script>
```

Дальше игра получает готовый объект: баланс игрока, ставки, выплаты, чат, presence и
честный рандом. Портал сам рисует лобби, кошелёк, историю ставок, лидерборды и
провайдеров.

---

## Статус

🚧 **Фаза 0 — фундамент.** Репозиторий только заводится: монорепа, схема БД, скелеты
портала и API, инфраструктура в Docker. SDK появится в фазе 2.

Полный план и дизайн-решения — в [`PLAN.md`](./PLAN.md).

---

## Быстрый старт

Нужны **Bun ≥ 1.2** и **Docker**.

```bash
git clone https://github.com/your-org/LuciferusCasinos.git
cd LuciferusCasinos
bun install
cp .env.example .env

bun run infra:up     # Postgres + Redis в докере
bun run db:migrate   # миграции
bun run db:seed      # категории, игры-заглушки, боты, демо-аккаунты

bun run dev          # портал на :3000, API на :3001
```

Одной командой всё сразу: `bun run setup`.

### Демо-аккаунты из сидов

| Логин | Пароль | Роль |
|---|---|---|
| `admin` | `admin` | админ: модерация игр, корректировка балансов |
| `player` | `player` | обычный игрок с C$250 на счету |

---

## Что уже есть

- **Монорепа** на Turborepo + Bun workspaces.
- `packages/config` — единый конфиг валюты и экономики (C$, стартовый бонус, релоад).
- `packages/db` — схема на Drizzle (users, sessions, wallets, ledger, providers, games,
  game_versions), миграции и сиды.
- `apps/api` — Hono: health-check с проверкой БД, публичный список игр, конфиг валюты.
- `apps/portal` — Next.js: лобби, которое тянет игры из API.
- `infra/` — Postgres 16 + Redis 7 в docker compose.
- CI на GitHub Actions: lint, typecheck, тесты.

## Что дальше

| Фаза | Содержание |
|---|---|
| 1 | Аккаунты, сессии, кошелёк на леджере, C$250 при регистрации |
| 2 | **SDK + хендшейк iframe + песочница** — ключевая веха |
| 3 | Каталог игр, регистрация и модерация игр |
| 4 | Provably fair: commit-reveal, страница верификации |
| 5 | Realtime: чат, presence, живая лента выигрышей |
| 6 | Слой симуляции: депозиты, выводы, KYC, бонусы, VIP |
| 7 | Харденинг, документация, публичное демо |

---

## Структура

```
apps/       portal (Next.js) · api (Hono) · example-game · docs
packages/   sdk · protocol · fairness · manifest · db · ui · config
infra/      docker-compose.yml
```

Сейчас в репозитории есть `apps/portal`, `apps/api`, `packages/config` и `packages/db`.
Остальные пакеты и `apps/example-game` появятся вместе со своими фазами.

## Стек

Next.js · React · TypeScript · Bun · Hono · PostgreSQL · Redis · Drizzle ORM · Tailwind
CSS · WebSocket · Zod.

## Лицензия

[MIT](./LICENSE). Делай что хочешь, только не называй это казино.

## Важно

Проект — **песочница и учебный стенд**. Реальных ставок, платежей и выводов здесь нет и
не будет. Подробнее: [`DISCLAIMER.md`](./DISCLAIMER.md).
