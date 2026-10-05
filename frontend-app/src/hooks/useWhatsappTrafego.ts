import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

/** Tráfego do WhatsApp (Evolution) — ver backend/src/routes/whatsappTrafego.ts. */
export type TipoConversa = 'individual' | 'grupo' | 'todos'

export interface TrafegoTotais {
  recebidas: number
  enviadas: number
  conversas: number
  conversasComCliente: number
  novos: number
}

export interface TrafegoReport {
  periodo: { de: string; ate: string; anteriorDe: string; anteriorAte: string }
  filtros: { tipo: TipoConversa; instancia: string | null }
  /** Todos os números com cadastro ou com histórico (sem cadastro = `cadastrado: false`). */
  instancias: Array<{ instanceName: string; nome: string; telefone: string | null; ativo: boolean; cor: string | null; cadastrado: boolean }>
  totais: TrafegoTotais
  anterior: TrafegoTotais
  novos: { total: number; chegaram: number; abordados: number; anterior: number }
  resposta: {
    esperas: number
    respondidasPorPessoa: number
    soRobo: number
    semResposta: number
    medianaSeg: number | null
    p90Seg: number | null
    faixas: { ate5min: number; ate15min: number; ate1h: number; ate4h: number; ate24h: number; mais24h: number }
    aplica: boolean
  }
  esperaAgora: { total: number; ate1h: number; ate4h: number; ate24h: number; mais24h: number; maisAntigaMin: number }
  serie: Array<{ dia: string; recebidas: number; enviadas: number; conversas: number; novos: number }>
  mapaCalor: Array<{ dow: number; hora: number; qtd: number }>
  composicao: { atendente: number; celular: number; robo: number; automacao: number; nao_identificado: number }
  atendentes: Array<{ nome: string; enviadas: number; conversas: number; respondidas: number; medianaSeg: number | null }>
  porInstancia: Array<{
    instanceName: string | null; nome: string; telefone: string | null; ativo: boolean | null; cadastrado: boolean
    recebidas: number; enviadas: number; conversas: number; novos: number; esperandoAgora: number
    esperas: number; respondidas: number; medianaSeg: number | null
    /** Alinhada com `serie` (mesmos dias). */
    serie: Array<{ recebidas: number; enviadas: number }>
  }>
  entrega: Partial<Record<'falha' | 'pendente' | 'enviada' | 'entregue' | 'lida', number>>
  midia: Array<{ tipo: string; recebidas: number; enviadas: number }>
}

export interface TrafegoFiltro {
  de: string
  ate: string
  antDe?: string | undefined
  antAte?: string | undefined
  instancia: string | null
  tipo: TipoConversa
}

export function useWhatsappTrafego(f: TrafegoFiltro, enabled = true) {
  const qs = new URLSearchParams({ de: f.de, ate: f.ate, tipo: f.tipo })
  if (f.antDe && f.antAte) { qs.set('antDe', f.antDe); qs.set('antAte', f.antAte) }
  if (f.instancia) qs.set('instancia', f.instancia)
  return useQuery({
    queryKey: ['whatsapp-trafego', qs.toString()],
    queryFn: () => api.get<TrafegoReport>(`/whatsapp/trafego?${qs}`),
    staleTime: 60_000,
    // Troca de filtro mantém a tela anterior até a nova chegar — sem isso o
    // seletor de números some e volta a cada clique.
    placeholderData: (anterior) => anterior,
    enabled,
  })
}
