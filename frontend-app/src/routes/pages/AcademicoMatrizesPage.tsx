import { useLocation } from 'wouter-preact'
import { Layers, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useMatrizes } from '@/hooks/useAcaCatalogo'
import { useAcaRefs } from '@/hooks/useAcaCatalogo'

// Matrizes com o ciclo de vida da Fase 1: rascunho é editável, ativa é
// imutável (alteração vira nova versão), suspensa não recebe ingressante.

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  RASCUNHO: 'neutral', ATIVA: 'success', SUSPENSA: 'warning', EXTINTA: 'danger',
}
const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: 'Rascunho', ATIVA: 'Ativa', SUSPENSA: 'Suspensa', EXTINTA: 'Extinta',
}

export function AcademicoMatrizesPage() {
  const [, navigate] = useLocation()
  const { data, isLoading } = useMatrizes()
  const refs = useAcaRefs()
  const matrizes = data?.matrizes ?? []
  const cursoNome = (id: number) => (refs.data?.courses ?? []).find((c) => c.id === id)?.nome ?? `Curso #${id}`

  return (
    <Page
      title="Matrizes curriculares"
      description="A grade que define o que o aluno precisa cumprir. Matriz com aluno vinculado é imutável — alteração vira nova versão."
    >
      {isLoading ? (
        <Skeleton class="h-40 w-full" />
      ) : matrizes.length === 0 ? (
        <EmptyState title="Nenhuma matriz cadastrada" description="Crie a matriz do curso em Currículo para começar." />
      ) : (
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {matrizes.map((m) => {
            const status = m.status ?? 'RASCUNHO'
            const chTotal = (m.componentes ?? []).reduce((s, c) => s + (c.disciplina?.cargaHoraria ?? 0), 0)
            return (
              <Card
                key={m.id}
                class="!p-0 overflow-hidden cursor-pointer hover:border-accent transition-colors"
                onClick={() => navigate(`/aca/matrizes/${m.id}`)}
              >
                <div class="px-4 py-3 flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <Layers size={15} class="text-fg-muted shrink-0" />
                      <span class="text-sm font-semibold text-fg">Versão {m.versao}</span>
                      <Badge tone={STATUS_TONE[status]!}>{STATUS_LABEL[status]}</Badge>
                    </div>
                    <div class="text-xs text-fg-muted mt-1 truncate">{m.nome ?? cursoNome(m.courseId)}</div>
                    <div class="text-[11px] text-fg-subtle mt-1">
                      {m._count?.componentes ?? m.componentes?.length ?? 0} componentes · {chTotal}h no catálogo
                      {m.publicadaEm ? ` · publicada em ${new Date(m.publicadaEm).toLocaleDateString('pt-BR')}` : ''}
                    </div>
                  </div>
                  <div class="flex items-center gap-1 shrink-0 text-fg-subtle">
                    {status === 'ATIVA'
                      ? <CheckCircle2 size={15} class="text-success" />
                      : status === 'RASCUNHO'
                        ? <AlertCircle size={15} class="text-fg-subtle" />
                        : null}
                    <ChevronRight size={15} />
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </Page>
  )
}
