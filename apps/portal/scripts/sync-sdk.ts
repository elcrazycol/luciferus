import { resolve } from 'node:path'
import { buildSdk } from '@luciferus/sdk/build'

/**
 * Кладёт собранный SDK в `public/sdk/v1.js`, откуда его отдаёт портал.
 *
 * Именно эту строку вставляют в игру:
 *   <script src="http://localhost:3000/sdk/v1.js" async></script>
 *
 * Собирается тем же кодом, что и пакет в `packages/sdk/dist`: одна реализация —
 * один и тот же байт-в-байт файл, никакой возможности разойтись.
 */
const { outfile, bytes } = await buildSdk({
  outfile: resolve(import.meta.dir, '../public/sdk/v1.js'),
  minify: true,
})

console.log(`✅ /sdk/v1.js ← ${outfile} (${(bytes / 1024).toFixed(1)} КБ)`)
