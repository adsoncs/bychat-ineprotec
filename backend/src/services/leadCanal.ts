// src/services/leadCanal.ts
//
// Normaliza o CANAL de captação de um lead vindo do CRM Educacional.
//
// Duas fontes, nesta ordem de confiança:
//  1. `CampaignSource` (texto livre digitado pela instituição) — presente em
//     ~50% dos leads e é o mais específico ("Ação Polo", "Panfletagem",
//     "Indicação Colaborador", "Assaí").
//  2. `OrigemClientePotencial` — optionset numérico do Dynamics, presente em
//     100%. A API NÃO devolve o rótulo, então os significados abaixo foram
//     DEDUZIDOS cruzando cada código com os canais que aparecem dentro dele
//     (ver project_bychat_crm_educacional_integration). Confirmar a tabela
//     oficial com a unialfa — dois códigos seguem sem significado conhecido.

export type CanalMacro =
  | 'Mídia paga'
  | 'Ação presencial'
  | 'Base própria'
  | 'Site'
  | 'Indicação'
  | 'Campanha de curso'

export interface CanalClassificado {
  canal: CanalMacro | null
  detalhe: string | null
  /** 'texto' = veio do CampaignSource; 'codigo' = deduzido do optionset. */
  base: 'texto' | 'codigo' | null
}

/**
 * Significado deduzido de cada código (cobertura medida sobre 112.092 leads):
 *   200003    38.827 (35%)  Base Off/digital de editais anteriores
 *   200002    35.672 (32%)  Ação Externa, Ação Polo, Onda Vermelha, Panfletagem
 *   809220003 27.987 (25%)  facebook, google, pmax, ig, Meta
 *   200001     2.044 (1,8%) Mestrado em Direito, Vestibular — campanha de curso
 *   200000     1.002 (0,9%) google, Site_ead
 *   809220002  6.457 (5,8%) SEM nenhuma pista — não mapeado de propósito
 *   200005       103 (0,1%) SEM nenhuma pista — não mapeado de propósito
 */
const POR_CODIGO: Record<string, CanalMacro> = {
  '200003': 'Base própria',
  '200002': 'Ação presencial',
  '809220003': 'Mídia paga',
  '200001': 'Campanha de curso',
  '200000': 'Site',
}

/** Padrões do texto livre → canal. Ordem importa: o primeiro que casar vence. */
const POR_TEXTO: Array<{ re: RegExp; canal: CanalMacro; detalhe?: string }> = [
  { re: /face|^meta$|instagram|^ig$|whatsapp\s?ads/i, canal: 'Mídia paga', detalhe: 'Facebook/Instagram' },
  { re: /google|^pmax$|adwords|youtube/i, canal: 'Mídia paga', detalhe: 'Google' },
  { re: /tiktok|kwai|linkedin/i, canal: 'Mídia paga' },
  { re: /base\s?(off|digital)|edital(es)?\s?anterior/i, canal: 'Base própria' },
  { re: /remarketing|reengaj|base\s/i, canal: 'Base própria' },
  { re: /indica[çc][ãa]o|amigo|colaborador/i, canal: 'Indicação' },
  { re: /site|landing|^lp$|formul[áa]rio\s?do\s?site|org[âa]nico/i, canal: 'Site' },
  {
    re: /a[çc][ãa]o|panfleta|rua|feira|polo|onda\s?vermelha|evento|f[áa]brica|lojista|assa[íi]|externa|blitz|visita|escola|stand/i,
    canal: 'Ação presencial',
  },
  { re: /enem|vestibular|mestrado|mba|p[óo]s|gradua|t[ée]cnico|curso/i, canal: 'Campanha de curso' },
]

/**
 * Classifica o canal. `detalhe` guarda sempre o texto original quando existe —
 * é ele que responde "qual ação de rua?", "qual polo?" no relatório.
 */
export function classificarCanal(
  campaignSource: string | null | undefined,
  origemCodigo: string | number | null | undefined,
): CanalClassificado {
  const texto = (campaignSource ?? '').toString().trim()

  if (texto) {
    for (const regra of POR_TEXTO) {
      if (regra.re.test(texto)) {
        return { canal: regra.canal, detalhe: regra.detalhe ?? texto, base: 'texto' }
      }
    }
    // texto presente mas fora dos padrões conhecidos: preserva como detalhe e
    // tenta o código para a categoria macro
    const porCod = origemCodigo != null ? POR_CODIGO[String(origemCodigo)] : undefined
    return { canal: porCod ?? null, detalhe: texto, base: porCod ? 'codigo' : null }
  }

  const porCod = origemCodigo != null ? POR_CODIGO[String(origemCodigo)] : undefined
  if (porCod) return { canal: porCod, detalhe: null, base: 'codigo' }
  return { canal: null, detalhe: null, base: null }
}

/** Chaves `canal_*` para customFields. Vazio quando não há o que afirmar. */
export function canalParaCustomFields(c: CanalClassificado): Record<string, string> {
  const cf: Record<string, string> = {}
  if (c.canal) cf.canal = c.canal
  if (c.detalhe) cf.canal_detalhe = c.detalhe.substring(0, 191)
  if (c.base) cf.canal_base = c.base
  return cf
}
