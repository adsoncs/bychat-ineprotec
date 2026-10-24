// Dados das telas iniciais do comercial (Diretoria, Gerente, Agente).
//
// Uma chamada só, por /home-screen/comercial — como a Visão Geral Educacional,
// a tela é atribuída a papéis que podem não ter o módulo 'dashboard'. A visão
// vem da tela atribuída; o `visao` do pedido só vale para administrador.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type VisaoComercial = 'diretoria' | 'gerente' | 'agente'

export interface KpisComercial {
  leads: number
  contatados: number
  taxaContato: number | null
  /** Mediana da 1ª resposta, em minutos úteis. */
  tempoResposta: number | null
  amostraResposta: number
  dentroDaMeta: number | null
  matriculas: number
  conversao: number | null
  pagamentos: number
  receita: number
  ticketMedio: number | null
  cicloMedioDias: number | null
}

export interface MetaDoAgente {
  metrica: 'count' | 'revenue' | 'conversion' | string
  alvo: number | null
  atual: number | null
  atingimento: number | null
  projecao: number | null
}

export interface LinhaAgente {
  userId: number
  nome: string
  equipe: string | null
  eu: boolean
  leads: number
  contatados: number
  taxaContato: number | null
  tempoResposta: number | null
  respostasNaMeta: number
  matriculas: number
  conversao: number | null
  pagamentos: number
  /** null para o agente olhando um colega: R$ dos outros não aparece. */
  receita: number | null
  ticketMedio: number | null
  perdidos: number
  atividades: number
  atrasadas: number
  semResposta: number
  parados: number
  ativos: number
  pontos: number
  meta: MetaDoAgente | null
  conquistas: string[]
  sequencia: number
}

export interface EtapaDoFunil {
  key: string
  nome: string
  cor: string
  terminal: boolean
  matricula: boolean
  agora: number
  entradas: number
  chegaramAMatricula: number | null
}

export interface PainelComercial {
  visao: VisaoComercial
  periodo: { de: string; ate: string; dias: number; decorridos: number }
  funisNoRecorte: { id: number; nome: string; semEtapaDeMatricula: boolean }[]
  kpis: KpisComercial
  anterior: KpisComercial
  projecao: { matriculas: number; pagamentos: number; receita: number } | null
  fila: { semResposta: number; parados: number; atrasadas: number; ativos: number }
  semResponsavel: { leads: number; ativos: number } | null
  serie: { dia: string; leads: number; matriculas: number; pagamentos: number }[]
  funil: { id: number; nome: string; etapas: EtapaDoFunil[] }[]
  porOrigem: { nome: string; leads: number; matriculas: number; conversao: number | null }[]
  porCurso: { nome: string; pagamentos: number; receita: number }[]
  motivosDePerda: { nome: string; c: number }[]
  agentes: LinhaAgente[]
  mediaDoTime: { conversao: number | null; tempoResposta: number | null; matriculas: number; pontos: number } | null
  eu: (LinhaAgente & { comissaoPrevista: number | null }) | null
  missao: { alvo: number; atual: number; atingimento: number; metrica: string; projecao: number } | null
  pontos: Record<string, number>
  metaDeRespostaMin: number
  filtros: {
    funis: { id: number; nome: string; deVenda: boolean; temMatricula: boolean }[]
    equipes: { id: number; name: string }[]
    origens: string[]
  }
}

export interface FiltrosComercial {
  dateFrom: string
  dateTo: string
  funis: number[]
  teamId: number | null
  userId: number | null
  origem: string | null
  visao?: VisaoComercial | undefined
}

export function usePainelComercial(f: FiltrosComercial) {
  const q = new URLSearchParams({ dateFrom: f.dateFrom, dateTo: f.dateTo })
  if (f.funis.length) q.set('funis', f.funis.join(','))
  if (f.teamId) q.set('teamId', String(f.teamId))
  if (f.userId) q.set('userId', String(f.userId))
  if (f.origem) q.set('origem', f.origem)
  if (f.visao) q.set('visao', f.visao)
  return useQuery({
    queryKey: ['home-screen', 'comercial', q.toString()],
    queryFn: () => api.get<PainelComercial>(`/home-screen/comercial?${q.toString()}`),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
}

export interface ConfigPainelComercial {
  config: {
    funis: number[] | null
    etapasMatricula: Record<string, string[]>
    etapasPerda: Record<string, string[]>
    pontos: Record<string, number>
  }
  funis: { id: number; nome: string; etapas: { key: string; nome: string; tipo: string | null }[]; matricula: string[]; perda: string[]; deVenda: boolean }[]
  pontosPadrao: Record<string, number>
}

export function useConfigPainelComercial(enabled: boolean) {
  return useQuery({
    queryKey: ['painel-comercial', 'config'],
    queryFn: () => api.get<ConfigPainelComercial>('/admin/painel-comercial/config'),
    enabled,
  })
}

export function useSalvarConfigPainelComercial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ConfigPainelComercial['config']) => api.put('/admin/painel-comercial/config', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['painel-comercial'] })
      void qc.invalidateQueries({ queryKey: ['home-screen', 'comercial'] })
    },
  })
}
