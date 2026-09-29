// src/services/cursoDoLink.ts
//
// Curso escolhido pelo link: /portal/<portal>/<curso> (ou ?curso=<curso>).
//
// É o que a página de um curso no site usa no botão "Matricule-se": o portal
// abre só com aquele curso, já escolhido, e a pessoa não passa pela lista. O
// identificador é o `slug` da oferta — um campo próprio, e não o id (recriar a
// oferta mudaria o id e quebraria o link do site em silêncio) nem o código
// interno (que tem outro dono e pode mudar por outro motivo).

/**
 * Caminhos que o portal já usa depois de /portal/<slug>/... ou que o servidor
 * atende em /portal/<nome>. Um curso com um desses endereços "sequestraria" a
 * tela do aluno — o portal-app decide a tela pelo fim do caminho.
 */
export const SLUGS_RESERVADOS = new Set([
  'aluno', 'documentos', 'contrato', 'entrar', 'login', 'senha', 'aca', 'acordo',
  'offline', 'rematricula', 'pagamento', 'candidato', 'api', 'assets', 'portal',
])

/** "Técnico em Agrimensura" → "tecnico-em-agrimensura". */
export function normalizarSlugCurso(bruto: unknown): string {
  return String(bruto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

/**
 * Valida o endereço digitado na tela de ofertas. `null` = campo apagado (a
 * oferta deixa de ter link direto).
 */
export function validarSlugCurso(bruto: unknown): { slug: string | null } | { erro: string } {
  if (bruto === null || bruto === undefined || String(bruto).trim() === '') return { slug: null }
  const slug = normalizarSlugCurso(bruto)
  if (slug.length < 2) return { erro: 'O endereço do curso precisa de pelo menos 2 letras ou números.' }
  if (SLUGS_RESERVADOS.has(slug)) return { erro: `"${slug}" é um endereço reservado do portal. Escolha outro.` }
  return { slug }
}

/** Lê o curso pedido no link: o segmento do caminho vence o `?curso=`. */
export function cursoPedido(segmento: unknown, query: unknown): string | null {
  const s = normalizarSlugCurso(segmento || query)
  return s && !SLUGS_RESERVADOS.has(s) ? s : null
}
