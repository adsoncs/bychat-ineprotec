import { create } from 'zustand'
import { CATALOGS, pt, type Locale, type MessageKey } from './messages'

interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

/**
 * O sistema é em português, e só.
 *
 * O seletor de idioma saiu do topo em 05/09/2026. Duas coisas tinham de sair
 * junto com ele, senão a remoção prenderia gente em inglês ou espanhol sem
 * botão nenhum para voltar:
 *
 *   1. O idioma vinha do idioma do NAVEGADOR, então quem usa o navegador em
 *      inglês nunca tinha visto o sistema em português — sem ter mexido em nada.
 *   2. A escolha era gravada em `bh:locale` no localStorage. Quem já tinha
 *      trocado continuaria no idioma antigo para sempre.
 *
 * A maquinaria de tradução fica de pé: `useT`, os catálogos e as chaves seguem
 * como estão. Voltar atrás é recolocar o `<LocaleMenu />` no Topbar e devolver
 * a detecção e a gravação aqui — de propósito, para o dia em que houver
 * tradução de verdade para manter.
 */
export const useLocaleStore = create<LocaleState>()((set) => ({
  locale: 'pt',
  setLocale: (locale) => {
    if (typeof document !== 'undefined') document.documentElement.lang = bcp47(locale)
    set({ locale })
  },
}))

if (typeof document !== 'undefined') {
  document.documentElement.lang = bcp47('pt')
  // Apaga a preferência antiga: sem isto ela ficaria guardada no navegador de
  // cada usuário sem nada que a leia nem que a mude.
  try {
    window.localStorage.removeItem('bh:locale')
  } catch {
    // localStorage bloqueado (janela anônima, cookies desativados) — nada a fazer.
  }
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
