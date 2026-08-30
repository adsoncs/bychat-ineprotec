import { useLocation } from 'wouter-preact'
import { ArrowLeft, Pause, Play, BarChart3 } from '@/components/ui/icon-set'
import {
  useSalesCadence,
  useUpdateSalesCadence,
} from '@/hooks/useSalesCadences'
import { Page } from '@/components/ui/Page'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { CadenceCanvasView } from '@/components/CadenceCanvasView'
import { toast } from '@/lib/toast'

interface Props {
  params: { id: string }
}

/**
 * Tela dedicada do builder visual de cadências. Layout idêntico em espírito
 * ao `WorkflowBuilderPage` — cabeçalho compacto + canvas no resto da
 * viewport.
 */
export function SalesCadenceBuilderPage({ params }: Props) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const { data, isLoading, error } = useSalesCadence(Number.isFinite(id) ? id : null)
  const update = useUpdateSalesCadence()

  const stepsCount = data?.steps?.length ?? 0
  const status = data?.status ?? 'draft'
  const isActive = status === 'active'

  function handleToggle() {
    if (!data) return
    const nextStatus = isActive ? 'paused' : 'active'
    update.mutate(
      { id: data.id, status: nextStatus },
      {
        onSuccess: () => toast(isActive ? 'Cadência pausada' : 'Cadência ativada', 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <div class="flex flex-col gap-4 h-[calc(100dvh-var(--app-topbar-height,72px)-2rem)]">
      <Page
        title={data?.name ?? 'Cadência'}
        description={
          data
            ? `${stepsCount} step${stepsCount !== 1 ? 's' : ''} · ${data.team?.name ?? 'sem equipe'}`
            : 'Carregando…'
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => navigate('/sales-cadences')}>
              <ArrowLeft size={12} /> Voltar
            </Button>
            {data && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/sales-cadences/${data.id}/dashboard`)}
                  title="Ver métricas e dashboard"
                >
                  <BarChart3 size={12} /> Métricas
                </Button>
                <Button
                  variant={isActive ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={handleToggle}
                  disabled={update.isPending}
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
            <Badge tone={
              status === 'active' ? 'success'
              : status === 'paused' ? 'warning'
              : status === 'archived' ? 'neutral'
              : 'info'
            }>
              {status === 'active' ? 'Ativa'
                : status === 'paused' ? 'Pausada'
                : status === 'archived' ? 'Arquivada'
                : 'Rascunho'}
            </Badge>
            {data.pauseOnReply && <Badge tone="info">Pausa ao responder</Badge>}
            {data.exitOnConversion && <Badge tone="info">Sai com conversão</Badge>}
            {data.triggerMode === 'filter' && <Badge tone="info">Auto-inscrição (filtro)</Badge>}
          </div>
        )}
      </Page>

      {isLoading && <Skeleton class="flex-1 w-full" />}

      {error && (
        <div class="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          Erro ao carregar cadência: {(error as Error).message}
        </div>
      )}

      {data && (
        <div class="flex-1 min-h-0">
          <CadenceCanvasView
            steps={data.steps}
            cadenceId={data.id}
            editable
            height="calc(100dvh - 260px)"
          />
        </div>
      )}
    </div>
  )
}
