// src/lib/tipos.ts
//
// Utilitários de tipo que o projeto precisa por causa de
// `exactOptionalPropertyTypes: true` no tsconfig.
//
// Com essa flag, `campo?: string` significa "a chave pode não existir" — e NÃO
// "a chave pode valer undefined". São coisas diferentes, e o código de tela
// escreve a segunda o tempo todo:
//
//     salvar({ id: editando?.id, nome, ... })      // id ausente = criar
//     buscar({ q: termo || undefined })            // filtro limpo
//
// `Partial<T>` do TypeScript produz `campo?: T[K]`, que recusa esses casos. Este
// arquivo dá as versões que aceitam.

/**
 * Como `Partial<T>`, mas cada chave também aceita `undefined` explícito.
 *
 * Use no tipo do parâmetro de uma mutation que faz "criar ou atualizar", ou de
 * qualquer função que receba um objeto de filtros montado na tela.
 */
export type Parcial<T> = { [K in keyof T]?: T[K] | undefined }

/**
 * Como `T`, mas as chaves já opcionais passam a aceitar `undefined` explícito.
 * Preserva as chaves obrigatórias como estão.
 */
export type ComUndefinedOpcional<T> = {
  [K in keyof T]: undefined extends T[K] ? T[K] : T[K]
}
