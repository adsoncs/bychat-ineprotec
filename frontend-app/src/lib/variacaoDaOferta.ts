// Versão da oferta quando o mesmo curso tem variações (ex.: "Técnico em Mecânica — Tradicional"
// e "Técnico em Mecânica — Certificação por Competência"). É o que vem depois do "—" no nome
// da oferta, mais o complemento (o prazo). Oferta sem variação devolve null.
export interface OfertaComVariacao { nome?: string | null; complemento?: string | null; course?: { nome?: string | null } | null }

export function partesDaOferta(o: OfertaComVariacao | null | undefined): { base: string | null; variacao: string | null } {
  const nome = (o?.nome ?? '').trim()
  if (!nome) return { base: null, variacao: null }
  const curso = (o?.course?.nome ?? '').trim()
  let base = nome
  let resto = ''
  if (curso && nome.startsWith(curso) && nome.length > curso.length) {
    base = curso
    resto = nome.slice(curso.length).replace(/^\s*[—–-]\s*/, '').trim()
  } else if (nome.includes(' — ')) {
    const i = nome.indexOf(' — ')
    base = nome.slice(0, i).trim()
    resto = nome.slice(i + 3).trim()
  }
  if (!resto) return { base, variacao: null }
  return { base, variacao: [resto, o?.complemento?.trim()].filter(Boolean).join(' · ') }
}

export const variacaoDaOferta = (o: OfertaComVariacao | null | undefined) => partesDaOferta(o).variacao
