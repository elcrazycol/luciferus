import './src/env'

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://luciferus:luciferus@localhost:55432/luciferus',
  },
  verbose: true,
  strict: true,
})
