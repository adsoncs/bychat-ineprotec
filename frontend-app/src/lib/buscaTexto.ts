/**
 * Achar e grifar o termo buscado — sem diferença de acento nem de maiúscula,
 * como o banco (collation _ci) e o WhatsApp: "joao" acha "João".
 *
 * A comparação é feita num texto "achatado" (sem acento, minúsculo), mas os
 * trechos devolvidos são do texto ORIGINAL — o grifo cai exatamente sobre o
 * que a pessoa lê, com os acentos que estão lá.
 */

/** Texto achatado + de que posição do original veio cada caractere dele. */
function achatar(texto: string): { plano: string; origem: number[] } {
  let plano = ''
  const origem: number[] = []
  let i = 0
  for (const ch of texto) {
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    for (let k = 0; k < base.length; k++) { plano += base[k]; origem.push(i) }
    i += ch.length
  }
  origem.push(i)
  return { plano, origem }
}

export function normalizarBusca(s: string): string {
  return achatar(s.trim()).plano.replace(/\s+/g, ' ')
}

/** Intervalos [início, fim) do termo no texto original. */
export function ocorrencias(texto: string, termo: string): Array<[number, number]> {
  const t = normalizarBusca(termo)
  if (!t || !texto) return []
  const { plano, origem } = achatar(texto)
  const achados: Array<[number, number]> = []
  let de = 0
  for (;;) {
    const i = plano.indexOf(t, de)
    if (i < 0) break
    achados.push([origem[i]!, origem[i + t.length]!])
    de = i + t.length
  }
  return achados
}

export type Trecho = { texto: string; hit: boolean }

export function trechos(texto: string, termo: string): Trecho[] {
  const oc = ocorrencias(texto, termo)
  if (!oc.length) return [{ texto, hit: false }]
  const out: Trecho[] = []
  let pos = 0
  for (const [a, b] of oc) {
    if (a > pos) out.push({ texto: texto.slice(pos, a), hit: false })
    out.push({ texto: texto.slice(a, b), hit: true })
    pos = b
  }
  if (pos < texto.length) out.push({ texto: texto.slice(pos), hit: false })
  return out
}

/**
 * Tira os marcadores do WhatsApp (*negrito*, _itálico_, ~tachado~, `código`)
 * do texto de uma linha de resultado — lá eles apareceriam crus, como
 * "_Atribuído a:_". Só os que estão colados numa palavra, como o WhatsApp exige.
 */
export function semMarcacao(texto: string): string {
  return texto
    .replace(/```/g, '')
    .replace(/(^|[\s(])([*_~`])(?=\S)([^*_~`\n]*?\S)\2(?=$|[\s).,!?:;])/g, '$1$3')
}

/**
 * Trecho da mensagem para a lista de resultados: uma linha só, e começando
 * perto do termo — numa mensagem longa, o termo no meio do texto nunca
 * apareceria na linha cortada. Como o WhatsApp, corta com "…".
 */
export function recorte(texto: string, termo: string, antes = 28): string {
  const umaLinha = semMarcacao(texto).replace(/\s+/g, ' ').trim()
  const oc = ocorrencias(umaLinha, termo)[0]
  if (!oc || oc[0] <= antes) return umaLinha
  let ini = oc[0] - antes
  const espaco = umaLinha.lastIndexOf(' ', ini + 8)
  if (espaco > ini - 12 && espaco < oc[0]) ini = espaco + 1
  return '…' + umaLinha.slice(ini)
}

/**
 * Grifa o termo num HTML já montado (a bolha formatada: negrito, links…).
 * Percorre só os NÓS DE TEXTO — substituir na string quebraria tag e atributo
 * (buscar "class" grifaria dentro de `<a class=…>`).
 */
export function grifarHtml(html: string, termo: string, classe: string): string {
  if (!normalizarBusca(termo) || typeof document === 'undefined') return html
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT)
  const nos: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nos.push(n as Text)
  for (const no of nos) {
    const partes = trechos(no.data, termo)
    if (partes.length === 1 && !partes[0]!.hit) continue
    const frag = document.createDocumentFragment()
    for (const p of partes) {
      if (!p.hit) { frag.appendChild(document.createTextNode(p.texto)); continue }
      const m = document.createElement('mark')
      m.className = classe
      m.textContent = p.texto
      frag.appendChild(m)
    }
    no.replaceWith(frag)
  }
  return tpl.innerHTML
}
