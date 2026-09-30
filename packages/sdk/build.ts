import { resolve } from 'node:path'
import { buildSdk } from './src/build'

const { outfile, bytes } = await buildSdk({
  outfile: resolve(import.meta.dir, 'dist/v1.js'),
  minify: true,
  sourcemap: true,
})

console.log(`✅ SDK собран: ${outfile} (${(bytes / 1024).toFixed(1)} КБ)`)
