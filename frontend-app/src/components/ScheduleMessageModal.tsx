import { useState } from 'preact/hooks'
import { Clock, AlertTriangle } from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useCreateScheduledMessage } from '@/hooks/useScheduledMessages'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadId: number
  /** Texto que já estava no compositor — agendar não deve fazer redigitar. */
  textoInicial?: string
  /** Número escolhido no seletor; só uma dica, o envio resolve de novo. */
  channelId?: string | undefined
  onAgendado?: () => void
}

/** Converte um Date para o formato de <input type="datetime-local"> no fuso
 *  LOCAL do navegador. O toISOString() daria UTC e o operador veria 3h a menos. */
function paraInputLocal(d: Date): string {
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

/** Atalhos de horário — cobre a maioria dos casos sem abrir o calendário. */
function atalhos(): { label: string; date: Date }[] {
  const agora = new Date()

  const em1h = new Date(agora.getTime() + 3600_000)

  const amanhaCedo = new Date(agora)
  amanhaCedo.setDate(amanhaCedo.getDate() + 1)
  amanhaCedo.setHours(9, 0, 0, 0)

  const segunda = new Date(agora)
  // 1 = segunda; se hoje já é segunda, joga para a próxima.
  const diasAteSegunda = ((8 - segunda.getDay()) % 7) || 7
  segunda.setDate(segunda.getDate() + diasAteSegunda)
  segunda.setHours(9, 0, 0, 0)

  return [
    { label: 'Em 1 hora', date: em1h },
    { label: 'Amanhã, 9h', date: amanhaCedo },
    { label: 'Segunda, 9h', date: segunda },
  ]
}

export function ScheduleMessageModal({ open, onOpenChange, leadId, textoInicial, channelId, onAgendado }: Props) {
  const [quando, setQuando] = useState(() => paraInputLocal(new Date(Date.now() + 3600_000)))
  const [texto, setTexto] = useState(textoInicial ?? '')
  const [cancelarSeResponder, setCancelarSeResponder] = useState(true)
  const criar = useCreateScheduledMessage(leadId)

  function agendar() {
    const corpo = texto.trim()
    if (!corpo) {
      toast('Escreva a mensagem que deve ser enviada', 'warning')
      return
    }
    const data = new Date(quando)
    if (isNaN(data.getTime())) {
      toast('Data ou hora inválida', 'warning')
      return
    }
    if (data.getTime() - Date.now() < 60_000) {
      toast('Escolha um horário pelo menos 1 minuto à frente', 'warning')
      return
    }
    criar.mutate(
      {
        scheduledAt: data.toISOString(),
        body: corpo,
        cancelIfReplied: cancelarSeResponder,
        ...(channelId ? { channelId } : {}),
      },
      {
        onSuccess: (r) => {
          // O backend avisa quando o horário cai fora da janela de 24h — o
          // operador precisa saber agora, não descobrir depois no histórico.
          if (r.aviso) toast(r.aviso, 'warning')
          else toast('Mensagem agendada', 'success')
          onOpenChange(false)
          setTexto('')
          onAgendado?.()
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Agendar mensagem"
      description="A mensagem sai sozinha no horário escolhido, pelo mesmo número desta conversa."
      size="lg"
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="primary" size="md" onClick={agendar} disabled={criar.isPending}>
            <Clock size={14} />
            {criar.isPending ? 'Agendando…' : 'Agendar'}
          </Button>
        </div>
      }
    >
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-sm font-medium">Mensagem</label>
          <Textarea
            rows={4}
            value={texto}
            onInput={(e) => setTexto((e.target as HTMLTextAreaElement).value)}
            placeholder="O que deve ser enviado no horário marcado…"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium">Quando enviar</label>
          <div class="mb-2 flex flex-wrap gap-2">
            {atalhos().map((a) => (
              <button
                key={a.label}
                type="button"
                class="rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg"
                onClick={() => setQuando(paraInputLocal(a.date))}
              >
                {a.label}
              </button>
            ))}
          </div>
          <Input
            type="datetime-local"
            value={quando}
            onInput={(e) => setQuando((e.target as HTMLInputElement).value)}
          />
        </div>

        <label class="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            class="mt-0.5"
            checked={cancelarSeResponder}
            onChange={(e) => setCancelarSeResponder((e.target as HTMLInputElement).checked)}
          />
          <span>
            Cancelar se o contato responder antes
            <span class="block text-xs text-fg-subtle">
              Evita mandar um follow-up para quem já voltou a falar com você.
            </span>
          </span>
        </label>

        <div class="flex gap-2 rounded-md border border-border bg-surface-2 p-3 text-xs text-fg-muted">
          <AlertTriangle size={14} class="mt-0.5 shrink-0" />
          <span>
            No horário do envio a mensagem passa pelas mesmas regras de uma mensagem digitada agora:
            número da conversa, opt-out e janela de 24h do WhatsApp Oficial.
          </span>
        </div>
      </div>
    </Modal>
  )
}
