/**
 * Sons do painel — sintetizados em WebAudio, sem arquivo de áudio.
 *
 * Motivo de não usar <audio src>: um arquivo exigiria hospedar o asset, tratar
 * cache e falha de rede para tocar 200ms de bipe. O oscilador não depende de
 * nada e soa igual em todo navegador.
 *
 * Um único AudioContext para o app inteiro: cada `new AudioContext()` consome
 * um slot de hardware, e o navegador corta o áudio depois de algumas dezenas —
 * a primeira versão criava um por bipe.
 *
 * O catálogo é aberto de propósito. Conforme o painel ganhar outros avisos
 * (chamado novo, SLA estourando, lembrete), cada um escolhe o seu timbre daqui:
 * o mesmo som para tudo faz o operador parar de distinguir o que aconteceu.
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    ctx ??= new Ctx()
    // Política de autoplay: o contexto nasce suspenso até um gesto do usuário.
    // O resume só vale dentro/depois de um clique — por isso o painel toca uma
    // prévia ao escolher o som, que é o gesto que destrava o áudio.
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Uma nota: frequência, quando entra e quanto dura (segundos). */
interface Note {
  freq: number
  at: number
  dur: number
  type?: OscillatorType
}

export type SoundId = 'classico' | 'duplo' | 'suave' | 'ascendente' | 'grave' | 'cristal'
export type SoundVolume = 'low' | 'medium' | 'high'

export interface SoundDef {
  id: SoundId
  label: string
  /** Uma linha sobre o caráter do som — ajuda a escolher sem ficar tocando todos. */
  hint: string
  notes: Note[]
  /** Ajuste fino por timbre: agudo curto soa mais alto que grave longo no mesmo ganho. */
  gainScale?: number
}

export const NOTIFICATION_SOUNDS: SoundDef[] = [
  {
    id: 'classico', label: 'Clássico', hint: 'Dois tons descendo — o som padrão do painel.',
    notes: [{ freq: 880, at: 0, dur: 0.1 }, { freq: 660, at: 0.12, dur: 0.1 }],
  },
  {
    id: 'duplo', label: 'Duplo', hint: 'Dois toques iguais e rápidos, tipo campainha curta.',
    notes: [{ freq: 760, at: 0, dur: 0.07 }, { freq: 760, at: 0.13, dur: 0.07 }],
  },
  {
    id: 'suave', label: 'Suave', hint: 'Uma nota só, com saída longa. Discreto para sala aberta.',
    notes: [{ freq: 587, at: 0, dur: 0.42, type: 'triangle' }],
    gainScale: 1.2,
  },
  {
    id: 'ascendente', label: 'Ascendente', hint: 'Três notas subindo — chama mais atenção.',
    notes: [{ freq: 523, at: 0, dur: 0.09 }, { freq: 659, at: 0.1, dur: 0.09 }, { freq: 784, at: 0.2, dur: 0.12 }],
  },
  {
    id: 'grave', label: 'Grave', hint: 'Nota baixa e curta. Some no meio da conversa da sala.',
    notes: [{ freq: 233, at: 0, dur: 0.16, type: 'triangle' }, { freq: 196, at: 0.14, dur: 0.18, type: 'triangle' }],
    gainScale: 1.5,
  },
  {
    id: 'cristal', label: 'Cristal', hint: 'Agudo e curtinho, como um “tim”.',
    notes: [{ freq: 1318, at: 0, dur: 0.07 }, { freq: 1760, at: 0.06, dur: 0.14 }],
    gainScale: 0.7,
  },
]

export const DEFAULT_SOUND_ID: SoundId = 'classico'

/** Volume base. Valores baixos de propósito: isto toca ao lado de quem atende o
 *  dia inteiro — 'high' aqui já é audível numa sala com conversa. */
const GAIN: Record<SoundVolume, number> = { low: 0.03, medium: 0.06, high: 0.12 }

function playNotes(notes: Note[], gainValue: number): void {
  const audio = getCtx()
  if (!audio) return
  try {
    const t0 = audio.currentTime
    for (const n of notes) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = n.type ?? 'sine'
      osc.frequency.value = n.freq
      // Envelope curto: sem ele o oscilador começa e corta em degrau, e o
      // resultado é um "clique" no lugar de uma nota.
      const start = t0 + n.at
      const end = start + n.dur
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, end)
      osc.connect(gain).connect(audio.destination)
      osc.start(start)
      osc.stop(end + 0.02)
    }
  } catch { /* áudio bloqueado pelo navegador — silêncio é aceitável */ }
}

export function getSound(id: string | undefined): SoundDef {
  return NOTIFICATION_SOUNDS.find((s) => s.id === id) ?? NOTIFICATION_SOUNDS[0]!
}

/** Toca um som do catálogo. Usado pelo aviso de mensagem e pela prévia do painel. */
export function playNotificationSound(id: SoundId | string = DEFAULT_SOUND_ID, volume: SoundVolume = 'medium'): void {
  const som = getSound(id)
  playNotes(som.notes, (GAIN[volume] ?? GAIN.medium) * (som.gainScale ?? 1))
}

/** Mensagem nova do contato. */
export function playMessageBeep(volume: SoundVolume = 'medium', soundId: SoundId | string = DEFAULT_SOUND_ID): void {
  playNotificationSound(soundId, volume)
}

/**
 * Confirmação de mensagem ENVIADA — mesmo timbre do aviso, um degrau abaixo no
 * volume: enviar é confirmação de algo que a pessoa acabou de fazer, não
 * chamado de atenção. Igualar os dois faria o próprio trabalho soar como
 * interrupção.
 */
const VOLUME_ABAIXO: Record<SoundVolume, SoundVolume> = { high: 'medium', medium: 'low', low: 'low' }
export function playSentSound(id: SoundId | string = DEFAULT_SOUND_ID, volume: SoundVolume = 'medium'): void {
  playNotificationSound(id, VOLUME_ABAIXO[volume] ?? 'low')
}

/** Confirmação ao ligar o som (também destrava o áudio no navegador). */
export function playToggleOn(): void { playNotes([{ freq: 523, at: 0, dur: 0.08 }, { freq: 659, at: 0.09, dur: 0.08 }, { freq: 784, at: 0.18, dur: 0.1 }], GAIN.medium) }
/** Confirmação ao silenciar. */
export function playToggleOff(): void { playNotes([{ freq: 784, at: 0, dur: 0.09 }, { freq: 523, at: 0.1, dur: 0.12 }], GAIN.medium) }
