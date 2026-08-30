import { useRef, useState } from 'preact/hooks'
import { Paperclip, X, Loader2, FileText, Image as ImageIcon, Video, Music } from '@/components/ui/icon-set'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'

export interface TemplateAttachment {
  url: string
  name: string
  type: string
}

interface Props {
  value: TemplateAttachment | null
  onChange: (a: TemplateAttachment | null) => void
  /** WhatsApp tem limites por tipo; e-mail e SMS não usam anexo do modelo. */
  channel: string
}

/** Limites do WhatsApp, mais apertados que o teto de 25 MB do upload. Validar
 *  aqui evita o pior caso: cadastrar, achar que deu certo e a mensagem falhar
 *  na frente do cliente. */
const LIMITES: Record<string, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
}

const ACEITOS = '.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.mp3,.ogg,.opus,.wav'

function tipoPor(nome: string, mime: string): string {
  const n = nome.toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(n)) return 'image'
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|3gp)$/.test(n)) return 'video'
  if (mime.startsWith('audio/') || /\.(mp3|ogg|opus|m4a|wav|aac)$/.test(n)) return 'audio'
  return 'document'
}

function tamanhoLegivel(b: number): string {
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`
  if (b >= 1024) return `${Math.round(b / 1024)} KB`
  return `${b} B`
}

const ICONE: Record<string, typeof FileText> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  document: FileText,
}

export function TemplateAttachmentField({ value, onChange, channel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)

  if (channel !== 'whatsapp') return null

  async function escolher(file: File) {
    const tipo = tipoPor(file.name, file.type)

    // .mov do iPhone: o upload rejeita e o WhatsApp não entrega — melhor dizer
    // o que fazer do que devolver "tipo não permitido".
    if (/\.mov$/i.test(file.name)) {
      toast('Vídeos .MOV (padrão do iPhone) não são aceitos pelo WhatsApp. Converta para MP4 antes de anexar.', 'danger')
      return
    }

    const limite = LIMITES[tipo] ?? LIMITES.document!
    if (file.size > limite) {
      toast(`Arquivo de ${tamanhoLegivel(file.size)} — o limite do WhatsApp para ${tipo === 'video' ? 'vídeo' : tipo === 'image' ? 'imagem' : 'este tipo'} é ${tamanhoLegivel(limite)}.`, 'danger')
      return
    }

    setEnviando(true)
    try {
      const fd = new FormData()
      fd.append('file', file, file.name)
      const r = await api.post<{ url: string; filename: string; mimetype?: string }>('/atendimento/upload', fd)
      onChange({ url: r.url, name: r.filename || file.name, type: tipoPor(r.filename || file.name, r.mimetype || file.type) })
      toast('Anexo enviado', 'success')
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setEnviando(false)
    }
  }

  const Icone = value ? (ICONE[value.type] ?? FileText) : FileText

  return (
    <div class="mt-3">
      <label class="mb-1 block text-sm font-medium">Anexo</label>

      {value ? (
        <div class="flex items-center gap-3 rounded-md border border-border bg-surface-2 p-2">
          {value.type === 'image' ? (
            <img src={value.url} alt="" class="size-12 shrink-0 rounded object-cover" />
          ) : (
            <div class="grid size-12 shrink-0 place-items-center rounded bg-surface-3">
              <Icone size={20} class="text-fg-muted" />
            </div>
          )}
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm">{value.name}</div>
            <div class="text-xs text-fg-muted">
              {value.type === 'image' ? 'Imagem' : value.type === 'video' ? 'Vídeo' : value.type === 'audio' ? 'Áudio' : 'Documento'}
              {' · vai junto com o texto ao usar o modelo'}
            </div>
          </div>
          <button
            type="button"
            class="shrink-0 rounded p-1 text-fg-muted hover:bg-surface-3 hover:text-danger"
            onClick={() => onChange(null)}
            aria-label="Remover anexo"
            title="Remover anexo"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border p-3 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
          disabled={enviando}
        >
          {enviando ? <Loader2 size={16} class="animate-spin" /> : <Paperclip size={16} />}
          {enviando ? 'Enviando…' : 'Anexar imagem, vídeo ou documento'}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        class="hidden"
        accept={ACEITOS}
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0]
          if (f) void escolher(f)
          ;(e.target as HTMLInputElement).value = ''
        }}
      />

      <p class="mt-1 text-xs text-fg-muted">
        Enviado junto com o texto sempre que o modelo for usado. Limites do WhatsApp: imagem 5 MB,
        vídeo 16 MB (MP4), documento 100 MB.
      </p>
    </div>
  )
}
