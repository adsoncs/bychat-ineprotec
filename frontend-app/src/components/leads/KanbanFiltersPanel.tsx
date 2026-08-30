// Painel de filtros do Kanban — espelha os filtros da tela de Leads (FiltersPanel),
// mas tailored pro board: omite "Funil" (o Kanban tem seletor próprio) e o bloco
// "Data de entrada na etapa" (não se aplica a colunas). Ligado ao boardFilters.
import { useTags } from '@/hooks/useTags'
import { useAgents } from '@/hooks/useRouting'
import { useLeadSources } from '@/hooks/useLeads'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import type { KanbanBoardFilters } from '@/hooks/useKanban'

const dateInputCls =
  'flex-1 h-9 px-2 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent'
const chipCls = (active: boolean) =>
  cn(
    'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
    active ? 'bg-accent/15 text-accent border-accent' : 'bg-surface text-fg-muted border-border hover:text-fg',
  )

export function KanbanFiltersPanel({
  filters,
  onChange,
}: {
  filters: KanbanBoardFilters
  onChange: (p: Partial<KanbanBoardFilters>) => void
}) {
  const { data: tagsData } = useTags()
  const { data: agentsData } = useAgents()
  const { data: sourcesData } = useLeadSources()
  const tagIds = filters.tagIds ?? []
  const assignedUserIds = filters.assignedUserIds ?? []
  const sources = filters.sources ?? []
  const availableSources = sourcesData?.sources ?? []

  const toggleTag = (id: number) =>
    onChange({ tagIds: tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id] })
  const toggleAgent = (id: number) =>
    onChange({ assignedUserIds: assignedUserIds.includes(id) ? assignedUserIds.filter((x) => x !== id) : [...assignedUserIds, id] })
  const toggleSource = (key: string) =>
    onChange({ sources: sources.includes(key) ? sources.filter((x) => x !== key) : [...sources, key] })

  const hasAny =
    !!filters.outcome || !!filters.aiScoreLabel || !!filters.dateFrom || !!filters.dateTo ||
    tagIds.length > 0 || assignedUserIds.length > 0 || sources.length > 0

  return (
    <Card>
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <Select
          label="Resultado"
          value={filters.outcome ?? ''}
          onChange={(e) => onChange({ outcome: ((e.target as HTMLSelectElement).value || undefined) as KanbanBoardFilters['outcome'] })}
        >
          <option value="">Todos</option>
          <option value="open">Em andamento</option>
          <option value="won">Ganhos</option>
          <option value="lost">Perdidos</option>
          <option value="classified">Classificados (ganho ou perdido)</option>
        </Select>

        <Select
          label="Score IA"
          value={filters.aiScoreLabel ?? ''}
          onChange={(e) => onChange({ aiScoreLabel: ((e.target as HTMLSelectElement).value || undefined) as KanbanBoardFilters['aiScoreLabel'] })}
          hint="Faixa qualitativa do lead score por IA"
        >
          <option value="">Qualquer</option>
          <option value="hot">🔥 Quente (70-100)</option>
          <option value="warm">🌤 Morno (40-69)</option>
          <option value="cold">❄️ Frio (0-39)</option>
        </Select>

        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-fg-muted">Período (cadastro)</span>
          <div class="flex gap-1">
            <input type="date" class={dateInputCls} value={filters.dateFrom ?? ''}
              onInput={(e) => onChange({ dateFrom: (e.target as HTMLInputElement).value || undefined })} />
            <input type="date" class={dateInputCls} value={filters.dateTo ?? ''}
              onInput={(e) => onChange({ dateTo: (e.target as HTMLInputElement).value || undefined })} />
          </div>
        </div>
      </div>

      {/* Responsável (multi) */}
      <div class="mt-4 pt-4 border-t border-border">
        <div class="flex items-center justify-between mb-2">
          <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wider">Responsável</span>
          {assignedUserIds.length > 0 && (
            <button type="button" class="text-2xs text-fg-muted hover:text-fg" onClick={() => onChange({ assignedUserIds: undefined })}>Limpar</button>
          )}
        </div>
        <div class="flex flex-wrap gap-1.5">
          {(agentsData?.agents ?? []).filter((a) => a.active).map((a) => (
            <button key={a.id} type="button" onClick={() => toggleAgent(a.id)} class={chipCls(assignedUserIds.includes(a.id))}>
              {a.name || a.email}
            </button>
          ))}
          {(!agentsData || agentsData.agents.length === 0) && (
            <span class="text-xs text-fg-muted">Sem operadores cadastrados</span>
          )}
        </div>
      </div>

      {/* Origem (multi) */}
      <div class="mt-4 pt-4 border-t border-border">
        <div class="flex items-center justify-between mb-2">
          <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wider">Origem</span>
          {sources.length > 0 && (
            <button type="button" class="text-2xs text-fg-muted hover:text-fg" onClick={() => onChange({ sources: undefined })}>Limpar</button>
          )}
        </div>
        <div class="flex flex-wrap gap-1.5">
          {availableSources.length === 0 ? (
            <span class="text-xs text-fg-muted italic">Nenhuma origem encontrada</span>
          ) : availableSources.map((src) => {
            const key = src.value ?? ''
            return (
              <button key={key || 'null'} type="button" onClick={() => toggleSource(key)} class={chipCls(sources.includes(key))}>
                {leadSourceLabel(src.value)}
                <span class="text-fg-muted text-3xs">{src.count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Etiquetas */}
      {tagsData && tagsData.tags.length > 0 && (
        <div class="mt-4 pt-4 border-t border-border">
          <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wider block mb-2">Etiquetas</span>
          <div class="flex flex-wrap gap-1.5">
            {tagsData.tags.map((t) => (
              <button key={t.id} type="button" onClick={() => toggleTag(t.id)}
                class={cn('inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-medium transition-all',
                  tagIds.includes(t.id) ? 'ring-2 ring-accent' : 'opacity-60 hover:opacity-100')}
                style={{ background: `${t.color}22`, color: t.color }}>
                <span class="size-1.5 rounded-full" style={{ background: t.color }} />
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasAny && (
        <button type="button" class="mt-3 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
          onClick={() => onChange({ outcome: undefined, aiScoreLabel: undefined, dateFrom: undefined, dateTo: undefined, tagIds: undefined, assignedUserIds: undefined, sources: undefined })}>
          ✕ Limpar filtros
        </button>
      )}
    </Card>
  )
}
