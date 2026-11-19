// De onde a pessoa veio (anúncio, UTM, site que mandou para cá).
//
// O Google e a Meta põem a marcação só na URL da PRIMEIRA página. Se ela
// navega, volta outro dia ou recarrega, a marcação some da URL. Por isso
// guardamos a origem quando ela chega e a mandamos junto com a inscrição; o
// servidor grava na inscrição e no lead (utmSource, gclid, fbclid…).
//
// Regra: a última chegada COM marcação vale (último clique pago). Uma visita
// sem marcação não apaga a marcação guardada. Vale por 30 dias.

const CHAVES = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'gclid', 'gbraid', 'wbraid', 'fbclid'] as const
const ARMAZEM = 'attrae:origem:v1'
const VALIDADE = 30 * 86400_000

type Origem = Partial<Record<(typeof CHAVES)[number] | 'referrer' | 'landing', string>> & { em?: number }

function ler(): Origem | null {
  try {
    const o = JSON.parse(localStorage.getItem(ARMAZEM) || 'null') as Origem | null
    if (!o || typeof o !== 'object') return null
    if (!o.em || Date.now() - o.em > VALIDADE) return null
    return o
  } catch { return null }
}

/** Chama uma vez ao abrir o portal. */
export function guardarOrigem() {
  try {
    const qs = new URLSearchParams(location.search)
    const achado: Origem = {}
    for (const k of CHAVES) {
      // A URL do Google às vezes repete o parâmetro (utm_source=google…&utm_source=adwords&utm_campaign=).
      const v = qs.getAll(k).map((x) => x.trim()).find(Boolean)
      if (v) achado[k] = v.slice(0, 255)
    }
    let ref = ''
    try {
      const r = document.referrer ? new URL(document.referrer) : null
      if (r && r.host !== location.host) ref = r.href.slice(0, 500)
    } catch { /* referrer inválido */ }
    const temMarcacao = Object.keys(achado).length > 0
    if (!temMarcacao && (!ref || ler())) return
    const novo: Origem = { ...achado, ...(ref ? { referrer: ref } : {}), landing: (location.pathname + location.search).slice(0, 500), em: Date.now() }
    localStorage.setItem(ARMAZEM, JSON.stringify(novo))
  } catch { /* sem armazenamento: segue sem origem */ }
}

/** Campos para ir dentro do formData da inscrição (só os preenchidos). */
export function origemParaEnvio(): Record<string, string> {
  const o = ler()
  if (!o) return {}
  const out: Record<string, string> = {}
  for (const k of [...CHAVES, 'referrer'] as const) if (o[k]) out[k] = o[k]!
  return out
}
