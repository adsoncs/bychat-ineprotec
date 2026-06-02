import { render } from 'preact'
import { App } from '@/App'
import '@/styles/global.css'

// ── Recuperação automática de deploy (anti tela-preta) ────────────────────────
// Após um novo build, os chunks lazy mudam de hash e os antigos deixam de existir.
// Uma aba já aberta (index.html antigo em memória) pode pedir um chunk inexistente
// na navegação → o import dinâmico falha e o app trava na tela preta.
// Aqui forçamos UM reload (que busca o index.html fresco — servido como no-store —
// com os hashes novos). Um carimbo de tempo em sessionStorage impede loop: no
// máximo 1 reload a cada 10s. Cobre `vite:preloadError` e rejeições de chunk-load.
const RELOAD_TS_KEY = 'bc_chunk_reload_ts'
function recoverFromStaleChunk(reason: unknown): void {
  const msg = String((reason as any)?.message ?? reason ?? '')
  const isChunkError =
    /preloaderror/i.test(msg) ||
    /dynamically imported module|importing a module script failed|failed to fetch dynamically import/i.test(msg) ||
    /ChunkLoadError|Loading (chunk|CSS chunk)/i.test(msg)
  if (!isChunkError) return
  const last = Number(sessionStorage.getItem(RELOAD_TS_KEY) || 0)
  if (Date.now() - last < 10_000) return // já recarregou há pouco — evita loop
  sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()))
  location.reload()
}
window.addEventListener('vite:preloadError', (e: any) => { e?.preventDefault?.(); recoverFromStaleChunk(e?.payload ?? e) })
window.addEventListener('unhandledrejection', (e) => recoverFromStaleChunk((e as PromiseRejectionEvent)?.reason))

const root = document.getElementById('root')
if (!root) throw new Error('#root não encontrado')
render(<App />, root)
