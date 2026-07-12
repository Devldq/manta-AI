import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const src = resolve(__dirname, 'src')
export default defineConfig({ resolve: { alias: {
  '@core': resolve(src, 'core'), '@engine': resolve(src, 'core/engine'), '@context': resolve(src, 'core/context'),
  '@storage': resolve(src, 'core/storage'), '@tools': resolve(src, 'core/tools'), '@observability': resolve(src, 'core/observability'),
  '@security': resolve(src, 'core/security'), '@llm': resolve(src, 'core/llm'), '@routes': resolve(src, 'routes'),
} } })
