import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Select } from '@/components/ui/Input'
import { useCapacidade } from '@/hooks/usePermissions'
import { cn } from '@/lib/cn'

/**
 * O que acontece com o funil do lead na transferência.
 *
 * Padrão é MANTER: transferir troca equipe/operador e o lead segue no funil e
 * na etapa em que está. As outras duas são escolhas que a empresa libera por
 * papel (Papéis e acessos):
 *  · Mover — troca o funil principal (o lead sai de onde está).
 *  · Acompanhar também — abre um card no outro funil e mantém o principal
 *    intacto. É o caso do aluno ganho em Vendas atendido pela Secretaria: a
 *    venda continua registrada e ele não vira outra ficha (que contaria de novo
 *    nos relatórios de marketing).
 *
 * São opções que se excluem, por isso um grupo de escolha única e não toggles.
 */

export type AcaoFunil = 'manter' | 'mover' | 'acompanhar'

export interface EscolhaFunil {
  acao: AcaoFunil
  funnelId: number | null
  stageKey: string | null
}

interface FunilComEtapas {
  id: number
  name: string
  stages: { key: string; name: string; position: number }[]
}

interface RespostaFunil {
  funilAtual: { id: number; name: string } | null
  adicionais: { funnelId: number; nome: string }[]
  funis: FunilComEtapas[]
}

export function useOpcoesDeFunilNaTransferencia() {
  const podeMover = useCapacidade('transferencia.mover_funil')
  const podeAcompanhar = useCapacidade('transferencia.abrir_outro_funil')
  return { podeMover, podeAcompanhar, algum: podeMover || podeAcompanhar }
}

export function TransferenciaFunil({
  leadId,
  valor,
  onChange,
}: {
  leadId: number
  valor: EscolhaFunil
  onChange: (v: EscolhaFunil) => void
}) {
  const { podeMover, podeAcompanhar, algum } = useOpcoesDeFunilNaTransferencia()
  // Mesma consulta do card de funil da conversa: reaproveita o cache.
  const q = useQuery({
    queryKey: ['ticket-funnel', leadId],
    queryFn: () => api.get<RespostaFunil>(`/atendimento/tickets/${leadId}/funnel`),
    enabled: !!leadId && algum,
    staleTime: 30_000,
  })
  if (!algum) return null

  const atual = q.data?.funilAtual ?? null
  const jaAcompanha = new Set((q.data?.adicionais ?? []).map((a) => a.funnelId))
  const funis = (q.data?.funis ?? []).filter((f) =>
    // Acompanhar no próprio funil principal não faz sentido.
    valor.acao === 'acompanhar' ? f.id !== atual?.id : true,
  )
  const funil = funis.find((f) => f.id === valor.funnelId) ?? null
  const etapas = [...(funil?.stages ?? [])].sort((a, b) => a.position - b.position)

  const opcoes: { acao: AcaoFunil; titulo: string; descricao: string; pode: boolean }[] = [
    {
      acao: 'manter',
      titulo: 'Manter funil e etapa',
      descricao: atual ? `Continua em "${atual.name}". Só muda quem atende.` : 'Só muda quem atende.',
      pode: true,
    },
    {
      acao: 'mover',
      titulo: 'Mover para outro funil',
      descricao: 'O lead sai do funil atual e passa para o escolhido.',
      pode: podeMover,
    },
    {
      acao: 'acompanhar',
      titulo: 'Acompanhar também em outro funil',
      descricao: 'Abre um card no outro funil; o atual fica como está (histórico e relatórios preservados).',
      pode: podeAcompanhar,
    },
  ]

  return (
    <fieldset class="space-y-2">
      <legend class="text-xs font-semibold text-fg-muted mb-1">Funil</legend>
      <div class="space-y-1.5" role="radiogroup">
        {opcoes.filter((o) => o.pode).map((o) => (
          <label
            key={o.acao}
            class={cn(
              'flex items-start gap-2 rounded-md border p-2 cursor-pointer',
              valor.acao === o.acao ? 'border-accent bg-accent/5' : 'border-border hover:bg-surface-2',
            )}
          >
            <input
              type="radio"
              name={`funil-acao-${leadId}`}
              class="mt-0.5"
              checked={valor.acao === o.acao}
              onChange={() => onChange({ acao: o.acao, funnelId: null, stageKey: null })}
            />
            <span>
              <span class="block text-sm text-fg">{o.titulo}</span>
              <span class="block text-2xs text-fg-muted">{o.descricao}</span>
            </span>
          </label>
        ))}
      </div>

      {valor.acao !== 'manter' && (
        <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 pt-1">
          <Select
            label="Funil de destino"
            value={valor.funnelId ?? ''}
            onChange={(e) => onChange({ ...valor, funnelId: Number((e.target as HTMLSelectElement).value) || null, stageKey: null })}
          >
            <option value="">— Escolher funil —</option>
            {funis.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}{f.id === atual?.id ? ' (atual)' : ''}{jaAcompanha.has(f.id) ? ' (já acompanha)' : ''}
              </option>
            ))}
          </Select>
          <Select
            label="Etapa"
            value={valor.stageKey ?? ''}
            disabled={!funil}
            onChange={(e) => onChange({ ...valor, stageKey: (e.target as HTMLSelectElement).value || null })}
          >
            <option value="">{funil ? 'Primeira etapa' : '—'}</option>
            {etapas.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </Select>
        </div>
      )}
    </fieldset>
  )
}
