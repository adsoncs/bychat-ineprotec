import { useLocation } from 'wouter-preact'
import { ArrowLeft } from '@/components/ui/icon-set'
import { useWorkflow } from '@/hooks/useWorkflows'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { WorkflowCanvasView } from '@/components/WorkflowCanvasView'

interface Props {
  params: { id: string }
}

/**
 * POC standalone do builder visual de fluxos.
 *
 * Rota oculta (não está na sidebar). Acesse via /app/workflows/:id/canvas-poc.
 * O canvas em si é o componente reutilizável `WorkflowCanvasView`, que também
 * é usado dentro do `WorkflowStepsEditor` no toggle "Lista / Canvas".
 */
export function WorkflowCanvasPocPage({ params }: Props) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const { data, isLoading, error } = useWorkflow(Number.isFinite(id) ? id : null)

  return (
    <Page
      title={data ? `Canvas (POC) — ${data.name}` : 'Canvas (POC)'}
      description="Visualização experimental do fluxo em formato de canvas (read-only). Esta página é parte da POC do builder visual e não está no menu."
      actions={
        <Button variant="secondary" size="sm" onClick={() => navigate('/workflows')}>
          <ArrowLeft size={12} /> Voltar
        </Button>
      }
    >
      {isLoading && (
        <Card>
          <Skeleton class="h-[500px] w-full" />
        </Card>
      )}

      {error && (
        <Card>
          <p class="text-sm text-danger">Erro ao carregar fluxo: {(error as Error).message}</p>
        </Card>
      )}

      {data && (
        <WorkflowCanvasView steps={data.steps} height="70vh" />
      )}
    </Page>
  )
}
