// Componentes de anexos por atividade.
//
//   <ActivityAttachments activityId leadId />     → usado em ActivityRow.
//     Carrega anexos do servidor, permite adicionar (+) e remover (X).
//     Mostra thumbnails 48px para imagens, ícone+nome para outros.
//     Click em imagem abre lightbox; outros abrem em nova aba.
//
//   <PendingAttachmentsPicker files onChange />   → usado em CreateActivityModal.
//     Estado local de File[] antes de existir activityId. O modal sobe cada
//     arquivo via POST /activities/:id/attachments após criar a Activity.

import { useState, useRef, useEffect } from 'preact/hooks'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Plus, Trash2, Download, FileImage, FileText, File as FileIcon, X,
  Loader2, AlertCircle, Paperclip, ClipboardPaste, MoreVertical, Eye, RefreshCw,
} from 'lucide-preact'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import {
  useActivityAttachments, useUploadActivityAttachment, useDeleteActivityAttachment,
  type LeadAttachment,
} from '@/hooks/useLeadAttachments'

const MAX_BYTES = 25 * 1024 * 1024

function isImage(mime: string): boolean {
  return mime.startsWith('image/')
}

// Extrai imagens do clipboard (Print Screen, Cmd+Shift+4 etc.) gerando File com
// nome útil — o clipboard manda blob anônimo com nome "image.png" que ficaria
// confuso se vários prints fossem colados na mesma atividade.
function extractImagesFromClipboard(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items
  if (!items) return []
  const out: File[] = []
  let idx = 0
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const blob = item.getAsFile()
      if (blob) {
        const ext = (blob.type.split('/')[1] || 'png').toLowerCase().split(';')[0] || 'png'
        const suffix = idx > 0 ? `-${idx}` : ''
        out.push(new File([blob], `colado-${Date.now()}${suffix}.${ext}`, { type: blob.type }))
        idx++
      }
    }
  }
  return out
}

// Lê o clipboard via Clipboard API moderna (botão "Colar"). Requer HTTPS +
// permissão do usuário; cai gracioso quando não suportado.
async function readImagesFromClipboardAPI(): Promise<File[]> {
  const read = (navigator.clipboard as any)?.read
  if (!read) throw new Error('Seu navegador não permite ler imagens do clipboard. Use Ctrl+V.')
  const items = await (navigator.clipboard as any).read()
  const out: File[] = []
  let idx = 0
  for (const item of items) {
    const imgType = (item.types as string[]).find((t) => t.startsWith('image/'))
    if (!imgType) continue
    const blob: Blob = await item.getType(imgType)
    const ext = (imgType.split('/')[1] || 'png').toLowerCase().split(';')[0] || 'png'
    const suffix = idx > 0 ? `-${idx}` : ''
    out.push(new File([blob], `colado-${Date.now()}${suffix}.${ext}`, { type: imgType }))
    idx++
  }
  return out
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function iconFor(mime: string) {
  if (isImage(mime)) return FileImage
  if (mime === 'application/pdf' || mime.includes('document') || mime.includes('text/') || mime.includes('sheet')) return FileText
  return FileIcon
}

// ──────────────────────────────────────────────────────────────
//  Anexos de uma activity existente (ActivityRow)
// ──────────────────────────────────────────────────────────────

export function ActivityAttachments({
  activityId, leadId, compact = false,
}: {
  activityId: number
  leadId: number
  compact?: boolean
}) {
  const { data, isLoading } = useActivityAttachments(activityId)
  const upload = useUploadActivityAttachment()
  const removeMut = useDeleteActivityAttachment()

  const inputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<LeadAttachment | null>(null)
  const [deleting, setDeleting] = useState<LeadAttachment | null>(null)
  const [replacing, setReplacing] = useState<LeadAttachment | null>(null)

  const attachments = data?.attachments ?? []
  const isUploading = upload.isPending

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    let okCount = 0
    let failCount = 0
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast(`"${file.name}" tem ${formatSize(file.size)} (máx 25MB)`, 'danger')
        failCount++
        continue
      }
      try {
        await upload.mutateAsync({ activityId, file })
        okCount++
      } catch (err) {
        failCount++
        const msg = err instanceof Error ? err.message : String(err)
        toast(`Falha em "${file.name}": ${msg}`, 'danger')
      }
    }
    if (okCount > 0) toast(okCount === 1 ? 'Anexo adicionado' : `${okCount} anexos adicionados`, 'success')
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); e.stopPropagation(); setDragging(false)
    handleFiles(e.dataTransfer?.files ?? null)
  }
  function onDragOver(e: DragEvent) {
    e.preventDefault(); e.stopPropagation()
    if (!dragging) setDragging(true)
  }
  function onDragLeave(e: DragEvent) {
    e.preventDefault(); e.stopPropagation()
    const rt = e.relatedTarget as Node | null
    if (rt && e.currentTarget instanceof Node && e.currentTarget.contains(rt)) return
    setDragging(false)
  }

  async function confirmDelete() {
    if (!deleting) return
    try {
      await removeMut.mutateAsync({ activityId, attachmentId: deleting.id, leadId })
      toast('Anexo removido', 'success')
      if (preview?.id === deleting.id) setPreview(null)
      setDeleting(null)
    } catch {
      toast('Falha ao remover', 'danger')
    }
  }

  // "Trocar": file picker compartilhado seta `replacing` antes de abrir, e o
  // onChange aqui resolve qual anexo está sendo substituído.
  function startReplace(att: LeadAttachment) {
    setReplacing(att)
    // Pequeno delay garante que o state seta antes do click
    setTimeout(() => replaceInputRef.current?.click(), 0)
  }

  async function handleReplaceFile(file: File | null) {
    const target = replacing
    setReplacing(null)
    if (replaceInputRef.current) replaceInputRef.current.value = ''
    if (!target || !file) return
    if (file.size > MAX_BYTES) {
      toast(`"${file.name}" tem ${formatSize(file.size)} (máx 25MB)`, 'danger')
      return
    }
    // Upload primeiro — se falhar, NÃO apaga o antigo (não fica sem nada).
    try {
      await upload.mutateAsync({ activityId, file })
    } catch (err) {
      toast(`Falha ao enviar substituto: ${(err as Error).message}`, 'danger')
      return
    }
    try {
      await removeMut.mutateAsync({ activityId, attachmentId: target.id, leadId })
      toast(`"${target.fileName}" substituído por "${file.name}"`, 'success')
      if (preview?.id === target.id) setPreview(null)
    } catch {
      // Upload OK, delete falhou → operador fica com 2 anexos (não é perda de dado).
      toast('Substituto enviado, mas falha ao remover o antigo. Remova manualmente.', 'warning')
    }
  }

  // Paste local (tabindex no container → Ctrl+V quando focado dispara aqui).
  // Não usamos listener global pra não conflitar com 20 ActivityAttachments
  // na mesma página (cada um capturaria o mesmo evento).
  async function onPasteContainer(e: ClipboardEvent) {
    const imgs = extractImagesFromClipboard(e)
    if (imgs.length === 0) return
    e.preventDefault()
    const fl = new DataTransfer()
    for (const f of imgs) fl.items.add(f)
    await handleFiles(fl.files)
  }

  async function pasteFromClipboardApi() {
    try {
      const imgs = await readImagesFromClipboardAPI()
      if (imgs.length === 0) {
        toast('Não há imagem no clipboard', 'info')
        return
      }
      const fl = new DataTransfer()
      for (const f of imgs) fl.items.add(f)
      await handleFiles(fl.files)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao ler clipboard'
      toast(msg, 'danger')
    }
  }

  // Esconde quando vazio e ainda carregando — evita flash de "Anexar" enquanto busca.
  if (isLoading && attachments.length === 0) return null
  if (attachments.length === 0) {
    // Botão minimalista pra adicionar primeiros anexos (sem ocupar espaço se não usado)
    return (
      <>
        <div class="mt-1.5 flex items-center gap-1">
          <input
            ref={inputRef}
            type="file"
            multiple
            class="hidden"
            onChange={(e) => {
              handleFiles((e.target as HTMLInputElement).files)
              if (inputRef.current) inputRef.current.value = ''
            }}
          />
          <button
            type="button"
            class="inline-flex items-center gap-1 h-6 px-2 rounded text-[0.6875rem] font-medium border border-dashed border-border text-fg-subtle hover:text-fg hover:border-accent hover:bg-accent/5"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? <Loader2 size={10} class="animate-spin" /> : <Paperclip size={10} />}
            {isUploading ? 'Enviando…' : 'Anexar arquivo'}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 h-6 px-2 rounded text-[0.6875rem] font-medium text-fg-subtle hover:text-accent hover:bg-accent/5 disabled:opacity-40"
            onClick={pasteFromClipboardApi}
            disabled={isUploading}
            title="Cola a última imagem copiada"
          >
            <ClipboardPaste size={10} /> Colar
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div
        tabIndex={0}
        class={cn(
          'mt-2 rounded-md border border-border bg-surface-2/40 p-1.5 transition-colors outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent',
          dragging && 'ring-2 ring-accent border-accent bg-accent/5',
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onPaste={onPasteContainer as any}
      >
        <div class="flex items-center gap-1.5 flex-wrap">
          {attachments.map((a) => (
            <AttachmentChip
              key={a.id}
              attachment={a}
              onOpen={() => isImage(a.mimeType) ? setPreview(a) : window.open(a.url, '_blank', 'noopener')}
              onDelete={() => setDeleting(a)}
              onReplace={() => startReplace(a)}
            />
          ))}
          <input
            ref={inputRef}
            type="file"
            multiple
            class="hidden"
            onChange={(e) => {
              handleFiles((e.target as HTMLInputElement).files)
              if (inputRef.current) inputRef.current.value = ''
            }}
          />
          {/* File input compartilhado para a ação "Trocar" do menu de cada chip.
              Único pra todos os anexos — qual está sendo substituído fica em `replacing`. */}
          <input
            ref={replaceInputRef}
            type="file"
            class="hidden"
            onChange={(e) => {
              const files = (e.target as HTMLInputElement).files
              handleReplaceFile(files && files.length > 0 ? files[0]! : null)
            }}
          />
          <button
            type="button"
            class="size-12 rounded-md border border-dashed border-border bg-surface text-fg-subtle hover:text-fg hover:border-accent hover:bg-accent/5 grid place-items-center"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            title="Anexar mais"
            aria-label="Anexar mais"
          >
            {isUploading ? <Loader2 size={14} class="animate-spin" /> : <Plus size={14} />}
          </button>
          <button
            type="button"
            class="size-12 rounded-md border border-dashed border-border bg-surface text-fg-subtle hover:text-accent hover:border-accent hover:bg-accent/5 grid place-items-center"
            onClick={pasteFromClipboardApi}
            disabled={isUploading}
            title="Colar imagem do clipboard"
            aria-label="Colar imagem do clipboard"
          >
            <ClipboardPaste size={14} />
          </button>
        </div>
        {!compact && (
          <div class="text-[0.625rem] text-fg-subtle mt-1.5 px-0.5">
            {attachments.length} anexo{attachments.length === 1 ? '' : 's'} · arraste, clique em
            <Plus size={9} class="inline mx-0.5" />
            ou <kbd class="px-1 rounded border border-border bg-surface text-[0.625rem] font-mono">Ctrl+V</kbd> com a área em foco
          </div>
        )}
      </div>

      {preview && <ImageLightbox attachment={preview} onClose={() => setPreview(null)} onDelete={() => setDeleting(preview)} />}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(v) => { if (!v) setDeleting(null) }}
          title="Remover anexo?"
          description={`"${deleting.fileName}" será apagado desta atividade e do disco. Esta ação não pode ser desfeita.`}
          confirmLabel="Remover"
          destructive
          loading={removeMut.isPending}
          onConfirm={confirmDelete}
        />
      )}
    </>
  )
}

function AttachmentChip({
  attachment, onOpen, onDelete, onReplace,
}: {
  attachment: LeadAttachment
  onOpen: () => void
  onDelete: () => void
  onReplace: () => void
}) {
  const img = isImage(attachment.mimeType)
  const Icon = iconFor(attachment.mimeType)
  const tip = `${attachment.fileName} · ${formatSize(attachment.fileSize)} · ${attachment.uploadedByName ?? 'Sistema'} · ${formatDate(attachment.createdAt)}`

  return (
    <div class="relative group">
      <button
        type="button"
        class="size-12 rounded-md border border-border bg-surface overflow-hidden hover:border-accent block"
        onClick={onOpen}
        title={tip}
        aria-label={tip}
      >
        {img ? (
          <img
            src={attachment.url}
            alt={attachment.fileName}
            class="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div class="h-full w-full grid place-items-center bg-surface-2 text-fg-muted">
            <Icon size={18} />
          </div>
        )}
      </button>
      {!img && (
        <div class="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[0.5625rem] text-white bg-black/55 truncate pointer-events-none">
          {attachment.fileName}
        </div>
      )}
      {/* Menu kebab no canto — substitui o X destrutivo de hover. Mesmo se o
          operador clicar por engano, o pior que acontece é abrir o menu. As
          ações destrutivas (Excluir) ainda passam por ConfirmDialog. */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            class="absolute top-0.5 right-0.5 size-5 rounded grid place-items-center bg-black/55 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/75 data-[state=open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
            title="Ações do anexo"
            aria-label="Ações do anexo"
          >
            <MoreVertical size={11} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            class="z-50 min-w-[160px] rounded-md border border-border bg-surface-2 shadow-lg p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu.Item
              class="flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-fg hover:bg-surface-3 cursor-pointer outline-none"
              onSelect={() => onOpen()}
            >
              <Eye size={12} /> {img ? 'Visualizar' : 'Abrir'}
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <a
                href={attachment.url}
                download={attachment.fileName}
                target="_blank"
                rel="noopener"
                class="flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-fg hover:bg-surface-3 cursor-pointer outline-none"
                onClick={(e) => e.stopPropagation()}
              >
                <Download size={12} /> Baixar
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-fg hover:bg-surface-3 cursor-pointer outline-none"
              onSelect={() => onReplace()}
            >
              <RefreshCw size={12} /> Trocar arquivo
            </DropdownMenu.Item>
            <DropdownMenu.Separator class="my-1 h-px bg-border" />
            <DropdownMenu.Item
              class="flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-danger hover:bg-danger/10 cursor-pointer outline-none"
              onSelect={() => onDelete()}
            >
              <Trash2 size={12} /> Excluir
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
//  Lightbox (compartilhado)
// ──────────────────────────────────────────────────────────────

export function ImageLightbox({
  attachment, onClose, onDelete,
}: {
  attachment: LeadAttachment
  onClose: () => void
  onDelete?: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div
      class="fixed inset-0 z-50 bg-black/85 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Visualização: ${attachment.fileName}`}
      onClick={onClose}
    >
      <div
        class="relative max-h-full max-w-5xl w-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between gap-3 mb-2 text-white">
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">{attachment.fileName}</div>
            <div class="text-xs text-white/60 truncate">
              {attachment.uploadedByName ?? 'Sistema'} · {formatDate(attachment.createdAt)} · {formatSize(attachment.fileSize)}
            </div>
          </div>
          <div class="flex items-center gap-1">
            <a
              href={attachment.url}
              download={attachment.fileName}
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1 h-8 px-2.5 rounded text-xs font-medium bg-white/10 text-white hover:bg-white/20"
            >
              <Download size={12} /> Baixar
            </a>
            {onDelete && (
              <button
                type="button"
                class="inline-flex items-center gap-1 h-8 px-2.5 rounded text-xs font-medium bg-white/10 text-white hover:bg-danger hover:text-white"
                onClick={onDelete}
              >
                <Trash2 size={12} /> Remover
              </button>
            )}
            <button
              type="button"
              class="size-8 rounded grid place-items-center bg-white/10 text-white hover:bg-white/20"
              onClick={onClose}
              aria-label="Fechar"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <div class="flex-1 grid place-items-center overflow-auto">
          <img
            src={attachment.url}
            alt={attachment.fileName}
            class="max-h-[80vh] max-w-full object-contain rounded-md shadow-2xl"
          />
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
//  Pending picker (usado no CreateActivityModal, antes da activity existir)
// ──────────────────────────────────────────────────────────────

export function PendingAttachmentsPicker({
  files, onChange, disabled = false,
}: {
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Refs pra evitar capturar `files`/`onChange` antigos no listener global de paste
  // (que vive todo o ciclo do modal, sem re-attach a cada render).
  const filesRef = useRef(files)
  const onChangeRef = useRef(onChange)
  const disabledRef = useRef(disabled)
  useEffect(() => { filesRef.current = files }, [files])
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { disabledRef.current = disabled }, [disabled])

  function addFilesToList(newFiles: File[]) {
    if (newFiles.length === 0) return
    setError(null)
    const next: File[] = [...filesRef.current]
    for (const f of newFiles) {
      if (f.size > MAX_BYTES) {
        setError(`"${f.name}" tem ${formatSize(f.size)} (máx 25MB)`)
        continue
      }
      next.push(f)
    }
    onChangeRef.current(next)
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    addFilesToList(Array.from(list))
  }

  function removeAt(idx: number) {
    onChange(files.filter((_, i) => i !== idx))
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); e.stopPropagation(); setDragging(false)
    addFiles(e.dataTransfer?.files ?? null)
  }
  function onDragOver(e: DragEvent) {
    e.preventDefault(); e.stopPropagation()
    if (!dragging) setDragging(true)
  }
  function onDragLeave(e: DragEvent) {
    e.preventDefault(); e.stopPropagation()
    const rt = e.relatedTarget as Node | null
    if (rt && e.currentTarget instanceof Node && e.currentTarget.contains(rt)) return
    setDragging(false)
  }

  // Paste global enquanto o componente (e portanto o modal Nova atividade) está
  // montado. Só captura imagens — texto colado em Input/Textarea continua normal.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (disabledRef.current) return
      const imgs = extractImagesFromClipboard(e)
      if (imgs.length === 0) return
      e.preventDefault()
      addFilesToList(imgs)
      toast(imgs.length === 1 ? 'Imagem colada do clipboard' : `${imgs.length} imagens coladas`, 'success')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  // Botão "Colar" via Clipboard API (alternativa explícita ao Ctrl+V — útil em
  // mobile/tablet onde teclado de atalho não existe).
  async function pasteFromClipboardApi() {
    if (disabled) return
    try {
      const imgs = await readImagesFromClipboardAPI()
      if (imgs.length === 0) {
        toast('Não há imagem no clipboard', 'info')
        return
      }
      addFilesToList(imgs)
      toast(imgs.length === 1 ? 'Imagem colada' : `${imgs.length} imagens coladas`, 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao ler clipboard'
      toast(msg, 'danger')
    }
  }

  return (
    <div class="space-y-2">
      <div
        class={cn(
          'rounded-md border-2 border-dashed border-border bg-surface-2/40 p-4 text-center transition-colors',
          dragging && 'border-accent bg-accent/5',
          disabled && 'opacity-60',
        )}
        onDragOver={(e) => !disabled && onDragOver(e)}
        onDragLeave={(e) => !disabled && onDragLeave(e)}
        onDrop={(e) => !disabled && onDrop(e)}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          class="hidden"
          disabled={disabled}
          onChange={(e) => {
            addFiles((e.target as HTMLInputElement).files)
            if (inputRef.current) inputRef.current.value = ''
          }}
        />
        <div class="flex items-center justify-center gap-3 flex-wrap">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            <Paperclip size={14} /> Anexar arquivos
          </button>
          <span class="text-fg-subtle text-xs">·</span>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-accent hover:underline disabled:opacity-50"
            onClick={pasteFromClipboardApi}
            disabled={disabled}
            title="Cola a última imagem copiada (Print Screen, Snipping Tool, Cmd+Shift+4)"
          >
            <ClipboardPaste size={14} /> Colar imagem
          </button>
        </div>
        <div class="text-xs text-fg-muted mt-1">
          Arraste aqui, clique para escolher ou <kbd class="px-1 py-0.5 rounded border border-border bg-surface text-[0.6875rem] font-mono">Ctrl+V</kbd> para colar um print (até 25 MB cada)
        </div>
      </div>

      {error && (
        <div class="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-xs text-danger">
          <AlertCircle size={12} class="shrink-0 mt-0.5" />
          <span class="flex-1">{error}</span>
          <button type="button" class="text-danger/70 hover:text-danger" onClick={() => setError(null)} aria-label="Fechar">
            <X size={12} />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <ul class="space-y-1.5">
          {files.map((f, i) => {
            const img = isImage(f.type)
            const url = img ? URL.createObjectURL(f) : null
            const Icon = iconFor(f.type)
            return (
              <li key={`${f.name}-${i}`} class="flex items-center gap-2 rounded-md border border-border bg-surface p-1.5">
                <div class="size-10 rounded overflow-hidden bg-surface-2 grid place-items-center shrink-0">
                  {url ? (
                    <img
                      src={url}
                      alt={f.name}
                      class="h-full w-full object-cover"
                      onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                    />
                  ) : (
                    <Icon size={16} class="text-fg-muted" />
                  )}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-medium text-fg truncate">{f.name}</div>
                  <div class="text-[0.6875rem] text-fg-subtle">{formatSize(f.size)} · {f.type || 'tipo desconhecido'}</div>
                </div>
                <button
                  type="button"
                  class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
                  onClick={() => removeAt(i)}
                  disabled={disabled}
                  title="Remover da lista"
                  aria-label="Remover da lista"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
