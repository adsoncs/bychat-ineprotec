import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CATALOGS, pt, type Locale, type MessageKey } from './messages'

interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: detectInitialLocale(),
      setLocale: (locale) => {
        if (typeof document !== 'undefined') {
          document.documentElement.lang = bcp47(locale)
        }
        set({ locale })
      },
    }),
    {
      name: 'bh:locale',
      onRehydrateStorage: () => (state) => {
        if (state && typeof document !== 'undefined') {
          document.documentElement.lang = bcp47(state.locale)
        }
      },
    },
  ),
)

function detectInitialLocale(): Locale {
  if (typeof navigator === 'undefined') return 'pt'
  const lang = navigator.language.toLowerCase()
  if (lang.startsWith('en')) return 'en'
  if (lang.startsWith('es')) return 'es'
  return 'pt'
}

function bcp47(locale: Locale): string {
  return { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }[locale]
}

export function bcpLocale(locale: Locale): string {
  return bcp47(locale)
}

export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string

/**
 * Hook que retorna a função de tradução `t(key, params?)`. Substitui {param}
 * em ordem simples — não suporta plural ou ICU complexo (intencional, manter
 * dependências leves). Se a chave faltar no idioma atual, cai no pt e loga
 * em DEV.
 */
export function useT(): Translator {
  const locale = useLocaleStore((s) => s.locale)
  const catalog = CATALOGS[locale]

  return (key, params) => {
    const raw = catalog[key] ?? pt[key]
    if (!raw) {
      if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`)
      return key
    }
    if (!params) return raw
    return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
      params[name] !== undefined ? String(params[name]) : `{${name}}`,
    )
  }
}

export type { Locale, MessageKey } from './messages'
