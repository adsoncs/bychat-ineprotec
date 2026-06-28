import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

const base = '/admin/aca/fin-banco'

export interface ContaFin { id: number; codigo: string; nome: string; tipo: string; ativo: boolean }
export interface ContaBanco { id: number; nome: string; bancoCodigo: string; agencia: string | null; conta: string | null; carteira: string | null; convenio: string | null; cnab: string; cedente: string | null; documentoCedente: string | null; sequencialRemessa: number; ativo: boolean }
export interface IndexadorVal { id: number; competencia: string; valorPct: number }
export interface Indexador { id: number; nome: string; ativo: boolean; valores: IndexadorVal[] }
export interface Feriado { id: number; data: string; nome: string }
export interface Recorrente { id: number; contratoId: number; alunoId: number; descricao: string; valorCentavos: number; periodo: string; diaVencimento: number; proximaGeracao: string; ativo: boolean; alunoNome: string; ra: string | null }
export interface ParcelaAberto { id: number; nroParcela: number; tipo: string; valorBrutoCentavos: number; dataVencimento: string; remessaId: number | null; alunoNome: string; ra: string | null }
export interface Remessa { id: number; contaBancariaId: number; sequencial: number; layout: string; qtdTitulos: number; valorTotalCentavos: number; nomeArquivo: string; status: string; createdAt: string }

function listHook<T>(key: string, path: string, field: string) {
  return () => useQuery({ queryKey: [key], queryFn: () => api.get<Record<string, T[]>>(`${base}/${path}`).then((r) => r[field] as T[]), staleTime: 5_000 })
}
export const useContasFin = listHook<ContaFin>('aca-fb-contasfin', 'contas-financeiras', 'contas')
export const useContasBanco = listHook<ContaBanco>('aca-fb-contasbanco', 'contas-bancarias', 'contas')
export const useIndexadores = listHook<Indexador>('aca-fb-indexadores', 'indexadores', 'indexadores')
export const useFeriados = listHook<Feriado>('aca-fb-feriados', 'feriados', 'feriados')
export const useRecorrentes = listHook<Recorrente>('aca-fb-recorrentes', 'recorrentes', 'recorrentes')
export const useRemessas = listHook<Remessa>('aca-fb-remessas', 'remessas', 'remessas')

export const useParcelasAberto = (semRemessa = true) =>
  useQuery({ queryKey: ['aca-fb-parcelas', semRemessa], queryFn: () => api.get<{ parcelas: ParcelaAberto[] }>(`${base}/parcelas-aberto${semRemessa ? '?semRemessa=1' : ''}`), staleTime: 3_000 })

export function useFinBancoMut() {
  const qc = useQueryClient()
  const inval = (...keys: string[]) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }))
  const M = (path: string, method: 'post' | 'put' | 'delete', ...keys: string[]) =>
    useMutation({ mutationFn: (b: any) => (method === 'delete' ? api.delete(`${base}/${typeof b === 'number' ? path.replace(':id', String(b)) : path}`) : (api as any)[method](`${base}/${path}`, b)), onSuccess: () => inval(...keys) })
  return {
    criarContaFin: M('contas-financeiras', 'post', 'aca-fb-contasfin'),
    criarContaBanco: M('contas-bancarias', 'post', 'aca-fb-contasbanco'),
    criarIndexador: M('indexadores', 'post', 'aca-fb-indexadores'),
    addValorIndexador: useMutation({ mutationFn: ({ id, ...b }: any) => api.post(`${base}/indexadores/${id}/valores`, b), onSuccess: () => inval('aca-fb-indexadores') }),
    criarFeriado: M('feriados', 'post', 'aca-fb-feriados'),
    delFeriado: useMutation({ mutationFn: (id: number) => api.delete(`${base}/feriados/${id}`), onSuccess: () => inval('aca-fb-feriados') }),
    criarRecorrente: M('recorrentes', 'post', 'aca-fb-recorrentes'),
    updateRecorrente: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`${base}/recorrentes/${id}`, b), onSuccess: () => inval('aca-fb-recorrentes') }),
    gerarRecorrencias: useMutation({ mutationFn: (b: { dryRun: boolean }) => api.post<{ dryRun: boolean; total: number; geradas?: number }>(`${base}/recorrentes/gerar`, b), onSuccess: () => inval('aca-fb-recorrentes', 'aca-fb-parcelas') }),
    cobrancaAvulsa: M('cobranca-avulsa', 'post', 'aca-fb-parcelas'),
    gerarRemessa: useMutation({ mutationFn: (b: { contaBancariaId: number; parcelaIds: number[] }) => api.post<{ remessa: any }>(`${base}/remessa/gerar`, b), onSuccess: () => inval('aca-fb-remessas', 'aca-fb-parcelas') }),
    processarRetorno: useMutation({ mutationFn: (b: { conteudo: string }) => api.post<{ baixadas: number; naoEncontradas: number }>(`${base}/retorno/processar`, b), onSuccess: () => inval('aca-fb-parcelas') }),
  }
}

export async function baixarRemessa(id: number, nome: string) {
  const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
  const res = await fetch(`${env.apiBase}/admin/aca/fin-banco/remessa/${id}/arquivo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('Falha ao baixar remessa')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
