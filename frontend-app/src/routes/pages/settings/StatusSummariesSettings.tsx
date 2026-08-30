import { useMemo, useState } from 'preact/hooks'
import { Plus, Pencil, Power, ListChecks, ArrowRight, Trophy, XCircle } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useFunnels, useFunnel } from '@/hooks/useFunnels'
import { useLossReasons } from '@/hooks/useLeadOutcome'
import {
  useStatusSummaries,
  useCreateStatusSummary,
  useUpdateStatusSummary,
  useActivityTemplates,
  useCreateActivityTemplate,
  useUpdateActivityTemplate,
  useSetSummaryActivities,
  type StatusSummary,
  type ActivityTemplate,
  type DueMode,
  type AssigneeMode,
} from '@/hooks/useStatusSummaries'

const SELECT_CLASS =
  'w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent'

const DUE_MODE_LABELS: Record<DueMode, string> = {
  immediate: 'Imediato',
  hours: 'Em N horas',
  days: 'Em N dias corridos',
  business_days: 'Em N dias úteis',
  lead_defined: 'Data informada pelo operador',
}

const ASSIGNEE_LABELS: Record<AssigneeMode, string> = {
  lead_owner: 'Responsável pelo lead',
  team: 'Fila do setor',
  user: 'Pessoa fixa',
  round_robin: 'Rodízio no setor',
  creator: 'Quem aplicou o resumo',
}

const ACTIVITY_TYPES = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'call', label: 'Ligação' },
  { value: 'task', label: 'Tarefa / sistema' },
  { value: 'meeting', label: 'Reunião' },
]

export function StatusSummariesSettings() {
  const [tab, setTab] = useState<'summaries' | 'templates'>('summaries')

  return (
    <div class="space-y-4">
      <div class="flex gap-2">
        <Button variant={tab === 'summaries' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('summaries')}>
          Resumos
        </Button>
        <Button variant={tab === 'templates' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('templates')}>
          Atividades padrão
        </Button>
      </div>

      {tab === 'summaries' ? <SummariesTab /> : <TemplatesTab />}
    </div>
  )
}

// ─── Aba: Resumos ──────────────────────────────────────────

function SummariesTab() {
  const { data: funnelsResp } = useFunnels()
  const funnels = funnelsResp?.funnels ?? []
  const [funnelFilter, setFunnelFilter] = useState<number | 'all'>('all')
  const { data, isLoading } = useStatusSummaries({ includeInactive: true })
  const upd = useUpdateStatusSummary()
  const [editing, setEditing] = useState<StatusSummary | null>(null)
  const [creating, setCreating] = useState(false)
  const [linking, setLinking] = useState<StatusSummary | null>(null)

  const rows = useMemo(() => {
    const all = data?.data ?? []
    if (funnelFilter === 'all') return all
    return all.filter((s) => s.funnelId === funnelFilter || s.funnelId === null)
  }, [data, funnelFilter])

  function toggleActive(s: StatusSummary) {
    upd.mutate({ id: s.id, active: !s.active }, {
      onSuccess: () => toast(s.active ? 'Resumo desativado' : 'Resumo ativado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-fg">Resumos</div>
            <p class="text-xs text-fg-muted mt-0.5">
              O operador escolhe o resumo que descreve a situação e o sistema move a etapa,
              gera as atividades com prazo e responsável, e marca ganho/perdido. Catálogo por funil —
              um resumo sem funil vale para todos.
            </p>
          </div>
          <div class="flex gap-2 shrink-0">
            <select
              value={funnelFilter === 'all' ? 'all' : String(funnelFilter)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setFunnelFilter(v === 'all' ? 'all' : Number(v))
              }}
              class={SELECT_CLASS}
            >
              <option value="all">Todos os funis</option>
              {funnels.map((f) => (
                <option key={f.id} value={String(f.id)}>{f.name}</option>
              ))}
            </select>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> Novo resumo
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Skeleton class="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p class="text-sm text-fg-muted text-center py-6">
            Nenhum resumo cadastrado. Comece pelos que o time já usa no dia a dia.
          </p>
        ) : (
          <ul class="divide-y divide-border">
            {rows.map((s) => (
              <li key={s.id} class="py-2.5 flex items-center gap-3 flex-wrap">
                <span class="size-3 rounded-full shrink-0" style={{ background: s.color || '#94a3b8' }} />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <code class="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-2 text-fg">{s.code}</code>
                    <span class={s.active ? 'text-sm font-medium text-fg truncate' : 'text-sm font-medium text-fg-muted line-through truncate'}>
                      {s.name}
                    </span>
                    {s.sector && <Badge tone="neutral">{s.sector}</Badge>}
                    {!s.active && <Badge tone="neutral">Inativo</Badge>}
                  </div>
                  <div class="flex items-center gap-2 mt-1 flex-wrap text-xs text-fg-muted">
                    {s.targetStageKey && (
                      <span class="inline-flex items-center gap-1">
                        <ArrowRight size={11} /> {s.targetStageKey}
                      </span>
                    )}
                    {s.setOutcome === 'won' && (
                      <span class="inline-flex items-center gap-1 text-success"><Trophy size={11} /> Ganho</span>
                    )}
                    {s.setOutcome === 'lost' && (
                      <span class="inline-flex items-center gap-1 text-danger"><XCircle size={11} /> Perdido</span>
                    )}
                    {s.activities.length > 0 && (
                      <span class="inline-flex items-center gap-1">
                        <ListChecks size={11} /> {s.activities.length} atividade{s.activities.length > 1 ? 's' : ''}
                      </span>
                    )}
                    {s.nextSummaryCode && (
                      <span>escada → {s.nextSummaryCode}{s.autoAdvanceOnDue ? ' (automática)' : ''}</span>
                    )}
                  </div>
                </div>
                <div class="flex gap-1.5 shrink-0 flex-wrap">
                  <Button variant="secondary" size="sm" onClick={() => setLinking(s)} title="Atividades que este resumo gera">
                    <ListChecks size={12} /> Atividades
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(s)} title="Editar">
                    <Pencil size={12} /> Editar
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => toggleActive(s)} title={s.active ? 'Desativar' : 'Ativar'}>
                    <Power size={12} /> {s.active ? 'Desativar' : 'Ativar'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(creating || editing) && (
        <SummaryModal
          summary={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}
      {linking && <LinkActivitiesModal summary={linking} onClose={() => setLinking(null)} />}
    </div>
  )
}

function SummaryModal({ summary, onClose }: { summary: StatusSummary | null; onClose: () => void }) {
  const isEdit = summary != null
  const { data: funnelsResp } = useFunnels()
  const funnels = funnelsResp?.funnels ?? []
  const { data: reasons } = useLossReasons()
  const { data: allSummaries } = useStatusSummaries({ includeInactive: true })
  const create = useCreateStatusSummary()
  const upd = useUpdateStatusSummary()

  const [code, setCode] = useState(summary?.code ?? '')
  const [name, setName] = useState(summary?.name ?? '')
  const [helpText, setHelpText] = useState(summary?.helpText ?? '')
  const [sector, setSector] = useState(summary?.sector ?? '')
  const [funnelId, setFunnelId] = useState<number | ''>(summary?.funnelId ?? '')
  const [targetStageKey, setTargetStageKey] = useState(summary?.targetStageKey ?? '')
  const [targetFunnelId, setTargetFunnelId] = useState<number | ''>(summary?.targetFunnelId ?? '')
  const [setOutcome, setSetOutcome] = useState(summary?.setOutcome ?? '')
  const [requireLossReason, setRequireLossReason] = useState(summary?.requireLossReason ?? false)
  const [defaultLossReasonId, setDefaultLossReasonId] = useState<number | ''>(summary?.defaultLossReasonId ?? '')
  const [temperature, setTemperature] = useState(summary?.temperature ?? '')
  const [closeOpenActivities, setCloseOpenActivities] = useState(summary?.closeOpenActivities ?? false)
  const [nextSummaryCode, setNextSummaryCode] = useState(summary?.nextSummaryCode ?? '')
  const [autoAdvanceOnDue, setAutoAdvanceOnDue] = useState(summary?.autoAdvanceOnDue ?? false)
  const [color, setColor] = useState(summary?.color ?? '')

  // Etapas do funil escolhido — o destino é escolhido numa lista, não digitado.
  // A listagem de funis não traz stages; busca o detalhe do funil-alvo (o
  // explícito, ou o do próprio catálogo quando o resumo não troca de funil).
  const stagesFunnelId = targetFunnelId !== '' ? targetFunnelId : (funnelId !== '' ? funnelId : null)
  const { data: stagesFunnel } = useFunnel(stagesFunnelId)
  const stages = useMemo(() => stagesFunnel?.stages ?? [], [stagesFunnel])

  const busy = create.isPending || upd.isPending

  async function submit(e: Event) {
    e.preventDefault()
    const payload = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      helpText: helpText.trim() || null,
      sector: sector.trim() || null,
      funnelId: funnelId === '' ? null : funnelId,
      targetStageKey: targetStageKey || null,
      targetFunnelId: targetFunnelId === '' ? null : targetFunnelId,
      setOutcome: (setOutcome || null) as 'won' | 'lost' | null,
      requireLossReason,
      defaultLossReasonId: defaultLossReasonId === '' ? null : defaultLossReasonId,
      temperature: (temperature || null) as 'quente' | 'morno' | 'frio' | null,
      closeOpenActivities,
      nextSummaryCode: nextSummaryCode.trim().toUpperCase() || null,
      autoAdvanceOnDue,
      color: color.trim() || null,
    }
    try {
      if (isEdit) await upd.mutateAsync({ id: summary!.id, ...payload })
      else await create.mutateAsync(payload)
      toast(isEdit ? 'Resumo atualizado' : 'Resumo criado', 'success')
      onClose()
    } catch (err) {
      toast((err as Error).message, 'danger')
    }
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={isEdit ? `Editar ${summary!.code}` : 'Novo resumo'}>
      <form onSubmit={submit} class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Código</label>
            <Input value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} placeholder="AT-200" required maxLength={20} />
          </div>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Setor</label>
            <Input value={sector} onInput={(e) => setSector((e.target as HTMLInputElement).value)} placeholder="AT" maxLength={10} />
          </div>
        </div>

        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">Nome</label>
          <Input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="SOLICITOU MATRICULA" required />
        </div>

        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">
            Quando usar <span class="font-normal text-fg-muted">(vira dica para o operador)</span>
          </label>
          <textarea
            value={helpText}
            onInput={(e) => setHelpText((e.target as HTMLTextAreaElement).value)}
            rows={2}
            class="w-full px-3 py-2 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Funil do catálogo</label>
            <select value={funnelId === '' ? '' : String(funnelId)} onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              setFunnelId(v === '' ? '' : Number(v))
            }} class={SELECT_CLASS}>
              <option value="">Todos (global)</option>
              {funnels.map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Temperatura</label>
            <select value={temperature} onChange={(e) => setTemperature((e.target as HTMLSelectElement).value)} class={SELECT_CLASS}>
              <option value="">—</option>
              <option value="quente">Quente</option>
              <option value="morno">Morno</option>
              <option value="frio">Frio</option>
            </select>
          </div>
        </div>

        <div class="pt-2 border-t border-border">
          <div class="text-xs font-semibold text-fg mb-2">O que acontece ao aplicar</div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs font-medium text-fg-muted block mb-1">Mover para o funil</label>
              <select value={targetFunnelId === '' ? '' : String(targetFunnelId)} onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setTargetFunnelId(v === '' ? '' : Number(v))
                setTargetStageKey('')
              }} class={SELECT_CLASS}>
                <option value="">Mantém o funil atual</option>
                {funnels.map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <label class="text-xs font-medium text-fg-muted block mb-1">Mover para a etapa</label>
              <select value={targetStageKey} onChange={(e) => setTargetStageKey((e.target as HTMLSelectElement).value)} class={SELECT_CLASS}>
                <option value="">Não move</option>
                {stages.map((st) => (
                  <option key={st.key} value={st.key}>{st.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label class="text-xs font-medium text-fg-muted block mb-1">Classificar como</label>
              <select value={setOutcome} onChange={(e) => setSetOutcome((e.target as HTMLSelectElement).value)} class={SELECT_CLASS}>
                <option value="">Não classifica</option>
                <option value="won">Ganho</option>
                <option value="lost">Perdido</option>
              </select>
            </div>
            <div>
              <label class="text-xs font-medium text-fg-muted block mb-1">Objeção padrão</label>
              <select value={defaultLossReasonId === '' ? '' : String(defaultLossReasonId)} onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setDefaultLossReasonId(v === '' ? '' : Number(v))
              }} class={SELECT_CLASS}>
                <option value="">—</option>
                {(reasons?.data ?? []).map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
              </select>
            </div>
          </div>

          <label class="flex items-center gap-2 mt-3 text-sm text-fg">
            <input type="checkbox" checked={requireLossReason} onChange={(e) => setRequireLossReason((e.target as HTMLInputElement).checked)} />
            Exigir que o operador aponte a objeção
          </label>
          <label class="flex items-center gap-2 mt-2 text-sm text-fg">
            <input type="checkbox" checked={closeOpenActivities} onChange={(e) => setCloseOpenActivities((e.target as HTMLInputElement).checked)} />
            Concluir as atividades pendentes antes de gerar as novas
          </label>
        </div>

        <div class="pt-2 border-t border-border">
          <div class="text-xs font-semibold text-fg mb-2">Escada de tentativas</div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs font-medium text-fg-muted block mb-1">Próximo resumo</label>
              <select value={nextSummaryCode} onChange={(e) => setNextSummaryCode((e.target as HTMLSelectElement).value)} class={SELECT_CLASS}>
                <option value="">—</option>
                {(allSummaries?.data ?? [])
                  .filter((s) => s.code !== code.trim().toUpperCase())
                  .map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div class="flex items-end">
              <label class="flex items-center gap-2 text-sm text-fg pb-2">
                <input type="checkbox" checked={autoAdvanceOnDue} onChange={(e) => setAutoAdvanceOnDue((e.target as HTMLInputElement).checked)} />
                Avançar sozinho quando a atividade vencer sem resposta
              </label>
            </div>
          </div>
        </div>

        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">Cor</label>
          <Input value={color} onInput={(e) => setColor((e.target as HTMLInputElement).value)} placeholder="#1a73e8" maxLength={20} />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function LinkActivitiesModal({ summary, onClose }: { summary: StatusSummary; onClose: () => void }) {
  const { data: templates } = useActivityTemplates()
  const setActivities = useSetSummaryActivities()
  const [selected, setSelected] = useState<Array<{
    activityTemplateId: number
    dueOverrideMode: DueMode | ''
    dueOverrideValue: number | ''
    titleOverride: string
  }>>(
    summary.activities.map((a) => ({
      activityTemplateId: a.activityTemplateId,
      dueOverrideMode: (a.dueOverrideMode ?? '') as DueMode | '',
      dueOverrideValue: a.dueOverrideValue ?? '',
      titleOverride: a.titleOverride ?? '',
    })),
  )

  function toggle(tplId: number) {
    setSelected((prev) =>
      prev.some((s) => s.activityTemplateId === tplId)
        ? prev.filter((s) => s.activityTemplateId !== tplId)
        : [...prev, { activityTemplateId: tplId, dueOverrideMode: '', dueOverrideValue: '', titleOverride: '' }],
    )
  }

  function patch(tplId: number, field: string, value: unknown) {
    setSelected((prev) => prev.map((s) => (s.activityTemplateId === tplId ? { ...s, [field]: value } : s)))
  }

  async function save() {
    try {
      await setActivities.mutateAsync({
        id: summary.id,
        activities: selected.map((s, i) => ({
          activityTemplateId: s.activityTemplateId,
          dueOverrideMode: s.dueOverrideMode || null,
          dueOverrideValue: s.dueOverrideValue === '' ? null : Number(s.dueOverrideValue),
          titleOverride: s.titleOverride.trim() || null,
          order: i,
        })),
      })
      toast('Atividades do resumo salvas', 'success')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={`Atividades geradas por ${summary.code}`}>
      <p class="text-xs text-fg-muted mb-3">
        Marque as atividades que nascem quando este resumo é aplicado. O prazo vem do template —
        sobrescreva só quando a mesma atividade for cobrada em ritmo diferente aqui.
      </p>
      <div class="space-y-2 max-h-96 overflow-y-auto">
        {(templates?.data ?? []).map((t) => {
          const sel = selected.find((s) => s.activityTemplateId === t.id)
          return (
            <div key={t.id} class="rounded-md border border-border p-2.5">
              <label class="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={!!sel} onChange={() => toggle(t.id)} />
                <code class="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-2">{t.code}</code>
                <span class="truncate">{t.name}</span>
                <span class="text-xs text-fg-muted ml-auto shrink-0">{DUE_MODE_LABELS[t.dueMode]} {t.dueValue || ''}</span>
              </label>
              {sel && (
                <div class="grid grid-cols-3 gap-2 mt-2 pl-6">
                  <select
                    value={sel.dueOverrideMode}
                    onChange={(e) => patch(t.id, 'dueOverrideMode', (e.target as HTMLSelectElement).value)}
                    class={SELECT_CLASS}
                  >
                    <option value="">Prazo do template</option>
                    {(Object.keys(DUE_MODE_LABELS) as DueMode[]).map((m) => (
                      <option key={m} value={m}>{DUE_MODE_LABELS[m]}</option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    value={String(sel.dueOverrideValue)}
                    onInput={(e) => patch(t.id, 'dueOverrideValue', (e.target as HTMLInputElement).value)}
                    placeholder="N"
                  />
                  <Input
                    value={sel.titleOverride}
                    onInput={(e) => patch(t.id, 'titleOverride', (e.target as HTMLInputElement).value)}
                    placeholder="Ex.: Cobrança – Tentativa 02"
                  />
                </div>
              )}
            </div>
          )
        })}
        {(templates?.data ?? []).length === 0 && (
          <p class="text-sm text-fg-muted text-center py-4">
            Cadastre atividades padrão na outra aba primeiro.
          </p>
        )}
      </div>
      <div class="flex justify-end gap-2 pt-3">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={save} disabled={setActivities.isPending}>
          {setActivities.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </Modal>
  )
}

// ─── Aba: Templates de atividade ───────────────────────────

function TemplatesTab() {
  const { data, isLoading } = useActivityTemplates({ includeInactive: true })
  const upd = useUpdateActivityTemplate()
  const [editing, setEditing] = useState<ActivityTemplate | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <div class="text-sm font-semibold text-fg">Atividades padrão</div>
            <p class="text-xs text-fg-muted mt-0.5">
              Catálogo de atividades com código, prazo e responsável. É o código que permite
              medir quantas cobranças foram feitas e por quem — título livre não gera indicador.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nova atividade
          </Button>
        </div>

        {isLoading ? (
          <Skeleton class="h-32 w-full" />
        ) : (data?.data ?? []).length === 0 ? (
          <p class="text-sm text-fg-muted text-center py-6">Nenhuma atividade padrão cadastrada.</p>
        ) : (
          <ul class="divide-y divide-border">
            {(data?.data ?? []).map((t) => (
              <li key={t.id} class="py-2.5 flex items-center gap-3 flex-wrap">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <code class="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-2 text-fg">{t.code}</code>
                    <span class={t.active ? 'text-sm font-medium text-fg truncate' : 'text-sm font-medium text-fg-muted line-through truncate'}>
                      {t.name}
                    </span>
                    <Badge tone="neutral">{t.type}</Badge>
                  </div>
                  <div class="text-xs text-fg-muted mt-1">
                    {DUE_MODE_LABELS[t.dueMode]}{t.dueValue ? ` (${t.dueValue})` : ''} · {ASSIGNEE_LABELS[t.assigneeMode]}
                  </div>
                </div>
                <div class="flex gap-1.5 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(t)}>
                    <Pencil size={12} /> Editar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => upd.mutate({ id: t.id, active: !t.active }, {
                      onSuccess: () => toast(t.active ? 'Atividade desativada' : 'Atividade ativada', 'success'),
                      onError: (e: unknown) => toast((e as Error).message, 'danger'),
                    })}
                  >
                    <Power size={12} /> {t.active ? 'Desativar' : 'Ativar'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(creating || editing) && (
        <TemplateModal template={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
    </div>
  )
}

function TemplateModal({ template, onClose }: { template: ActivityTemplate | null; onClose: () => void }) {
  const isEdit = template != null
  const create = useCreateActivityTemplate()
  const upd = useUpdateActivityTemplate()

  const [code, setCode] = useState(template?.code ?? '')
  const [name, setName] = useState(template?.name ?? '')
  const [type, setType] = useState(template?.type ?? 'whatsapp')
  const [defaultDescription, setDefaultDescription] = useState(template?.defaultDescription ?? '')
  const [dueMode, setDueMode] = useState<DueMode>(template?.dueMode ?? 'immediate')
  const [dueValue, setDueValue] = useState<number | ''>(template?.dueValue ?? '')
  const [assigneeMode, setAssigneeMode] = useState<AssigneeMode>(template?.assigneeMode ?? 'lead_owner')
  const [assigneeTeamId, setAssigneeTeamId] = useState<number | ''>(template?.assigneeTeamId ?? '')

  const busy = create.isPending || upd.isPending

  async function submit(e: Event) {
    e.preventDefault()
    const payload = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      type,
      defaultDescription: defaultDescription.trim() || null,
      dueMode,
      dueValue: dueValue === '' ? 0 : Number(dueValue),
      assigneeMode,
      assigneeTeamId: assigneeTeamId === '' ? null : assigneeTeamId,
    }
    try {
      if (isEdit) await upd.mutateAsync({ id: template!.id, ...payload })
      else await create.mutateAsync(payload)
      toast(isEdit ? 'Atividade atualizada' : 'Atividade criada', 'success')
      onClose()
    } catch (err) {
      toast((err as Error).message, 'danger')
    }
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={isEdit ? `Editar ${template!.code}` : 'Nova atividade padrão'}>
      <form onSubmit={submit} class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Código</label>
            <Input value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} placeholder="AT-WP-06" required maxLength={20} />
          </div>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Canal</label>
            <select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)} class={SELECT_CLASS}>
              {ACTIVITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">Nome</label>
          <Input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="COBRANCA DE TAXA DE MATRICULA/CONTRATO" required />
        </div>

        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">Descrição padrão</label>
          <textarea
            value={defaultDescription}
            onInput={(e) => setDefaultDescription((e.target as HTMLTextAreaElement).value)}
            rows={2}
            class="w-full px-3 py-2 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Prazo</label>
            <select value={dueMode} onChange={(e) => setDueMode((e.target as HTMLSelectElement).value as DueMode)} class={SELECT_CLASS}>
              {(Object.keys(DUE_MODE_LABELS) as DueMode[]).map((m) => (
                <option key={m} value={m}>{DUE_MODE_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Valor (N)</label>
            <Input
              type="number"
              value={String(dueValue)}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value
                setDueValue(v === '' ? '' : Number(v))
              }}
              disabled={dueMode === 'immediate' || dueMode === 'lead_defined'}
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Responsável</label>
            <select value={assigneeMode} onChange={(e) => setAssigneeMode((e.target as HTMLSelectElement).value as AssigneeMode)} class={SELECT_CLASS}>
              {(Object.keys(ASSIGNEE_LABELS) as AssigneeMode[]).map((m) => (
                <option key={m} value={m}>{ASSIGNEE_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">
              ID do setor {(assigneeMode === 'team' || assigneeMode === 'round_robin') && <span class="text-danger">*</span>}
            </label>
            <Input
              type="number"
              value={String(assigneeTeamId)}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value
                setAssigneeTeamId(v === '' ? '' : Number(v))
              }}
              disabled={assigneeMode !== 'team' && assigneeMode !== 'round_robin'}
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
