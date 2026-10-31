// src/lib/perfilLead.ts
//
// Traduz o que um formulário de anúncio (Meta Lead Ads) gravou em
// `lead.customFields` para texto que pode entrar numa mensagem. Os valores
// chegam crus, no formato em que a Meta serializa a opção escolhida —
// "mato_grosso", "até_300_ha", "proprietário_(a)" —, e escrever isso para o
// contato denuncia automação.
//
// O cuidado maior é a opção "outro": espelhar "Vi no seu cadastro: outro, até
// 300 ha, em outros_estados" é pior do que não espelhar nada, então a frase
// {{perfil}} é montada só com o que informa de verdade e cai numa frase neutra
// quando não sobra nada.
//
// Nasceu no terram com as chaves do formulário DELE fixas no código. No código
// comum, QUAIS campos entram e em que formato é configuração (Setting
// `leads.variaveis_perfil`, JSON):
//
//   {
//     "campos": [
//       { "variavel": "cultura", "campo": "<chave em customFields>", "formato": "minusculo" },
//       { "variavel": "area",    "campo": "<chave>", "formato": "area_ha" },
//       { "variavel": "estado",  "campo": "<chave>", "formato": "estado" }
//     ],
//     "vazios": ["outro", "outros", "outros_estados", "nao_informado", "n/a"],
//     "neutro": "<frase usada em {{perfil}} quando nenhum campo informa nada>"
//   }
//
// Formatos: texto (limpa "_" e "(a)"), minusculo, titulo, area_ha ("até 300 ha"),
// estado (título + preposição certa na frase: "no Mato Grosso", "em Goiás").
// Sem o Setting, nenhuma variável é criada — os campos personalizados seguem
// disponíveis crus por chave, como sempre.

import { prisma } from './prisma.js'

/** Opções que existem no formulário mas não dizem nada sobre o lead (padrão). */
const VAZIOS_PADRAO = ['outro', 'outros', 'outros_estados', 'nao_informado', 'n/a']

/** Preposição correta por estado — "no Mato Grosso", "na Bahia", "em Goiás". */
const PREPOSICAO: Record<string, string> = {
  acre: 'no', alagoas: 'em', amapa: 'no', amazonas: 'no', bahia: 'na',
  ceara: 'no', distrito_federal: 'no', espirito_santo: 'no', goias: 'em',
  maranhao: 'no', mato_grosso: 'no', mato_grosso_do_sul: 'no',
  minas_gerais: 'em', para: 'no', paraiba: 'na', parana: 'no',
  pernambuco: 'em', piaui: 'no', rio_de_janeiro: 'no',
  rio_grande_do_norte: 'no', rio_grande_do_sul: 'no', rondonia: 'em',
  roraima: 'em', santa_catarina: 'em', sao_paulo: 'em', sergipe: 'em',
  tocantins: 'no',
}

export type FormatoPerfil = 'texto' | 'minusculo' | 'titulo' | 'area_ha' | 'estado'

export interface CampoPerfil {
  /** Nome da variável na mensagem ({{cultura}}). */
  variavel: string
  /** Chave em lead.customFields. */
  campo: string
  formato?: FormatoPerfil
}

export interface ConfigPerfil {
  campos: CampoPerfil[]
  vazios?: string[]
  neutro?: string
}

/** Remove acento — só para casar a chave da preposição, nunca para exibir. */
function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** "mato_grosso" → "mato grosso"; "de_300_a_500_" → "de 300 a 500". */
function limpar(v: unknown): string {
  return String(v ?? '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\(a\)\s*$/i, '')
    .trim()
}

function chave(v: unknown): string {
  return semAcento(String(v ?? '').toLowerCase().trim()).replace(/\s+/g, '_')
}

/** Título em PT: primeira maiúscula por palavra, preservando "de/do/da/e". */
function titulo(s: string): string {
  const minusculas = new Set(['de', 'do', 'da', 'dos', 'das', 'e'])
  return s
    .split(' ')
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
}

/** "até 300 ha" | "de 300 a 500 ha" — a Meta às vezes corta o "ha" final. */
function areaLegivel(v: unknown): string {
  let a = limpar(v).toLowerCase()
  if (!/\bha\b/.test(a)) a = `${a} ha`
  return a.replace(/\s+ha$/, ' ha')
}

function formatar(v: unknown, formato: FormatoPerfil | undefined): string {
  switch (formato) {
    case 'minusculo': return limpar(v).toLowerCase()
    case 'titulo':
    case 'estado': return titulo(limpar(v).toLowerCase())
    case 'area_ha': return areaLegivel(v)
    default: return limpar(v)
  }
}

/**
 * Monta as variáveis de perfil a partir de `lead.customFields` e da config.
 * Só entra na frase o campo que diz alguma coisa; sem nenhum deles, {{perfil}}
 * vira a frase neutra para a mensagem continuar fazendo sentido.
 */
export function perfilDoLead(customFields: unknown, cfg: ConfigPerfil | null): Record<string, string> {
  if (!cfg || !Array.isArray(cfg.campos) || cfg.campos.length === 0) return {}
  let cf: Record<string, unknown> = {}
  if (customFields && typeof customFields === 'object') {
    cf = customFields as Record<string, unknown>
  } else if (typeof customFields === 'string') {
    try { cf = JSON.parse(customFields) } catch { cf = {} }
  }
  const vazios = new Set([...(cfg.vazios ?? VAZIOS_PADRAO), ''].map((v) => chave(v)))

  const out: Record<string, string> = {}
  const partes: string[] = []
  for (const c of cfg.campos) {
    if (!c?.variavel || !c?.campo) continue
    const bruto = cf[c.campo]
    const util = !vazios.has(chave(bruto))
    const valor = util ? formatar(bruto, c.formato) : ''
    out[c.variavel] = valor
    if (!valor) continue
    partes.push(c.formato === 'estado' ? `${PREPOSICAO[chave(bruto)] || 'em'} ${valor}` : valor)
  }
  out.perfil = partes.length ? partes.join(', ') : String(cfg.neutro ?? '')
  return out
}

const CACHE_MS = 60_000
let cache: { at: number; cfg: ConfigPerfil | null } | null = null

/** Config do Setting `leads.variaveis_perfil` (null = recurso desligado). */
export async function configDoPerfil(): Promise<ConfigPerfil | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.cfg
  let cfg: ConfigPerfil | null = null
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'leads.variaveis_perfil' } })
    let v: any = row?.value ?? null
    if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
    if (v && typeof v === 'object' && Array.isArray(v.campos)) cfg = v as ConfigPerfil
  } catch { cfg = null }
  cache = { at: Date.now(), cfg }
  return cfg
}

/** Variáveis {{<variavel>}} e {{perfil}} do lead; vazio sem configuração. */
export async function variaveisDePerfil(lead: { customFields?: unknown } | null | undefined): Promise<Record<string, string>> {
  return perfilDoLead(lead?.customFields, await configDoPerfil())
}
