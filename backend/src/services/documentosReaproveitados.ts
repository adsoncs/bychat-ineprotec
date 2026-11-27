// src/services/documentosReaproveitados.ts
//
// Documento já APROVADO numa inscrição da mesma pessoa vale para a inscrição
// nova: não se pede de novo. Só fica pendente o documento que o curso novo
// exige e que a pessoa ainda não teve aprovado (ex.: diploma técnico para a
// especialização). 27/11/2026, ineprotec.
//
// Mesma pessoa = mesmo CPF na inscrição, ou ficha da mesma pessoa
// (fichasDaMesmaPessoa: mesmo WhatsApp ou CPF; CPF diferente nunca entra —
// celular da família). Só aprovado viaja: pendente e reprovado, não.
//
// O arquivo é COPIADO (como na transferência de curso): apagar o documento
// numa inscrição não pode sumir com o da outra. A aprovação original vai junto
// (quem aprovou e quando), com a nota de onde veio.

import { prisma } from '../lib/prisma.js'
import { normalizeCpf } from '../lib/cpf.js'
import { logEvent } from './leadHistory.js'
import { exigidosDoProcesso, copiarArquivo } from './transferenciaCurso.js'
import { fichasDaMesmaPessoa } from './journey/validacaoContato.js'

const STATUS_FORA = ['merged', 'cancelled']
// A inscrição que já saiu (transferida, reprovada) não recebe documento.
const DESTINO_FORA = [...STATUS_FORA, 'transferred', 'rejected']
// Documento que vale para UM curso ou UMA situação: pede-se de novo.
// Experiência é da área do curso (a de Administração não prova Agrimensura).
const NUNCA_REAPROVEITA = new Set(['comprovante_experiencia', 'declaracao_transferencia', 'ementa_disciplinas', 'oficio_remocao', 'decisao_judicial', 'declaracao_nao_vinculo'])
// Documento que envelhece: só vale se aprovado há até PRAZO_RECENTE_DIAS.
const SO_RECENTE = new Set(['comprovante_residencia', 'quitacao_eleitoral'])
const PRAZO_RECENTE_DIAS = 90

export interface Reaproveitamento {
  copiados: Array<{ codigo: string; nome: string; de: string }>
  faltam: string[]
}

export async function reaproveitarDocumentosAprovados(registrationId: number, opts: { simular?: boolean } = {}): Promise<Reaproveitamento> {
  const vazio: Reaproveitamento = { copiados: [], faltam: [] }
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, leadId: true, formData: true, status: true, candidateCode: true,
      processRegistration: { select: { selectionProcessId: true } },
      documents: { select: { typeCode: true, status: true } },
    },
  }).catch(() => null)
  if (!reg || DESTINO_FORA.includes(reg.status) || !reg.processRegistration?.selectionProcessId) return vazio

  const exigidos = await exigidosDoProcesso(reg.processRegistration.selectionProcessId, reg.formData).catch(() => [] as any[])
  if (!exigidos.length) return vazio
  // Já tem (aprovado ou aguardando análise) não se mexe: reprovado é que pede reenvio.
  const temNaInscricao = new Set(reg.documents.filter((d) => d.status !== 'rejected').map((d) => d.typeCode))
  const faltando = exigidos.filter((e: any) => !temNaInscricao.has(e.documentType.code))
  if (!faltando.length) return vazio

  const cpf = normalizeCpf(String((reg.formData as any)?.cpf ?? ''))
  const fichas = reg.leadId ? await fichasDaMesmaPessoa(reg.leadId).catch(() => [reg.leadId!]) : []
  const candidatas = await prisma.enrollmentRegistration.findMany({
    where: { id: { not: reg.id }, status: { notIn: STATUS_FORA } },
    orderBy: { id: 'desc' }, take: 3000,
    select: { id: true, leadId: true, formData: true, candidateCode: true },
  }).catch(() => [] as any[])
  const daPessoa = candidatas.filter((c: any) => {
    const cpfDela = normalizeCpf(String(c.formData?.cpf ?? ''))
    // CPF diferente é outra pessoa, mesmo na mesma ficha (celular da família).
    if (cpf.length === 11 && cpfDela.length === 11) return cpfDela === cpf
    return c.leadId != null && fichas.includes(c.leadId)
  })
  if (!daPessoa.length) return { copiados: [], faltam: faltando.filter((e: any) => e.required !== false).map((e: any) => e.documentType.name) }

  const codigos = faltando.map((e: any) => e.documentType.code as string).filter((c: string) => !NUNCA_REAPROVEITA.has(c))
  if (!codigos.length) return { copiados: [], faltam: faltando.filter((e: any) => e.required !== false).map((e: any) => e.documentType.name) }
  const recenteDesde = new Date(Date.now() - PRAZO_RECENTE_DIAS * 86400_000)
  const aprovados = await prisma.enrollmentDocument.findMany({
    where: { registrationId: { in: daPessoa.map((c: any) => c.id) }, status: 'approved', typeCode: { in: codigos } },
    orderBy: [{ reviewedAt: 'desc' }, { id: 'asc' }], // empate = o original (a cópia nasce depois)
  }).catch(() => [] as any[])
  const melhor = new Map<string, any>()
  for (const d of aprovados) {
    if (melhor.has(d.typeCode)) continue
    if (SO_RECENTE.has(d.typeCode) && !((d.reviewedAt ?? d.uploadedAt) >= recenteDesde)) continue
    melhor.set(d.typeCode, d)
  }

  const codigoDe = new Map(daPessoa.map((c: any) => [c.id, c.candidateCode as string]))
  const copiados: Reaproveitamento['copiados'] = []
  for (const [codigo, orig] of melhor) {
    const de = codigoDe.get(orig.registrationId) ?? `#${orig.registrationId}`
    const nome = faltando.find((e: any) => e.documentType.code === codigo)?.documentType.name ?? orig.label
    if (!opts.simular) {
      const url = await copiarArquivo(orig.fileUrl, reg.id)
      const verso = orig.versoFileUrl ? await copiarArquivo(orig.versoFileUrl, reg.id) : null
      const { id: _id, registrationId: _r, fileUrl, versoFileUrl, enemScoreImport: _e, reviewNote, ...resto } = orig
      const dados: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(resto)) if (v !== null && v !== undefined) dados[k] = v
      await prisma.enrollmentDocument.create({
        data: {
          ...(dados as any),
          registrationId: reg.id,
          fileUrl: url ?? fileUrl,
          ...(versoFileUrl ? { versoFileUrl: verso ?? versoFileUrl } : {}),
          reviewNote: `Reaproveitado da inscrição ${de} (já aprovado)${reviewNote ? ` — nota original: ${reviewNote}` : ''}`.slice(0, 2000),
        },
      })
    }
    copiados.push({ codigo, nome, de })
  }
  const faltam = faltando.filter((e: any) => e.required !== false && !melhor.has(e.documentType.code)).map((e: any) => e.documentType.name as string)

  if (copiados.length && !opts.simular && reg.leadId) {
    logEvent({
      leadId: reg.leadId, type: 'document_reused' as any, category: 'lifecycle', source: 'system', actorType: 'system',
      title: `Documentos já aprovados reaproveitados na inscrição ${reg.candidateCode}`,
      description: `${copiados.map((c) => `${c.nome} (de ${c.de})`).join('; ')}${faltam.length ? `. Ainda faltam: ${faltam.join(', ')}` : '. Nenhum documento pendente.'}`,
    })
  }
  return { copiados, faltam }
}
