// Identidade do portal no painel — o que diferencia um portal (e uma empresa)
// do outro para a equipe: ícone, cor, empresa, descrição interna e ordem.
// Não aparece para o candidato; a página pública usa as cores de Aparência.

export interface IdentidadePainel {
  icone: string | null
  cor: string | null
  empresa: string | null
  descricao: string | null
  ordem: number | null
  /** Mostra o polo no card do portal e na faixa da inscrição, quando houver. */
  mostrarPolo: boolean
  /** Imagem própria no lugar do ícone (logo da empresa, PNG sem fundo ou ICO).
   *  Só a URL que o upload `kind=icone` grava: /uploads/portals/{id}/icone-painel.{png|ico}. */
  imagem: string | null
}

const HEX = /^#[0-9a-f]{6}$/i
const ICONE = /^[A-Za-z][A-Za-z0-9]{0,39}$/
export const IMAGEM_ICONE = /^\/uploads\/portals\/\d{1,9}\/icone-painel\.(png|ico)(\?v=\d{1,16})?$/
const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null)

/** Normaliza o que veio do formulário; `null`/vazio = sem identidade. */
export function lerIdentidadePainel(v: unknown): IdentidadePainel | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const ordem = Number(o.ordem)
  const r: IdentidadePainel = {
    icone: typeof o.icone === 'string' && ICONE.test(o.icone) ? o.icone : null,
    cor: typeof o.cor === 'string' && HEX.test(o.cor.trim()) ? o.cor.trim().toLowerCase() : null,
    empresa: texto(o.empresa, 60),
    descricao: texto(o.descricao, 200),
    ordem: o.ordem !== null && o.ordem !== '' && Number.isInteger(ordem) && ordem >= 0 && ordem <= 999 ? ordem : null,
    mostrarPolo: o.mostrarPolo === true,
    imagem: typeof o.imagem === 'string' && IMAGEM_ICONE.test(o.imagem.trim()) ? o.imagem.trim() : null,
  }
  return Object.entries(r).some(([k, x]) => (k === 'mostrarPolo' ? x === true : x !== null)) ? r : null
}
