import { useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { useFunnels } from '@/hooks/useFunnels'
import { useMyPermissions } from '@/hooks/usePermissions'
import { useUserStore } from '@/stores/user'
import {
  WIDGET_CATALOG,
  WIDGET_CATEGORIES,
  TYPE_LABELS,
  SIZE_LABELS,
  FUNNEL_AWARE_METRICS,
  GROUPABLE_METRICS,
  LIMITABLE_METRICS,
  type WidgetMetaWithCategory,
  type WidgetSize,
} from './WidgetCatalog'
import type { Widget, WidgetType } from '@/hooks/useWidgets'

interface AddWidgetModalProps {
  open: boolean
  onClose: () => void
  onAdd: (widget: Widget) => void
}

export function AddWidgetModal({ open, onClose, onAdd }: AddWidgetModalProps) {
  const [picked, setPicked] = useState<WidgetMetaWithCategory | null>(null)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<WidgetType>('kpi')
  const [size, setSize] = useState<WidgetSize>('md')
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day')
  const [limit, setLimit] = useState<number>(10)
  const [funnelId, setFunnelId] = useState<string>('')

  const { data: funnelsData } = useFunnels()
  const funnels = funnelsData?.funnels ?? []

  // Permissões: categorias com `requiresPermission` só aparecem para usuários
  // com canView naquele módulo. SUPERADMIN sempre vê tudo. Enquanto carrega,
  // fail-open (mostra todas — evita flash de UI vazia).
  const role = useUserStore((s) => s.user?.role ?? null)
  const { data: permsData, isLoading: loadingPerms } = useMyPermissions()
  function canSeeCategory(perm: string | undefined): boolean {
    if (!perm) return true
    if (role === 'SUPERADMIN') return true
    if (loadingPerms || !permsData) return true
    return !!permsData.permissions[perm]?.canView
  }
  const visibleCategories = WIDGET_CATEGORIES.filter((c) => canSeeCategory(c.requiresPermission))

  function selectMetric(m: WidgetMetaWithCategory) {
    setPicked(m)
    setTitle(m.title)
    setType(m.defaultType)
    setSize(m.defaultSize)
    setGroupBy('day')
    setLimit(10)
    setFunnelId('')
  }

  function close() {
    setPicked(null)
    setTitle('')
    onClose()
  }

  function confirm() {
    if (!picked) return
    const config: Record<string, unknown> = {}
    if (GROUPABLE_METRICS.includes(picked.metric)) config.groupBy = groupBy
    if (LIMITABLE_METRICS.includes(picked.metric)) config.limit = limit
    if (FUNNEL_AWARE_METRICS.includes(picked.metric) && funnelId) {
      config.funnelId = Number(funnelId)
    }
    onAdd({
      id: `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      metric: picked.metric,
      title: title.trim() || picked.title,
      size,
      ...(Object.keys(config).length > 0 ? { config } : {}),
    })
    close()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) close() }}
      title="Adicionar Widget"
      size="xl"
      footer={
        picked ? (
          <>
            <Button variant="secondary" size="sm" onClick={close}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={confirm}>Adicionar</Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={close}>Cancelar</Button>
        )
      }
    >
      <div class="space-y-4">
        <div class="text-xs text-fg-muted">Escolha uma métrica para o widget:</div>

        {visibleCategories.map((cat) => {
          const items = WIDGET_CATALOG.filter((m) => m.category === cat.id)
          if (items.length === 0) return null
          return (
            <section key={cat.id}>
              <div class="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
                <span class="text-xs font-semibold text-fg-muted uppercase tracking-wider">
                  {cat.label}
                </span>
                {cat.domainBadge && (
                  <span class="text-3xs px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium uppercase tracking-wider">
                    {cat.domainBadge}
                  </span>
                )}
              </div>
              <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((m) => (
                  <button
                    key={m.metric}
                    type="button"
                    onClick={() => selectMetric(m)}
                    class={`text-left rounded-md border p-2.5 transition-colors ${
                      picked?.metric === m.metric
                        ? 'border-accent bg-accent/10'
                        : 'border-border bg-surface hover:border-accent/60 hover:bg-surface-3'
                    }`}
                  >
                    <div class="flex items-start gap-2">
                      <span class="text-xl leading-none">{m.icon}</span>
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-fg">{m.title}</div>
                        <div class="text-2xs text-fg-muted leading-snug mt-0.5">{m.description}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )
        })}

        {picked && (
          <div class="border-t border-border pt-4 mt-4">
            <div class="text-sm font-medium text-fg mb-3">
              {picked.icon} {picked.title} — Configuração
            </div>
            <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Input
                label="Título do widget"
                value={title}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
              />
              <Select
                label="Visualização"
                value={type}
                onChange={(e) => setType((e.target as HTMLSelectElement).value as WidgetType)}
              >
                {picked.availableTypes.map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </Select>
              <Select
                label="Tamanho"
                value={size}
                onChange={(e) => setSize((e.target as HTMLSelectElement).value as WidgetSize)}
              >
                <option value="sm">{SIZE_LABELS.sm}</option>
                <option value="md">{SIZE_LABELS.md}</option>
                <option value="lg">{SIZE_LABELS.lg}</option>
                <option value="xl">{SIZE_LABELS.xl}</option>
              </Select>
              {GROUPABLE_METRICS.includes(picked.metric) && (
                <Select
                  label="Agrupar por"
                  value={groupBy}
                  onChange={(e) => setGroupBy((e.target as HTMLSelectElement).value as 'day' | 'week' | 'month')}
                >
                  <option value="day">Dia</option>
                  <option value="week">Semana</option>
                  <option value="month">Mês</option>
                </Select>
              )}
              {LIMITABLE_METRICS.includes(picked.metric) && (
                <Select
                  label="Limite de itens"
                  value={String(limit)}
                  onChange={(e) => setLimit(Number((e.target as HTMLSelectElement).value))}
                >
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="15">15</option>
                  <option value="25">25</option>
                </Select>
              )}
              {FUNNEL_AWARE_METRICS.includes(picked.metric) && (
                <Select
                  label="Funil específico"
                  value={funnelId}
                  onChange={(e) => setFunnelId((e.target as HTMLSelectElement).value)}
                >
                  <option value="">Todos os funis (usa filtro global)</option>
                  {funnels.filter((f) => f.active !== false).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}{f.isDefault ? ' (padrão)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
