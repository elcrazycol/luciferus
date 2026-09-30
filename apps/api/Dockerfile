# Образ API. Bun запускает TypeScript напрямую, поэтому шага сборки нет.
FROM oven/bun:1.4-alpine

WORKDIR /app
ENV NODE_ENV=production

# Манифесты отдельным слоем: пока они не менялись, зависимости берутся из кэша.
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/portal/package.json ./apps/portal/
COPY apps/example-game/package.json ./apps/example-game/
COPY packages/config/package.json ./packages/config/
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/fairness/package.json ./packages/fairness/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/db/package.json ./packages/db/

# Ставим только граф зависимостей API: без --filter сюда попал бы весь монорепозиторий
# вместе с Next.js и бинарниками SWC, которые API не нужны — это лишние 600 МБ образа.
# Без devDependencies: в рантайме не нужны ни drizzle-kit, ни typescript.
RUN bun install --frozen-lockfile --production --filter=@luciferus/api

COPY packages ./packages
COPY apps/api ./apps/api

EXPOSE 3001
CMD ["bun", "run", "apps/api/src/index.ts"]
