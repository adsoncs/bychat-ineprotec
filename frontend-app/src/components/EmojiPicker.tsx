import { useMemo, useState } from 'preact/hooks'
import * as Popover from '@radix-ui/react-popover'
import { Smile, Search } from '@/components/ui/icon-set'
import { cn } from '@/lib/cn'

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
}

interface EmojiSection {
  label: string
  emojis: { e: string; k: string }[]
}

const SECTIONS: EmojiSection[] = [
  {
    label: 'Frequentes',
    emojis: [
      { e: '👍', k: 'positivo joia like ok' },
      { e: '❤️', k: 'coracao amor love' },
      { e: '🙏', k: 'obrigado por favor please' },
      { e: '🎉', k: 'parabens festa party' },
      { e: '🔥', k: 'fogo top hot' },
      { e: '✅', k: 'check ok concluido' },
      { e: '😂', k: 'rindo lol haha' },
      { e: '😊', k: 'sorriso feliz' },
      { e: '🤝', k: 'aperto mao deal' },
      { e: '⚡', k: 'rapido raio' },
    ],
  },
  {
    label: 'Rostos',
    emojis: [
      { e: '😀', k: 'sorriso feliz' },
      { e: '😃', k: 'feliz' },
      { e: '😄', k: 'rindo' },
      { e: '😁', k: 'sorriso' },
      { e: '😆', k: 'rindo' },
      { e: '🥹', k: 'emocionado' },
      { e: '😅', k: 'aliviado risada' },
      { e: '🤣', k: 'rolando rindo' },
      { e: '😉', k: 'piscadinha' },
      { e: '😍', k: 'apaixonado love' },
      { e: '😘', k: 'beijo' },
      { e: '🥰', k: 'amor coracoes' },
      { e: '😎', k: 'oculos cool' },
      { e: '🤔', k: 'pensando' },
      { e: '🤩', k: 'estrelas wow' },
      { e: '😢', k: 'triste lagrima' },
      { e: '😭', k: 'chorando' },
      { e: '😡', k: 'raiva bravo' },
      { e: '🤯', k: 'mente explodindo' },
      { e: '😴', k: 'dormindo' },
    ],
  },
  {
    label: 'Mãos',
    emojis: [
      { e: '👍', k: 'joia like positivo' },
      { e: '👎', k: 'negativo dislike' },
      { e: '👏', k: 'palmas aplausos' },
      { e: '🙌', k: 'maos para cima' },
      { e: '🙏', k: 'obrigado por favor' },
      { e: '👋', k: 'oi tchau' },
      { e: '✌️', k: 'paz vitoria' },
      { e: '🤞', k: 'torcendo' },
      { e: '🤝', k: 'aperto mao deal' },
      { e: '👌', k: 'ok perfeito' },
      { e: '💪', k: 'forca biceps' },
    ],
  },
  {
    label: 'Símbolos',
    emojis: [
      { e: '✅', k: 'check ok' },
      { e: '❌', k: 'errado x' },
      { e: '⚠️', k: 'aviso atencao' },
      { e: '⭐', k: 'estrela' },
      { e: '💡', k: 'ideia luz' },
      { e: '🔥', k: 'fogo top' },
      { e: '⚡', k: 'rapido raio' },
      { e: '🎉', k: 'parabens festa' },
      { e: '🎁', k: 'presente' },
      { e: '💰', k: 'dinheiro' },
      { e: '📞', k: 'telefone ligacao' },
      { e: '📧', k: 'email' },
      { e: '📅', k: 'agenda' },
      { e: '⏰', k: 'relogio horario' },
      { e: '✨', k: 'brilho' },
      { e: '❤️', k: 'coracao amor' },
      { e: '💔', k: 'coracao partido' },
      { e: '☑️', k: 'caixa marcada' },
    ],
  },
]

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.map((s) => ({
      ...s,
      emojis: s.emojis.filter((it) => it.k.toLowerCase().includes(q) || it.e.includes(q)),
    })).filter((s) => s.emojis.length > 0)
  }, [search])

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          class="size-9 shrink-0 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg grid place-items-center"
          aria-label="Emoji"
        >
          <Smile size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          class={cn(
            'w-72 rounded-lg border border-border bg-surface-2 p-2 shadow-xl',
          )}
          style={{ zIndex: 'var(--z-popover)' }}
        >
          <div class="relative mb-2">
            <Search
              size={12}
              class="absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted"
            />
            <input
              type="text"
              autoFocus
              placeholder="Buscar emoji…"
              class="h-8 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-xs text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
              value={search}
              onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <p class="py-4 text-center text-2xs text-fg-muted">Nenhum emoji</p>
            )}
            {filtered.map((s) => (
              <div key={s.label} class="mb-2">
                <div class="mb-1 px-1 text-2xs font-medium text-fg-muted">{s.label}</div>
                <div class="grid grid-cols-8 gap-0.5">
                  {s.emojis.map((it) => (
                    <button
                      key={it.e}
                      type="button"
                      class="grid size-8 place-items-center rounded hover:bg-surface-3 text-base"
                      onClick={() => onSelect(it.e)}
                      title={it.k.split(' ')[0]}
                    >
                      {it.e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
