import { useEffect, useRef, useState } from 'preact/hooks'
import { Mic, X, Send } from '@/components/ui/icon-set'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'

interface AudioRecorderProps {
  onComplete: (file: File) => void
  onCancel: () => void
  /** O microfone parou sozinho (ligação, tela bloqueada, fone desconectado).
   *  Recebe o que já foi gravado para o operador revisar — sem isso o trecho
   *  se perdia calado e a tela seguia contando "Gravando…". */
  onInterrupted?: (file: File) => void
}

// Ogg primeiro, WebM depois, MP4 por último: a API Oficial da Meta recusa
// áudio em WebM (erro 131053, "Media upload error") e o envio falha DEPOIS de
// já ter sido aceito. O Firefox grava Ogg direto; o Chrome não sabe, e nele o
// arquivo continua saindo em WebM — por isso o backend converte no upload.
// O Safari (iPhone/iPad e Mac) só grava MP4/AAC: sem ele na lista o gravador
// caía no formato padrão, o arquivo saía como ".webm" com tipo audio/mp4 e o
// upload recusava — no iPhone, áudio nunca funcionou.
const PREFERRED_MIMES = [
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/aac',
]

// Voz não precisa de 128 kbps (padrão do Chrome): 32 kbps em Opus é a mesma
// faixa das mensagens de voz do próprio WhatsApp. O arquivo fica 4x menor —
// 1 minuto passa de ~1 MB para ~240 KB — e sobe rápido no 4G.
const BITRATE_VOZ = 32_000

// Pedaços de 1 s em vez de um blob único no fim: se o microfone for cortado
// no meio, o que já foi gravado está guardado e pode ser aproveitado.
const FATIA_MS = 1000

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  for (const m of PREFERRED_MIMES) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

/** Extensão coerente com o que foi gravado de verdade — é por ela e pelo MIME
 *  que o backend decide se aceita e se converte. */
export function extensaoDoAudio(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('webm')) return 'webm'
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a'
  return 'webm'
}

/** Tipo sem parâmetros (`audio/webm;codecs=opus` → `audio/webm`). */
function tipoBase(mime: string): string {
  return (mime.split(';')[0] || '').trim()
}

/** Erro de getUserMedia/MediaRecorder em português, dizendo o que fazer. */
export function mensagemDoMicrofone(e: unknown): string {
  const nome = (e as { name?: string })?.name || ''
  switch (nome) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'O navegador bloqueou o microfone. Libere o acesso no cadeado ao lado do endereço do site (no celular: Ajustes do navegador → Microfone) e tente de novo.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhum microfone encontrado. Conecte um microfone ou fone com microfone e tente de novo.'
    case 'NotSupportedError':
      return 'Este navegador não permite gravar áudio aqui. Abra o sistema no Chrome, Safari, Edge ou Firefox atualizado.'
    case 'NotReadableError':
    case 'AbortError':
      return 'O microfone está em uso por outro aplicativo (ligação, reunião, outro site). Feche-o e tente de novo.'
    default:
      return 'Não foi possível acessar o microfone. Tente de novo; se continuar, recarregue a página.'
  }
}

/** Navegadores embutidos (Instagram, Facebook, alguns WebViews) e páginas
 *  fora de HTTPS não têm gravação. Melhor dizer antes de tentar. */
export function motivoSemSuporte(): string | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'A gravação de áudio só funciona pelo endereço seguro (https) do sistema.'
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return 'Este navegador não permite gravar áudio. Abra o sistema no Chrome, Safari, Edge ou Firefox atualizado.'
  }
  return null
}

type Estado = 'preparando' | 'gravando'

export function AudioRecorder({ onComplete, onCancel, onInterrupted }: AudioRecorderProps) {
  const [estado, setEstado] = useState<Estado>('preparando')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const tickRef = useRef<number | null>(null)
  const inicioRef = useRef<number>(0)
  /** O que fazer com o resultado quando o gravador terminar de parar. */
  const destinoRef = useRef<'enviar' | 'descartar' | 'interrompido' | null>(null)
  const onCompleteRef = useRef(onComplete)
  const onCancelRef = useRef(onCancel)
  const onInterruptedRef = useRef(onInterrupted)

  useEffect(() => {
    onCompleteRef.current = onComplete
    onCancelRef.current = onCancel
    onInterruptedRef.current = onInterrupted
  }, [onComplete, onCancel, onInterrupted])

  useEffect(() => {
    let desmontado = false

    function falhar(msg: string) {
      setError(msg)
      toast(msg, 'danger')
      onCancelRef.current()
    }

    async function start() {
      const semSuporte = motivoSemSuporte()
      if (semSuporte) return falhar(semSuporte)

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
      } catch (e: unknown) {
        if (!desmontado) falhar(mensagemDoMicrofone(e))
        return
      }
      if (desmontado) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream

      const mime = pickMimeType()
      let rec: MediaRecorder
      try {
        const opcoes: MediaRecorderOptions = { audioBitsPerSecond: BITRATE_VOZ }
        if (mime) opcoes.mimeType = mime
        rec = new MediaRecorder(stream, opcoes)
      } catch {
        try {
          // Alguns navegadores recusam a combinação de opções; o padrão ainda serve.
          rec = new MediaRecorder(stream)
        } catch (e: unknown) {
          stream.getTracks().forEach((t) => t.stop())
          return falhar(mensagemDoMicrofone(e))
        }
      }
      recorderRef.current = rec
      chunksRef.current = []

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onerror = () => {
        if (rec.state !== 'inactive') {
          destinoRef.current = destinoRef.current ?? 'interrompido'
          rec.stop()
        }
      }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (tickRef.current) window.clearInterval(tickRef.current)
        const destino = destinoRef.current
        if (destino === 'descartar' || destino === null) return

        const type = tipoBase(rec.mimeType || mime) || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        if (blob.size === 0) {
          const msg = 'A gravação ficou vazia — o microfone não captou som. Verifique se ele está liberado e ligado e grave de novo.'
          toast(msg, 'danger')
          onCancelRef.current()
          return
        }
        const file = new File([blob], `audio-${Date.now()}.${extensaoDoAudio(type)}`, { type })
        if (destino === 'interrompido') {
          if (onInterruptedRef.current) {
            toast('A gravação foi interrompida pelo aparelho. O trecho gravado ficou como anexo — ouça e envie se estiver bom.', 'warning')
            onInterruptedRef.current(file)
          } else {
            toast('A gravação foi interrompida pelo aparelho. Grave de novo.', 'warning')
            onCancelRef.current()
          }
          return
        }
        onCompleteRef.current(file)
      }

      // Microfone cortado por fora (ligação, bloqueio de tela no celular,
      // fone removido, permissão revogada): antes o gravador parava calado.
      stream.getAudioTracks().forEach((t) => {
        t.onended = () => {
          if (rec.state !== 'inactive') {
            destinoRef.current = destinoRef.current ?? 'interrompido'
            rec.stop()
          }
        }
      })

      rec.onstart = () => {
        inicioRef.current = Date.now()
        setEstado('gravando')
        // Pelo relógio, não por contagem de ticks: no celular em segundo plano
        // o setInterval é estrangulado e o contador atrasava.
        tickRef.current = window.setInterval(() => {
          setSeconds(Math.floor((Date.now() - inicioRef.current) / 1000))
        }, 250)
      }
      try {
        rec.start(FATIA_MS)
      } catch (e: unknown) {
        stream.getTracks().forEach((t) => t.stop())
        falhar(mensagemDoMicrofone(e))
      }
    }

    void start()

    return () => {
      desmontado = true
      if (tickRef.current) window.clearInterval(tickRef.current)
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') {
        // Saiu da tela gravando (trocou de conversa, voltou para a lista no
        // celular). O áudio NÃO pode seguir para outra conversa — descarta, mas
        // avisando, em vez de sumir sem explicação.
        if (destinoRef.current === null) {
          toast('Gravação descartada: você saiu da tela antes de enviar.', 'warning')
        }
        destinoRef.current = 'descartar'
        rec.stop()
      } else {
        streamRef.current?.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  function stop(send: boolean) {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') {
      if (tickRef.current) window.clearInterval(tickRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      destinoRef.current = 'descartar'
      onCancelRef.current()
      return
    }
    destinoRef.current = send ? 'enviar' : 'descartar'
    // requestData antes do stop: garante que o último pedaço (fração de
    // segundo final) entra no arquivo em todos os navegadores.
    try { rec.requestData() } catch { /* alguns navegadores não suportam — o stop já entrega */ }
    rec.stop()
    if (!send) onCancelRef.current()
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  if (error) return null

  return (
    <div class="flex flex-1 items-center gap-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
      <span class="relative flex size-3 shrink-0">
        {estado === 'gravando' && (
          <span class="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-75" />
        )}
        <span class={`relative inline-flex size-3 rounded-full ${estado === 'gravando' ? 'bg-danger' : 'bg-fg-muted'}`} />
      </span>
      <Mic size={14} class={estado === 'gravando' ? 'text-danger' : 'text-fg-muted'} />
      <span class="font-mono text-sm tabular-nums text-fg">
        {mm}:{ss}
      </span>
      <span class="flex-1 text-xs text-fg-muted">
        {/* Só diz "Gravando" quando está gravando de fato. Antes aparecia já no
            pedido de permissão, e o que se falava nesse intervalo se perdia. */}
        {estado === 'gravando' ? 'Gravando…' : 'Aguardando o microfone… (permita o acesso se o navegador perguntar)'}
      </span>
      <Button variant="ghost" size="sm" onClick={() => stop(false)} aria-label="Cancelar gravação">
        <X size={14} />
      </Button>
      <Button variant="primary" size="sm" onClick={() => stop(true)} disabled={estado !== 'gravando' || seconds < 1}>
        <Send size={14} /> Enviar
      </Button>
    </div>
  )
}
