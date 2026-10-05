import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

/**
 * Para quem dá para transferir ou atribuir um lead — a lista do dia a dia.
 *
 * Substitui /admin/users, /admin/teams e /admin/agents nos seletores de
 * Promover e Transferir: essas são listas de administração e voltavam 403 para
 * o agente, travando as janelas. O recorte vem do servidor: o administrador vê
 * todo mundo; os demais veem todas as equipes (para mandar à fila delas), mas
 * só os colegas das equipes de que fazem parte.
 */
export interface DestinoPessoa {
  id: number
  name: string
  role: string
}

export interface DestinoEquipe {
  id: number
  name: string
  /** A pessoa logada faz parte desta equipe. */
  minha: boolean
  /** Se os membros vieram. Falso = equipe de outro setor: dá para mandar à fila dela. */
  membrosVisiveis: boolean
  members: Array<DestinoPessoa & { isLeader: boolean }>
}

export interface Destinos {
  equipes: DestinoEquipe[]
  pessoas: DestinoPessoa[]
  /** true para administrador: a lista de pessoas é a da instalação inteira. */
  completo: boolean
}

export function useDestinos(enabled = true) {
  return useQuery({
    queryKey: ['lead-destinos'],
    queryFn: () => api.get<Destinos>('/bychat/leads/destinos'),
    staleTime: 60_000,
    enabled,
  })
}
