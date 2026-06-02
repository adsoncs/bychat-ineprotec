/**
 * Gera um slug curto e maiúsculo a partir de um nome em português, ideal para
 * usar como `codigo` (Level/Modality/EntryMode/Course/etc).
 *
 * Espelha `_eduSlugify()` do legado:
 * - Remove acentos (NFD + diacríticos)
 * - Mantém somente letras e números
 * - Maiúsculas
 * - Limita a 12 caracteres por padrão
 *
 * @example slugify('Educação Básica') === 'EDUCACAOBASIC'
 * @example slugify('Vestibular 2026.2', 20) === 'VESTIBULAR20262'
 */
export function slugify(input: string, max = 12): string {
  if (!input) return ''
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, max)
}

/**
 * Versão dasherized — ideal para slug de URL.
 *
 * @example dasherize('Educação Básica') === 'educacao-basica'
 */
export function dasherize(input: string): string {
  if (!input) return ''
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
