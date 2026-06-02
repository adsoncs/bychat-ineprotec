// src/services/enemClassification.ts
// F3 — Importação e classificação de notas ENEM a partir de boletim analisado
// pelo worker de análise documental (F2).
//
// Fluxo:
//   1. aiDocumentReview processa o boletim e grava EnrollmentDocument.aiAnalysis
//   2. Se o tipo é boletim_enem, o worker chama processEnemScoreFromDocument()
//   3. Aqui extraímos as 5 notas, calculamos a média simples e (F3.3)
//      aplicamos a nota de corte da oferta/processo para classificar.
//   4. Cria/atualiza EnemScoreImport + atualiza ProcessRegistration.
//
// A IA NUNCA aprova definitivamente — o status 'classificado' ou 'reprovado'
// pode ser revertido pelo operador humano via validateEnemImport.

import { prisma } from '../lib/prisma.js'

function toNumber(v: any): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return isFinite(n) ? n : null
}

// Extrai o shape do aiAnalysis com tolerância (ora vem aninhado em .data, ora flat).
function extractEnemData(aiAnalysis: any): any {
  if (!aiAnalysis) return {}
  if (aiAnalysis.data) return aiAnalysis.data
  return aiAnalysis
}

export async function processEnemScoreFromDocument(docId: number): Promise<{
  ok: boolean
  importedId?: number
  passed?: boolean | null
  mediaSimples?: number | null
  reason?: string
}> {
  const doc = await prisma.enrollmentDocument.findUnique({
    where: { id: docId },
    include: {
      type: true,
      registration: {
        include: {
          processRegistration: {
            include: {
              offering: { select: { id: true, nome: true, notaCorte: true } },
              selectionProcess: {
                select: {
                  id: true, nome: true, notaCorte: true,
                  entryMode: { select: { code: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!doc) return { ok: false, reason: 'doc não encontrado' }
  if (doc.type?.code !== 'boletim_enem') return { ok: false, reason: 'tipo não é boletim_enem' }
  if (doc.aiStatus !== 'done') return { ok: false, reason: `aiStatus=${doc.aiStatus}` }

  const d = extractEnemData(doc.aiAnalysis)
  const notas = d.notas || d
  const ch = toNumber(notas.cienciasHumanas)
  const cn = toNumber(notas.cienciasNatureza)
  const lg = toNumber(notas.linguagens)
  const mt = toNumber(notas.matematica)
  const rd = toNumber(notas.redacao)
  const notasValidas = [ch, cn, lg, mt, rd].filter((v): v is number => v != null && v > 0)
  const mediaSimples = notasValidas.length >= 4
    ? notasValidas.reduce((a, b) => a + b, 0) / notasValidas.length
    : null

  const sp = doc.registration.processRegistration?.selectionProcess
  const off = doc.registration.processRegistration?.offering
  // Prioridade: oferta (override) > processo > null
  const cutoff = off?.notaCorte != null ? Number(off.notaCorte)
               : sp?.notaCorte != null ? Number(sp.notaCorte)
               : null
  // passed: null se não há corte ou nota insuficiente pra avaliar
  const passed = cutoff != null && mediaSimples != null ? mediaSimples >= cutoff : null

  const payload = {
    nome: d.nome || null,
    inscricao: d.inscricao || null,
    ano: toNumber(d.ano),
    treineiro: !!d.treineiro,
    cienciasHumanas: ch,
    cienciasNatureza: cn,
    linguagens: lg,
    matematica: mt,
    redacao: rd,
    mediaSimples,
    nomeBateComForm: typeof d.nomeBateComForm === 'boolean' ? d.nomeBateComForm : null,
    inscricaoBateComForm: typeof d.inscricaoBateComForm === 'boolean' ? d.inscricaoBateComForm : null,
    anoBateComForm: typeof d.anoBateComForm === 'boolean' ? d.anoBateComForm : null,
    cutoffScore: cutoff,
    passed,
    source: 'ai' as const,
    aiConfidence: doc.aiConfidence,
    rawAnalysis: doc.aiAnalysis as any,
  }

  // Upsert: 1 EnemScoreImport por documento (unique documentId)
  const existing = await prisma.enemScoreImport.findUnique({ where: { documentId: doc.id } })
  const imp = existing
    ? await prisma.enemScoreImport.update({ where: { id: existing.id }, data: payload })
    : await prisma.enemScoreImport.create({
        data: { registrationId: doc.registrationId, documentId: doc.id, ...payload },
      })

  // F3.3 — Classificação automática em ProcessRegistration
  const pr = doc.registration.processRegistration
  if (pr && mediaSimples != null) {
    const updates: any = { notaClassificacao: mediaSimples }
    let newStatus = pr.status
    if (passed === true) {
      newStatus = 'classificado'
      updates.status = 'classificado'
      updates.classificadoEm = new Date()
    } else if (passed === false) {
      newStatus = 'reprovado'
      updates.status = 'reprovado'
    }

    if (newStatus !== pr.status) {
      await prisma.processRegistration.update({ where: { id: pr.id }, data: updates })
      await prisma.processRegistrationStatusLog.create({
        data: {
          registrationId: pr.id,
          fromStatus: pr.status,
          toStatus: newStatus,
          actorName: 'Sistema (IA — ENEM)',
          observacao: `Classificação automática por média ENEM: ${mediaSimples.toFixed(1)}${cutoff != null ? ` (corte ${cutoff})` : ' (sem corte definido)'}`,
        },
      }).catch(() => {})
    } else if (mediaSimples != null) {
      // Só atualiza a nota, sem mudar status
      await prisma.processRegistration.update({
        where: { id: pr.id },
        data: { notaClassificacao: mediaSimples },
      })
    }
  }

  return { ok: true, importedId: imp.id, passed, mediaSimples }
}

// Override humano — permite admin corrigir as notas extraídas pela IA
// ou forçar classificação quando o automático não tem corte configurado.
export async function validateEnemImport(
  importId: number,
  actor: { userId: number; name: string },
  override: {
    cienciasHumanas?: number | null
    cienciasNatureza?: number | null
    linguagens?: number | null
    matematica?: number | null
    redacao?: number | null
    passed?: boolean | null
    validationNote?: string
  }
) {
  const existing = await prisma.enemScoreImport.findUnique({ where: { id: importId } })
  if (!existing) throw new Error('Import não encontrado')

  // Recalcula mediaSimples se alguma nota mudou
  const ch = override.cienciasHumanas !== undefined ? override.cienciasHumanas : existing.cienciasHumanas
  const cn = override.cienciasNatureza !== undefined ? override.cienciasNatureza : existing.cienciasNatureza
  const lg = override.linguagens !== undefined ? override.linguagens : existing.linguagens
  const mt = override.matematica !== undefined ? override.matematica : existing.matematica
  const rd = override.redacao !== undefined ? override.redacao : existing.redacao
  const valid = [ch, cn, lg, mt, rd].filter((v): v is number => v != null && v > 0)
  const mediaSimples = valid.length >= 4 ? valid.reduce((a, b) => a + b, 0) / valid.length : null

  const updated = await prisma.enemScoreImport.update({
    where: { id: importId },
    data: {
      cienciasHumanas: ch, cienciasNatureza: cn, linguagens: lg, matematica: mt, redacao: rd,
      mediaSimples,
      passed: override.passed !== undefined ? override.passed : existing.passed,
      source: 'manual',
      validatedBy: actor.userId,
      validatedAt: new Date(),
      validationNote: override.validationNote || null,
    },
  })

  return updated
}
