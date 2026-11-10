// Agendar reunião/visita PELA EQUIPE, dentro do lead.
//
// Antes não havia como a equipe criar uma reserva no painel: a visita virava
// tarefa ("VISITA 8 ANO") e ficava sem lembrete, sem capacidade por horário e
// fora das métricas. Aqui ela nasce igual à da página pública — mesmos
// horários livres, rodízio, etapa do funil e confirmação ao contato — já no
// lead aberto na tela.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck } from '@/components/ui/icon-set'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select, Textarea } from '@/components/ui/Input'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'
import { useMeetingTypes, useSlotsPreview } from '@/hooks/useScheduling'

export function AgendarReuniaoButton({ leadId, label = 'Agendar visita', variante = 'botao' }: { leadId: number; label?: string; variante?: 'botao' | 'linha' }) {
  const [open, setOpen] = useState(false)
  const { data } = useMeetingTypes()
  if (!(data?.items ?? []).some((t) => t.active)) return null // sem agendamento configurado
  return (
    <>
      {variante === 'linha' ? (
        <button type="button" class="w-full flex items-center gap-2 px-3 py-2 text-xs text-accent hover:bg-surface-3 border-b border-border" onClick={() => setOpen(true)}>
          <CalendarCheck size={13} /> {label}
        </button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} title="Marcar visita ou reunião na agenda (envia confirmação e lembretes)">
          <CalendarCheck size={14} /> {label}
        </Button>
      )}
      {open && <AgendarModal leadId={leadId} onClose={() => setOpen(false)} />}
    </>
  )
}

function AgendarModal({ leadId, onClose }: { leadId: number; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: tiposData } = useMeetingTypes()
  const tipos = (tiposData?.items ?? []).filter((t) => t.active)
  const [tipoId, setTipoId] = useState<number | null>(null)
  useEffect(() => { if (tipoId == null && tipos[0]) setTipoId(tipos[0].id) }, [tipos.length])
  const { data: slotsData, isLoading } = useSlotsPreview(tipoId)
  const dias = slotsData?.days ?? []
  const [dia, setDia] = useState<string>('')
  const [hora, setHora] = useState<string>('')
  const [obs, setObs] = useState('')
  const [jaMarcada, setJaMarcada] = useState<string | null>(null)
  useEffect(() => { setDia(dias[0]?.date ?? ''); setHora('') }, [tipoId, dias.length])
  const slotsDoDia = useMemo(() => dias.find((d) => d.date === dia)?.slots ?? [], [dias, dia])

  const agendar = useMutation({
    mutationFn: (force: boolean) =>
      api.post(`/admin/scheduling/meeting-types/${tipoId}/book-for-lead`, { leadId, startAt: hora, note: obs || undefined, force }),
    onSuccess: () => {
      toast('Agendado! A família recebe a confirmação e os lembretes automaticamente.', 'success')
      qc.invalidateQueries({ queryKey: ['meeting-type-slots'] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
      qc.invalidateQueries({ queryKey: ['calendar'] })
      onClose()
    },
    onError: (e: unknown) => {
      const msg = (e as Error).message || 'Não foi possível agendar'
      if (/já tem .* marcada/i.test(msg)) setJaMarcada(msg)
      else toast(msg, 'danger')
    },
  })

  const fmtDia = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`)
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Agendar visita / reunião"
      description="Mostra só horários livres da equipe. Ao confirmar, a família recebe a confirmação e os lembretes (1 dia e 2 horas antes)."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={agendar.isPending}>Cancelar</Button>
          {jaMarcada ? (
            <Button variant="primary" size="sm" onClick={() => agendar.mutate(true)} disabled={agendar.isPending || !hora}>Agendar mesmo assim</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => agendar.mutate(false)} disabled={agendar.isPending || !hora || !tipoId}>
              {agendar.isPending ? 'Agendando…' : 'Confirmar agendamento'}
            </Button>
          )}
        </>
      }
    >
      <div class="space-y-3">
        <Select label="Tipo" value={tipoId ? String(tipoId) : ''} onChange={(e) => { setTipoId(Number((e.target as HTMLSelectElement).value) || null); setJaMarcada(null) }}>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>

        {isLoading ? (
          <p class="text-sm text-fg-muted">Carregando horários…</p>
        ) : dias.length === 0 ? (
          <p class="text-sm text-warning">Nenhum horário livre na janela deste tipo.</p>
        ) : (
          <>
            <div>
              <div class="text-xs font-medium text-fg-muted mb-1">Dia</div>
              <div class="flex flex-wrap gap-1.5">
                {dias.map((d) => (
                  <button key={d.date} type="button" onClick={() => { setDia(d.date); setHora('') }}
                    class={`px-2.5 py-1 rounded-md text-xs border ${dia === d.date ? 'bg-accent text-fg-on-brand border-accent' : 'bg-surface border-border text-fg hover:bg-surface-2'}`}>
                    {fmtDia(d.date)} <span class="opacity-70">({d.slots.length})</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div class="text-xs font-medium text-fg-muted mb-1">Horário</div>
              <div class="flex flex-wrap gap-1.5">
                {slotsDoDia.map((s) => (
                  <button key={s.startAt} type="button" onClick={() => setHora(s.startAt)}
                    class={`px-2.5 py-1 rounded-md text-xs border ${hora === s.startAt ? 'bg-accent text-fg-on-brand border-accent' : 'bg-surface border-border text-fg hover:bg-surface-2'}`}>
                    {new Date(s.startAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <Textarea label="Observação (opcional)" value={obs} onInput={(e) => setObs((e.target as HTMLTextAreaElement).value)} placeholder="Ex.: 8º ano, vem com o pai" rows={2} />

        {jaMarcada && (
          <p class="text-sm text-warning">{jaMarcada} Se for mesmo uma segunda reunião, use “Agendar mesmo assim”.</p>
        )}
      </div>
    </Modal>
  )
}
