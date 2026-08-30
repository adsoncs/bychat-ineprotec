// Widget flutuante de chamada (canto inferior direito). Abre ao iniciar um
// click-to-call e acompanha o status ao vivo (polling do VoipCall). Não controla
// a ligação — a FaleMaisVoip é click-to-call (a conversa é no ramal físico) e a
// API não expõe hangup/hold/mute. Mostra: ramal, destino, status, cronômetro,
// resultado e player da gravação.
import { useEffect, useState } from 'preact/hooks'
import { Phone, X, PhoneOff } from '@/components/ui/icon-set'
import { useActiveCall } from '@/stores/voipCall'
import { useVoipCall, VOIP_TERMINAL_STATUS } from '@/hooks/useVoip'
import { cn } from '@/lib/cn'

const DIALING_META = { label: 'Chamando — atenda no seu ramal', cls: 'bg-info/15 text-info', pulse: true }
const STATUS_META: Record<string, { label: string; cls: string; pulse?: boolean }> = {
  dialing:   DIALING_META,
  completed: { label: 'Atendida', cls: 'bg-success/15 text-success' },
  no_answer: { label: 'Não atendeu', cls: 'bg-surface-3 text-fg-muted' },
  busy:      { label: 'Ocupado', cls: 'bg-warning/15 text-warning' },
  failed:    { label: 'Falhou', cls: 'bg-danger/15 text-danger' },
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function CallWidget() {
  const activeCallId = useActiveCall((s) => s.activeCallId)
  const clear = useActiveCall((s) => s.clear)
  const { data } = useVoipCall(activeCallId)
  const call = data?.call

  const isTerminal = !!call && VOIP_TERMINAL_STATUS.includes(call.status)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!call || isTerminal) return
    const start = new Date(call.startedAt).getTime()
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [call?.startedAt, isTerminal])

  if (!activeCallId) return null

  const meta = (call && STATUS_META[call.status]) || DIALING_META
  const title = call?.leadName || call?.phone || 'Ligação'
  const shownTime = isTerminal
    ? (call?.durationSec != null ? fmt(call.durationSec) : null)
    : fmt(elapsed)

  return (
    <div class="fixed bottom-4 right-4 z-[60] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
      <div class="flex items-center gap-2 px-4 py-2.5 bg-[#1a73e8] text-white">
        <span class={cn('inline-flex items-center justify-center size-7 rounded-full bg-white/20', !isTerminal && 'animate-pulse')}>
          {isTerminal ? <PhoneOff size={15} /> : <Phone size={15} />}
        </span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold truncate">{title}</div>
          <div class="text-2xs text-white/80 truncate">{call?.phone}</div>
        </div>
        <button type="button" aria-label="Fechar" class="text-white/80 hover:text-white" onClick={clear}>
          <X size={16} />
        </button>
      </div>

      <div class="p-4 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <span class={cn('inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full', meta.cls)}>
            {meta.pulse && <span class="size-1.5 rounded-full bg-current animate-pulse" />}
            {meta.label}
          </span>
          {shownTime && <span class="text-sm font-mono tabular-nums text-fg">{shownTime}</span>}
        </div>

        {call?.extension && (
          <div class="text-xs text-fg-muted">Ramal de origem: <span class="font-medium text-fg">{call.extension}</span></div>
        )}

        {isTerminal && call?.recordingUrl && (
          <audio controls src={call.recordingUrl} class="w-full h-9" />
        )}
        {isTerminal && !call?.recordingUrl && call?.status === 'completed' && (
          <div class="text-2xs text-fg-muted italic">A gravação aparece aqui após a sincronização.</div>
        )}

        {isTerminal && (
          <button type="button" onClick={clear} class="w-full h-9 rounded-md bg-surface-3 hover:bg-surface-2 text-sm font-medium text-fg">
            Fechar
          </button>
        )}
      </div>
    </div>
  )
}
