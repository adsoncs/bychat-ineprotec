import { useEffect, useRef, useState } from 'preact/hooks'
import { Mic, X, Send } from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'

interface AudioRecorderProps {
  onComplete: (file: File) => void
  onCancel: () => void
}

const PREFERRED_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const m of PREFERRED_MIMES) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

export function AudioRecorder({ onComplete, onCancel }: AudioRecorderProps) {
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const tickRef = useRef<number | null>(null)
  const finalizedRef = useRef(false)
  const cancelledRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  const onCancelRef = useRef(onCancel)

  useEffect(() => {
    onCompleteRef.current = onComplete
    onCancelRef.current = onCancel
  }, [onComplete, onCancel])

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        const mime = pickMimeType()
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
        recorderRef.current = rec
        chunksRef.current = []

        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          if (cancelledRef.current) return
          if (!finalizedRef.current) return
          const type = rec.mimeType || 'audio/webm'
          const ext = type.includes('ogg') ? 'ogg' : 'webm'
          const blob = new Blob(chunksRef.current, { type })
          const file = new File([blob], `audio-${Date.now()}.${ext}`, { type })
          onCompleteRef.current(file)
        }
        rec.start()
        tickRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
      } catch (e: unknown) {
        const msg = (e as Error).message || 'Falha ao acessar microfone'
        setError(msg)
        toast(msg, 'danger')
        onCancelRef.current()
      }
    }

    void start()

    return () => {
      cancelled = true
      if (tickRef.current) window.clearInterval(tickRef.current)
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') {
        cancelledRef.current = true
        rec.stop()
      } else {
        streamRef.current?.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  function stop(send: boolean) {
    if (tickRef.current) window.clearInterval(tickRef.current)
    const rec = recorderRef.current
    if (!rec) {
      onCancelRef.current()
      return
    }
    if (send) {
      finalizedRef.current = true
    } else {
      cancelledRef.current = true
    }
    if (rec.state !== 'inactive') {
      rec.stop()
    }
    if (!send) onCancelRef.current()
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  if (error) return null

  return (
    <div class="flex flex-1 items-center gap-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
      <span class="relative flex size-3 shrink-0">
        <span class="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-75" />
        <span class="relative inline-flex size-3 rounded-full bg-danger" />
      </span>
      <Mic size={14} class="text-danger" />
      <span class="font-mono text-sm tabular-nums text-fg">
        {mm}:{ss}
      </span>
      <span class="flex-1 text-xs text-fg-muted">Gravando…</span>
      <Button variant="ghost" size="sm" onClick={() => stop(false)} aria-label="Cancelar gravação">
        <X size={14} />
      </Button>
      <Button variant="primary" size="sm" onClick={() => stop(true)} disabled={seconds < 1}>
        <Send size={14} /> Enviar
      </Button>
    </div>
  )
}
