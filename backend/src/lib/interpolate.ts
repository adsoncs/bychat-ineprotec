// src/lib/interpolate.ts
// Interpolação simples de variáveis {{ chave }} em textos de mensagem editáveis
// (mensagens do chatbot scripted, templates de notificação de reunião, etc.).
// Valores nulos/indefinidos viram string vazia; chave desconhecida é removida.

export function interpolate(tpl: string, vars: Record<string, any>): string {
  if (!tpl) return ''
  return aplicarBlocos(tpl, vars).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

// Blocos condicionais (estilo Mustache), para o texto inteiro morar no modelo:
//   {{#link}}Link: {{link}}{{/link}}  → só aparece se `link` tiver valor
//   {{^nome}}Olá!{{/nome}}            → só aparece se `nome` estiver vazio
//   {{#itens}}• {{titulo}}\n{{/itens}}  → repete para cada item da lista
// Aninhar o mesmo nome não é suportado (não precisamos).
const vazio = (v: any) => v === undefined || v === null || v === '' || v === false || v === 0 || (Array.isArray(v) && v.length === 0)
export function aplicarBlocos(tpl: string, vars: Record<string, any>): string {
  let s = tpl
  for (let i = 0; i < 5 && /\{\{[#^][\w.]+\}\}/.test(s); i++) {
    s = s.replace(/\{\{([#^])\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g, (_m, tipo: string, key: string, dentro: string) => {
      const v = vars[key]
      // Lista: repete o trecho para cada item, com os campos do item como variáveis.
      if (tipo === '#' && Array.isArray(v)) {
        // {{#primeiro}}…{{/primeiro}} dentro da lista: título que só aparece se houver item.
        return v.map((item, i) => interpolate(dentro, {
          ...vars, ...(item && typeof item === 'object' ? item : { item }),
          primeiro: i === 0 ? 'sim' : '', ultimo: i === v.length - 1 ? 'sim' : '',
        })).join('')
      }
      const mostra = tipo === '#' ? !vazio(v) : vazio(v)
      return mostra ? dentro : ''
    })
  }
  return s
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
