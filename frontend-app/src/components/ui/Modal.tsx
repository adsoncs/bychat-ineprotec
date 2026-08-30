import type { ComponentChildren } from 'preact'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from '@/components/ui/icon-set'
import { cn } from '@/lib/cn'

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string | undefined
  children: ComponentChildren
  footer?: ComponentChildren
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full' | undefined
  /** quando true, o conteúdo ocupa toda a largura do modal (sem max-w interno).
   *  útil para layouts grid/multi-coluna que precisam aproveitar o espaço. */
  unconstrained?: boolean | undefined
}

const sizeClasses: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  full: 'max-w-none',
}

export function Modal({ open, onOpenChange, title, description, children, footer, size = 'md', unconstrained = false }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* O único `backdrop-filter` do painel, e de propósito: é uma área que
            só existe enquanto o modal está aberto, então o custo de composição
            não entra em nenhuma rolagem de lista. O véu escureceu de 0.5 para
            0.62 porque o fundo da janela agora é quase preto — a 0.5 quase não
            se distinguia do que havia por baixo. */}
        <Dialog.Overlay
          class="fixed inset-0 bg-[oklch(0%_0_0/0.62)] backdrop-blur-sm"
          style={{ zIndex: 'var(--z-backdrop)' }}
        />
        <Dialog.Content
          class={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            size === 'full'
              ? 'w-[95vw] h-[95dvh] max-h-[95dvh] flex flex-col'
              : 'w-[min(90vw,var(--modal-max))] max-h-[85dvh] flex flex-col',
            /* Mesmo raio e mesma mecânica do painel de conteúdo: o modal é o
               plano flutuante em outra escala, não uma caixa de outro sistema. */
            /* `overflow-hidden` é o que deixa cabeçalho e rodapé respeitarem o
               raio do container sem precisar repetir o raio em cada um. Os
               popovers do Radix são portalizados para fora, então não são
               cortados por ele. */
            'rounded-panel overflow-hidden bg-surface-2 shadow-xl surface-raised',
          )}
          style={{ zIndex: 'var(--z-modal)', ['--modal-max' as string]: { sm: '24rem', md: '32rem', lg: '40rem', xl: '52rem', full: '100vw' }[size] }}
          onInteractOutside={(e) => {
            // Popovers/DropdownMenus do Radix são portalizados pra fora do Dialog.Content;
            // ignora cliques nesses layers pra não fechar o modal (ex: ColorPicker).
            const target = e.target as HTMLElement | null
            if (target?.closest('[data-radix-popper-content-wrapper]')) {
              e.preventDefault()
            }
          }}
        >
          <header class="flex items-start justify-between gap-3 p-4 border-b border-border">
            <div class="min-w-0 flex-1">
              <Dialog.Title class="text-base font-bold tracking-tight text-fg truncate">{title}</Dialog.Title>
              {description && (
                <Dialog.Description class="text-xs text-fg-muted mt-0.5">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              class="size-8 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg flex items-center justify-center shrink-0"
              aria-label="Fechar"
            >
              <X size={16} />
            </Dialog.Close>
          </header>
          <div class="flex-1 overflow-y-auto p-4">
            {unconstrained ? children : <div class={`mx-auto ${sizeClasses[size]}`}>{children}</div>}
          </div>
          {/* O rodapé afunda em vez de ser separado por linha — mesma regra do
              resto da pele: o que muda de papel muda de plano. */}
          {footer && (
            <footer class="flex items-center justify-end gap-2 p-4 bg-surface-inset">
              {footer}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
