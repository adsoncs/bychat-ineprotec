// Educacional › Acesso por portal (backend: routes/portalAcesso.ts, lib/portalAccess.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type NivelAcesso = 'VER' | 'OPERAR'

export interface PortalDaMatriz { id: number; nome: string; ativo: boolean; equipeDonaId: number | null; inscricoes: number }
export interface MembroDaEquipe { id: number; nome: string; papel: string; lider: boolean }
export interface EquipeDaMatriz { id: number; nome: string; cor: string; ativa: boolean; veTodosOsPortais: boolean; membros: MembroDaEquipe[] }
export interface LinhaDeAcesso { portalId: number; teamId: number; nivel: NivelAcesso }

export interface MatrizDeAcesso { portais: PortalDaMatriz[]; equipes: EquipeDaMatriz[]; linhas: LinhaDeAcesso[] }

export interface SalvarMatriz {
  linhas: LinhaDeAcesso[]
  equipesVeTodos: number[]
  equipesDonas: Record<string, number | null>
}

export interface Simulacao {
  usuario: { id: number; nome: string; papel: string; ativo: boolean }
  veTodos: boolean
  motivo: 'papel' | 'equipe' | null
  portais: Array<{ id: number; nome: string; ve: boolean; modo: 'todos' | 'aberto' | 'lider' | 'membro' | 'nenhum'; opera: boolean; inscricoes: number }>
}

export function useMatrizDeAcesso() {
  return useQuery({
    queryKey: ['portal-acesso'],
    queryFn: () => api.get<MatrizDeAcesso>('/admin/portal-acesso'),
  })
}

export function useSalvarMatrizDeAcesso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: SalvarMatriz) => api.put<{ ok: true; linhas: number }>('/admin/portal-acesso', dados),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portal-acesso'] })
      void qc.invalidateQueries({ queryKey: ['portal-acesso-simular'] })
    },
  })
}

export function useSimularAcesso(userId: number | null) {
  return useQuery({
    queryKey: ['portal-acesso-simular', userId],
    queryFn: () => api.get<Simulacao>(`/admin/portal-acesso/simular?userId=${userId}`),
    enabled: userId != null,
  })
}
