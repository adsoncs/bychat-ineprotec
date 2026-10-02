// Textos do portal editáveis em Educacional › Configurações Gerais › Textos.
//
// Cada tela chama t('chave', 'texto de sempre'): sem nada configurado, sai o
// texto de sempre. O catálogo (nomes e padrões que o admin vê) mora no backend,
// em lib/eduTextos.ts — mudou um padrão aqui, mude lá também.
//
// Os textos chegam junto com a marca (aplicarMarca), então a tela redesenha
// com eles assim que a marca carrega.

let editados: Record<string, string> = {}

export function definirTextos(t: Record<string, string> | null | undefined) {
  editados = t && typeof t === 'object' ? t : {}
}

/** Texto configurado nas Gerais, ou o padrão. {marcadores} trocados por `vars`. */
export function t(chave: string, padrao: string, vars?: Record<string, string | number>): string {
  const v = editados[chave]
  let s = typeof v === 'string' && v.trim() ? v : padrao
  if (vars) for (const [k, val] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(val))
  return s
}
