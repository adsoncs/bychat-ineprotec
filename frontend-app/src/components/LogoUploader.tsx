import { useRef, useState } from 'preact/hooks'
import { Upload, Trash2, ImageIcon } from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useUploadLogo, useDeleteLogo, type LogoSlot } from '@/hooks/useSettings'
import { toast } from '@/lib/toast'

interface LogoUploaderProps {
  slot: LogoSlot
  label: string
  hint?: string
  currentUrl: string
  /** aceitar SVG/ICO além de imagens raster (favicon usa true) */
  allowVector?: boolean
}

const ACCEPT_RASTER = 'image/png,image/jpeg,image/webp,image/gif'
const ACCEPT_ALL = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico'

const MAX_BYTES = 2 * 1024 * 1024

export function LogoUploader({ slot, label, hint, currentUrl, allowVector = false }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const upload = useUploadLogo()
  const remove = useDeleteLogo()
  const [confirmOpen, setConfirmOpen] = useState(false)

  function pick() {
    inputRef.current?.click()
  }

  function handleChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) {
      toast(`Arquivo maior que 2 MB`, 'danger')
      return
    }
    upload.mutate(
      { slot, file },
      {
        onSuccess: () => toast('Logotipo atualizado', 'success'),
        onError: (err: unknown) => toast((err as Error).message, 'danger'),
      },
    )
  }

  function handleRemove() {
    remove.mutate(slot, {
      onSuccess: () => {
        toast('Logotipo removido', 'success')
        setConfirmOpen(false)
      },
      onError: (err: unknown) => {
        toast((err as Error).message, 'danger')
        setConfirmOpen(false)
      },
    })
  }

  const hasLogo = Boolean(currentUrl)

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-fg-muted">{label}</span>
        <div class="flex gap-1">
          <Button variant="secondary" size="sm" onClick={pick} disabled={upload.isPending}>
            <Upload size={14} /> {upload.isPending ? 'Enviando…' : hasLogo ? 'Trocar' : 'Enviar'}
          </Button>
          {hasLogo && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={remove.isPending}
              aria-label={`Remover ${label}`}
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      </div>

      <div class="flex h-24 items-center justify-center rounded-md border border-border bg-surface px-3">
        {hasLogo ? (
          <img
            src={currentUrl}
            alt={label}
            class="max-h-20 max-w-full object-contain"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <span class="flex items-center gap-2 text-xs text-fg-subtle">
            <ImageIcon size={16} /> sem arquivo
          </span>
        )}
      </div>

      {hint && <span class="text-[0.6875rem] text-fg-subtle">{hint}</span>}

      <input
        ref={inputRef}
        type="file"
        class="hidden"
        accept={allowVector ? ACCEPT_ALL : ACCEPT_RASTER}
        onChange={handleChange}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remover logotipo?"
        description={`Isso apaga o "${label}" da configuração. Você pode reenviar a qualquer momento.`}
        confirmLabel="Remover"
        destructive
        onConfirm={handleRemove}
        loading={remove.isPending}
      />
    </div>
  )
}
