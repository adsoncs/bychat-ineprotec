import { useLocation } from 'wouter-preact'
import { Scale, Plus, ChevronRight, Info } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEsquemas, ESCOPO_LABEL } from '@/hooks/useAcaAvaliacao'

// Esquemas de avaliação: o regimento da IES vira dado, não código.
// A resolução é em cascata — disciplina → matriz → curso → institucional.

export function AcademicoEsquemasPage() {
  const [, navigate] = useLocation()
  const { data, isLoading } = useEsquemas()
  const esquemas = (data?.esquemas ?? []).filter((e) => e.ativo)
  const temInstitucional = esquemas.some((e) => e.escopo === 'INSTITUCIONAL')

  return (
    <Page
      title="Esquemas de avaliação"
      description="Como cada curso calcula média, exame e aprovação — sem depender de customização."
      actions={
        <Button variant="primary" size="sm" onClick={() => navigate('/aca/esquemas/novo')}>
          <Plus size={14} /> Novo esquema
        </Button>
      }
    >
      <Card class="!p-3 bg-surface-2/50">
        <div class="flex items-start gap-2 text-xs text-fg-muted">
          <Info size={14} class="shrink-0 mt-0.5" />
          <span>
            Vale sempre o esquema mais específico: <strong class="text-fg">disciplina → matriz → curso → institucional</strong>.
            Sem nenhum esquema cadastrado, a apuração continua usando as regras gerais de Configurações.
          </span>
        </div>
      </Card>

      {isLoading ? (
        <Skeleton class="h-40 w-full" />
      ) : esquemas.length === 0 ? (
        <EmptyState
          title="Nenhum esquema cadastrado"
          description="Cadastre o esquema institucional com o regimento da IES: componentes de nota, fórmula da média, exame e frequência mínima."
        />
      ) : (
        <div class="space-y-2">
          {!temInstitucional && (
            <Card class="!p-3 border-warning/40 bg-warning/5 text-xs text-fg-muted">
              Não há esquema <strong class="text-fg">institucional</strong>. Disciplinas sem esquema próprio caem nas
              regras gerais antigas — cadastre o institucional para o regimento valer em toda a IES.
            </Card>
          )}
          {esquemas.map((e) => (
            <Card
              key={e.id}
              class="!p-0 overflow-hidden cursor-pointer hover:border-accent transition-colors"
              onClick={() => navigate(`/aca/esquemas/${e.id}`)}
            >
              <div class="px-4 py-3 flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <Scale size={15} class="text-fg-muted shrink-0" />
                    <span class="text-sm font-semibold text-fg">{e.nome}</span>
                    <Badge tone={e.escopo === 'INSTITUCIONAL' ? 'info' : 'neutral'}>{ESCOPO_LABEL[e.escopo]}</Badge>
                  </div>
                  <div class="text-xs text-fg-muted mt-1">
                    {e.componentes.length} componente(s): {e.componentes.map((c) => c.sigla).join(', ') || '—'}
                    {e.formulaMedia ? ` · fórmula ${e.formulaMedia}` : ' · média ponderada'}
                  </div>
                  <div class="text-[11px] text-fg-subtle mt-0.5">
                    Aprova com {e.mediaAprovacao} · frequência mínima {e.frequenciaMinima}%
                    {e.exameHabilitado ? ` · exame a partir de ${e.exameMinimo ?? '—'}` : ' · sem exame'}
                  </div>
                </div>
                <ChevronRight size={15} class="text-fg-subtle shrink-0 mt-1" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}
