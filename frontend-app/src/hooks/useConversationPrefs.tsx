// Preferências da tela de Conversas.
//
// São escolhas de leitura/escrita do operador — tamanho de fonte, densidade,
// velocidade do áudio, o que aparece na lista. Ficam no navegador (mesmo padrão
// do resto da tela: `bh_atd_notif`) e são separadas
// por usuário, porque o mesmo computador costuma ser dividido entre operadores.
//
// O que mexe no SERVIDOR não mora aqui: a transcrição de áudio é uma Setting
// global (`conversations.transcribe_audio`), editável só por administrador.

import { createContext } from 'preact'
import type { ComponentChildren } from 'preact'
import { useCallback, useContext, useMemo, useState } from 'preact/hooks'
import { useUserStore } from '@/stores/user'

export type FontStep = 'sm' | 'md' | 'lg' | 'xl'
export type Density = 'comfortable' | 'compact'

export interface ConversationPrefs {
  /** Tamanho do texto das mensagens dentro da conversa. */
  messageFont: FontStep
  /** Tamanho do nome do contato na lista de conversas. */
  contactFont: FontStep
  /** Tamanho do nome do remetente e da hora DENTRO da bolha da mensagem. */
  bubbleMetaFont: FontStep
  /** Nome do contato e do agente em negrito dentro da conversa. */
  nameBold: boolean
  /** Cor dos nomes dentro da conversa — 'auto' mantém a cor herdada. */
  nameColor: string
  /** Altura das linhas da lista de conversas. */
  density: Density
  /** Foto do contato na lista. */
  showAvatars: boolean
  /** Prévia da última mensagem na lista (desligar ajuda em tela compartilhada). */
  showPreview: boolean
  /** Texto transcrito junto do player de áudio. */
  showTranscript: boolean
  /** Velocidade inicial de reprodução dos áudios. */
  audioSpeed: number
  /** Enter envia (Shift+Enter quebra) ou Enter quebra (Ctrl+Enter envia). */
  sendOnEnter: boolean
  /** Desfoca imagens/vídeos/figurinhas até passar o mouse. */
  blurMedia: boolean
}

export const DEFAULT_PREFS: ConversationPrefs = {
  messageFont: 'md',
  contactFont: 'md',
  // 'sm' = os 10px de sempre: quem não mexer no painel não vê a tela mudar.
  bubbleMetaFont: 'sm',
  nameBold: false,
  nameColor: 'auto',
  density: 'comfortable',
  showAvatars: true,
  showPreview: true,
  showTranscript: true,
  audioSpeed: 1,
  sendOnEnter: true,
  blurMedia: false,
}

export const FONT_STEPS: { id: FontStep; label: string; size: string }[] = [
  { id: 'sm', label: 'Pequena', size: '0.8125rem' },
  { id: 'md', label: 'Padrão', size: '0.875rem' },
  { id: 'lg', label: 'Grande', size: '1rem' },
  { id: 'xl', label: 'Maior', size: '1.125rem' },
]

/**
 * Escala própria do nome do remetente e da hora dentro da bolha: eles nascem
 * em 10px (bem menores que o corpo da mensagem) e subir na mesma escala do
 * texto deixaria a bolha desequilibrada.
 */
export const META_FONT_STEPS: { id: FontStep; label: string; size: string }[] = [
  { id: 'sm', label: 'Pequena', size: '0.625rem' },
  { id: 'md', label: 'Padrão', size: '0.75rem' },
  { id: 'lg', label: 'Grande', size: '0.875rem' },
  { id: 'xl', label: 'Maior', size: '1rem' },
]

/**
 * Cores oferecidas para os nomes. A mesma cor cai sobre dois fundos (a bolha
 * clara do contato e a colorida do operador), por isso a lista é curta e de
 * tons saturados o bastante para os dois — a amostra do painel mostra o par.
 */
export const NAME_COLORS: { id: string; label: string; value: string | null }[] = [
  { id: 'auto', label: 'Automática', value: null },
  { id: 'verde', label: 'Verde', value: '#22c55e' },
  { id: 'azul', label: 'Azul', value: '#60a5fa' },
  { id: 'roxo', label: 'Roxo', value: '#c084fc' },
  { id: 'ambar', label: 'Âmbar', value: '#fbbf24' },
  { id: 'rosa', label: 'Rosa', value: '#f472b6' },
  { id: 'branco', label: 'Branco', value: '#ffffff' },
]

export const AUDIO_SPEEDS = [1, 1.25, 1.5, 2]

function fontSize(step: FontStep): string {
  return (FONT_STEPS.find((f) => f.id === step) ?? FONT_STEPS[1]).size
}

function metaFontSize(step: FontStep): string {
  return (META_FONT_STEPS.find((f) => f.id === step) ?? META_FONT_STEPS[0]).size
}

const STORAGE_PREFIX = 'conversas.prefs.v1'

function storageKey(userId: string | number | null | undefined): string {
  return userId ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX
}

function load(userId: string | number | null | undefined): ConversationPrefs {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<ConversationPrefs>
    // Merge com o default: chave nova em versão futura não quebra quem já salvou.
    return { ...DEFAULT_PREFS, ...parsed }
  } catch {
    return DEFAULT_PREFS
  }
}

interface PrefsContext {
  prefs: ConversationPrefs
  setPref: <K extends keyof ConversationPrefs>(key: K, value: ConversationPrefs[K]) => void
  reset: () => void
  /** Destaque dos nomes, pronto para `style` (vazio quando nada foi escolhido). */
  nameStyle: Record<string, string | number>
  /** Variáveis de tema para o container da tela — os componentes leem daqui. */
  cssVars: Record<string, string>
}

const Ctx = createContext<PrefsContext>({
  prefs: DEFAULT_PREFS,
  setPref: () => {},
  reset: () => {},
  nameStyle: {},
  cssVars: {},
})

export function ConversationPrefsProvider({ children }: { children: ComponentChildren }) {
  const userId = useUserStore((s) => s.user?.id)
  const [prefs, setPrefs] = useState<ConversationPrefs>(() => load(userId))

  const persist = useCallback((next: ConversationPrefs) => {
    try { localStorage.setItem(storageKey(userId), JSON.stringify(next)) } catch { /* modo privado */ }
  }, [userId])

  const setPref = useCallback(<K extends keyof ConversationPrefs>(key: K, value: ConversationPrefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value }
      persist(next)
      return next
    })
  }, [persist])

  const reset = useCallback(() => {
    setPrefs(DEFAULT_PREFS)
    persist(DEFAULT_PREFS)
  }, [persist])

  const value = useMemo<PrefsContext>(() => {
    // Cor e peso só entram quando escolhidos: sem a variável, o CSS cai no
    // fallback (`currentColor` / 700) e a tela fica exatamente como era.
    const cor = NAME_COLORS.find((c) => c.id === prefs.nameColor)?.value ?? null
    return {
      prefs,
      setPref,
      reset,
      nameStyle: {
        ...(cor ? { color: cor } : {}),
        ...(prefs.nameBold ? { fontWeight: 700 } : {}),
      },
      cssVars: {
        '--conv-msg-font': fontSize(prefs.messageFont),
        '--conv-name-font': fontSize(prefs.contactFont),
        '--conv-meta-font': metaFontSize(prefs.bubbleMetaFont),
        ...(cor ? { '--conv-name-color': cor } : {}),
        ...(prefs.nameBold ? { '--conv-name-weight': '700' } : {}),
      },
    }
  }, [prefs, setPref, reset])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useConversationPrefs(): PrefsContext {
  return useContext(Ctx)
}
