// stores/pageHeader.ts
//
// O título da tela atual, para a FAIXA DE PÁGINA da barra superior.
//
// A faixa poderia tirar o nome do menu lateral, e é o que ela faz quando não há
// nada aqui. Mas o menu só conhece nomes genéricos: numa tela de lead ele diria
// "Leads", e o título de verdade é o nome da pessoa. Por isso quem manda é o
// <Page> da própria tela — ele registra o que está escrevendo, e a faixa mostra.
//
// O <Page> deixou de desenhar o próprio <h1> no mesmo movimento: com a faixa
// fixa no topo, dois títulos apareceriam um debaixo do outro em 99 telas.

import { create } from 'zustand'

interface PageHeaderState {
  title: string | null
  /** Define o título da tela. Chamado pelo <Page> a cada montagem/atualização. */
  setTitle: (title: string | null) => void
}

export const usePageHeaderStore = create<PageHeaderState>()((set) => ({
  title: null,
  setTitle: (title) => set((s) => (s.title === title ? s : { title })),
}))
