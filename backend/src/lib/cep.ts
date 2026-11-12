// Busca de endereço pelo CEP.
//
// O painel não chama o provedor direto: passa por aqui para ter cache, troca
// automática de provedor quando um cai e uma resposta no mesmo formato, venha de
// onde vier. Provedores públicos, sem chave, na ordem:
//   1. BrasilAPI (consulta várias fontes, inclusive Correios)
//   2. ViaCEP
//   3. OpenCEP
// "Não encontrado" só quando um provedor responde que o CEP não existe; se
// todos falham (fora do ar, tempo esgotado), é "indisponível" — e a tela deixa
// preencher à mão.

import { redis } from './redis.js'

export interface EnderecoDoCep {
  cep: string          // 00000-000
  logradouro: string
  bairro: string
  municipio: string
  uf: string
  ibge: string | null  // código do município
  fonte: string
}

export type ResultadoCep =
  | { situacao: 'encontrado'; endereco: EnderecoDoCep }
  | { situacao: 'nao_encontrado' }
  | { situacao: 'indisponivel' }

const TEMPO_LIMITE_MS = 2500
const CACHE_ENCONTRADO_S = 30 * 24 * 3600
const CACHE_NAO_ENCONTRADO_S = 24 * 3600

/** Só dígitos; null se não forem exatamente 8. */
export function normalizarCep(bruto: unknown): string | null {
  const d = String(bruto ?? '').replace(/\D+/g, '')
  return d.length === 8 ? d : null
}

const comMascara = (d: string) => `${d.slice(0, 5)}-${d.slice(5)}`
const txt = (v: unknown) => String(v ?? '').trim()

// Cada provedor devolve o endereço, null (CEP não existe) ou lança (falhou).
type Provedor = { nome: string; buscar: (cep: string, sinal: AbortSignal) => Promise<EnderecoDoCep | null> }

const PROVEDORES: Provedor[] = [
  {
    nome: 'brasilapi',
    async buscar(cep, sinal) {
      const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`, { signal: sinal, headers: { accept: 'application/json' } })
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j: any = await r.json()
      return { cep: comMascara(cep), logradouro: txt(j.street), bairro: txt(j.neighborhood), municipio: txt(j.city), uf: txt(j.state).toUpperCase(), ibge: txt(j.ibge?.city) || null, fonte: 'brasilapi' }
    },
  },
  {
    nome: 'viacep',
    async buscar(cep, sinal) {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: sinal, headers: { accept: 'application/json' } })
      if (r.status === 400) return null
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j: any = await r.json()
      if (j?.erro) return null
      return { cep: comMascara(cep), logradouro: txt(j.logradouro), bairro: txt(j.bairro), municipio: txt(j.localidade), uf: txt(j.uf).toUpperCase(), ibge: txt(j.ibge) || null, fonte: 'viacep' }
    },
  },
  {
    nome: 'opencep',
    async buscar(cep, sinal) {
      const r = await fetch(`https://opencep.com/v1/${cep}`, { signal: sinal, headers: { accept: 'application/json' } })
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j: any = await r.json()
      if (j?.erro) return null
      return { cep: comMascara(cep), logradouro: txt(j.logradouro), bairro: txt(j.bairro), municipio: txt(j.localidade), uf: txt(j.uf).toUpperCase(), ibge: txt(j.ibge) || null, fonte: 'opencep' }
    },
  },
]

async function lerCache(cep: string): Promise<ResultadoCep | null> {
  try {
    const v = await redis.get(`cep:${cep}`)
    return v ? (JSON.parse(v) as ResultadoCep) : null
  } catch { return null }
}

async function gravarCache(cep: string, r: ResultadoCep): Promise<void> {
  const ttl = r.situacao === 'encontrado' ? CACHE_ENCONTRADO_S : CACHE_NAO_ENCONTRADO_S
  try { await redis.set(`cep:${cep}`, JSON.stringify(r), 'EX', ttl) } catch { /* sem cache, segue */ }
}

export async function buscarCep(bruto: unknown, log?: { warn: (m: string) => void }): Promise<ResultadoCep | null> {
  const cep = normalizarCep(bruto)
  if (!cep) return null
  const emCache = await lerCache(cep)
  if (emCache) return emCache

  let alguemRespondeu = false
  for (const p of PROVEDORES) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TEMPO_LIMITE_MS)
    try {
      const e = await p.buscar(cep, ctl.signal)
      alguemRespondeu = true
      // Um provedor sem o CEP não encerra a busca: as bases diferem (CEP novo
      // costuma aparecer antes em uma delas). Achou, para por aqui.
      if (e && e.uf) {
        const r: ResultadoCep = { situacao: 'encontrado', endereco: e }
        await gravarCache(cep, r)
        return r
      }
    } catch (err: any) {
      log?.warn(`[cep] ${p.nome} falhou para ${cep}: ${err?.name === 'AbortError' ? 'tempo esgotado' : err?.message}`)
    } finally {
      clearTimeout(timer)
    }
  }
  if (!alguemRespondeu) return { situacao: 'indisponivel' } // não vai para o cache
  const r: ResultadoCep = { situacao: 'nao_encontrado' }
  await gravarCache(cep, r)
  return r
}
