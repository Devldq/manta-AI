const { build } = require('esbuild')
const { join, resolve } = require('node:path')

const packageRoot = resolve(__dirname, '..')
const dist = join(packageRoot, 'dist')

build({
  entryPoints: [join(dist, 'server.js')],
  outfile: join(dist, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  alias: {
    '@core': join(dist, 'core'),
    '@engine': join(dist, 'core', 'engine'),
    '@context': join(dist, 'core', 'context'),
    '@storage': join(dist, 'core', 'storage'),
    '@tools': join(dist, 'core', 'tools'),
    '@observability': join(dist, 'core', 'observability'),
    '@security': join(dist, 'core', 'security'),
    '@llm': join(dist, 'core', 'llm'),
    '@routes': join(dist, 'routes'),
  },
  external: [
    'better-sqlite3',
    '@langchain/openai',
    '@langchain/ollama',
    '@langchain/anthropic',
    '@langchain/core',
    '@langchain/core/messages',
    '@manta/shared',
    '@manta/storage-hub',
    '@manta/contracts',
    '@manta/task-runtime',
    '@manta/skill-runtime',
  ],
  define: { 'import.meta.url': '__mantaImportMetaUrl' },
  banner: {
    js: "const __mantaImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
