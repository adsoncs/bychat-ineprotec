// src/lib/cortarTexto.ts
//
// Corta texto sem partir emoji. Emoji (e outros caracteres fora do plano
// básico) ocupam DUAS unidades numa string JS. Um `.slice(0, n)` que cai no
// meio deixa a primeira metade sozinha (surrogate solto), o JSON enviado à IA
// fica inválido e Anthropic e OpenAI recusam com 400 "Invalid body". Foi o que
// travou a análise de um lead do severiano por dias (05/11/2026).

/** Troca metades soltas de emoji por "�" (o texto continua válido em JSON). */
export function textoValido(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) { out += s[i] + s[i + 1]; i++; continue }
      out += '�'; continue
    }
    if (c >= 0xdc00 && c <= 0xdfff) { out += '�'; continue }
    out += s[i]
  }
  return out
}

/** Até `max` unidades, sem deixar meio emoji no fim. */
export function cortarTexto(s: string | null | undefined, max: number): string {
  let t = String(s ?? '')
  if (t.length > max) {
    t = t.slice(0, max)
    const ultimo = t.charCodeAt(t.length - 1)
    if (ultimo >= 0xd800 && ultimo <= 0xdbff) t = t.slice(0, -1)
  }
  return textoValido(t)
}
