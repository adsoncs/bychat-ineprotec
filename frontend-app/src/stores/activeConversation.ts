import { create } from 'zustand'

/**
 * Qual conversa está aberta na tela, se alguma.
 *
 * Existe só para o aviso global saber quando NÃO avisar: mensagem que chega na
 * conversa que o operador está lendo, com a aba na frente, não precisa de bipe
 * nem de balão do sistema — ele acabou de ver a mensagem aparecer.
 *
 * Não persiste: é estado de sessão de tela.
 */
interface ActiveConversationState {
  leadId: number | null
  setActiveConversation: (leadId: number | null) => void
}

export const useActiveConversationStore = create<ActiveConversationState>()((set) => ({
  leadId: null,
  setActiveConversation: (leadId) => set({ leadId }),
}))
