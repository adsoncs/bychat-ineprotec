import { useState } from 'preact/hooks'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ArrowRightLeft, Check, X as XIcon } from '@/components/ui/icon-set'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'
import {
  useIncomingTransferCount,
  useTransferRequests,
  useAcceptTransferRequest,
  useRejectTransferRequest,
  type TransferRequest,
} from '@/hooks/useTransferRequests'

// Bandeja de transferências pendentes — abre via botão na topbar.
// Mostra requests recebidos (incoming), com botões aceitar/recusar.
export function TransferInbox() {
  const countQuery = useIncomingTransferCount()
  const count = countQuery.data?.count ?? 0
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          class="relative inline-flex items-center justify-center size-9 rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Transferências de leads"
          title="Transferências pendentes"
        >
          <ArrowRightLeft size={18} />
          {count > 0 && (
            <span class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-fg-on-brand text-3xs font-bold flex items-center justify-center">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          class="flex flex-col w-[28rem] overflow-hidden rounded-lg border border-border bg-surface-2 shadow-xl"
          style={{
            zIndex: 'var(--z-dropdown)',
            // `max-h` com `overflow-hidden` sobre conteúdo de altura livre não
            // rola — corta. A altura precisa morar num ancestral flex para o
            // miolo abaixo ganhar barra de rolagem.
            maxHeight: 'min(32rem, var(--radix-dropdown-menu-content-available-height, 32rem))',
          }}
        >
          <TransferList onClose={() => setOpen(false)} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function TransferList({ onClose: _onClose }: { onClose: () => void }) {
  const incomingQuery = useTransferRequests('incoming', 'pending')
  const list = incomingQuery.data?.requests ?? []

  return (
    <div class="flex flex-col min-h-0 flex-1">
      <div class="shrink-0 p-3 border-b border-border">
        <div class="font-semibold text-sm">Transferências pendentes</div>
        <div class="text-xs text-fg-muted">Solicitações recebidas — você pode aceitar ou recusar.</div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {incomingQuery.isLoading ? (
          <div class="p-6 text-xs text-fg-muted">Carregando…</div>
        ) : list.length === 0 ? (
          <div class="p-6 text-xs text-fg-muted text-center">
            <ArrowRightLeft size={20} class="mx-auto mb-2 opacity-50" />
            Sem transferências pendentes.
          </div>
        ) : (
          list.map((r) => <TransferRow key={r.id} request={r} />)
        )}
      </div>
    </div>
  )
}

function TransferRow({ request }: { request: TransferRequest }) {
  const accept = useAcceptTransferRequest()
  const reject = useRejectTransferRequest()

  const handleAccept = async () => {
    try {
      await accept.mutateAsync({ id: request.id })
      toast(`Lead transferido — ${request.lead.empresa ?? request.lead.nome ?? `#${request.lead.id}`} é seu agora`, 'success')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao aceitar', 'danger')
    }
  }

  const handleReject = async () => {
    try {
      await reject.mutateAsync({ id: request.id })
      toast('Transferência recusada', 'info')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao recusar', 'danger')
    }
  }

  const requested = new Date(request.requestedAt)
  const expires = new Date(request.expiresAt)
  const hoursLeft = Math.max(0, Math.round((expires.getTime() - Date.now()) / 3600_000))

  const pending = accept.isPending || reject.isPending

  return (
    <div class="p-3 border-b border-border last:border-0 hover:bg-surface-3">
      <div class="flex items-start gap-2">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">
            {request.lead.empresa ?? request.lead.nome ?? `Lead #${request.lead.id}`}
          </div>
          <div class="text-xs text-fg-muted truncate">
            De: <strong>{request.fromUser.name}</strong>
          </div>
          {request.reason && (
            <div class="text-xs text-fg mt-1 italic">"{request.reason}"</div>
          )}
          <div class="text-3xs text-fg-muted mt-1">
            Solicitado {requested.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            {' · '}
            Expira em {hoursLeft}h
          </div>
        </div>
        <div class="flex flex-col gap-1 shrink-0">
          <Button variant="success" size="sm" onClick={handleAccept} disabled={pending}>
            <Check size={12} /> Aceitar
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReject} disabled={pending}>
            <XIcon size={12} /> Recusar
          </Button>
        </div>
      </div>
    </div>
  )
}
