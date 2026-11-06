// src/services/docCondicional.ts
//
// Documento exigido só de quem deu certa resposta no formulário — ex.: laudo
// médico só de quem declarou deficiência. A condição mora no requisito
// (EntryModeDocumentRequirement / SelectionProcessDocumentRequirement.condicao)
// como { campo, valores[] }: vale quando formData[campo] é um dos valores.
// Sem condição, o requisito vale sempre (comportamento de antes).

export interface CondicaoDoc { campo: string; valores: string[] }

export function normalizarCondicao(bruto: unknown): CondicaoDoc | null {
  const b = bruto as any
  const campo = String(b?.campo ?? '').trim()
  const valores = Array.isArray(b?.valores) ? b.valores.map((v: unknown) => String(v ?? '').trim()).filter(Boolean) : []
  return campo && valores.length ? { campo, valores } : null
}

export function condicaoAtende(bruto: unknown, formData: unknown): boolean {
  const c = normalizarCondicao(bruto)
  if (!c) return true
  const v = String(((formData as Record<string, unknown>) ?? {})[c.campo] ?? '').trim()
  return c.valores.includes(v)
}

/**
 * Dispensas da matrícula interna (05/11/2026). Ficam no próprio formData da
 * inscrição, em `_dispensas`, porque é ele que todo mundo que calcula "o que esta
 * inscrição exige" já recebe: tela do aluno, jornada, revisão, funil, SEI e
 * gateway de avaliação passam a enxergar a dispensa sem caminho paralelo.
 * Quem grava e valida: routes/matriculaInterna.ts.
 */
export interface Dispensa { motivo: string; por: string; porId: number; em: string }
export interface Dispensas { documentos: Record<string, Dispensa>; etapas: Record<string, Dispensa> }
export function dispensasDe(formData: unknown): Dispensas {
  const d = (formData as any)?._dispensas
  return { documentos: (d?.documentos && typeof d.documentos === 'object') ? d.documentos : {}, etapas: (d?.etapas && typeof d.etapas === 'object') ? d.etapas : {} }
}

/** Requisitos pela condição, MANTENDO os dispensados (tela interna, que mostra o selo). */
export function requisitosDaCondicao<T>(lista: T[], formData: unknown): T[] {
  return (lista ?? []).filter((r: any) => condicaoAtende(r?.condicao, formData))
}

/** Requisitos que valem para esta inscrição (tira os condicionais que não batem e os dispensados). */
export function requisitosQueValem<T>(lista: T[], formData: unknown): T[] {
  const { documentos } = dispensasDe(formData)
  return requisitosDaCondicao(lista, formData).filter((r: any) => !documentos[r?.documentType?.code])
}

/** Frase curta para quem não tem a inscrição em mãos (chatbot, telas de config). */
export function descreverCondicao(bruto: unknown): string | null {
  const c = normalizarCondicao(bruto)
  return c ? `só quando "${c.campo}" for ${c.valores.join(' ou ')}` : null
}

/**
 * Campo do formulário que só aparece conforme outra resposta
 * (`visibleWhen.field = { name, values[] }`, ex.: tipo de deficiência só para
 * quem respondeu "Sim"). Escondido = não é cobrado.
 */
export function campoCondicionalAtende(visibleWhen: unknown, formData: unknown): boolean {
  const f = (visibleWhen as any)?.field
  if (!f?.name || !Array.isArray(f.values) || !f.values.length) return true
  return condicaoAtende({ campo: f.name, valores: f.values }, formData)
}
