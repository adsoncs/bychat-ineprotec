// Catálogo de Produtos e Serviços — o que a empresa vende (mercadoria,
// serviço, plano, mensalidade). O tipo continua `Product` porque é o nome do
// model no schema; na tela tudo é chamado de "item".
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Product {
  id: number
  categoria: string
  nome: string
  marca: string | null
  descricao: string | null
  preco: string | number | null
  estoque: number | null
  disponivel: boolean
  sku: string | null
  imageUrl: string | null
  /** unico = cobrança de uma vez; recorrente = mensalidade. Puxado como padrão
   * ao inserir o item numa negociação. */
  cobranca?: 'unico' | 'recorrente'
}

export interface ProductInput {
  id?: number
  categoria: string
  nome: string
  marca?: string
  descricao?: string
  preco?: string | number | null
  estoque?: number | null
  disponivel?: boolean
  sku?: string
  cobranca?: 'unico' | 'recorrente'
}

export function useCatalog(q: string, categoria: string) {
  return useQuery({
    queryKey: ['catalog', q, categoria],
    queryFn: () => api.get<{ products: Product[] }>(`/admin/catalog?q=${encodeURIComponent(q)}&categoria=${encodeURIComponent(categoria)}`),
    staleTime: 15_000,
  })
}

export function useCatalogCategories() {
  return useQuery({
    queryKey: ['catalog-categories'],
    queryFn: () => api.get<{ categories: { categoria: string; count: number }[] }>('/admin/catalog/categories'),
    staleTime: 30_000,
  })
}

export function useSaveProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: ProductInput) => p.id ? api.put(`/admin/catalog/${p.id}`, p) : api.post('/admin/catalog', p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['catalog'] }); qc.invalidateQueries({ queryKey: ['catalog-categories'] }) },
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/catalog/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['catalog'] }); qc.invalidateQueries({ queryKey: ['catalog-categories'] }) },
  })
}

export function useImportCatalog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file, file.name)
      return api.post<{ ok: true; created: number; updated: number; skipped: number; total: number }>('/admin/catalog/import', fd)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['catalog'] }); qc.invalidateQueries({ queryKey: ['catalog-categories'] }) },
  })
}

/** Baixa o modelo XLSX (endpoint autenticado → blob). */
export async function downloadCatalogTemplate(): Promise<void> {
  const token = localStorage.getItem('bh_token')
  const res = await fetch('/api/admin/catalog/template', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('Falha ao baixar o modelo')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'modelo-catalogo.xlsx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
