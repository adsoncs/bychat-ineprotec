// components/shell/WorkInbox.tsx
//
// A bandeja única da barra superior: alertas, transferências e duplicados numa
// caixa só, com um contador somado.
//
// Antes eram três botões vizinhos, cada um com o seu próprio número — e o olho
// lia a fileira como enfeite, não como trabalho. O que mudou não é só arrumação:
// três contadores obrigam a pessoa a somar de cabeça para saber se há algo para
// ela. Um número responde isso de uma vez.
//
// A caixa abre na PRIMEIRA ABA COM PENDÊNCIA, nesta ordem: transferências (é a
// única que expira e trava o trabalho de outra pessoa), alertas, duplicados.
// Sem isso, quem tinha uma transferência esperando pagaria um clique a mais do
// que pagava antes — e a reorganização teria piorado o caso que mais importa.

import { useState, useMemo } from 'preact/hooks'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useLocation } from 'wouter-preact'
import { Inbox, Copy, ArrowRight } from '@/components/ui/icon-set'
import { ListaDeAlertas, useAvisoDeAlertaAoVivo } from '@/components/alerts/AlertInbox'
import { TransferList } from '@/components/routing/TransferInbox'
import { useUnreadAlertCount } from '@/hooks/useAlerts'
import { useIncomingTransferCount } from '@/hooks/useTransferRequests'
import { useDuplicatesCount } from '@/hooks/useLeads'
import { cn } from '@/lib/cn'
import { TopbarUtil } from './TopbarUtil'
import { ICON_SIZE } from '@/components/ui/Icon'

type Aba = 'alertas' | 'transferencias' | 'duplicados'

export function WorkInbox() {
  const [open, setOpen] = useState(false)
  const [abaEscolhida, setAbaEscolhida] = useState<Aba | null>(null)

  const alertas = useUnreadAlertCount().data?.count ?? 0
  const transferencias = useIncomingTransferCount().data?.count ?? 0
  const duplicados = useDuplicatesCount().data?.count ?? 0
  const total = alertas + transferencias + duplicados

  // O aviso sonoro e a notificação da área de trabalho moravam no sino. Como o
  // sino deixou de existir sozinho, o hook veio junto — senão o alerta deixaria
  // de tocar sem que ninguém percebesse.
  useAvisoDeAlertaAoVivo()

  const abaPadrao: Aba = transferencias > 0 ? 'transferencias' : alertas > 0 ? 'alertas' : duplicados > 0 ? 'duplicados' : 'alertas'
  const aba = abaEscolhida ?? abaPadrao

  const abas: { id: Aba; label: string; n: number }[] = useMemo(() => ([
    { id: 'alertas', label: 'Alertas', n: alertas },
    { id: 'transferencias', label: 'Transferências', n: transferencias },
    { id: 'duplicados', label: 'Duplicados', n: duplicados },
  ]), [alertas, transferencias, duplicados])

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        // Ao fechar, esquece a aba escolhida: na próxima vez a caixa volta a
        // abrir onde há pendência, que é o motivo de ela existir.
        if (!v) setAbaEscolhida(null)
      }}
    >
      <DropdownMenu.Trigger asChild>
        {/* O mesmo botão das outras utilidades: é o que mantém os contadores
            vizinhos na mesma altura e o hover do mesmo tamanho. */}
        <TopbarUtil titulo="Alertas, transferências e duplicados" badge={total}>
          <Inbox size={ICON_SIZE.md} />
        </TopbarUtil>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          class="flex flex-col w-[28rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-surface-2 shadow-xl"
          style={{
            zIndex: 'var(--z-dropdown)',
            // A altura mora AQUI para o miolo ganhar rolagem — `max-h` com
            // `overflow-hidden` sobre conteúdo de altura livre corta em silêncio.
            maxHeight: 'min(32rem, var(--radix-dropdown-menu-content-available-height, 32rem))',
          }}
        >
          <div class="shrink-0 flex gap-1 px-2 pt-2 border-b border-border">
            {abas.map((a) => (
              <button
                key={a.id}
                type="button"
                class={cn(
                  'inline-flex items-center gap-1.5 px-2.5 pb-2 pt-1 text-xs border-b-2 -mb-px transition-colors',
                  a.id === aba
                    ? 'border-accent text-fg font-semibold'
                    : 'border-transparent text-fg-muted hover:text-fg',
                )}
                onClick={() => setAbaEscolhida(a.id)}
              >
                {a.label}
                {a.n > 0 && (
                  <span class={cn(
                    'min-w-[1.1rem] px-1 rounded-full text-3xs font-bold',
                    a.id === aba ? 'bg-accent text-fg-on-brand' : 'bg-surface-3 text-fg',
                  )}>
                    {a.n > 99 ? '99+' : a.n}
                  </span>
                )}
              </button>
            ))}
          </div>

          {aba === 'alertas' && (
            <ListaDeAlertas aberta={open} naoLidos={alertas} onFechar={() => setOpen(false)} embutida />
          )}
          {aba === 'transferencias' && (
            <TransferList onClose={() => setOpen(false)} embutida />
          )}
          {aba === 'duplicados' && (
            <PainelDeDuplicados total={duplicados} onFechar={() => setOpen(false)} />
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * Duplicados não vira lista aqui de propósito.
 *
 * Decidir se dois cadastros são a mesma pessoa exige ver os dois lado a lado, e
 * isso já existe em `/app/leads/duplicates`. Repetir a decisão num popover de
 * 28rem seria oferecer o mesmo trabalho com menos informação — o que a bandeja
 * precisa fazer é dizer que há o que revisar, e levar até lá.
 */
function PainelDeDuplicados({ total, onFechar }: { total: number; onFechar: () => void }) {
  const [, navigate] = useLocation()
  return (
    <div class="flex flex-col min-h-0 flex-1">
      <div class="flex-1 min-h-0 overflow-y-auto p-6 text-center">
        <Copy size={20} class="mx-auto mb-2 opacity-50 text-fg-muted" />
        {total === 0 ? (
          <p class="text-xs text-fg-muted">Nenhum cadastro duplicado esperando revisão.</p>
        ) : (
          <>
            <p class="text-sm text-fg font-medium">
              {total === 1 ? '1 possível duplicado' : `${total} possíveis duplicados`}
            </p>
            <p class="text-xs text-fg-muted mt-1 mb-4">
              A revisão compara os dois cadastros lado a lado antes de juntar qualquer coisa.
            </p>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent text-fg-on-brand text-xs font-semibold"
              onClick={() => { onFechar(); navigate('/app/leads/duplicates') }}
            >
              Revisar agora
              <ArrowRight size={ICON_SIZE.xs} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
