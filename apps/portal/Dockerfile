# Сборка портала.
FROM oven/bun:1.4-alpine AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/portal/package.json ./apps/portal/
COPY apps/example-game/package.json ./apps/example-game/
COPY packages/config/package.json ./packages/config/
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/fairness/package.json ./packages/fairness/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/db/package.json ./packages/db/
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/portal ./apps/portal
COPY apps/api ./apps/api
COPY tsconfig.json turbo.json ./

# Сборка портала сама собирает SDK и кладёт его в public/sdk.
RUN bun run --filter=@luciferus/portal build

# Рантайм: только собранное приложение, без исходников и тулчейна.
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Node сам следит за памятью: лучше собрать мусор, чем быть убитым OOM-киллером.
ENV NODE_OPTIONS=--max-old-space-size=192

COPY --from=build /app/apps/portal/.next/standalone ./
COPY --from=build /app/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=build /app/apps/portal/public ./apps/portal/public

EXPOSE 3000
CMD ["node", "apps/portal/server.js"]
