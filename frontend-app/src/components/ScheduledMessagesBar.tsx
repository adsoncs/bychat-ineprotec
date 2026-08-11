import { useState } from 'preact/hooks'
import { Clock, X, ChevronDown, ChevronUp } from 'lucide-preact'
import { toast } from '@/lib/toast'
import { useScheduledMessages, useCancelScheduledMessage } from '@/hooks/useScheduledMessages'

/** "hoje 14:30" / "amanhã 09:00" / "14/08 09:00" — o operador pensa em dias,
 *  não em datas completas. */
function quandoLegivel(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const amanha = new Date(hoje)
  amanha.setDate(amanha.getDate() + 1)
  const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (mesmoDia(d, hoje)) return `hoje ${hora}`
  if (mesmoDia(d, amanha)) return `amanhã ${hora}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`
}

/** Faixa discreta acima do compositor com o que ainda vai sair nesta conversa.
 *  Some quando não há nada pendente — não ocupa espaço à toa. */
export function ScheduledMessagesBar({ leadId }: { leadId: number }) {
  const [aberto, setAberto] = useState(false)
  const q = useScheduledMessages(leadId, 'pending')
  const cancelar = useCancelScheduledMessage(leadId)
  const itens = q.data?.items ?? []

  if (!itens.length) return null

  return (
    <div class="border-t border-border bg-surface-2 px-3 py-1.5 text-xs">
      <button
        type="button"
        class="flex w-full items-center gap-2 text-fg-muted hover:text-fg"
        onClick={() => setAberto((v) => !v)}
      >
        <Clock size={13} class="shrink-0" />
        <span>
          {itens.length === 1
            ? `1 mensagem agendada para ${quandoLegivel(itens[0]!.scheduledAt)}`
            : `${itens.length} mensagens agendadas`}
        </span>
        {aberto ? <ChevronDown size={13} class="ml-auto" /> : <ChevronUp size={13} class="ml-auto" />}
      </button>

      {aberto && (
        <ul class="mt-1.5 space-y-1">
          {itens.map((i) => (
            <li key={i.id} class="flex items-start gap-2 rounded-md bg-surface px-2 py-1.5">
              <span class="shrink-0 font-medium text-fg-muted">{quandoLegivel(i.scheduledAt)}</span>
              <span class="min-w-0 flex-1 truncate text-fg">
                {i.body || i.template?.name || '(modelo)'}
              </span>
              <button
                type="button"
                class="shrink-0 rounded p-0.5 text-fg-subtle hover:bg-surface-3 hover:text-danger disabled:opacity-50"
                title="Cancelar agendamento"
                aria-label="Cancelar agendamento"
                disabled={cancelar.isPending}
                onClick={() =>
                  cancelar.mutate(i.id, {
                    onSuccess: () => toast('Agendamento cancelado', 'success'),
                    onError: (e: unknown) => toast((e as Error).message, 'danger'),
                  })
                }
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
