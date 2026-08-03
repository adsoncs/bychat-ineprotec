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
  /** unico = cobrança de uma vez; recorrente = mensalidade (entra no MRR). */
  cobranca?: 'unico' | 'recorrente'
  /** Só p/ `unico`: parcelamento do item (null/1 = à vista). */
  parcelas?: number | null
  /** Só p/ `recorrente`: prazo do contrato em meses. */
  recorrenciaMeses?: number | null
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
  /** Mensalidade somada (MRR) e pagamento único, já com o desconto rateado. */
  valorRecorrente: number | string | null
  valorUnico: number | string | null
  moeda: string
  pagamentoForma: string | null
  parcelas: number | null
  entrada: number | string | null
  condicaoPagamento: string | null
  /** Condições da mensalidade — separadas das do pagamento único. */
  descontoRecTipo: 'valor' | 'percent' | null
  descontoRecValor: number | string | null
  pagamentoFormaRec: string | null
  vencimentoDiaRec: number | null
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

/** Rascunho sugerido pelo backend a partir dos dados comerciais que o lead já
 * trouxe da Kommo (curso + valor de tabela, pagamento, parcelas, desconto).
 * Só é consultado ao criar uma negociação nova. */
export interface NegotiationSuggestion {
  titulo: string
  items: Array<{ productId: number | null; nome: string; quantidade: number; precoUnit: number; descontoItem: number; cobranca?: 'unico' | 'recorrente' }>
  pagamentoForma: string | null
  parcelas: number | null
  descontoTipo: 'valor' | 'percent' | null
  descontoValor: number | null
  condicaoPagamento: string | null
  origem: string | null
}

export function useNegotiationSuggestion(leadId: number | null) {
  return useQuery({
    queryKey: ['negotiation-suggestion', leadId],
    queryFn: () => api.get<{ suggestion: NegotiationSuggestion | null }>(`/admin/negotiations/suggestion/${leadId}`),
    enabled: !!leadId,
    staleTime: 60_000,
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

// Catálogo como fonte de itens da proposta (best-effort: módulo desligado → vazio).
export interface CatalogHit {
  id: number; nome: string; categoria: string; preco: number | string | null
  cobranca?: 'unico' | 'recorrente'; descricao?: string | null; sku?: string | null; disponivel?: boolean
}

/** Busca por texto — usada no campo de digitação rápida. */
export function useCatalogPick(q: string) {
  return useQuery({
    queryKey: ['catalog-pick', q],
    queryFn: () => api.get<{ products: CatalogHit[] }>(`/admin/catalog?q=${encodeURIComponent(q)}`).catch(() => ({ products: [] as CatalogHit[] })),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
  })
}

/** Catálogo inteiro (opcionalmente por categoria), para o seletor de itens
 * mostrar o que existe sem obrigar o operador a adivinhar o nome. */
export function useCatalogBrowse(categoria: string, enabled: boolean) {
  return useQuery({
    queryKey: ['catalog-browse', categoria],
    queryFn: () => api.get<{ products: CatalogHit[] }>(`/admin/catalog?categoria=${encodeURIComponent(categoria)}`).catch(() => ({ products: [] as CatalogHit[] })),
    enabled,
    staleTime: 30_000,
  })
}

export function useCatalogPickCategories(enabled: boolean) {
  return useQuery({
    queryKey: ['catalog-pick-categories'],
    queryFn: () => api.get<{ categories: { categoria: string; count: number }[] }>('/admin/catalog/categories')
      .catch(() => ({ categories: [] as { categoria: string; count: number }[] })),
    enabled,
    staleTime: 60_000,
  })
}

// ── Tela do módulo (todas as negociações) ─────────────────────────────────
// Um endpoint só devolve a página da lista, os totais por status (colunas do
// pipeline) e os KPIs — três telas do mesmo recorte, uma volta ao servidor.

export interface NegotiationRow extends Negotiation {
  lead: { id: number; nome: string | null; email: string | null; whatsapp: string | null; funnelId: number | null; status: string | null } | null
  responsavelNome: string | null
}

export interface NegotiationsOverviewParams {
  page?: number
  limit?: number
  q?: string
  status?: string
  /** open | won | lost */
  resultado?: string
  funnelId?: number | null
  responsavelUserId?: number | null
  /** unico | recorrente — só propostas que têm aquele componente */
  cobranca?: string
  dateFrom?: string
  dateTo?: string
  /** recent | oldest | value | mrr */
  orderBy?: string
}

export interface NegotiationsOverview {
  negotiations: NegotiationRow[]
  total: number
  page: number
  limit: number
  byStatus: { status: string; count: number; valorUnico: number; valorRecorrente: number; valorFinal: number }[]
  kpis: {
    openCount: number; openUnico: number; openMrr: number; openTotal: number
    wonCount: number; wonUnico: number; wonMrr: number; wonTotal: number
    lostCount: number; winRate: number | null; avgTicket: number
  }
}

export function negotiationsOverviewQuery(p: NegotiationsOverviewParams): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }
  return qs.toString()
}

export function useNegotiationsOverview(p: NegotiationsOverviewParams) {
  return useQuery({
    queryKey: ['negotiations-overview', p],
    queryFn: () => api.get<NegotiationsOverview>(`/admin/negotiations/overview?${negotiationsOverviewQuery(p)}`),
    staleTime: 15_000,
  })
}

/** Muda só o status (arrastar card no pipeline). O PUT recalcula os totais a
 * partir dos itens que já estão salvos — não mexe na composição da proposta. */
export function useSetNegotiationStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.put<{ negotiation: Negotiation }>(`/admin/negotiations/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['negotiations-overview'] })
      qc.invalidateQueries({ queryKey: ['negotiation'] })
    },
  })
}
