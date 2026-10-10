// Estado do painel da Equipe (chat interno): aberto ou não, qual conversa e se
// está minimizado numa bolinha no canto (desktop). Fica fora das páginas para
// o painel continuar aberto enquanto se navega.
import { create } from 'zustand'

export type TelaDaEquipe = 'lista' | 'conversa' | 'nova' | 'detalhes'

interface EstadoDaEquipe {
  aberto: boolean
  minimizado: boolean
  tela: TelaDaEquipe
  conversaId: number | null
  /** Mensagem a destacar ao abrir (busca). */
  destaqueId: number | null
  abrir: (conversaId?: number | null, destaqueId?: number | null) => void
  irPara: (tela: TelaDaEquipe) => void
  fechar: () => void
  minimizar: () => void
}

export const useEquipeStore = create<EstadoDaEquipe>((set) => ({
  aberto: false,
  minimizado: false,
  tela: 'lista',
  conversaId: null,
  destaqueId: null,
  abrir: (conversaId = null, destaqueId = null) => set({
    aberto: true, minimizado: false, conversaId, destaqueId, tela: conversaId ? 'conversa' : 'lista',
  }),
  irPara: (tela) => set({ tela }),
  fechar: () => set({ aberto: false, minimizado: false }),
  minimizar: () => set((s) => ({ aberto: false, minimizado: !!s.conversaId })),
}))
