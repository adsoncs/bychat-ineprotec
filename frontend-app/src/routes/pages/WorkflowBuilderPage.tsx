import { useLocation } from 'wouter-preact'
import { ArrowLeft, Pause, Play, ExternalLink } from 'lucide-preact'
import {
  useWorkflow,
  useToggleWorkflow,
  useDuplicateWorkflow,
} from '@/hooks/useWorkflows'
import { Page } from '@/components/ui/Page'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { WorkflowStepsBody } from '@/components/WorkflowStepsEditor'
import { toast } from '@/lib/toast'

interface Props {
  params: { id: string }
}

/**
 * Tela dedicada do builder visual. Substitui o modal "Editar passos".
 *
 * Layout: cabeçalho compacto (nome, status, ações: voltar/pausar/duplicar) +
 * body do editor ocupando o restante da viewport. O canvas usa altura
 * calculada pra não criar scroll na página, deixando a navegação interna do
 * ReactFlow (pan/zoom) cuidar do conteúdo.
 */
export function WorkflowBuilderPage({ params }: Props) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const { data, isLoading, error } = useWorkflow(Number.isFinite(id) ? id : null)
  const toggle = useToggleWorkflow()
  const duplicate = useDuplicateWorkflow()

  const stepsCount = data?.steps?.length ?? 0
  const isActive = data?.active ?? false

  function handleToggle() {
    if (!data) return
    toggle.mutate(data.id, {
      onSuccess: () => toast(isActive ? 'Fluxo pausado' : 'Fluxo ativado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleDuplicate() {
    if (!data) return
    duplicate.mutate(data.id, {
      onSuccess: (created) => {
        toast('Fluxo duplicado', 'success')
        navigate(`/workflows/${created.id}/builder`)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="flex flex-col gap-4 h-[calc(100dvh-var(--app-topbar-height,72px)-2rem)]">
      <Page
        title={data?.name ?? 'Fluxo'}
        description={
          data
            ? `${stepsCount} passo${stepsCount !== 1 ? 's' : ''} · gatilho: ${data.triggerEvent}`
            : 'Carregando…'
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => navigate('/workflows')}>
              <ArrowLeft size={12} /> Voltar
            </Button>
            {data && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDuplicate}
                  disabled={duplicate.isPending}
                  title="Cria uma cópia do fluxo (com todos os passos)"
                >
                  <ExternalLink size={12} /> Duplicar
                </Button>
                <Button
                  variant={isActive ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={handleToggle}
                  disabled={toggle.isPending}
                >
                  {isActive ? <Pause size={12} /> : <Play size={12} />}
                  {isActive ? 'Pausar' : 'Ativar'}
                </Button>
              </>
            )}
          </>
        }
      >
        {data && (
          <div class="flex items-center gap-2 -mt-3 mb-1">
            <Badge tone={isActive ? 'success' : 'neutral'}>
              {isActive ? 'Ativo' : 'Pausado'}
            </Badge>
            {data.pauseOnReply && <Badge tone="info">Pausa ao responder</Badge>}
            {data.reentryPolicy && data.reentryPolicy !== 'none' && (
              <Badge tone="info">Re-entrada: {data.reentryPolicy}</Badge>
            )}
            {data.goalEvent && <Badge tone="info">Meta: {data.goalEvent}</Badge>}
          </div>
        )}
      </Page>

      {isLoading && <Skeleton class="flex-1 w-full" />}

      {error && (
        <div class="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          Erro ao carregar fluxo: {(error as Error).message}
        </div>
      )}

      {data && (
        <div class="flex-1 min-h-0">
          <WorkflowStepsBody
            workflowId={data.id}
            defaultView="canvas"
            canvasHeight="calc(100dvh - 260px)"
          />
        </div>
      )}
    </div>
  )
}
