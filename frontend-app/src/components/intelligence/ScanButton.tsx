import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Zap, Layers3, ChevronDown, RefreshCw } from 'lucide-preact'
import type { ScanMode } from '@/hooks/useIntelligence'

interface ScanButtonProps {
  onScan: (mode: ScanMode, force?: boolean) => void
  disabled?: boolean | undefined
  label?: string | undefined
  size?: 'sm' | 'md'
}

/**
 * Botão "Enriquecer" com dropdown de duas opções:
 *   - Scan rápido (~2s, só APIs oficiais — Tier 1)
 *   - Scan completo (~15s, inclui scraping leve e redes sociais — Tier 3)
 *
 * Click direto dispara o scan completo (decisão de produto: o vendedor
 * sempre quer o máximo possível, a opção rápida é para bulk).
 */
export function ScanButton({ onScan, disabled, label = 'Enriquecer', size = 'sm' }: ScanButtonProps) {
  const sizeClass = size === 'md' ? 'h-9 px-3 text-sm' : 'h-7 px-2 text-xs'
  return (
    <div class="inline-flex">
      <button
        type="button"
        class={`inline-flex items-center gap-1 ${sizeClass} rounded-l-md border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed`}
        onClick={() => onScan('full')}
        disabled={disabled}
      >
        <RefreshCw size={size === 'md' ? 14 : 12} />
        {label}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            class={`inline-flex items-center ${sizeClass} px-1.5 rounded-r-md border border-l-0 border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed`}
            disabled={disabled}
            aria-label="Opções de enriquecimento"
          >
            <ChevronDown size={size === 'md' ? 14 : 12} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            class="min-w-[18rem] rounded-md bg-surface-2 border border-border shadow-lg p-1"
            style={{ zIndex: 'var(--z-popover)' }}
          >
            <DropdownMenu.Item
              onSelect={() => onScan('quick')}
              class="flex items-start gap-2 p-2 rounded text-xs hover:bg-surface-3 cursor-pointer focus:outline-none focus:bg-surface-3"
            >
              <Zap size={14} class="text-warning mt-0.5 shrink-0" />
              <div class="min-w-0">
                <div class="text-fg font-medium">Scan rápido</div>
                <div class="text-fg-subtle text-[0.6875rem] leading-relaxed">
                  ~2s. Só APIs oficiais (Gravatar, BrasilAPI, ViaCEP, validação de telefone).
                </div>
              </div>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => onScan('full')}
              class="flex items-start gap-2 p-2 rounded text-xs hover:bg-surface-3 cursor-pointer focus:outline-none focus:bg-surface-3"
            >
              <Layers3 size={14} class="text-accent mt-0.5 shrink-0" />
              <div class="min-w-0">
                <div class="text-fg font-medium">Scan completo</div>
                <div class="text-fg-subtle text-[0.6875rem] leading-relaxed">
                  ~15s. Inclui Google CSE, GitHub, scraping leve e redes sociais. Padrão.
                </div>
              </div>
            </DropdownMenu.Item>
            <DropdownMenu.Separator class="h-px bg-border my-1" />
            <DropdownMenu.Item
              onSelect={() => onScan('full', true)}
              class="flex items-start gap-2 p-2 rounded text-xs hover:bg-surface-3 cursor-pointer focus:outline-none focus:bg-surface-3"
            >
              <RefreshCw size={14} class="text-fg-muted mt-0.5 shrink-0" />
              <div class="min-w-0">
                <div class="text-fg font-medium">Forçar reprocessamento</div>
                <div class="text-fg-subtle text-[0.6875rem] leading-relaxed">
                  Ignora cache e refaz tudo. Use quando dados públicos podem ter mudado.
                </div>
              </div>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
