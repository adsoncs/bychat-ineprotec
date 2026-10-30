import { useEffect, useState } from 'preact/hooks'
import { Clock } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { useCreateScheduledMessage } from '@/hooks/useScheduledMessages'
import { useSenderChannels } from '@/hooks/useChat'
import { AgendarWhatsappForm, agendamentoNovo, validarAgendamento, payloadDoAgendamento, type AgendamentoWhatsapp } from '@/components/AgendarWhatsappForm'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadId: number
  /** Texto que já estava no compositor — agendar não deve fazer redigitar. */
  textoInicial?: string
  /** Nome do contato: preenche a variável de nome do modelo aprovado. */
  nomeDoContato?: string | null | undefined
  onAgendado?: () => void
}

/** "Agendar envio" do Conversas. O formulário é o mesmo de Nova/Editar
 *  atividade (AgendarWhatsappForm): o agendamento É uma atividade. */
export function ScheduleMessageModal({ open, onOpenChange, leadId, textoInicial, nomeDoContato, onAgendado }: Props) {
  const [valor, setValor] = useState<AgendamentoWhatsapp>(() => agendamentoNovo(textoInicial ?? ''))
  const criar = useCreateScheduledMessage(leadId)
  const { data: sc } = useSenderChannels(leadId)

  // Abriu de novo: traz o que está no compositor agora (o estado do modal
  // sobrevive entre aberturas e mostraria o texto da vez anterior).
  useEffect(() => {
    if (open) setValor(agendamentoNovo(textoInicial ?? ''))
  }, [open])

  function agendar() {
    const erro = validarAgendamento(valor, sc)
    if (erro) { toast(erro, 'warning'); return }
    const p = payloadDoAgendamento(valor, sc)
    criar.mutate(
      { ...p, channelId: p.channelId ?? undefined, templateId: p.templateId ?? undefined },
      {
        onSuccess: () => {
          toast('Mensagem agendada — ela está em Atividades', 'success')
          onOpenChange(false)
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
      title="Agendar envio"
      description="A mensagem vira uma atividade de WhatsApp e sai sozinha no horário escolhido."
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
      <AgendarWhatsappForm leadId={leadId} valor={valor} onChange={setValor} sc={sc} nomeDoContato={nomeDoContato} />
    </Modal>
  )
}
