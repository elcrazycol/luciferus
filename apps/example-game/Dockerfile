# Образ эталонной игры. Она живёт на своём домене — так проверка origin в
# хендшейке проверяет что-то настоящее, а не совпадение с порталом.
FROM oven/bun:1.4-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/portal/package.json ./apps/portal/
COPY apps/example-game/package.json ./apps/example-game/
COPY packages/config/package.json ./packages/config/
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/fairness/package.json ./packages/fairness/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/db/package.json ./packages/db/
RUN bun install --frozen-lockfile --production --filter=@luciferus/example-game

COPY packages ./packages
COPY apps/example-game ./apps/example-game

EXPOSE 4000
# serve.ts собирает клиентский код при старте и раздаёт статику.
CMD ["bun", "run", "apps/example-game/serve.ts"]
