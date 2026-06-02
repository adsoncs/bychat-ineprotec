import { useEffect, useState } from 'preact/hooks'
import { Trash2, Plus } from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'
import {
  useAgents, useUpdateAgent,
  useAgentWorkingHours, useSaveAgentWorkingHours,
  useAgentSkills, useSaveAgentSkills,
  type WorkingHourEntry, type SkillEntry,
} from '@/hooks/useRouting'

const WEEKDAYS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
]

const DEFAULT_TZ = 'America/Sao_Paulo'
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

interface Props {
  userId: number
  onClose: () => void
}

export function AgentEditDrawer({ userId, onClose }: Props) {
  const agentsQuery = useAgents()
  const agent = agentsQuery.data?.agents.find((a) => a.id === userId)

  const whQuery = useAgentWorkingHours(userId)
  const skillsQuery = useAgentSkills(userId)
  const updateAgent = useUpdateAgent(userId)
  const saveHours = useSaveAgentWorkingHours(userId)
  const saveSkills = useSaveAgentSkills(userId)

  // Form state
  const [weight, setWeight] = useState<number>(1)
  const [maxDailyLeads, setMaxDailyLeads] = useState<string>('')
  const [vacationUntil, setVacationUntil] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [profileActive, setProfileActive] = useState<boolean>(true)
  const [hours, setHours] = useState<WorkingHourEntry[]>([])
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [skillInput, setSkillInput] = useState('')

  // Hidrata form ao abrir
  useEffect(() => {
    if (!agent) return
    const p = agent.agentProfile
    setWeight(p?.weight ?? 1)
    setMaxDailyLeads(p?.maxDailyLeads == null ? '' : String(p.maxDailyLeads))
    setVacationUntil(p?.vacationUntil ? p.vacationUntil.slice(0, 16) : '')
    setNotes(p?.notes ?? '')
    setProfileActive(p?.active ?? true)
  }, [agent])

  useEffect(() => {
    if (whQuery.data) setHours(whQuery.data.workingHours)
  }, [whQuery.data])

  useEffect(() => {
    if (skillsQuery.data) setSkills(skillsQuery.data.skills)
  }, [skillsQuery.data])

  const addSkill = () => {
    const raw = skillInput.trim().toLowerCase()
    if (!raw) return
    if (skills.some((s) => s.skill === raw)) {
      toast('Habilidade já adicionada', 'info')
      return
    }
    setSkills((prev) => [...prev, { skill: raw, level: 1 }])
    setSkillInput('')
  }

  const removeSkill = (skill: string) =>
    setSkills((prev) => prev.filter((s) => s.skill !== skill))

  const setSkillLevel = (skill: string, level: number) =>
    setSkills((prev) => prev.map((s) => (s.skill === skill ? { ...s, level } : s)))

  if (!agent) return null

  const addRow = () => {
    const used = new Set(hours.map((h) => h.weekday))
    const nextDay = WEEKDAYS.find((d) => !used.has(d.value))
    if (!nextDay) {
      toast('Todos os dias da semana já estão configurados', 'info')
      return
    }
    setHours([
      ...hours,
      { weekday: nextDay.value, startTime: '09:00', endTime: '18:00', timezone: DEFAULT_TZ },
    ])
  }

  const updateRow = (idx: number, patch: Partial<WorkingHourEntry>) => {
    setHours((prev) => prev.map((h, i) => (i === idx ? { ...h, ...patch } : h)))
  }

  const removeRow = (idx: number) => {
    setHours((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    // Validar working hours antes
    const seen = new Set<number>()
    for (const h of hours) {
      if (seen.has(h.weekday)) {
        toast('Dois horários para o mesmo dia da semana — remova um.', 'danger')
        return
      }
      seen.add(h.weekday)
      if (!HHMM_RE.test(h.startTime) || !HHMM_RE.test(h.endTime)) {
        toast('Horário inválido. Use HH:MM em 24h.', 'danger')
        return
      }
    }

    const profilePatch: Parameters<typeof updateAgent.mutateAsync>[0] = {
      active: profileActive,
      weight,
      maxDailyLeads: maxDailyLeads.trim() === '' ? null : parseInt(maxDailyLeads),
      vacationUntil: vacationUntil ? new Date(vacationUntil).toISOString() : null,
      notes: notes.trim() === '' ? null : notes.trim(),
    }

    try {
      await updateAgent.mutateAsync(profilePatch)
      await saveHours.mutateAsync(hours)
      await saveSkills.mutateAsync(skills)
      toast('Agente atualizado', 'success')
      onClose()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao salvar'
      toast(msg, 'danger')
    }
  }

  const pending = updateAgent.isPending || saveHours.isPending || saveSkills.isPending

  return (
    <Modal
      open
      onOpenChange={(v) => { if (!v) onClose() }}
      title={`Configurar agente: ${agent.name}`}
      description={`${agent.email} • ${agent.role}${agent.isAgent ? '' : ' (não-agente)'}`}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button onClick={handleSave} disabled={pending}>
            {pending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-6">
        {/* Perfil de roteamento */}
        <section>
          <h4 class="text-sm font-semibold mb-3">Perfil de roteamento</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Peso (1–10)"
              hint="Maior peso recebe mais leads no round-robin ponderado."
              type="number"
              min={1}
              max={10}
              value={String(weight)}
              onInput={(e) => setWeight(parseInt((e.currentTarget as HTMLInputElement).value) || 1)}
            />
            <Input
              label="Máx. leads/dia (opcional)"
              hint="Teto diário pelo roteamento automático. Em branco = sem limite."
              type="number"
              min={1}
              value={maxDailyLeads}
              onInput={(e) => setMaxDailyLeads((e.currentTarget as HTMLInputElement).value)}
            />
            <Input
              label="Ausente até"
              hint="Enquanto preenchido com data futura, o agente é pulado."
              type="datetime-local"
              value={vacationUntil}
              onInput={(e) => setVacationUntil((e.currentTarget as HTMLInputElement).value)}
            />
            <Select
              label="Perfil ativo"
              value={profileActive ? 'yes' : 'no'}
              onChange={(e) => setProfileActive((e.currentTarget as HTMLSelectElement).value === 'yes')}
            >
              <option value="yes">Sim — recebe leads</option>
              <option value="no">Não — pausado</option>
            </Select>
          </div>
          <div class="mt-3">
            <Textarea
              label="Notas (interno)"
              value={notes}
              onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)}
              maxLength={255}
              rows={2}
            />
          </div>
        </section>

        {/* Habilidades (F5) */}
        <section>
          <div class="mb-3">
            <h4 class="text-sm font-semibold">Habilidades</h4>
            <p class="text-xs text-fg-muted">
              Usadas por regras de roteamento com ação "por habilidade".
              Digite e pressione Enter para adicionar. Nível 1-5 ordena empate.
            </p>
          </div>
          <div class="flex items-end gap-2 mb-3">
            <Input
              label="Nova habilidade"
              value={skillInput}
              onInput={(e) => setSkillInput((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if ((e as KeyboardEvent).key === 'Enter') {
                  ;(e as KeyboardEvent).preventDefault()
                  addSkill()
                }
              }}
              placeholder="ex: graduacao, pos, ingles"
            />
            <Button variant="secondary" onClick={addSkill}>
              <Plus class="w-4 h-4 mr-1" /> Adicionar
            </Button>
          </div>
          {skills.length === 0 ? (
            <div class="text-sm text-fg-muted bg-surface-2 border border-border rounded p-3">
              Sem habilidades configuradas — agente recebe leads de qualquer skill.
            </div>
          ) : (
            <div class="flex flex-wrap gap-2">
              {skills.map((s) => (
                <div
                  key={s.skill}
                  class="inline-flex items-center gap-2 bg-surface-2 border border-border rounded-full pl-3 pr-1 py-1 text-sm"
                >
                  <span class="font-medium">{s.skill}</span>
                  <select
                    value={String(s.level)}
                    onChange={(e) =>
                      setSkillLevel(s.skill, parseInt((e.currentTarget as HTMLSelectElement).value))
                    }
                    class="bg-transparent text-xs text-fg-muted outline-none cursor-pointer"
                    title="Nível"
                  >
                    {[1, 2, 3, 4, 5].map((l) => (
                      <option key={l} value={String(l)}>Lv {l}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeSkill(s.skill)}
                    class="size-6 rounded-full hover:bg-surface-3 text-fg-muted hover:text-danger flex items-center justify-center"
                    title="Remover"
                  >
                    <Trash2 class="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Horários de trabalho */}
        <section>
          <div class="flex items-center justify-between mb-3">
            <div>
              <h4 class="text-sm font-semibold">Horário de trabalho</h4>
              <p class="text-xs text-fg-muted">
                Sem nenhuma linha = disponível 24/7. Janelas que cruzam meia-noite suportadas (ex: 22:00 → 02:00).
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={addRow}>
              <Plus class="w-4 h-4 mr-1" /> Adicionar dia
            </Button>
          </div>

          {whQuery.isLoading ? (
            <Skeleton class="h-24 w-full" />
          ) : hours.length === 0 ? (
            <div class="text-sm text-fg-muted bg-surface-2 border border-border rounded p-3">
              Sem horário configurado — agente recebe leads a qualquer momento.
            </div>
          ) : (
            <div class="space-y-2">
              {hours.map((h, idx) => {
                const firstLabel = (s: string) => (idx === 0 ? { label: s } : {})
                return (
                  <div key={idx} class="grid grid-cols-[1fr_auto_auto_1fr_auto] gap-2 items-end">
                    <Select
                      {...firstLabel('Dia')}
                      value={String(h.weekday)}
                      onChange={(e) =>
                        updateRow(idx, {
                          weekday: parseInt((e.currentTarget as HTMLSelectElement).value),
                        })
                      }
                    >
                      {WEEKDAYS.map((d) => (
                        <option key={d.value} value={String(d.value)}>{d.label}</option>
                      ))}
                    </Select>
                    <Input
                      {...firstLabel('Início')}
                      type="time"
                      value={h.startTime}
                      onInput={(e) => updateRow(idx, { startTime: (e.currentTarget as HTMLInputElement).value })}
                    />
                    <Input
                      {...firstLabel('Fim')}
                      type="time"
                      value={h.endTime}
                      onInput={(e) => updateRow(idx, { endTime: (e.currentTarget as HTMLInputElement).value })}
                    />
                    <Input
                      {...firstLabel('Fuso (IANA)')}
                      value={h.timezone}
                      onInput={(e) => updateRow(idx, { timezone: (e.currentTarget as HTMLInputElement).value })}
                      placeholder={DEFAULT_TZ}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRow(idx)}
                      title="Remover dia"
                    >
                      <Trash2 class="w-4 h-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
