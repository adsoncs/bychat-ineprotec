import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface NegItem {
  id?: number
  productId?: number | null
  nome: string
  quantidade: number
  precoUnit: number | string
  descontoItem?: number | string | null
  subtotal?: number | string
}

export interface NegAttachment {
  id: number
  fileName: string
  url: string
  mimeType: string | null
  fileSize: number | null
  createdAt: string
}

export interface Negotiation {
  id: number
  leadId: number
  titulo: string
  status: string
  valorTabela: number | string | null
  descontoTipo: 'valor' | 'percent' | null
  descontoValor: number | string | null
  frete: number | string | null
  valorFinal: number | string | null
  moeda: string
  pagamentoForma: string | null
  parcelas: number | null
  entrada: number | string | null
  condicaoPagamento: string | null
  probabilidade: number | null
  validadeAte: string | null
  fechamentoPrevisto: string | null
  responsavelUserId: number | null
  observacoes: string | null
  resultado: 'won' | 'lost' | null
  lostReasonId: number | null
  fechadaEm: string | null
  createdAt: string
  items?: NegItem[]
  attachments?: NegAttachment[]
  lostReason?: { id: number; name: string } | null
  _count?: { items: number; attachments: number }
}

export function useNegotiations(leadId: number) {
  return useQuery({
    queryKey: ['negotiations', leadId],
    queryFn: () => api.get<{ negotiations: Negotiation[] }>(`/admin/negotiations?leadId=${leadId}`),
    staleTime: 15_000,
  })
}

export function useNegotiation(id: number | null) {
  return useQuery({
    queryKey: ['negotiation', id],
    queryFn: () => api.get<{ negotiation: Negotiation }>(`/admin/negotiations/${id}`),
    enabled: !!id,
  })
}

export function useSaveNegotiation(leadId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (n: any) => n.id ? api.put<{ negotiation: Negotiation }>(`/admin/negotiations/${n.id}`, n) : api.post<{ negotiation: Negotiation }>('/admin/negotiations', { ...n, leadId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['negotiations', leadId] }); qc.invalidateQueries({ queryKey: ['negotiation'] }) },
  })
}

export function useDeleteNegotiation(leadId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/negotiations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['negotiations', leadId] }),
  })
}

export function useCloseNegotiation(leadId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, resultado, lostReasonId, valorFinal }: { id: number; resultado: 'won' | 'lost'; lostReasonId?: number; valorFinal?: number }) =>
      api.post<{ negotiation: Negotiation }>(`/admin/negotiations/${id}/close`, { resultado, lostReasonId, valorFinal }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['negotiations', leadId] }); qc.invalidateQueries({ queryKey: ['negotiation'] }); qc.invalidateQueries({ queryKey: ['lead'] }) },
  })
}

export function useReopenNegotiation(leadId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ negotiation: Negotiation }>(`/admin/negotiations/${id}/reopen`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['negotiations', leadId] }); qc.invalidateQueries({ queryKey: ['negotiation'] }); qc.invalidateQueries({ queryKey: ['lead'] }) },
  })
}

export function useUploadNegotiationAttachment(leadId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const fd = new FormData()
      fd.append('file', file, file.name)
      return api.post<{ attachment: NegAttachment }>(`/admin/negotiations/${id}/attachments`, fd)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['negotiation'] }); qc.invalidateQueries({ queryKey: ['negotiations', leadId] }) },
  })
}

export function useDeleteNegotiationAttachment(leadId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (attId: number) => api.delete(`/admin/negotiations/attachments/${attId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['negotiation'] }); qc.invalidateQueries({ queryKey: ['negotiations', leadId] }) },
  })
}

// Busca no catálogo para adicionar itens (best-effort: 403 se módulo catálogo off → vazio).
export interface CatalogHit { id: number; nome: string; categoria: string; preco: number | string | null }
export function useCatalogPick(q: string) {
  return useQuery({
    queryKey: ['catalog-pick', q],
    queryFn: () => api.get<{ products: CatalogHit[] }>(`/admin/catalog?q=${encodeURIComponent(q)}`).catch(() => ({ products: [] as CatalogHit[] })),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
  })
}
