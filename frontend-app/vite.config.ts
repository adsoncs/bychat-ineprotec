import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// Salt por build embutido no nome de TODOS os assets. Garante que cada deploy
// gere URLs inéditas — assim, mesmo que o Cloudflare tenha envenenado um chunk
// de hash estável (servindo HTML no lugar do .js), o index.html novo passa a
// referenciar um nome nunca cacheado (MISS → origem limpa). Anti tela-preta
// definitivo, sem depender de purge manual. Ver feedback_spa_fallback_cache_poisoning.
const BUILD_ID = (process.env.BUILD_ID || Date.now().toString(36)).slice(-7)

/**
 * Reescreve imports nomeados de `lucide-preact` para imports diretos em
 * `lucide-preact/dist/esm/icons/<kebab>.mjs`. O barrel principal do package
 * usa `export *` que impede tree shaking — sem isso, todos os ~1700 ícones
 * acabam no bundle. Este plugin transforma:
 *
 *   import { Plus, Save as SaveIcon } from 'lucide-preact'
 *
 * em:
 *
 *   import Plus from 'lucide-preact/dist/esm/icons/plus.mjs'
 *   import SaveIcon from 'lucide-preact/dist/esm/icons/save.mjs'
 */
/**
 * Carrega o mapa de aliases lucide-preact lendo o barrel principal —
 * toda exportação `default as Foo` em `from './icons/bar.mjs'` vira
 * `Foo: 'bar'`. Cobre os ícones renomeados (AlertCircle → circle-alert
 * etc.) sem precisar de override manual.
 */
function loadLucideAliasMap(): Record<string, string> {
  try {
    const path = resolve(__dirname, 'node_modules/lucide-preact/dist/esm/lucide-preact.mjs')
    const src = readFileSync(path, 'utf8')
    const map: Record<string, string> = {}
    const re = /export\s*\{([^}]+)\}\s*from\s*['"]\.\/icons\/([^'"]+)\.mjs['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const members = m[1] ?? ''
      const file = m[2] ?? ''
      const nameRe = /default\s+as\s+(\w+)/g
      let mm: RegExpExecArray | null
      while ((mm = nameRe.exec(members))) {
        const name = mm[1]
        if (name && !(name in map)) map[name] = file
      }
    }
    return map
  } catch {
    return {}
  }
}

const ICON_FILE_OVERRIDES = loadLucideAliasMap()

function toKebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z0-9])/g, '$1-$2')
    .replace(/([0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

const LUCIDE_DIRECT_PREFIX = 'lucide-preact/dist/esm/'

/**
 * Exports do barrel que NÃO são ícones. Sem esta lista o transform abaixo
 * reescreveria `LucideProvider` para `icons/lucide-provider.mjs` — arquivo que
 * não existe — e o build quebraria com um erro de resolução obscuro.
 * Valor = módulo real dentro de dist/esm.
 */
const LUCIDE_NON_ICON_EXPORTS: Record<string, string> = {
  LucideProvider: 'context',
  useLucideContext: 'context',
  createLucideIcon: 'createLucideIcon',
  Icon: 'Icon',
}

function lucideTreeShake(): Plugin {
  return {
    name: 'lucide-tree-shake',
    enforce: 'pre',
    resolveId(source) {
      // O package.json de lucide-preact tem `exports` restritivo que só
      // expõe `.`. Como nosso transform reescreve para deep imports,
      // precisamos resolvê-los manualmente no filesystem.
      if (!source.startsWith(LUCIDE_DIRECT_PREFIX)) return null
      return resolve(__dirname, 'node_modules', source)
    },
    transform(code, id) {
      if (!/\.(t|j)sx?$/.test(id)) return null
      if (!code.includes('lucide-preact')) return null
      const re = /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]lucide-preact['"]/g
      let changed = false
      const next = code.replace(re, (_, names: string) => {
        changed = true
        return names
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((item) => {
            const [original, alias] = item.split(/\s+as\s+/).map((s) => s.trim())
            if (!original) return ''
            const localName = alias ?? original
            const nonIcon = LUCIDE_NON_ICON_EXPORTS[original]
            if (nonIcon) {
              // Export nomeado (não default) nos módulos utilitários.
              return `import { ${original}${alias ? ` as ${alias}` : ''} } from 'lucide-preact/dist/esm/${nonIcon}.mjs'`
            }
            const file = ICON_FILE_OVERRIDES[original] ?? toKebab(original)
            return `import ${localName} from 'lucide-preact/dist/esm/icons/${file}.mjs'`
          })
          .filter(Boolean)
          .join('\n')
      })
      if (!changed) return null
      return { code: next, map: null }
    },
  }
}

export default defineConfig({
  base: '/app/',
  plugins: [preact(), tailwindcss(), lucideTreeShake()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  server: {
    port: 5180,
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:3005',
    },
  },
  optimizeDeps: {
    // O plugin lucide-tree-shake reescreve os imports — não deixar o esbuild
    // pré-empacotar o package (senão o barrel inteiro acaba no chunk).
    exclude: ['lucide-preact'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      // Multi-page: `app` é o SPA (/app/*), `landing` é a vitrine institucional
      // pública servida na raiz de bychat.ia.br pelo backend (Fase 2).
      // Ambos compartilham `base: '/app/'`, então os assets da landing também
      // são resolvidos via /app/assets/* mesmo com o HTML servido em `/`.
      input: {
        app: resolve(__dirname, 'index.html'),
        landing: resolve(__dirname, 'landing.html'),
        educacional: resolve(__dirname, 'educacional.html'),
      },
      output: {
        // build id no nome → URLs novas a cada deploy (auto-cura poison do CF)
        entryFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        chunkFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        assetFileNames: `assets/[name]-[hash]-${BUILD_ID}[extname]`,
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@radix-ui')) return 'vendor-radix'
          if (id.includes('@dnd-kit')) return 'vendor-dnd'
          if (id.includes('@tanstack/react-query')) return 'vendor-query'
          if (id.includes('cmdk')) return 'vendor-cmdk'
          if (id.includes('lucide-preact')) return 'vendor-icons'
          if (
            id.includes('/preact/') ||
            id.includes('preact-render-to-string') ||
            id.includes('wouter-preact')
          ) {
            return 'vendor-preact'
          }
          if (
            id.includes('zustand') ||
            id.includes('clsx') ||
            id.includes('tailwind-merge')
          ) {
            return 'vendor-utils'
          }
          return undefined
        },
      },
    },
  },
})
