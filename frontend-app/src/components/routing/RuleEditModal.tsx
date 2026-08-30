import { useEffect, useState } from 'preact/hooks'
import { Plus, Trash2 } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'
import {
  useCreateRoutingRule, useUpdateRoutingRule, useRoutingTeams, useAgents,
  useSkillsCatalog,
  type RoutingRule, type RuleCondition, type RuleConditionOp, type RuleAction,
} from '@/hooks/useRouting'

const FIELDS: { value: string; label: string; placeholder?: string }[] = [
  { value: 'source', label: 'Origem (source)', placeholder: 'form, inbound, meta, chatbot' },
  { value: 'utmSource', label: 'UTM Source', placeholder: 'google, facebook…' },
  { value: 'utmMedium', label: 'UTM Medium', placeholder: 'cpc, social…' },
  { value: 'utmCampaign', label: 'UTM Campaign' },
  { value: 'utmContent', label: 'UTM Content' },
  { value: 'utmTerm', label: 'UTM Term' },
  { value: 'formId', label: 'Form ID', placeholder: '123' },
  { value: 'chatbotId', label: 'Chatbot ID', placeholder: '12' },
  { value: 'instanceName', label: 'WhatsApp instance' },
  { value: 'tag', label: 'Tag' },
]

const OPS: { value: RuleConditionOp; label: string; needsValue: boolean; arrayValue?: boolean }[] = [
  { value: 'eq', label: 'igual a', needsValue: true },
  { value: 'neq', label: 'diferente de', needsValue: true },
  { value: 'contains', label: 'contém', needsValue: true },
  { value: 'startsWith', label: 'começa com', needsValue: true },
  { value: 'in', label: 'está em (lista)', needsValue: true, arrayValue: true },
  { value: 'notIn', label: 'não está em (lista)', needsValue: true, arrayValue: true },
  { value: 'exists', label: 'preenchido', needsValue: false },
  { value: 'missing', label: 'vazio', needsValue: false },
]

interface Props {
  rule: RoutingRule | null   // null = criar; objeto = editar
  onClose: () => void
}

export function RuleEditModal({ rule, onClose }: Props) {
  const teams = useRoutingTeams()
  const agents = useAgents()
  const skillsCatalog = useSkillsCatalog()
  const create = useCreateRoutingRule()
  const update = useUpdateRoutingRule(rule?.id ?? 0)

  const [name, setName] = useState(rule?.name ?? '')
  const [description, setDescription] = useState(rule?.description ?? '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [conditions, setConditions] = useState<RuleCondition[]>(
    rule?.conditions ?? [{ field: 'utmSource', op: 'eq', value: '' }],
  )
  const [actionType, setActionType] = useState<'team' | 'user' | 'skill'>(rule?.action.type ?? 'team')
  const [actionTeamId, setActionTeamId] = useState<number | ''>(
    rule?.action.type === 'team' || rule?.action.type === 'skill' ? rule.action.teamId : '',
  )
  const [actionUserId, setActionUserId] = useState<number | ''>(
    rule?.action.type === 'user' ? rule.action.userId : '',
  )
  const [actionSkill, setActionSkill] = useState<string>(
    rule?.action.type === 'skill' ? rule.action.skill : '',
  )

  // Quando rule muda (edit de outro item), rehidrata.
  useEffect(() => {
    if (rule) {
      setName(rule.name)
      setDescription(rule.description ?? '')
      setEnabled(rule.enabled)
      setConditions(rule.conditions)
      setActionType(rule.action.type)
      if (rule.action.type === 'team') {
        setActionTeamId(rule.action.teamId)
        setActionUserId('')
        setActionSkill('')
      } else if (rule.action.type === 'user') {
        setActionUserId(rule.action.userId)
        setActionTeamId('')
        setActionSkill('')
      } else {
        setActionTeamId(rule.action.teamId)
        setActionSkill(rule.action.skill)
        setActionUserId('')
      }
    }
  }, [rule])

  const addCondition = () =>
    setConditions((prev) => [...prev, { field: 'utmSource', op: 'eq', value: '' }])

  const updateCondition = (idx: number, patch: Partial<RuleCondition>) =>
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))

  const removeCondition = (idx: number) =>
    setConditions((prev) => prev.filter((_, i) => i !== idx))

  const handleSave = async () => {
    if (!name.trim()) {
      toast('Dê um nome à regra', 'danger')
      return
    }
    // Coerce value de condições com arrayValue para split por vírgula.
    const cleanedConditions: RuleCondition[] = conditions.map((c) => {
      const opDef = OPS.find((o) => o.value === c.op)
      if (!opDef) return c
      if (!opDef.needsValue) return { ...c, value: null }
      if (opDef.arrayValue) {
        if (Array.isArray(c.value)) return c
        const list = String(c.value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        return { ...c, value: list }
      }
      return { ...c, value: c.value ?? '' }
    })

    let action: RuleAction
    if (actionType === 'team') {
      if (typeof actionTeamId !== 'number') {
        toast('Selecione o setor', 'danger')
        return
      }
      action = { type: 'team', teamId: actionTeamId }
    } else if (actionType === 'user') {
      if (typeof actionUserId !== 'number') {
        toast('Selecione o agente', 'danger')
        return
      }
      action = { type: 'user', userId: actionUserId }
    } else {
      const skill = actionSkill.trim().toLowerCase()
      if (!skill) {
        toast('Informe a habilidade exigida', 'danger')
        return
      }
      if (typeof actionTeamId !== 'number') {
        toast('Selecione o setor (skill exige restringir ao time)', 'danger')
        return
      }
      action = { type: 'skill', skill, teamId: actionTeamId }
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      enabled,
      conditions: cleanedConditions,
      action,
    }

    try {
      if (rule) await update.mutateAsync(payload)
      else await create.mutateAsync(payload)
      toast(rule ? 'Regra atualizada' : 'Regra criada', 'success')
      onClose()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao salvar'
      toast(msg, 'danger')
    }
  }

  const pending = create.isPending || update.isPending
  const teamList = (teams.data?.teams ?? []).filter((t) => t.active)
  const agentList = (agents.data?.agents ?? []).filter((a) => a.isAgent && a.active)

  return (
    <Modal
      open
      onOpenChange={(v) => { if (!v) onClose() }}
      title={rule ? `Editar regra: ${rule.name}` : 'Nova regra de roteamento'}
      description="Defina condições (todas devem casar) e o destino do lead."
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
        <section class="space-y-3">
          <Input
            label="Nome da regra"
            value={name}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            placeholder='Ex: "Meta facebook → time graduação"'
          />
          <Textarea
            label="Descrição (opcional)"
            value={description}
            onInput={(e) => setDescription((e.currentTarget as HTMLTextAreaElement).value)}
            maxLength={255}
            rows={2}
          />
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled((e.currentTarget as HTMLInputElement).checked)}
            />
            Regra ativa
          </label>
        </section>

        <section>
          <div class="flex items-center justify-between mb-3">
            <div>
              <h4 class="text-sm font-semibold">Condições (todas devem casar)</h4>
              <p class="text-xs text-fg-muted">Sem condição = regra "catch-all" (sempre casa).</p>
            </div>
            <Button variant="secondary" size="sm" onClick={addCondition}>
              <Plus class="w-4 h-4 mr-1" /> Adicionar condição
            </Button>
          </div>
          <div class="space-y-2">
            {conditions.map((c, idx) => {
              const opDef = OPS.find((o) => o.value === c.op)
              const fieldDef = FIELDS.find((f) => f.value === c.field)
              return (
                <div key={idx} class="grid grid-cols-[1.5fr_1fr_2fr_auto] gap-2 items-end">
                  <Select
                    value={c.field}
                    onChange={(e) => updateCondition(idx, { field: (e.currentTarget as HTMLSelectElement).value })}
                  >
                    {FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </Select>
                  <Select
                    value={c.op}
                    onChange={(e) => updateCondition(idx, { op: (e.currentTarget as HTMLSelectElement).value as RuleConditionOp })}
                  >
                    {OPS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                  {opDef?.needsValue ? (
                    <Input
                      value={Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '')}
                      onInput={(e) => updateCondition(idx, { value: (e.currentTarget as HTMLInputElement).value })}
                      placeholder={opDef.arrayValue ? 'valor1, valor2, valor3' : fieldDef?.placeholder ?? ''}
                    />
                  ) : (
                    <div class="text-xs text-fg-muted italic self-center px-2">
                      sem valor necessário
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCondition(idx)}
                    title="Remover condição"
                  >
                    <Trash2 class="w-4 h-4" />
                  </Button>
                </div>
              )
            })}
            {conditions.length === 0 && (
              <div class="text-sm text-fg-muted bg-surface-2 border border-border rounded p-3">
                Sem condições — regra sempre casa (use com cuidado, geralmente como última na cascata).
              </div>
            )}
          </div>
        </section>

        <section>
          <h4 class="text-sm font-semibold mb-3">Ação (destino do lead)</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Tipo"
              value={actionType}
              onChange={(e) => setActionType((e.currentTarget as HTMLSelectElement).value as 'team' | 'user' | 'skill')}
            >
              <option value="team">Atribuir a setor (operador via round-robin)</option>
              <option value="user">Atribuir a agente direto</option>
              <option value="skill">Por habilidade (skill-based, dentro de um setor)</option>
            </Select>
            {actionType === 'team' && (
              <Select
                label="Setor"
                value={actionTeamId === '' ? '' : String(actionTeamId)}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value
                  setActionTeamId(v === '' ? '' : parseInt(v))
                }}
              >
                <option value="">— Selecionar —</option>
                {teamList.map((t) => (
                  <option key={t.id} value={String(t.id)}>{t.name}</option>
                ))}
              </Select>
            )}
            {actionType === 'user' && (
              <Select
                label="Agente"
                value={actionUserId === '' ? '' : String(actionUserId)}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value
                  setActionUserId(v === '' ? '' : parseInt(v))
                }}
              >
                <option value="">— Selecionar —</option>
                {agentList.map((a) => (
                  <option key={a.id} value={String(a.id)}>{a.name}</option>
                ))}
              </Select>
            )}
            {actionType === 'skill' && (
              <>
                <div>
                  <Input
                    label="Habilidade exigida"
                    value={actionSkill}
                    onInput={(e) => setActionSkill((e.currentTarget as HTMLInputElement).value)}
                    list="skills-catalog"
                    placeholder="ex: graduacao"
                  />
                  <datalist id="skills-catalog">
                    {(skillsCatalog.data?.skills ?? []).map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <Select
                  label="Setor alvo"
                  value={actionTeamId === '' ? '' : String(actionTeamId)}
                  onChange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value
                    setActionTeamId(v === '' ? '' : parseInt(v))
                  }}
                >
                  <option value="">— Selecionar —</option>
                  {teamList.map((t) => (
                    <option key={t.id} value={String(t.id)}>{t.name}</option>
                  ))}
                </Select>
              </>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}
