// Seletor de audiência por leads — compartilhado entre Disparos em Massa
// (Cloud API) e Disparos Inteligentes (números próprios). Vivia dentro do
// BroadcastPage; foi extraído quando o segundo módulo passou a precisar do
// mesmo comportamento (filtros + seleção em massa + contagem de elegíveis).

import { useMemo, useState } from 'preact/hooks'
import { AlertTriangle, CheckSquare, Filter, Square } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
import { useLeads, useLeadSources, fetchLeadsForSelection, type LeadsListFilters, type LeadListItem } from '@/hooks/useLeads'
import { useFunnels, useStages } from '@/hooks/useFunnels'
import { useAgents } from '@/hooks/useRouting'

/** Teto da lista exibida na tela. Acima disso, use "Selecionar todos os filtrados". */
const LIST_LIMIT = 200
/** Teto da seleção em massa — o disparo manda os IDs num POST só. */
const SELECT_ALL_CAP = 5000

/** Só entra na audiência quem tem WhatsApp; o resto o backend descartaria como inválido. */
function isEligible(l: LeadListItem): boolean {
  return !!(l.whatsapp && l.whatsapp.trim())
}

export function Stat({ label, value, tone = 'neutral' }: { label: string; value: number | string; tone?: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }) {
  const color = { neutral: 'text-fg', info: 'text-info', warning: 'text-warning', success: 'text-success', danger: 'text-danger' }[tone]
  return <div class="rounded-md border border-border bg-surface-2 p-3"><div class={`text-lg font-semibold ${color}`}>{value}</div><div class="text-[0.6875rem] text-fg-muted">{label}</div></div>
}

export function AudienceCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: any; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick} class={`text-left rounded-md border p-3 transition-colors ${active ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2'}`}>
      <div class="flex items-center gap-2 text-fg">{icon}<span class="text-sm font-medium">{title}</span></div>
      <div class="text-xs text-fg-muted mt-0.5">{desc}</div>
    </button>
  )
}

export function LeadsAudiencePicker({ selected, onChange }: { selected: Set<number>; onChange: (s: Set<number>) => void }) {
  const [filters, setFilters] = useState<LeadsListFilters>({})
  const [selectingAll, setSelectingAll] = useState(false)

  const query = useMemo<LeadsListFilters>(() => ({ ...filters, limit: LIST_LIMIT }), [filters])
  const { data, isLoading } = useLeads(query)
  const { data: funnels } = useFunnels()
  const { data: stagesData } = useStages(filters.funnelId)
  const { data: agentsData } = useAgents()
  const { data: sourcesData } = useLeadSources()

  const leads = data?.leads ?? []
  const total = data?.total ?? 0
  const eligible = leads.filter(isEligible)
  const withoutPhone = leads.length - eligible.length
  const truncated = total > leads.length

  const assignedUserIds = filters.assignedUserIds ?? []
  const sources = filters.sources ?? []

  function patch(p: Partial<LeadsListFilters>) {
    // trocar de funil invalida a etapa escolhida (as chaves são por funil)
    setFilters((f) => ({ ...f, ...p, ...(p.funnelId !== undefined && p.funnelId !== f.funnelId ? { status: undefined } : {}) }))
  }

  function toggleAgent(id: number) {
    const next = assignedUserIds.includes(id) ? assignedUserIds.filter((x) => x !== id) : [...assignedUserIds, id]
    patch({ assignedUserIds: next.length ? next : undefined })
  }

  function toggleSource(key: string) {
    const next = sources.includes(key) ? sources.filter((x) => x !== key) : [...sources, key]
    patch({ sources: next.length ? next : undefined })
  }

  function toggleLead(id: number, on: boolean) {
    const next = new Set(selected)
    on ? next.add(id) : next.delete(id)
    onChange(next)
  }

  /** Seleciona todos os leads elegíveis do filtro atual — não só os visíveis. */
  async function selectAllFiltered() {
    setSelectingAll(true)
    try {
      const res = await fetchLeadsForSelection(filters, SELECT_ALL_CAP)
      const ids = res.leads.filter(isEligible).map((l) => l.id)
      onChange(new Set(ids))
      const ignored = res.leads.length - ids.length
      toast(
        `${ids.length} lead(s) selecionado(s)` +
        (ignored > 0 ? ` · ${ignored} sem WhatsApp ignorado(s)` : '') +
        (res.total > res.leads.length ? ` · limite de ${SELECT_ALL_CAP} atingido` : ''),
        'success',
      )
    } catch {
      toast('Falha ao selecionar os leads do filtro', 'danger')
    } finally {
      setSelectingAll(false)
    }
  }

  const activeFilters =
    (filters.funnelId !== undefined ? 1 : 0) + (filters.status ? 1 : 0) + (filters.outcome ? 1 : 0) +
    (filters.dateFrom || filters.dateTo ? 1 : 0) + assignedUserIds.length + sources.length +
    (filters.search ? 1 : 0)

  return (
    <div class="grid gap-4 items-start lg:grid-cols-[20rem_minmax(0,1fr)]">
      {/* ── Coluna esquerda: filtros ── */}
      <Card class="p-3 space-y-3 lg:sticky lg:top-4">
        <div class="flex items-center justify-between">
          <span class="inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">
            <Filter size={12} /> Filtros{activeFilters > 0 ? ` (${activeFilters})` : ''}
          </span>
          {activeFilters > 0 && (
            <button type="button" class="text-[0.6875rem] text-fg-muted hover:text-fg" onClick={() => setFilters({})}>
              Limpar filtros
            </button>
          )}
        </div>

        <Input label="Buscar" value={filters.search ?? ''} placeholder="Nome, empresa, WhatsApp…"
          onInput={(e) => patch({ search: (e.target as HTMLInputElement).value || undefined })} />

        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-1">
          <Select label="Funil" value={filters.funnelId !== undefined ? String(filters.funnelId) : ''}
            onChange={(e) => { const v = (e.target as HTMLSelectElement).value; patch({ funnelId: v ? Number(v) : undefined }) }}>
            <option value="">Todos</option>
            {funnels?.funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>

          <Select label="Etapa" value={filters.status ?? ''} disabled={filters.funnelId === undefined}
            onChange={(e) => patch({ status: (e.target as HTMLSelectElement).value || undefined })}
            {...(filters.funnelId === undefined ? { hint: 'Escolha um funil primeiro' } : {})}>
            <option value="">Todas</option>
            {(stagesData?.stages ?? []).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </Select>

          <Select label="Resultado" value={filters.outcome ?? ''}
            onChange={(e) => patch({ outcome: ((e.target as HTMLSelectElement).value || undefined) as LeadsListFilters['outcome'] })}>
            <option value="">Todos</option>
            <option value="open">Em andamento</option>
            <option value="won">Ganhos</option>
            <option value="lost">Perdidos</option>
            <option value="classified">Classificados (ganho ou perdido)</option>
          </Select>

          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Período (cadastro)</span>
            <div class="flex gap-1">
              <input type="date" class="flex-1 h-9 px-2 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent"
                value={filters.dateFrom ?? ''} onInput={(e) => patch({ dateFrom: (e.target as HTMLInputElement).value || undefined })} />
              <input type="date" class="flex-1 h-9 px-2 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent"
                value={filters.dateTo ?? ''} onInput={(e) => patch({ dateTo: (e.target as HTMLInputElement).value || undefined })} />
            </div>
          </div>
        </div>

        {/* Responsável (multi) */}
        <div class="pt-3 border-t border-border">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">Responsável</span>
            {assignedUserIds.length > 0 && (
              <button type="button" class="text-[0.6875rem] text-fg-muted hover:text-fg" onClick={() => patch({ assignedUserIds: undefined })}>Limpar</button>
            )}
          </div>
          <div class="flex flex-wrap gap-1.5">
            {(agentsData?.agents ?? []).filter((a) => a.active).map((a) => (
              <button key={a.id} type="button" onClick={() => toggleAgent(a.id)}
                class={cn('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
                  assignedUserIds.includes(a.id) ? 'bg-accent/15 text-accent border-accent' : 'bg-surface text-fg-muted border-border hover:text-fg')}>
                {a.name || a.email}
              </button>
            ))}
            {(agentsData?.agents ?? []).length === 0 && <span class="text-xs text-fg-subtle">Sem operadores cadastrados</span>}
          </div>
        </div>

        {/* Origem (multi) */}
        <div class="pt-3 border-t border-border">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">Origem</span>
            {sources.length > 0 && (
              <button type="button" class="text-[0.6875rem] text-fg-muted hover:text-fg" onClick={() => patch({ sources: undefined })}>Limpar</button>
            )}
          </div>
          <div class="flex flex-wrap gap-1.5">
            {(sourcesData?.sources ?? []).length === 0 ? (
              <span class="text-xs text-fg-subtle italic">Nenhuma origem encontrada</span>
            ) : (sourcesData?.sources ?? []).map((src) => {
              const key = src.value ?? ''
              return (
                <button key={key || 'null'} type="button" onClick={() => toggleSource(key)}
                  class={cn('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
                    sources.includes(key) ? 'bg-accent/15 text-accent border-accent' : 'bg-surface text-fg-muted border-border hover:text-fg')}>
                  {leadSourceLabel(src.value)}
                  <span class="text-fg-subtle text-[0.625rem]">{src.count}</span>
                </button>
              )
            })}
          </div>
        </div>
      </Card>

      {/* ── Coluna direita: KPIs, ações e lista ── */}
      <div class="space-y-3 min-w-0">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat label="Encontrados no filtro" value={total} />
          <Stat label={`Com WhatsApp${truncated ? ' (nesta página)' : ''}`} value={eligible.length} tone="success" />
          <Stat label={`Sem WhatsApp${truncated ? ' (nesta página)' : ''}`} value={withoutPhone} tone={withoutPhone > 0 ? 'warning' : 'neutral'} />
          <Stat label="Selecionados" value={selected.size} tone={selected.size > 0 ? 'info' : 'neutral'} />
        </div>

        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={selectAllFiltered} disabled={selectingAll || total === 0}>
              <CheckSquare size={13} /> {selectingAll ? 'Selecionando…' : `Selecionar todos os filtrados (${total})`}
            </Button>
            {selected.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onChange(new Set())}><Square size={13} /> Limpar seleção</Button>
            )}
          </div>
          <span class="text-xs text-fg-muted">
            {isLoading ? 'Carregando…' : `Exibindo ${leads.length} de ${total}`}
          </span>
        </div>

        {truncated && (
          <div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-fg">
            <AlertTriangle size={14} class="text-warning shrink-0 mt-0.5" />
            <span>
              A lista mostra os primeiros {leads.length} de {total}. Use <b>Selecionar todos os filtrados</b> para incluir o resto
              (até {SELECT_ALL_CAP.toLocaleString('pt-BR')}) ou refine os filtros.
            </span>
          </div>
        )}

        {/* ── Lista ── */}
        <div class="border border-border rounded-md max-h-[min(60vh,40rem)] overflow-auto divide-y divide-border">
          {isLoading ? (
            <div class="px-3 py-6 text-center text-sm text-fg-muted">Carregando leads…</div>
          ) : leads.length === 0 ? (
            <div class="px-3 py-6 text-center text-sm text-fg-muted">Nenhum lead encontrado com esses filtros.</div>
          ) : leads.map((l) => {
            const ok = isEligible(l)
            return (
              <label key={l.id} class={cn('flex items-center gap-2 px-3 py-2 text-sm', ok ? 'hover:bg-surface-2 cursor-pointer' : 'opacity-60 cursor-not-allowed')}>
                <input type="checkbox" checked={selected.has(l.id)} disabled={!ok}
                  onChange={(e) => toggleLead(l.id, (e.target as HTMLInputElement).checked)} />
                <span class="text-fg truncate">{l.nome || l.empresa || '(sem nome)'}</span>
                <span class={cn('text-xs shrink-0', ok ? 'text-fg-subtle' : 'text-warning')}>{l.whatsapp || 'sem WhatsApp'}</span>
                <span class="ml-auto flex items-center gap-1.5 shrink-0">
                  {l.outcome === 'won' && <Badge tone="success">Ganho</Badge>}
                  {l.outcome === 'lost' && <Badge tone="danger">Perdido</Badge>}
                  {l.statusLabel && <span class="text-[0.625rem] text-fg-subtle truncate max-w-[120px]">{l.statusLabel}</span>}
                </span>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}
