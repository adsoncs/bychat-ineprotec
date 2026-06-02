import { useEffect, useMemo, useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useFunnels, useFunnel } from '@/hooks/useFunnels'
import { useQualifyLead, useBulkQualifyLeads, type BulkQualifyResult } from '@/hooks/useLeads'
import { toast } from '@/lib/toast'
import { Target, Users } from 'lucide-preact'

type Mode =
  | { kind: 'single'; leadId: number; leadName?: string | null | undefined }
  | { kind: 'bulk'; leadIds: number[] }

interface Props {
  open: boolean
  mode: Mode | null
  onOpenChange: (open: boolean) => void
  onDone?: (result: { qualified: number; alreadyQualified?: number; failed?: number }) => void
}

export function PromoteLeadDialog({ open, mode, onOpenChange, onDone }: Props) {
  const funnelsQ = useFunnels()
  const [funnelId, setFunnelId] = useState<number | null>(null)
  const [stageKey, setStageKey] = useState<string | null>(null)
  const funnelDetailQ = useFunnel(funnelId)
  const qualify = useQualifyLead()
  const bulkQualify = useBulkQualifyLeads()

  // Pré-seleciona o funil padrão quando abre.
  useEffect(() => {
    if (!open) return
    const list = funnelsQ.data?.funnels ?? []
    if (list.length === 0) return
    if (funnelId && list.some((f) => f.id === funnelId)) return
    const def = list.find((f) => f.isDefault && f.active) ?? list.find((f) => f.active) ?? list[0]
    setFunnelId(def?.id ?? null)
  }, [open, funnelsQ.data, funnelId])

  // Pré-seleciona a primeira etapa do funil escolhido.
  useEffect(() => {
    if (!funnelDetailQ.data) return
    const stages = funnelDetailQ.data.stages.filter((s) => s.active)
    if (stages.length === 0) { setStageKey(null); return }
    if (stageKey && stages.some((s) => s.key === stageKey)) return
    setStageKey(stages[0]?.key ?? null)
  }, [funnelDetailQ.data, stageKey])

  // Reset quando fecha.
  useEffect(() => {
    if (!open) {
      setStageKey(null)
    }
  }, [open])

  const stages = useMemo(() => (funnelDetailQ.data?.stages ?? []).filter((s) => s.active), [funnelDetailQ.data])
  const noFunnel = funnelId === null

  const submitting = qualify.isPending || bulkQualify.isPending
  const count = mode?.kind === 'bulk' ? mode.leadIds.length : 1

  async function handleSubmit() {
    if (!mode) return
    const targeting = !noFunnel && stageKey ? { funnelId: funnelId!, stageKey } : {}

    if (mode.kind === 'single') {
      try {
        const r = await qualify.mutateAsync({ id: mode.leadId, ...targeting })
        if (r.qualified) {
          toast(targeting.funnelId ? 'Promovido a Lead e adicionado ao funil' : 'Promovido a Lead', 'success')
          onDone?.({ qualified: 1 })
        } else {
          toast('Lead já estava qualificado', 'info')
        }
        onOpenChange(false)
      } catch (e) {
        toast((e as Error).message, 'danger')
      }
      return
    }

    try {
      const r: BulkQualifyResult = await bulkQualify.mutateAsync({
        leadIds: mode.leadIds,
        ...targeting,
      })
      const parts: string[] = []
      if (r.qualified > 0) parts.push(`${r.qualified} promovido${r.qualified > 1 ? 's' : ''}`)
      if (r.alreadyQualified > 0) parts.push(`${r.alreadyQualified} já estava${r.alreadyQualified > 1 ? 'm' : ''} qualificado${r.alreadyQualified > 1 ? 's' : ''}`)
      if (r.failed > 0) parts.push(`${r.failed} falha${r.failed > 1 ? 's' : ''}`)
      toast(parts.join(' · ') || 'Nenhum lead alterado', r.failed > 0 ? 'warning' : 'success')
      onDone?.({ qualified: r.qualified, alreadyQualified: r.alreadyQualified, failed: r.failed })
      onOpenChange(false)
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  const title = mode?.kind === 'bulk'
    ? `Promover ${mode.leadIds.length} conversa${mode.leadIds.length > 1 ? 's' : ''} a Lead`
    : 'Promover a Lead'
  const description = mode?.kind === 'single' && mode.leadName
    ? `Confirma promover "${mode.leadName}"?`
    : 'Marca o registro como Lead qualificado e (opcional) adiciona a um funil.'

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting || (!noFunnel && !stageKey)}>
            {mode?.kind === 'bulk' ? <><Users size={14} /> Promover {count}</> : <><Target size={14} /> Promover</>}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <div class="rounded-md border border-border bg-surface-3/40 p-3 text-xs text-fg-muted">
          <strong class="text-fg">O que acontece:</strong>
          <ul class="mt-1 list-disc pl-4 space-y-0.5">
            <li>O registro deixa de ser apenas "conversa" e passa a contar em métricas, kanban e relatórios.</li>
            <li>Se você escolher um funil, o lead já entra na etapa selecionada.</li>
            <li>Se preferir só qualificar (sem colocar em funil), escolha "Sem funil" abaixo.</li>
          </ul>
        </div>

        <div>
          <label class="block text-xs font-medium text-fg mb-1">Funil</label>
          {funnelsQ.isLoading ? (
            <Skeleton class="h-9 w-full" />
          ) : (
            <select
              class="w-full h-9 rounded-md border border-border bg-surface-2 px-2 text-sm"
              value={noFunnel ? '__none__' : String(funnelId)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setFunnelId(v === '__none__' ? null : parseInt(v, 10))
                setStageKey(null)
              }}
              disabled={submitting}
            >
              <option value="__none__">Sem funil (apenas qualificar)</option>
              {(funnelsQ.data?.funnels ?? []).filter((f) => f.active).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}{f.isDefault ? ' (padrão)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {!noFunnel && (
          <div>
            <label class="block text-xs font-medium text-fg mb-1">Etapa inicial</label>
            {funnelDetailQ.isLoading ? (
              <Skeleton class="h-9 w-full" />
            ) : stages.length === 0 ? (
              <p class="text-xs text-warning">Este funil não tem etapas ativas. Crie ao menos uma em Configurações &gt; Funis.</p>
            ) : (
              <div class="flex flex-wrap gap-1.5">
                {stages.map((s) => {
                  const active = s.key === stageKey
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setStageKey(s.key)}
                      disabled={submitting}
                      class={`px-2.5 h-7 rounded text-xs border inline-flex items-center gap-1.5 transition-colors ${
                        active
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-surface-2 text-fg-muted hover:bg-surface-3 hover:text-fg'
                      }`}
                    >
                      {s.color && <span class="size-2 rounded-full" style={{ background: s.color }} />}
                      {s.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {mode?.kind === 'bulk' && (
          <p class="text-xs text-fg-muted">
            Conversas selecionadas: <strong class="text-fg">{mode.leadIds.length}</strong>. Já qualificadas serão ignoradas.
          </p>
        )}
      </div>
    </Modal>
  )
}
