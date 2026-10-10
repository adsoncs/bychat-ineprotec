// Equipe (chat interno) — dados. Tempo real: eventos `equipe:*` invalidam
// ['equipe', ...] (lib/realtime.ts); a lista e o resumo também se atualizam
// num intervalo longo, como rede de segurança.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface PessoaEquipe { id: number; nome: string; email: string; role: string; workStatus: string | null; online: boolean }
export interface ResumoDoLeadEquipe {
  id: number; restrito?: boolean; nome?: string; whatsapp?: string; etapa?: string | null; funil?: string | null
  atendente?: string | null; semAtendente?: boolean; ultimaMensagemEm?: string | null
}
export interface ConversaEquipe {
  id: number; tipo: 'direta' | 'grupo' | 'equipe' | 'lead'; nome: string; descricao: string | null
  teamId: number | null; leadId: number | null; outro: PessoaEquipe | null; membros: number
  souAdmin: boolean; silenciada: boolean; naoLidas: number; mencoes: number
  ultima: { id: number; autor: string; texto: string; em: string } | null
}
export interface CartaoEquipe {
  tipo: 'lead' | 'indicacao' | 'transferencia' | 'negociacao' | 'tarefa'
  lead?: ResumoDoLeadEquipe | null
  restrito?: boolean
  motivo?: string | null
  para?: string | null
  paraUserId?: number | null
  de?: string | null
  status?: string
  resposta?: string | null
  podeAssumir?: boolean
  assumidoPor?: string | null
  podeResponder?: boolean
  podeCancelar?: boolean
  negociacao?: { id: number; titulo: string; status: string; valor: number | null; moeda: string | null }
  titulo?: string
  detalhe?: string | null
  prazo?: string | null
  concluidaPor?: string | null
  podeConcluir?: boolean
  podeReabrir?: boolean
}
export interface AnexoEquipe { url: string; nome: string; tipo: string; tamanho: number | null }
export interface MensagemEquipe {
  id: number; conversaId: number; autor: PessoaEquipe | { id: number; nome: string } | null
  minha: boolean; sistema: boolean; corpo: string | null; anexos: AnexoEquipe[]; cartao: CartaoEquipe | null
  linksDeLead: ResumoDoLeadEquipe[]; mencionaMim: boolean; reacoes: Record<string, number[]>
  resposta: { id: number; autor: string | null; trecho: string } | null
  editada: boolean; apagada: boolean; createdAt: string
}
export interface DetalhesDaConversa {
  id: number; tipo: ConversaEquipe['tipo']; nome: string | null; descricao: string | null; teamId: number | null
  leadId: number | null; lead: { id: number; nome: string } | null; souMembro: boolean; souAdmin: boolean
  silenciada: boolean; membros: Array<PessoaEquipe & { papel: string }>
}

export function useResumoDaEquipe(ligado: boolean) {
  return useQuery({
    queryKey: ['equipe', 'resumo'],
    queryFn: () => api.get<{ naoLidas: number; mencoes: number; conversasComNaoLidas: number }>('/equipe/resumo'),
    enabled: ligado,
    refetchInterval: 120_000,
    staleTime: 20_000,
  })
}

export function useConversasDaEquipe(ligado = true) {
  return useQuery({
    queryKey: ['equipe', 'conversas'],
    queryFn: () => api.get<{ conversas: ConversaEquipe[] }>('/equipe/conversas'),
    enabled: ligado,
    refetchInterval: 120_000,
    staleTime: 10_000,
  })
}

export function useDetalhesDaConversa(id: number | null) {
  return useQuery({
    queryKey: ['equipe', 'conversa', id],
    queryFn: () => api.get<DetalhesDaConversa>(`/equipe/conversas/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  })
}

export function useMensagensDaConversa(id: number | null) {
  return useQuery({
    queryKey: ['equipe', 'mensagens', id],
    queryFn: () => api.get<{ mensagens: MensagemEquipe[]; temMais: boolean; ultimaLidaId: number | null }>(`/equipe/conversas/${id}/mensagens?limit=60`),
    enabled: !!id,
    staleTime: 0,
  })
}

export function usePessoasDaEquipe(ligado = true) {
  return useQuery({
    queryKey: ['equipe', 'pessoas'],
    queryFn: () => api.get<{ pessoas: PessoaEquipe[]; equipes: Array<{ id: number; name: string; color: string | null; membros: number[] }> }>('/equipe/pessoas'),
    enabled: ligado,
    staleTime: 30_000,
  })
}

export function useAcoesDaEquipe() {
  const qc = useQueryClient()
  const recarregar = (conversaId?: number | null) => {
    void qc.invalidateQueries({ queryKey: ['equipe', 'conversas'] })
    void qc.invalidateQueries({ queryKey: ['equipe', 'resumo'] })
    if (conversaId) {
      void qc.invalidateQueries({ queryKey: ['equipe', 'mensagens', conversaId] })
      void qc.invalidateQueries({ queryKey: ['equipe', 'conversa', conversaId] })
    }
  }
  const enviar = useMutation({
    mutationFn: (v: { conversaId: number; corpo?: string; cartao?: unknown; anexos?: AnexoEquipe[]; respostaAId?: number | null }) =>
      api.post<{ mensagem: MensagemEquipe }>(`/equipe/conversas/${v.conversaId}/mensagens`, v),
    onSuccess: (_d, v) => recarregar(v.conversaId),
  })
  const criarConversa = useMutation({
    mutationFn: (v: { tipo: 'direta'; userId: number } | { tipo: 'grupo'; nome: string; membros: number[]; descricao?: string } | { tipo: 'lead'; leadId: number }) =>
      api.post<{ id: number }>('/equipe/conversas', v),
    onSuccess: () => recarregar(),
  })
  const marcarLida = useMutation({
    mutationFn: (conversaId: number) => api.post(`/equipe/conversas/${conversaId}/lida`),
    onSuccess: () => recarregar(),
  })
  const editar = useMutation({
    mutationFn: (v: { id: number; corpo: string; conversaId: number }) => api.patch(`/equipe/mensagens/${v.id}`, { corpo: v.corpo }),
    onSuccess: (_d, v) => recarregar(v.conversaId),
  })
  const apagar = useMutation({
    mutationFn: (v: { id: number; conversaId: number }) => api.delete(`/equipe/mensagens/${v.id}`),
    onSuccess: (_d, v) => recarregar(v.conversaId),
  })
  const reagir = useMutation({
    mutationFn: (v: { id: number; emoji: string; conversaId: number }) => api.post(`/equipe/mensagens/${v.id}/reacao`, { emoji: v.emoji }),
    onSuccess: (_d, v) => recarregar(v.conversaId),
  })
  const acaoDoCartao = useMutation({
    mutationFn: (v: { id: number; acao: string; resposta?: string; conversaId: number }) => api.post(`/equipe/mensagens/${v.id}/acao`, { acao: v.acao, resposta: v.resposta }),
    onSuccess: (_d, v) => recarregar(v.conversaId),
  })
  const silenciar = useMutation({
    mutationFn: (v: { conversaId: number; silenciada: boolean }) => api.put(`/equipe/conversas/${v.conversaId}/silenciar`, { silenciada: v.silenciada }),
    onSuccess: (_d, v) => recarregar(v.conversaId),
  })
  const adicionarMembros = useMutation({
    mutationFn: (v: { conversaId: number; userIds: number[] }) => api.post(`/equipe/conversas/${v.conversaId}/membros`, { userIds: v.userIds }),
    onSuccess: (_d, v) => recarregar(v.conversaId),
  })
  const removerMembro = useMutation({
    mutationFn: (v: { conversaId: number; userId: number }) => api.delete(`/equipe/conversas/${v.conversaId}/membros/${v.userId}`),
    onSuccess: (_d, v) => recarregar(v.conversaId),
  })
  const renomear = useMutation({
    mutationFn: (v: { conversaId: number; nome?: string; descricao?: string }) => api.patch(`/equipe/conversas/${v.conversaId}`, v),
    onSuccess: (_d, v) => recarregar(v.conversaId),
  })
  return { enviar, criarConversa, marcarLida, editar, apagar, reagir, acaoDoCartao, silenciar, adicionarMembros, removerMembro, renomear }
}

/** Envia um arquivo e devolve o anexo pronto para a mensagem. */
export async function enviarAnexo(arquivo: File): Promise<AnexoEquipe> {
  const fd = new FormData()
  fd.append('file', arquivo)
  return api.post<AnexoEquipe>('/equipe/anexos', fd)
}

export function buscarReferencias(tipo: 'lead' | 'negociacao', q: string) {
  return api.get<{ itens: any[] }>(`/equipe/referencias?tipo=${tipo}&q=${encodeURIComponent(q)}`)
}

export function buscarNasConversas(q: string) {
  return api.get<{ resultados: Array<{ id: number; conversaId: number; autor: string | null; trecho: string; em: string }> }>(`/equipe/busca?q=${encodeURIComponent(q)}`)
}
