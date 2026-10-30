import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * O que aparece no card do Kanban — escolha de CADA agente, salva no navegador
 * dele (localStorage). Nada vai para o servidor: é preferência de leitura, não
 * regra da casa.
 *
 * Duas camadas:
 *  - BLOCOS: as partes que o card sempre teve (score, contato, negociação,
 *    rodapé…). Guardamos os OCULTOS, não os visíveis — assim o padrão é o card
 *    de antes, e um bloco novo que surgir aparece para todos sem migração.
 *  - DADOS: linhas "ícone · rótulo · valor" que o agente acrescenta, na ordem
 *    que escolher — dados do lead (`lead:`), do Educacional (`edu:`) e campos
 *    personalizados (`cf:`), os mesmos que a lista de Leads oferece.
 */
export type KanbanCardBlock =
  | 'empresa'
  | 'score'
  | 'atividades'
  | 'situacao'
  | 'resultado'
  | 'parado'
  | 'whatsapp'
  | 'email'
  | 'inscricoes'
  | 'negociacao'
  | 'camposDaEmpresa'
  | 'responsavel'
  | 'tags'
  | 'anotacao'
  | 'formulario'
  | 'criado'

/** `lead:segmento` | `edu:eduPolo` | `cf:<key>` */
export type KanbanCardDado = `lead:${string}` | `edu:${string}` | `cf:${string}`

/** 'texto' = "Polo: Centro"; 'icone' = só o ícone, com o rótulo na dica. */
export type KanbanRotulos = 'texto' | 'icone'

interface KanbanCardState {
  ocultos: KanbanCardBlock[]
  dados: KanbanCardDado[]
  rotulos: KanbanRotulos
  alternarBloco: (b: KanbanCardBlock) => void
  adicionarDado: (d: KanbanCardDado) => void
  removerDado: (d: KanbanCardDado) => void
  moverDado: (d: KanbanCardDado, delta: -1 | 1) => void
  setRotulos: (r: KanbanRotulos) => void
  restaurar: () => void
}

export const useKanbanCardStore = create<KanbanCardState>()(
  persist(
    (set, get) => ({
      ocultos: [],
      dados: [],
      rotulos: 'texto',
      alternarBloco: (b) => {
        const cur = get().ocultos
        set({ ocultos: cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b] })
      },
      adicionarDado: (d) => {
        if (!get().dados.includes(d)) set({ dados: [...get().dados, d] })
      },
      removerDado: (d) => set({ dados: get().dados.filter((x) => x !== d) }),
      moverDado: (d, delta) => {
        const lista = [...get().dados]
        const i = lista.indexOf(d)
        const j = i + delta
        if (i < 0 || j < 0 || j >= lista.length) return
        ;[lista[i], lista[j]] = [lista[j]!, lista[i]!]
        set({ dados: lista })
      },
      setRotulos: (rotulos) => set({ rotulos }),
      restaurar: () => set({ ocultos: [], dados: [], rotulos: 'texto' }),
    }),
    { name: 'bh:kanban-card', version: 1 },
  ),
)

/** O card mostra este bloco? */
export function useBlocoVisivel(): (b: KanbanCardBlock) => boolean {
  const ocultos = useKanbanCardStore((s) => s.ocultos)
  return (b) => !ocultos.includes(b)
}
