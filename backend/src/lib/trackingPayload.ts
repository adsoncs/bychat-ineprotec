// src/lib/trackingPayload.ts
//
// Contrato de entrada dos dados de origem (tracking) para integrações externas:
// formulário do site do cliente, Make/n8n/Zapier, ERP. Quem posta manda as UTMs
// e os click ids junto do lead, e aqui eles viram colunas do Lead.
//
// Por que existe: o formulário nativo (`/f/`) captura utm/gclid/fbclid da URL
// sozinho, mas quem tem formulário PRÓPRIO no site não tinha por onde entregar
// isso — o webhook de entrada só mapeava 8 campos e a API pública gravava
// `source: 'api'` fixo. O lead entrava sem origem, e o relatório de atribuição
// não via a campanha que pagou por ele.
//
// Aceita as duas grafias de propósito: `utm_source` é o que o site tem na URL e
// o que Make/Zapier mandam; `utmSource` é o nome interno. Exigir uma delas só
// geraria um campo silenciosamente vazio na integração do cliente.

/** Coluna do Lead ← nomes aceitos no payload, e o limite da coluna no banco. */
const CAMPOS: Array<{ coluna: string; label: string; limite: number; nomes: string[] }> = [
  { coluna: 'utmSource', label: 'UTM source (utm_source)', limite: 100, nomes: ['utm_source', 'utmsource'] },
  { coluna: 'utmMedium', label: 'UTM medium (utm_medium)', limite: 100, nomes: ['utm_medium', 'utmmedium'] },
  { coluna: 'utmCampaign', label: 'UTM campaign (utm_campaign)', limite: 191, nomes: ['utm_campaign', 'utmcampaign'] },
  { coluna: 'utmContent', label: 'UTM content (utm_content)', limite: 191, nomes: ['utm_content', 'utmcontent'] },
  { coluna: 'utmTerm', label: 'UTM term (utm_term)', limite: 191, nomes: ['utm_term', 'utmterm'] },
  { coluna: 'utmId', label: 'UTM id (utm_id)', limite: 191, nomes: ['utm_id', 'utmid'] },
  { coluna: 'gclid', label: 'Google Click ID (gclid)', limite: 191, nomes: ['gclid'] },
  { coluna: 'fbclid', label: 'Meta Click ID (fbclid)', limite: 255, nomes: ['fbclid'] },
  { coluna: 'ctwaClid', label: 'Click-to-WhatsApp ID (ctwa_clid)', limite: 191, nomes: ['ctwa_clid', 'ctwaclid'] },
  // O script de tracking do site expõe o id do visitante em `BT.getVisitorId()`.
  // Mandá-lo aqui é o que costura a visita anônima ao lead que ela virou.
  { coluna: 'trackingVisitorId', label: 'ID do visitante (visitor_id)', limite: 64, nomes: ['visitor_id', 'visitorid', 'bt_vid', 'trackingvisitorid'] },
  { coluna: 'campaignId', label: 'ID da campanha (Meta)', limite: 191, nomes: ['campaign_id', 'campaignid'] },
  { coluna: 'campaignName', label: 'Nome da campanha (Meta)', limite: 191, nomes: ['campaign_name', 'campaignname'] },
  { coluna: 'adsetId', label: 'ID do conjunto (Meta)', limite: 191, nomes: ['adset_id', 'adsetid'] },
  { coluna: 'adsetName', label: 'Nome do conjunto (Meta)', limite: 191, nomes: ['adset_name', 'adsetname'] },
  { coluna: 'adId', label: 'ID do anúncio (Meta)', limite: 191, nomes: ['ad_id', 'adid'] },
  { coluna: 'adName', label: 'Nome do anúncio (Meta)', limite: 191, nomes: ['ad_name', 'adname'] },
  { coluna: 'source', label: 'Canal de origem (source)', limite: 50, nomes: ['source', 'origem', 'canal'] },
]

/** Alvos válidos no mapeamento do webhook de entrada, para a tela oferecer. */
export const ALVOS_TRACKING = CAMPOS.map(c => ({ target: c.coluna, label: c.label }))

export const COLUNAS_TRACKING = new Set(CAMPOS.map(c => c.coluna))

const LIMITE_POR_COLUNA = new Map(CAMPOS.map(c => [c.coluna, c.limite]))

/** Chave do payload → coluna. `utm_source`, `utmSource` e `UTM-Source` batem no mesmo lugar. */
const POR_NOME = new Map<string, string>()
for (const c of CAMPOS) {
  for (const n of c.nomes) POR_NOME.set(n, c.coluna)
  POR_NOME.set(c.coluna.toLowerCase(), c.coluna)
}

const normalizar = (k: string) => k.trim().toLowerCase().replace(/[-\s]/g, '_')

/** Corta no limite da coluna: valor maior que o `VarChar` faz o insert inteiro falhar. */
export function limitarTracking(coluna: string, valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  const v = String(valor).trim()
  if (!v) return null
  return v.slice(0, LIMITE_POR_COLUNA.get(coluna) ?? 191)
}

/**
 * Lê os campos de origem de um payload arbitrário.
 *
 * Procura na raiz e nos objetos onde as integrações costumam aninhar isso
 * (`tracking`, `utm`, `utms`, `data`, `query`, `fields`, `context`) — um nível,
 * de propósito: varrer o payload inteiro acharia `source` de qualquer subobjeto
 * e gravaria lixo como origem do lead.
 */
export function extrairTracking(payload: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!payload || typeof payload !== 'object') return out

  const raiz = payload as Record<string, unknown>
  const ninhos = ['tracking', 'utm', 'utms', 'data', 'query', 'fields', 'context']
  const fontes: Record<string, unknown>[] = [raiz]
  for (const n of ninhos) {
    const v = raiz[n]
    if (v && typeof v === 'object' && !Array.isArray(v)) fontes.push(v as Record<string, unknown>)
  }

  // A raiz vem primeiro: o que o integrador manda no topo vence o que estiver
  // repetido lá dentro.
  for (const fonte of fontes) {
    for (const [chave, valor] of Object.entries(fonte)) {
      if (valor === null || valor === undefined || typeof valor === 'object') continue
      const coluna = POR_NOME.get(normalizar(chave))
      if (!coluna || out[coluna]) continue
      const limpo = limitarTracking(coluna, valor)
      if (limpo) out[coluna] = limpo
    }
  }
  return out
}
