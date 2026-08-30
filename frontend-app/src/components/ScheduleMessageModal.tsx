import { useState } from 'preact/hooks'
import { Clock, AlertTriangle } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { nomeDoCanal } from '@/lib/channelColors'
import { useCreateScheduledMessage } from '@/hooks/useScheduledMessages'
import { useSenderChannels } from '@/hooks/useChat'

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

  // Mesmos canais do compositor: o operador precisa saber (e escolher) por qual
  // número a mensagem vai sair — é o que decide se existe janela de 24h.
  const { data: sc } = useSenderChannels(leadId)
  const canais = sc?.channels ?? []
  const travado = sc?.lockedChannelId ?? null
  const podeTrocar = sc?.canOverrideChannel ?? false
  const [canalEscolhido, setCanalEscolhido] = useState<string | null>(null)
  const canalId = canalEscolhido ?? travado ?? sc?.suggestedChannelId ?? canais[0]?.id ?? null
  const canal = canais.find((c) => c.id === canalId) ?? null
  const canalFixo = !!travado && !podeTrocar

  // Aviso de janela calculado aqui, com o número já conhecido: só a Cloud API
  // tem janela de 24h, então na Evolution não há o que avisar. Dois casos
  // distintos: a janela JÁ está fechada (o contato não escreveu nas últimas
  // 24h — esperar não resolve), ou ela fecha antes do horário escolhido.
  const ehCloud = canal?.provider === 'cloud_api'
  const janelaFecha = ehCloud && canal?.window?.expiresAt ? new Date(canal.window.expiresAt) : null
  const janelaJaFechada = !!ehCloud && canal?.window ? !canal.window.open : false
  const foraDaJanela =
    janelaJaFechada || (!!janelaFecha && new Date(quando).getTime() > janelaFecha.getTime())

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
        ...(canalId ? { channelId: canalId } : {}),
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
          <label class="mb-1 block text-sm font-medium">Enviar pelo número</label>
          {canalFixo ? (
            <div class="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
              <span class="font-medium">{nomeDoCanal(canal)}</span>
              {canal?.number && nomeDoCanal(canal) !== canal.number && (
                <span class="ml-2 text-xs text-fg-muted">{canal.number}</span>
              )}
              <span class="mt-0.5 block text-xs text-fg-muted">
                Esta conversa já está em andamento por este número — é o que o contato conhece.
              </span>
            </div>
          ) : (
            <div class="flex items-center gap-2">
              <Select
                class="flex-1"
                value={canalId ?? ''}
                onChange={(e) => setCanalEscolhido((e.target as HTMLSelectElement).value || null)}
              >
                {canais.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nomeDoCanal(c)}{c.number && nomeDoCanal(c) !== c.number ? ` — ${c.number}` : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}
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
          {foraDaJanela && (
            <div class="mt-2 flex gap-2 rounded-md border border-warning bg-warning/10 p-2 text-xs text-fg">
              <AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning" />
              <span>
                {janelaJaFechada ? (
                  <>
                    A janela de 24h deste número está <strong>fechada</strong> — o contato não escreveu
                    nas últimas 24h. Uma mensagem de texto não será entregue pelo WhatsApp Oficial
                    {canais.some((c) => c.provider === 'evolution') ? '; escolha um número do WhatsApp comum acima' : ''}.
                  </>
                ) : (
                  <>
                    A janela de 24h deste número fecha em{' '}
                    <strong>{janelaFecha?.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</strong>.
                    Depois disso o WhatsApp Oficial só entrega modelo aprovado (HSM) — antecipe o horário
                    {canais.some((c) => c.provider === 'evolution') ? ' ou escolha um número do WhatsApp comum acima' : ''}.
                  </>
                )}
              </span>
            </div>
          )}
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
            <span class="block text-xs text-fg-muted">
              Evita mandar um follow-up para quem já voltou a falar com você.
            </span>
          </span>
        </label>

        <div class="flex gap-2 rounded-md border border-border bg-surface-2 p-3 text-xs text-fg-muted">
          <AlertTriangle size={14} class="mt-0.5 shrink-0" />
          <span>
            No horário do envio a mensagem passa pelas mesmas regras de uma mensagem digitada agora:
            número da conversa, opt-out e bloqueios de envio.
          </span>
        </div>
      </div>
    </Modal>
  )
}
