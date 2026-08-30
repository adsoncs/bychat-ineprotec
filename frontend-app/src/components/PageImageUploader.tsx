import { useRef, useState } from 'preact/hooks'
import { Upload, Trash2, ImageIcon, Link as LinkIcon } from '@/components/ui/icon-set'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useUploadPageAsset, useDeletePageAsset, type PageAssetSlot } from '@/hooks/usePages'
import { toast } from '@/lib/toast'

interface PageImageUploaderProps {
  pageId: number
  slot: PageAssetSlot
  label: string
  value: string
  onChange: (url: string) => void
  hint?: string
  /** Permitir editar a URL manualmente (alguns assets podem vir de CDN externa). */
  allowManualUrl?: boolean
  /** Aceitar SVG/ICO além de raster (para favicon, etc.). */
  allowVector?: boolean
  /** Mostrar prévia em "container" mais alto (favicon usa baixo). */
  previewHeight?: 'sm' | 'md' | 'lg'
}

const ACCEPT_RASTER = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
const ACCEPT_ALL = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico'
const MAX_BYTES = 10 * 1024 * 1024

const HEIGHTS: Record<NonNullable<PageImageUploaderProps['previewHeight']>, string> = {
  sm: 'h-16',
  md: 'h-28',
  lg: 'h-48',
}

export function PageImageUploader({
  pageId,
  slot,
  label,
  value,
  onChange,
  hint,
  allowManualUrl = true,
  allowVector = false,
  previewHeight = 'md',
}: PageImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const upload = useUploadPageAsset()
  const remove = useDeletePageAsset()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editingUrl, setEditingUrl] = useState(false)

  function pick() { inputRef.current?.click() }

  function handleChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) {
      toast('Arquivo maior que 10 MB', 'danger')
      return
    }
    upload.mutate({ id: pageId, file, slot }, {
      onSuccess: ({ url }) => {
        onChange(url)
        toast('Imagem enviada', 'success')
      },
      onError: (err: unknown) => toast((err as Error).message, 'danger'),
    })
  }

  function handleRemove() {
    const url = value
    setConfirmOpen(false)
    onChange('')
    // Só apaga arquivo do backend se for upload local (mesmo prefixo)
    if (url?.startsWith(`/uploads/pages/${pageId}/`)) {
      remove.mutate({ id: pageId, url }, {
        onSuccess: () => toast('Imagem removida', 'success'),
        onError: (err: unknown) => toast((err as Error).message, 'warning'),
      })
    } else {
      toast('Referência removida', 'success')
    }
  }

  const hasImage = !!value.trim()
  const previewClass = `flex ${HEIGHTS[previewHeight]} items-center justify-center rounded-md border border-border bg-surface px-3 overflow-hidden`

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-fg-muted">{label}</span>
        <div class="flex gap-1">
          <Button variant="secondary" size="sm" onClick={pick} disabled={upload.isPending}>
            <Upload size={14} /> {upload.isPending ? 'Enviando…' : hasImage ? 'Trocar' : 'Enviar'}
          </Button>
          {allowManualUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingUrl((v) => !v)}
              aria-label="Editar URL"
              title="Colar URL externa"
            >
              <LinkIcon size={14} />
            </Button>
          )}
          {hasImage && (
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

      <div class={previewClass}>
        {hasImage ? (
          <img
            src={value}
            alt={label}
            class="max-h-full max-w-full object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <span class="flex items-center gap-2 text-xs text-fg-muted">
            <ImageIcon size={16} /> sem arquivo
          </span>
        )}
      </div>

      {editingUrl && (
        <Input
          value={value}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
          placeholder="https://..."
          hint="Cole uma URL externa (CDN, etc.) ou deixe vazio para usar arquivo enviado."
        />
      )}

      {hint && <span class="text-2xs text-fg-muted">{hint}</span>}

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
        title={`Remover ${label}?`}
        description="A referência é apagada da página. Se for um arquivo enviado, ele também é apagado do servidor."
        confirmLabel="Remover"
        destructive
        onConfirm={handleRemove}
        loading={remove.isPending}
      />
    </div>
  )
}
