// ConnectionFunnelPicker — escolha do funil/etapa dos leads do chatbot, na conexão
// WhatsApp (Cloud API ou instância Evolution). Só deve ser renderizado quando há um
// chatbot vinculado. Vazio = não promove (leads ficam na caixa de entrada). Com funil,
// os leads do chatbot caem no Kanban respeitando a qualificação/agendamento do form.

import { useState } from 'preact/hooks'
import { Select } from '@/components/ui/Input'
import { useFunnels, useStages } from '@/hooks/useFunnels'

export function ConnectionFunnelPicker({ funnelId, stageKey, disabled, onSave }: {
  funnelId: number | null
  stageKey: string | null
  disabled?: boolean
  onSave: (v: { funnelId: number | null; stageKey: string | null }) => void
}) {
  const [fid, setFid] = useState(funnelId ? String(funnelId) : '')
  const [skey, setSkey] = useState(stageKey ?? '')
  const { data: funnels } = useFunnels()
  const { data: stagesData } = useStages(fid ? Number(fid) : null)
  const stages = stagesData?.stages ?? []

  function changeFunnel(v: string) {
    setFid(v)
    setSkey('')
    onSave({ funnelId: v ? Number(v) : null, stageKey: null })
  }
  function changeStage(v: string) {
    setSkey(v)
    onSave({ funnelId: fid ? Number(fid) : null, stageKey: v || null })
  }

  return (
    <div class="mt-3 pt-3 border-t border-border">
      <div class="text-sm font-medium text-fg mb-1">Funil dos leads do chatbot</div>
      <p class="text-xs text-fg-muted mb-2">
        Com um funil escolhido, os leads do chatbot caem no Kanban nas etapas certas —
        respeitando a qualificação e o agendamento do formulário. Vazio = leads ficam na
        caixa de entrada para promover manualmente.
      </p>
      <div class="grid sm:grid-cols-2 gap-3">
        <Select label="Funil" value={fid} disabled={disabled} onChange={(e) => changeFunnel((e.target as HTMLSelectElement).value)}>
          <option value="">Não promover (caixa de entrada)</option>
          {funnels?.funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <Select label="Etapa inicial" value={skey} disabled={disabled || !fid} onChange={(e) => changeStage((e.target as HTMLSelectElement).value)}>
          <option value="">{fid ? 'Primeira etapa' : 'Selecione um funil'}</option>
          {stages.filter((s) => s.active).map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
        </Select>
      </div>
    </div>
  )
}
