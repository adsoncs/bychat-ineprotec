import { useState, useMemo } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useFunnels, useStages } from '@/hooks/useFunnels'
import { useUsers } from '@/hooks/useUsers'
import { useTeams } from '@/hooks/useTeams'
import { useDuplicateLead, useLead, type DuplicateLeadCopy } from '@/hooks/useLeads'
import { toast } from '@/lib/toast'

interface Props {
  leadId: number
  onClose: () => void
  onDuplicated: (newId: number) => void
}

const COPY_FIELDS: { key: keyof DuplicateLeadCopy; label: string; hint: string }[] = [
  { key: 'tags',         label: 'Tags',                  hint: 'Etiquetas vinculadas ao lead' },
  { key: 'annotation',   label: 'Anotação interna',      hint: 'Texto de anotação dos operadores' },
  { key: 'formData',     label: 'Dados do formulário',   hint: 'Respostas do formulário/chat' },
  { key: 'scores',       label: 'Scores',                hint: 'Pontuação geral e por dimensão' },
  { key: 'analysis',     label: 'Análise / IA',          hint: 'Resultado de IA e aiSentiment' },
  { key: 'customFields', label: 'Campos personalizados', hint: 'Custom fields preenchidos' },
  { key: 'activities',   label: 'Atividades',            hint: 'Tarefas, ligações, follow-ups, notas' },
  { key: 'cadences',     label: 'Cadências',             hint: 'Inscrições ativas/pausadas em cadências' },
]

export function DuplicateLeadModal({ leadId, onClose, onDuplicated }: Props) {
  const { data: lead } = useLead(leadId)
  const { data: funnelsData } = useFunnels()
  const { data: usersData } = useUsers()
  const { data: teamsData } = useTeams()

  // Defaults: funil/etapa do original
  const [funnelId, setFunnelId] = useState<number | ''>(lead?.funnelId ?? '')
  const [stageKey, setStageKey] = useState<string>(lead?.status ?? '')
  // Atribuição: 'inherit' = herda do original (default), 'unassign' = sem operador, ou um ID
  const [assignedUserSel, setAssignedUserSel] = useState<'inherit' | 'unassign' | number>('inherit')
  const [teamSel, setTeamSel] = useState<'inherit' | 'unassign' | number>('inherit')

  const [copy, setCopy] = useState<Required<DuplicateLeadCopy>>({
    tags: true, annotation: true, formData: true, scores: true,
    analysis: true, customFields: true, activities: true, cadences: true,
  })

  const dup = useDuplicateLead()

  const { data: stagesData } = useStages(typeof funnelId === 'number' ? funnelId : null)
  const stages = useMemo(() => stagesData?.stages.filter(s => s.active) ?? [], [stagesData])
  const funnels = useMemo(() => funnelsData?.funnels.filter(f => f.active) ?? [], [funnelsData])
  const users = useMemo(() => usersData?.users.filter(u => u.active) ?? [], [usersData])
  const teams = useMemo(() => teamsData?.teams.filter(t => t.active) ?? [], [teamsData])

  const allOn = Object.values(copy).every(Boolean)
  const allOff = Object.values(copy).every(v => !v)

  function toggleAll(value: boolean) {
    setCopy({
      tags: value, annotation: value, formData: value, scores: value,
      analysis: value, customFields: value, activities: value, cadences: value,
    })
  }

  function submit() {
    const input: Parameters<typeof dup.mutate>[0] = {
      id: leadId,
      copy,
      ...(typeof funnelId === 'number' ? { funnelId } : {}),
      ...(stageKey ? { stageKey } : {}),
      ...(assignedUserSel === 'inherit' ? {}
        : assignedUserSel === 'unassign' ? { assignedUserId: null }
        : { assignedUserId: assignedUserSel }),
      ...(teamSel === 'inherit' ? {}
        : teamSel === 'unassign' ? { teamId: null }
        : { teamId: teamSel }),
    }

    dup.mutate(input, {
      onSuccess: (r) => {
        toast('Lead duplicado', 'success')
        onDuplicated(r.id)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Duplicar lead"
      description="Escolha o destino e quais dados devem ser copiados para o novo lead."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={dup.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={dup.isPending}>
            {dup.isPending ? 'Duplicando…' : 'Duplicar lead'}
          </Button>
        </>
      }
    >
      <div class="space-y-5">
        {/* ── Destino ─────────────────────────── */}
        <section class="space-y-3">
          <h3 class="text-xs font-medium uppercase tracking-wider text-fg-subtle">Destino</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="text-xs text-fg-muted">Funil</span>
              <select
                class="mt-1 w-full h-9 px-2 rounded-md border border-border bg-surface text-sm text-fg"
                value={funnelId === '' ? '' : String(funnelId)}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  setFunnelId(v === '' ? '' : Number(v))
                  setStageKey('') // reset etapa quando troca funil
                }}
              >
                <option value="">— Manter funil original —</option>
                {funnels.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>

            <label class="block">
              <span class="text-xs text-fg-muted">Etapa</span>
              <select
                class="mt-1 w-full h-9 px-2 rounded-md border border-border bg-surface text-sm text-fg disabled:opacity-50"
                value={stageKey}
                onChange={(e) => setStageKey((e.target as HTMLSelectElement).value)}
                disabled={typeof funnelId !== 'number'}
              >
                <option value="">
                  {typeof funnelId === 'number' ? '— Primeira etapa do funil —' : '— Manter etapa original —'}
                </option>
                {stages.map(s => (
                  <option key={s.id} value={s.key}>{s.name}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* ── Atribuição ──────────────────────── */}
        <section class="space-y-3">
          <h3 class="text-xs font-medium uppercase tracking-wider text-fg-subtle">Atribuição</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="text-xs text-fg-muted">Operador</span>
              <select
                class="mt-1 w-full h-9 px-2 rounded-md border border-border bg-surface text-sm text-fg"
                value={typeof assignedUserSel === 'number' ? String(assignedUserSel) : assignedUserSel}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  setAssignedUserSel(v === 'inherit' || v === 'unassign' ? v : Number(v))
                }}
              >
                <option value="inherit">— Manter atribuição original —</option>
                <option value="unassign">Sem operador</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
                ))}
              </select>
            </label>

            <label class="block">
              <span class="text-xs text-fg-muted">Equipe</span>
              <select
                class="mt-1 w-full h-9 px-2 rounded-md border border-border bg-surface text-sm text-fg"
                value={typeof teamSel === 'number' ? String(teamSel) : teamSel}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  setTeamSel(v === 'inherit' || v === 'unassign' ? v : Number(v))
                }}
              >
                <option value="inherit">— Manter equipe original —</option>
                <option value="unassign">Sem equipe</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* ── O que copiar ────────────────────── */}
        <section class="space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium uppercase tracking-wider text-fg-subtle">Dados a copiar</h3>
            <button
              type="button"
              class="text-xs text-primary hover:underline"
              onClick={() => toggleAll(!allOn)}
            >
              {allOn ? 'Desmarcar todos' : 'Marcar todos'}
            </button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {COPY_FIELDS.map(({ key, label, hint }) => (
              <label
                key={key}
                class="flex items-start gap-2 p-2 rounded-md border border-border hover:bg-surface-3/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={copy[key]}
                  onChange={(e) => setCopy({ ...copy, [key]: (e.target as HTMLInputElement).checked })}
                />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm text-fg">{label}</span>
                  <span class="block text-[0.6875rem] text-fg-subtle">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {allOff && (
            <p class="text-[0.6875rem] text-warning">
              Nenhum dado será copiado — apenas dados básicos (nome, contato, empresa) e o destino escolhido.
            </p>
          )}
        </section>
      </div>
    </Modal>
  )
}
