// Educacional › Configurações Gerais (backend: routes/eduGeral.ts, lib/eduGeral.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface GeralIdentidade {
  nome: string | null
  logoUrl: string | null
  faviconUrl: string | null
  logoLink: string | null
  rodape: string | null
}

export interface GeralAparencia {
  corPrincipal: string | null
  corApoio: string | null
  fonte: string | null
  raio: string | null
  botao: string | null
  caixaAlta: boolean | null
  escala: string | null
  largura: string | null
  espacamento: string | null
  corTexto: string | null
  corTextoSuave: string | null
  corFundo: string | null
  corCartao: string | null
  corLinha: string | null
  corSucesso: string | null
  corPendente: string | null
  corErro: string | null
}

export interface GeralLogin {
  painelTitulo: string | null
  painelSubtitulo: string | null
  painelItens: string[] | null
  painelImagemUrl: string | null
  painelVeu: number | null
  painelLado: string | null
  painelCorDe: string | null
  painelCorPara: string | null
  formTitulo: string | null
  formSubtitulo: string | null
  modoEmail: boolean | null
  modoCodigo: boolean | null
  esqueciTexto: string | null
  recuperarTitulo: string | null
  recuperarTexto: string | null
}

export interface EduGeral {
  identidade: GeralIdentidade
  aparencia: GeralAparencia
  login: GeralLogin
  /** Só os textos editados (chave → texto). */
  textos: Record<string, string>
  seo: GeralSeo
  /** portalId → o que o portal segue das Gerais. Ausente = personalizado. */
  heranca: Record<string, Heranca>
}

export interface GeralSeo {
  ogImageUrl: string | null
  pixels: { ga4Id: string | null; gtmId: string | null; metaPixelId: string | null; tiktokPixelId: string | null; linkedinPartnerId: string | null }
}

/** O que um portal segue das Configurações Gerais. */
export interface Heranca { marca: boolean; textos: boolean; seo: boolean }

export const SEM_HERANCA: Heranca = { marca: false, textos: false, seo: false }

/** Catálogo dos textos do portal (backend: lib/eduTextos.ts). */
export interface GrupoDeTextos {
  id: string
  titulo: string
  descricao: string
  textos: Array<{ chave: string; rotulo: string; padrao: string; longo?: boolean; marcadores?: string[] }>
}

export interface PadroesLogin {
  painelTitulo: string
  painelSubtitulo: string
  painelItens: string[]
  formTitulo: string
  formSubtitulo: string
  esqueciTexto: string
  recuperarTitulo: string
  recuperarTexto: string
}

export interface RespostaEduGeral {
  geral: EduGeral
  padroes: { login: PadroesLogin; textos: GrupoDeTextos[] }
  linkHoras: number
  portais: Array<{ id: number; nome: string; slug: string; active: boolean }>
}

export type ArquivoGeral = 'logo' | 'favicon' | 'painel' | 'og'

export function useEduGeral() {
  return useQuery({
    queryKey: ['edu-geral'],
    queryFn: () => api.get<RespostaEduGeral>('/admin/edu/geral'),
  })
}

export function useSalvarEduGeral() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: Partial<EduGeral>) => api.put<{ geral: EduGeral }>('/admin/edu/geral', dados),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['edu-geral'] }) },
  })
}

/** Liga/desliga o que um portal segue das Gerais (salva na hora). */
export function useSalvarHeranca() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ portalId, ...h }: Partial<Heranca> & { portalId: number }) =>
      api.put<{ heranca: Heranca }>(`/admin/edu/geral/heranca/${portalId}`, h),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['edu-geral'] }) },
  })
}

/** Lê a marca de um portal no formato das Gerais (não grava nada). */
export function importarDoPortal(id: number) {
  return api.get<{ identidade: Partial<GeralIdentidade>; aparencia: Partial<GeralAparencia>; login: Partial<GeralLogin>; textos: Record<string, string> }>(`/admin/edu/geral/importar/${id}`)
}

export function useEnviarArquivoGeral() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, file }: { kind: ArquivoGeral; file: File }) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post<{ ok: true; url: string; kind: ArquivoGeral }>(`/admin/edu/geral/upload?kind=${kind}`, fd)
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['edu-geral'] }) },
  })
}

export function useRemoverArquivoGeral() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (kind: ArquivoGeral) => api.delete<{ ok: true }>(`/admin/edu/geral/upload?kind=${kind}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['edu-geral'] }) },
  })
}
