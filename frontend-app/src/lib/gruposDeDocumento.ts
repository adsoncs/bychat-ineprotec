// Grupos de documentos (mesma divisão no portal do aluno e na ficha da
// inscrição do painel): Pessoais · Residência · Escolaridade · Complementares.
// O grupo sai da categoria do tipo de documento (cada tenant usa um nome:
// identity/identificacao, academic/academico…); comprovante de endereço tem
// grupo próprio mesmo cadastrado como identificação.
// ⚠️ Arquivo duplicado em frontend-app/src/lib e portal-app/src — mudou um, mude o outro.

export type GrupoDeDocumento = 'pessoais' | 'residencia' | 'escolaridade' | 'complementares'

export const GRUPOS: Array<{ chave: GrupoDeDocumento; nome: string; icone: string }> = [
  { chave: 'pessoais', nome: 'Documentos pessoais', icone: '🪪' },
  { chave: 'residencia', nome: 'Comprovante de residência', icone: '🏠' },
  { chave: 'escolaridade', nome: 'Escolaridade', icone: '🎓' },
  { chave: 'complementares', nome: 'Complementares', icone: '📎' },
]

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function grupoDoDocumento(t: { code?: string | null; name?: string | null; category?: string | null } | null | undefined): GrupoDeDocumento {
  const code = sem(t?.code ?? '')
  const nome = sem(t?.name ?? '')
  const cat = sem(t?.category ?? '')
  if (/resid|endereco|comp_end/.test(code) || /resid|endereco/.test(cat) || /comprovante de (residencia|endereco)/.test(nome)) return 'residencia'
  if (/^(identity|identificacao|identidade|pessoal|pessoais)$/.test(cat)) return 'pessoais'
  if (/^(academic|academico|escolaridade|enem)$/.test(cat)) return 'escolaridade'
  return 'complementares'
}

/**
 * Separa os itens nos grupos, na ordem combinada (pessoais e residência
 * primeiro, depois escolaridade). Grupo vazio não aparece; grupo só de
 * opcionais vai para o fim. Dentro do grupo, a ordem original se mantém.
 */
export function agruparDocumentos<T>(itens: T[], tipo: (x: T) => { code?: string | null; name?: string | null; category?: string | null } | null | undefined, obrigatorio: (x: T) => boolean) {
  const grupos = GRUPOS.map((g) => ({ ...g, itens: itens.filter((x) => grupoDoDocumento(tipo(x)) === g.chave) }))
    .filter((g) => g.itens.length > 0)
    .map((g) => ({ ...g, soOpcionais: !g.itens.some(obrigatorio) }))
  return [...grupos.filter((g) => !g.soOpcionais), ...grupos.filter((g) => g.soOpcionais)]
}
