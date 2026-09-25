// src/services/acaFunilMatriculas.ts
//
// Funil real da matrícula, do jeito que a secretaria enxerga: inscrito →
// documentos → contrato → pago → matriculado.
//
// O que existia era analytics de formulário (quantos chegaram ao passo 3 do
// wizard), útil para marketing e inútil para quem precisa saber *quem* está
// parado e *no quê*. Aqui cada inscrição tem uma etapa e um motivo.

import { prisma } from '../lib/prisma.js'

export type EtapaFunil = 'inscrito' | 'documentos' | 'contrato' | 'pagamento' | 'matriculado' | 'cancelado'

export const ETAPAS: Array<{ chave: EtapaFunil; rotulo: string }> = [
  { chave: 'inscrito', rotulo: 'Inscrito' },
  { chave: 'documentos', rotulo: 'Documentos' },
  { chave: 'contrato', rotulo: 'Contrato' },
  { chave: 'pagamento', rotulo: 'Pagamento' },
  { chave: 'matriculado', rotulo: 'Matriculado' },
  { chave: 'cancelado', rotulo: 'Cancelado' },
]

export interface ItemFunil {
  registrationId: number
  codigo: string
  candidato: string
  whatsapp: string | null
  portal: string | null
  oferta: string | null
  criadaEm: Date
  etapa: EtapaFunil
  /** O que trava — em uma frase que a secretaria possa agir em cima. */
  motivo: string
  diasParado: number
  alunoId: number | null
  matriculaId: number | null
}

const dias = (d: Date) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000)

export async function funilDeMatriculas(filtros: {
  etapa?: EtapaFunil
  portalId?: number
  busca?: string
  limite?: number
} = {}): Promise<{ etapas: Array<{ chave: EtapaFunil; rotulo: string; total: number }>; itens: ItemFunil[] }> {
  const registros = await prisma.enrollmentRegistration.findMany({
    where: {
      ...(filtros.portalId ? { portalId: filtros.portalId } : {}),
      ...(filtros.busca
        ? {
            OR: [
              { candidateCode: { contains: filtros.busca } },
              { lead: { nome: { contains: filtros.busca } } },
            ],
          }
        : {}),
    },
    orderBy: { id: 'desc' },
    take: Math.min(filtros.limite ?? 300, 1000),
    select: {
      id: true, candidateCode: true, status: true, createdAt: true, updatedAt: true,
      paymentStatus: true, paymentPaidAt: true,
      portal: { select: { id: true, nome: true, requirePayment: true } },
      lead: { select: { id: true, nome: true, whatsapp: true } },
      documents: { select: { status: true } },
      processRegistration: {
        select: {
          offering: { select: { nome: true } },
          selectionProcess: {
            select: {
              useCustomDocuments: true,
              documentRequirements: { select: { required: true } },
              entryMode: { select: { documentRequirements: { select: { required: true } } } },
            },
          },
        },
      },
    },
  })

  const leadIds = registros.map((r) => r.lead?.id).filter((x): x is number => !!x)
  const alunos = leadIds.length
    ? await prisma.aluno.findMany({ where: { leadId: { in: leadIds } }, select: { id: true, leadId: true } })
    : []
  const alunoPorLead = new Map(alunos.map((a) => [a.leadId, a]))

  const alunoIds = alunos.map((a) => a.id)
  const matriculas = alunoIds.length
    ? await prisma.acaMatricula.findMany({
        where: { alunoId: { in: alunoIds } },
        orderBy: { id: 'desc' },
        select: { id: true, alunoId: true, status: true, listaEspera: true },
      })
    : []
  const matriculaPorAluno = new Map<number, (typeof matriculas)[number]>()
  for (const m of matriculas) if (!matriculaPorAluno.has(m.alunoId)) matriculaPorAluno.set(m.alunoId, m)

  const matriculaIds = matriculas.map((m) => m.id)
  const envelopes = matriculaIds.length
    ? await prisma.acaAssinatura.findMany({
        where: { matriculaId: { in: matriculaIds } },
        orderBy: { id: 'desc' },
        select: { id: true, matriculaId: true, status: true, enviadoEm: true },
      })
    : []
  const envelopePorMatricula = new Map<number, (typeof envelopes)[number]>()
  for (const e of envelopes) if (e.matriculaId && !envelopePorMatricula.has(e.matriculaId)) envelopePorMatricula.set(e.matriculaId, e)

  const itens: ItemFunil[] = registros.map((r) => {
    const aluno = r.lead ? alunoPorLead.get(r.lead.id) : undefined
    const matricula = aluno ? matriculaPorAluno.get(aluno.id) : undefined
    const envelope = matricula ? envelopePorMatricula.get(matricula.id) : undefined

    const sp = r.processRegistration?.selectionProcess as any
    const exigidos: Array<{ required: boolean }> = sp
      ? (sp.useCustomDocuments && sp.documentRequirements?.length ? sp.documentRequirements : (sp.entryMode?.documentRequirements ?? []))
      : []
    const obrigatorios = exigidos.filter((e) => e.required).length
    const aprovados = r.documents.filter((d) => d.status === 'approved').length
    const recusados = r.documents.filter((d) => d.status === 'rejected').length
    const emAnalise = r.documents.filter((d) => d.status === 'pending').length

    let etapa: EtapaFunil = 'inscrito'
    let motivo = 'Inscrição recebida, nada pendente ainda.'

    if (['cancelled', 'expired', 'rejected'].includes(r.status)) {
      etapa = 'cancelado'
      motivo = `Inscrição ${r.status}.`
    } else if (matricula?.status === 'MATRICULADO') {
      etapa = 'matriculado'
      motivo = 'Matrícula efetivada.'
    } else if (r.portal?.requirePayment && r.paymentStatus !== 'paid' && !r.paymentPaidAt) {
      etapa = 'pagamento'
      motivo = 'Taxa de inscrição ainda não paga.'
    } else if (envelope && envelope.status !== 'ASSINADO') {
      etapa = 'contrato'
      motivo = envelope.enviadoEm
        ? `Contrato enviado há ${dias(envelope.enviadoEm)} dia(s) e não assinado.`
        : 'Contrato criado mas ainda não enviado para assinatura.'
    } else if (obrigatorios > 0 && (aprovados < obrigatorios || recusados > 0)) {
      etapa = 'documentos'
      motivo = recusados > 0
        ? `${recusados} documento(s) recusado(s), aguardando reenvio.`
        : emAnalise > 0
          ? `${emAnalise} documento(s) aguardando conferência da secretaria.`
          : `Faltam ${obrigatorios - aprovados} de ${obrigatorios} documentos.`
    } else if (matricula) {
      etapa = 'contrato'
      motivo = matricula.listaEspera
        ? 'Em lista de espera — sem vaga na turma.'
        : 'Documentos aprovados; falta gerar/assinar o contrato.'
    } else if (obrigatorios === 0) {
      etapa = 'inscrito'
      motivo = 'Sem documentos exigidos — pronto para efetivar a matrícula.'
    }

    return {
      registrationId: r.id,
      codigo: r.candidateCode,
      candidato: r.lead?.nome ?? '—',
      whatsapp: r.lead?.whatsapp ?? null,
      portal: r.portal?.nome ?? null,
      oferta: r.processRegistration?.offering?.nome ?? null,
      criadaEm: r.createdAt,
      etapa,
      motivo,
      diasParado: dias(r.updatedAt),
      alunoId: aluno?.id ?? null,
      matriculaId: matricula?.id ?? null,
    }
  })

  const totais = new Map<EtapaFunil, number>()
  for (const i of itens) totais.set(i.etapa, (totais.get(i.etapa) ?? 0) + 1)

  return {
    etapas: ETAPAS.map((e) => ({ ...e, total: totais.get(e.chave) ?? 0 })),
    itens: filtros.etapa ? itens.filter((i) => i.etapa === filtros.etapa) : itens,
  }
}
