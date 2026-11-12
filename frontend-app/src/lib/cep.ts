// Busca de endereço pelo CEP (rota /api/cep do backend, com cache e troca de provedor).
import { api, ApiError } from '@/lib/apiClient'

export interface EnderecoDoCep { cep: string; logradouro: string; bairro: string; municipio: string; uf: string; ibge: string | null; fonte: string }

export type ResultadoCep =
  | { situacao: 'encontrado'; endereco: EnderecoDoCep }
  | { situacao: 'nao_encontrado' }
  | { situacao: 'indisponivel' }

/** Máscara 00000-000 enquanto digita. */
export function mascararCep(v: string): string {
  const d = v.replace(/\D+/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

export const digitosDoCep = (v: string) => v.replace(/\D+/g, '')

// Mesma consulta repetida na tela (apagar e redigitar) não vai de novo ao servidor.
const memoria = new Map<string, ResultadoCep>()

export async function consultarCep(cep: string): Promise<ResultadoCep> {
  const d = digitosDoCep(cep)
  const salvo = memoria.get(d)
  if (salvo) return salvo
  try {
    const r = await api.get<ResultadoCep>(`/cep/${d}`)
    memoria.set(d, r)
    return r
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) return { situacao: 'indisponivel' }
    throw e
  }
}

/**
 * Onde cada parte do endereço cai no formulário. O catálogo usa logradouro/
 * municipio; formulários antigos usam endereco/cidade/estado.
 */
export const CHAVES_DO_ENDERECO = {
  logradouro: ['logradouro', 'endereco', 'rua'],
  bairro: ['bairro'],
  municipio: ['municipio', 'cidade'],
  uf: ['uf', 'estado'],
} as const

/** Chaves de CEP reconhecidas (catálogo e formulários antigos). */
export const CHAVES_DE_CEP = ['cep', 'enderecoCep', 'cepResidencial']
