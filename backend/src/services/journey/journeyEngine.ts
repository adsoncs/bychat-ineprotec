// src/services/journey/journeyEngine.ts
//
// Núcleo de DECISÃO puro e agnóstico de canal da jornada formulário→lead.
// Sem I/O: aqui só se DECIDE (interpretar a resposta de um campo, avaliar a
// qualificação, resolver para qual etapa mover e qual é o próximo passo); quem
// EXECUTA (enviar mensagem, persistir, mover etapa, agendar) é o adapter do canal.
//
// Objetivo: tirar a lógica de decisão de dentro do runner do WhatsApp
// (scriptedChatbotFlow.ts) para um ponto único, eliminando o "motor clonado".
// As operações atômicas de persistência continuam em formFlow.ts
// (createLeadFromForm/moveLeadStage). As Fases 2 (regras de transição
// explícitas) e 3 (interpretação por IA) plugam exatamente nestes pontos.

import {
  resolveQualification,
  validateFieldValue,
  matchSelectChoice,
  matchScaleChoice,
  type QualifyResolved,
} from '../formFlow.js'

export type { QualifyResolved }

// ── Próximo passo ─────────────────────────────────────────────────────────────
// Avança a partir de `fromIndex` pulando statements e classifica o que fazer no
// campo encontrado: perguntar, entrar no agendamento ou finalizar (acabaram os
// campos). `index` é idêntico ao antigo nextRealIndex; `kind` substitui os
// checks inline (>= length → finish; type==='scheduling' → scheduling).
export type StepKind = 'ask' | 'scheduling' | 'finish'
export interface NextStep {
  kind: StepKind
  index: number
  field: any | null
}
// `opts.known` (opcional): mapa mapTo→true de dados que o canal JÁ possui
// (ex.: nome do contato). Campos com `skipIfKnown: true` cujo mapTo consta como
// conhecido são pulados como os statements — nunca pergunta o que já se sabe.
export function nextStep(fields: any[], fromIndex: number, opts?: { known?: Record<string, boolean> }): NextStep {
  const skip = (f: any): boolean =>
    f?.type === 'statement' || (f?.skipIfKnown === true && !!f?.mapTo && !!opts?.known?.[f.mapTo])
  let i = fromIndex
  while (i < fields.length && skip(fields[i])) i++
  if (i >= fields.length) return { kind: 'finish', index: i, field: null }
  const field = fields[i]
  if (field?.type === 'scheduling') return { kind: 'scheduling', index: i, field }
  return { kind: 'ask', index: i, field }
}

// ── Interpretação da resposta a um campo (canal texto) ────────────────────────
// Espelha exatamente o que o runner fazia inline: select casa primeiro pelo id do
// botão/linha (value exato) e, senão, pela resposta digitada (número/label/value);
// demais campos passam pela validação server-side. Na Fase 3 este é o ponto onde
// a interpretação por IA entra como mais um elo da cadeia (antes do reask).
export type ParsedAnswer =
  | { ok: true; value: string }
  | { ok: false; kind: 'select'; error: 'invalidSelect' }
  | { ok: false; kind: 'value'; error: string }

export function parseAnswer(field: any, text: string, interactiveReplyId?: string | null): ParsedAnswer {
  // Escala: o id do botão/linha nativo já é a própria nota; no texto, matchScaleChoice
  // extrai o número e valida o intervalo (não é índice 1-based como no select).
  if (field?.type === 'scale') {
    const fromInteractive = interactiveReplyId && /^-?\d+$/.test(interactiveReplyId) ? interactiveReplyId : null
    const choice = fromInteractive
      ? matchScaleChoice(field, fromInteractive)
      : matchScaleChoice(field, text)
    if (!choice) return { ok: false, kind: 'value', error: validateFieldValue(field, text) || 'Nota inválida' }
    return { ok: true, value: choice.value }
  }
  if (field?.type === 'select') {
    let choice: { value: string; label: string } | null = null
    if (interactiveReplyId) {
      const byId = (field.options || []).find((o: any) => String(o.value) === interactiveReplyId)
      if (byId) choice = { value: byId.value, label: byId.label }
    }
    if (!choice) choice = matchSelectChoice(field, text)
    if (!choice) return { ok: false, kind: 'select', error: 'invalidSelect' }
    return { ok: true, value: choice.value }
  }
  const err = validateFieldValue(field, text)
  if (err) return { ok: false, kind: 'value', error: err }
  return { ok: true, value: text.trim() }
}

// ── Qualificação ("negativo vence") ───────────────────────────────────────────
// Ponto único de avaliação de qualificação para todos os canais.
export function evaluateQualification(fields: any[], answers: Record<string, any>, settings: any): QualifyResolved | null {
  return resolveQualification(fields, answers, settings)
}

// ── Resolução de movimentação de etapa ────────────────────────────────────────
// Centraliza o encadeamento de fallback de funil (outcome → conexão → form) e a
// política forwardOnly, que estavam repetidos em 4 lugares do runner:
//   - Desqualificação (isFinish): move SEMPRE (forwardOnly:false); usa
//     defaultStageKey quando o outcome não traz stageKey próprio.
//   - Qualificação positiva (!isFinish): NUNCA regride (forwardOnly:true) e só
//     move se houver stageKey (sem stageKey → null, mantém a etapa atual).
export interface StageMove { funnelId: number | null; stageKey: string; forwardOnly: boolean }
export function resolveStageMove(
  outcome: QualifyResolved | null,
  opts: { promoteFunnelId?: number | null; formFunnelId?: number | null; isFinish: boolean; defaultStageKey?: string },
): StageMove | null {
  if (!outcome) return null
  const stageKey = outcome.stageKey || (opts.isFinish ? (opts.defaultStageKey || 'DESQUALIFICADO_FORMS') : '')
  if (!stageKey) return null
  const funnelId = outcome.funnelId ?? opts.promoteFunnelId ?? opts.formFunnelId ?? null
  return { funnelId, stageKey, forwardOnly: !opts.isFinish }
}
