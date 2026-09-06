// hooks/useTopbarPulse.ts
//
// O pulso do turno que a barra superior mostra o dia inteiro: quantas conversas
// esperam por nós, quanto temos levado para responder hoje, e quantas já
// passaram da meta.
//
// Os números são os MESMOS do painel de Supervisão, pela mesma consulta e com a
// mesma definição de "esperando" (a última palavra é do contato, não o contador
// de não lidas). Dois lugares dizendo números diferentes para a mesma pergunta
// é o defeito que aquele painel acabou de corrigir — não vale a pena repeti-lo
// no topo da tela.

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface TopbarPulse {
  /** Conversas ativas cuja última mensagem é do contato. */
  esperando: number
  /** Destas, as paradas há mais de `esquecidasDias` — fila de arquivo, não de turno. */
  esquecidas: number
  esquecidasDias: number
  /** Espera mais antiga em minutos ÚTEIS, já sem as esquecidas. */
  maisAntigaMin: number | null
  /** Mediana de primeira resposta de hoje, em minutos úteis. `null` abaixo do piso. */
  medianaHojeMin: number | null
  amostraHoje: number
  minAmostra: number
  foraDaMeta: number
  metaMin: number
  relogio: { label: string; origem: string }
  turno: { status: string; desde: string | null }
}

export function useTopbarPulse(habilitado: boolean) {
  return useQuery({
    queryKey: ['topbar', 'pulse'],
    queryFn: () => api.get<TopbarPulse>('/supervision/pulse'),
    enabled: habilitado,
    // O servidor guarda o pulso por 30s por usuário; pedir de minuto em minuto
    // mantém a barra viva sem transformar o painel de Supervisão em custo fixo
    // de todas as telas.
    refetchInterval: 60_000,
    staleTime: 30_000,
    // Um erro aqui não pode ficar piscando no topo: a barra simplesmente não
    // mostra os sinais, e o resto dela continua igual.
    retry: 1,
  })
}
