// hooks/usePapeis.ts
//
// Configurações › Papéis e acessos — o novo modelo de permissões
// (backend: routes/papeis.ts, motor em services/papeisMotor.ts).
// Uma pessoa = um papel + pacotes; o papel diz o que ela pode fazer
// (capacidades) e sobre quais registros (alcance por tipo de dado).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type TipoAlcance = 'LEADS' | 'AGENDA' | 'INSCRICOES' | 'FINANCEIRO' | 'VISOES'
export type NivelAlcance = 'MEUS' | 'EQUIPE' | 'LIDERADAS' | 'RECORTES' | 'TUDO'
export type PapelBase = 'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER'

export interface CatalogoRecurso { recurso: string; nome: string; area: string; acoes: string[] }
export interface CatalogoNomeada { id: string; nome: string; separavel: boolean }
export interface Catalogo { recursos: CatalogoRecurso[]; nomeadas: CatalogoNomeada[]; tipos: TipoAlcance[]; niveis: NivelAlcance[] }

export interface PapelResumo {
  id: number
  nome: string
  descricao: string | null
  sistema: boolean
  papelBase: PapelBase
  origem: string | null
  arquivado: boolean
  capacidades: number
  pessoas: number
  alcances: Partial<Record<TipoAlcance, NivelAlcance>>
}

export interface PapelDetalhe extends Omit<PapelResumo, 'capacidades' | 'pessoas'> {
  capacidades: Array<{ capacidade: string; separacao: boolean }>
  usuarios: Array<{ id: number; name: string; email: string; active: boolean }>
}

export interface PessoaPapel { id: number; name: string; email: string; role: PapelBase; active: boolean; papelId: number | null; pacotes: number[] }
export interface Pacote { id: number; nome: string; descricao: string | null; origem: string | null; capacidades: string[]; pessoas: number }

export interface VerComo {
  pessoa: { id: number; nome: string; papelBase: PapelBase }
  papel: { id: number; nome: string } | null
  pacotes: string[]
  modulosVisiveis: string[]
  leads: number
  inscricoes: number
  motorLigado: boolean
}

export interface Sombra { pessoas: number; semPapel: number; total: number; divergencias: Array<Record<string, unknown>> }

const B = '/admin/papeis'
const K = ['papeis'] as const

export const usePapeis = () =>
  useQuery({ queryKey: [...K, 'lista'], queryFn: () => api.get<{ motorLigado: boolean; papeis: PapelResumo[] }>(B) })

export const usePapel = (id: number | null) =>
  useQuery({ queryKey: [...K, 'papel', id], queryFn: () => api.get<PapelDetalhe>(`${B}/${id}`), enabled: id != null })

export const useCatalogoPapeis = () =>
  useQuery({ queryKey: [...K, 'catalogo'], queryFn: () => api.get<Catalogo>(`${B}/catalogo`), staleTime: 5 * 60_000 })

export const usePessoasPapeis = () =>
  useQuery({ queryKey: [...K, 'pessoas'], queryFn: () => api.get<{ pessoas: PessoaPapel[] }>(`${B}/pessoas`) })

export const usePacotes = () =>
  useQuery({ queryKey: [...K, 'pacotes'], queryFn: () => api.get<{ pacotes: Pacote[] }>(`${B}/pacotes`) })

export const useVerComo = (userId: number | null) =>
  useQuery({ queryKey: [...K, 'ver-como', userId], queryFn: () => api.get<VerComo>(`${B}/ver-como/${userId}`), enabled: userId != null })

export const useSombra = (ativo: boolean) =>
  useQuery({ queryKey: [...K, 'sombra'], queryFn: () => api.get<Sombra>(`${B}/sombra`), enabled: ativo })

/** Toda escrita mexe no acesso de alguém: recarrega a tela inteira e as
 *  permissões da própria sessão (o menu pode mudar). */
function useEscrita<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K })
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      void qc.invalidateQueries({ queryKey: ['my-permissions'] })
    },
  })
}

export const useCriarPapel = () =>
  useEscrita((b: { nome: string; descricao?: string; clonarDe?: number; papelBase?: PapelBase }) => api.post<{ ok: true; id: number }>(B, b))

export const useSalvarPapel = () =>
  useEscrita(({ id, ...b }: { id: number; nome?: string; descricao?: string; papelBase?: PapelBase; capacidades?: string[]; separacao?: string[]; alcances?: Partial<Record<TipoAlcance, NivelAlcance>> }) =>
    api.put<{ ok: true; pessoasAfetadas: number }>(`${B}/${id}`, b))

export const useArquivarPapel = () =>
  useEscrita((id: number) => api.post<{ ok: true; arquivado: boolean }>(`${B}/${id}/arquivar`))

export const useSalvarPessoa = () =>
  useEscrita(({ userId, ...b }: { userId: number; papelId?: number; pacotes?: number[] }) => api.put<{ ok: true }>(`${B}/pessoas/${userId}`, b))

export const useSalvarPacote = () =>
  useEscrita(({ id, ...b }: { id?: number; nome: string; descricao?: string; capacidades: string[] }) =>
    id ? api.put<{ ok: true }>(`${B}/pacotes/${id}`, b) : api.post<{ ok: true; id: number }>(`${B}/pacotes`, b))

export const useExcluirPacote = () =>
  useEscrita((id: number) => api.delete<{ ok: true }>(`${B}/pacotes/${id}`))

export const useLigarMotor = () =>
  useEscrita((b: { ligado: boolean; forcar?: boolean }) => api.put<{ ok: true; motorLigado: boolean }>(`${B}/motor`, b))
