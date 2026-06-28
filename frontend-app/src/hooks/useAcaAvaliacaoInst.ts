import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

const base = '/admin/aca/avaliacao-inst'

export interface AvaliacaoInst { id: number; nome: string; descricao: string | null; publico: string; status: string; anonima: boolean; dimensoes: number; participacoes: number }
export interface PerguntaInst { id: number; dimensaoId: number; tipo: string; enunciado: string; ordem: number }
export interface DimensaoInst { id: number; avaliacaoId: number; nome: string; ordem: number; perguntas: PerguntaInst[] }
export interface ResultadoPergunta { id: number; enunciado: string; tipo: string; media: number | null; nps: number | null; pctSim: number | null; n: number; respostas?: string[] }
export interface ResultadoDimensao { id: number; nome: string; mediaDim: number | null; perguntas: ResultadoPergunta[] }
export interface Resultado { participacoes: number; dimensoes: ResultadoDimensao[] }

export const TIPO_LABEL: Record<string, string> = { ESCALA: 'Escala (1–5)', NPS: 'NPS (0–10)', TEXTO: 'Texto livre', SIMNAO: 'Sim / Não' }
export const AVAL_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'danger' }> = { RASCUNHO: { label: 'Rascunho', tone: 'neutral' }, ABERTA: { label: 'Aberta', tone: 'success' }, ENCERRADA: { label: 'Encerrada', tone: 'danger' } }

export const useAvaliacoesInst = () =>
  useQuery({ queryKey: ['aca-aval-inst'], queryFn: () => api.get<{ avaliacoes: AvaliacaoInst[] }>(base), staleTime: 5_000 })
export const useEstruturaAval = (id: number | null) =>
  useQuery({ queryKey: ['aca-aval-estrutura', id], queryFn: () => api.get<{ dimensoes: DimensaoInst[] }>(`${base}/${id}/estrutura`), enabled: id !== null, staleTime: 5_000 })
export const useResultadoAval = (id: number | null, enabled = true) =>
  useQuery({ queryKey: ['aca-aval-result', id], queryFn: () => api.get<Resultado>(`${base}/${id}/resultado`), enabled: id !== null && enabled, staleTime: 3_000 })

export function useAvalInstMut() {
  const qc = useQueryClient()
  const inval = (...k: string[]) => k.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }))
  return {
    criar: useMutation({ mutationFn: (b: any) => api.post(base, b), onSuccess: () => inval('aca-aval-inst') }),
    atualizar: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`${base}/${id}`, b), onSuccess: () => inval('aca-aval-inst') }),
    criarDimensao: useMutation({ mutationFn: ({ avaliacaoId, ...b }: any) => api.post(`${base}/${avaliacaoId}/dimensoes`, b), onSuccess: () => inval('aca-aval-estrutura') }),
    delDimensao: useMutation({ mutationFn: (id: number) => api.delete(`${base}/dimensoes/${id}`), onSuccess: () => inval('aca-aval-estrutura') }),
    criarPergunta: useMutation({ mutationFn: ({ dimensaoId, ...b }: any) => api.post(`${base}/dimensoes/${dimensaoId}/perguntas`, b), onSuccess: () => inval('aca-aval-estrutura') }),
    delPergunta: useMutation({ mutationFn: (id: number) => api.delete(`${base}/perguntas/${id}`), onSuccess: () => inval('aca-aval-estrutura') }),
    gerarLink: useMutation({ mutationFn: (id: number) => api.post<{ url: string; token: string }>(`${base}/${id}/link`, {}) }),
  }
}
