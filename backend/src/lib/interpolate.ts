// src/lib/interpolate.ts
// Interpolação simples de variáveis {{ chave }} em textos de mensagem editáveis
// (mensagens do chatbot scripted, templates de notificação de reunião, etc.).
// Valores nulos/indefinidos viram string vazia; chave desconhecida é removida.

export function interpolate(tpl: string, vars: Record<string, any>): string {
  if (!tpl) return ''
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

// Conserta HTML que foi salvo entity-encoded (&lt;div&gt;...) por engano — ex.: um
// editor que escapou o HTML inteiro. Só decodifica quando o valor PARECE totalmente
// escapado (tem &lt;/&gt; e NÃO tem tag crua), pra não tocar em HTML legítimo que
// use entidades pontuais. Mesma heurística do sanitizeBlockHtml de forms.
export function decodeHtmlIfEscaped(v: string | null | undefined): string {
  const s = String(v ?? '')
  if (!s) return ''
  if (/&lt;|&gt;/.test(s) && !/<[a-z!/]/i.test(s)) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  }
  return s
}
