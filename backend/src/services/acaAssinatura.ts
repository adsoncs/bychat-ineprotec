// src/services/acaAssinatura.ts
// Orquestra a assinatura eletrônica de contratos do aluno (envelope + signatários),
// usando a Autentique quando configurada, ou o modo SIMULADO (sem rede) para testes.

import { prisma } from '../lib/prisma.js'
import { getDocHeader, dataExtenso } from './acaDocRender.js'
import { pdfContrato } from './acaPdf.js'
import * as aut from './autentique.js'

const PAPEL_LABEL: Record<string, string> = { ALUNO: 'Aluno(a)', RESPONSAVEL: 'Responsável', FIADOR: 'Fiador(a)', INSTITUICAO: 'Instituição', TESTEMUNHA: 'Testemunha' }

function reais(c: number) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

/** Corpo padrão do contrato a partir dos dados do aluno/contrato (se termo não for fornecido). */
async function corpoPadrao(env: any): Promise<string> {
  let alunoNome = 'o(a) CONTRATANTE', curso = '', valor = ''
  if (env.alunoId) {
    const a = await prisma.aluno.findUnique({ where: { id: env.alunoId }, select: { lead: { select: { nome: true } }, cpf: true } })
    if (a) alunoNome = a.lead.nome + (a.cpf ? ` (CPF ${a.cpf})` : '')
  }
  if (env.contratoId) {
    const c = await prisma.acaContrato.findUnique({ where: { id: env.contratoId }, select: { valorTotalCentavos: true, matricula: { select: { turma: { select: { nome: true } } } } } })
    if (c) { valor = reais(c.valorTotalCentavos); curso = c.matricula?.turma?.nome || '' }
  }
  return [
    `Pelo presente instrumento particular de Contrato de Prestação de Serviços Educacionais, de um lado a INSTITUIÇÃO DE ENSINO (CONTRATADA) e de outro ${alunoNome} (CONTRATANTE), têm entre si justo e acertado o seguinte:`,
    ``,
    `CLÁUSULA 1ª — A CONTRATADA prestará ao CONTRATANTE os serviços educacionais ${curso ? `referentes a ${curso}` : 'do curso contratado'}, nos termos do projeto pedagógico e do calendário acadêmico vigentes.`,
    ``,
    `CLÁUSULA 2ª — Pelos serviços, o CONTRATANTE pagará ${valor ? `o valor total de ${valor}` : 'o valor pactuado'}, na forma e nas datas do plano de pagamento acordado.`,
    ``,
    `CLÁUSULA 3ª — O presente contrato é firmado por assinatura eletrônica, reconhecendo as partes sua validade jurídica nos termos da legislação vigente (MP 2.200-2/2001 e Lei 14.063/2020).`,
    ``,
    `E, por estarem assim justas e contratadas, as partes assinam o presente instrumento eletronicamente.`,
  ].join('\n')
}

export async function gerarPdf(envelopeId: number): Promise<{ buffer: Buffer; titulo: string }> {
  const env = await prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
  if (!env) throw new Error('Envelope não encontrado')
  const header = await getDocHeader()
  const corpo = env.termoTexto && env.termoTexto.trim() ? env.termoTexto : await corpoPadrao(env)
  const partes: Array<{ nome: string; papel: string; documento?: string | null }> = []
  for (const s of env.signatarios) partes.push({ nome: s.nome, papel: PAPEL_LABEL[s.papel] || s.papel })
  if (!partes.length) partes.push({ nome: 'Contratante', papel: 'Aluno(a)' })
  partes.push({ nome: header.instituicao, papel: 'Instituição (Contratada)' })
  const buffer = await pdfContrato(header, env.titulo, dataExtenso(), corpo, partes)
  return { buffer, titulo: env.titulo }
}

export interface NovoSignatario { nome: string; email?: string | null; papel?: string }
export async function criar(p: { alunoId?: number | null; matriculaId?: number | null; contratoId?: number | null; titulo: string; termoTexto?: string | null; signatarios?: NovoSignatario[] }) {
  let signatarios = p.signatarios || []
  // auto: se não informado e há aluno, inclui o aluno como ALUNO
  if (!signatarios.length && p.alunoId) {
    const a = await prisma.aluno.findUnique({ where: { id: p.alunoId }, select: { lead: { select: { nome: true, email: true } } } })
    if (a) signatarios.push({ nome: a.lead.nome, email: a.lead.email, papel: 'ALUNO' })
    const resp = await prisma.acaResponsavel.findFirst({ where: { alunoId: p.alunoId, tipo: { in: ['CONTRATO', 'FINANCEIRO'] }, email: { not: null } }, select: { nome: true, email: true } })
    if (resp?.email) signatarios.push({ nome: resp.nome, email: resp.email, papel: 'RESPONSAVEL' })
  }
  const env = await prisma.acaAssinatura.create({
    data: {
      alunoId: p.alunoId ?? null, matriculaId: p.matriculaId ?? null, contratoId: p.contratoId ?? null,
      titulo: p.titulo.slice(0, 191), termoTexto: p.termoTexto || null, status: 'RASCUNHO',
      signatarios: { create: signatarios.map((s, i) => ({ nome: s.nome.slice(0, 191), email: s.email || null, papel: (s.papel as any) || 'ALUNO', ordem: i })) },
    },
    include: { signatarios: true },
  })
  return env
}

function statusEnvelope(sigs: Array<{ status: string }>, enviado: boolean): 'RASCUNHO' | 'ENVIADO' | 'PARCIAL' | 'ASSINADO' | 'REJEITADO' {
  if (!sigs.length) return enviado ? 'ENVIADO' : 'RASCUNHO'
  if (sigs.some((s) => s.status === 'REJEITADO')) return 'REJEITADO'
  if (sigs.every((s) => s.status === 'ASSINADO')) return 'ASSINADO'
  if (sigs.some((s) => s.status === 'ASSINADO')) return 'PARCIAL'
  return enviado ? 'ENVIADO' : 'RASCUNHO'
}

/** Envia o envelope para assinatura (Autentique ou SIMULADO). */
export async function enviar(envelopeId: number) {
  const env = await prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
  if (!env) throw new Error('Envelope não encontrado')
  if (env.status !== 'RASCUNHO') throw new Error('Envelope já enviado')
  if (!env.signatarios.length) throw new Error('Adicione ao menos um signatário')
  if (env.signatarios.some((s) => !s.email)) throw new Error('Todos os signatários precisam de e-mail')
  const { buffer } = await gerarPdf(envelopeId)
  const cfg = await aut.getConfig()

  if (cfg.modo === 'AUTENTIQUE' && cfg.token) {
    const doc = await aut.criarDocumento(cfg.token, cfg.sandbox, env.titulo, env.signatarios.map((s) => ({ nome: s.nome, email: s.email! })), buffer)
    // casa signatures (por email) com os nossos signatários
    for (const s of env.signatarios) {
      const sig = doc.signatures.find((x) => (x.email || '').toLowerCase() === (s.email || '').toLowerCase())
      if (sig) await prisma.acaSignatario.update({ where: { id: s.id }, data: { publicId: sig.public_id, linkAssinatura: sig.link?.short_link || null } })
    }
    await prisma.acaAssinatura.update({ where: { id: envelopeId }, data: { provider: 'AUTENTIQUE', documentoExternoId: doc.id, status: 'ENVIADO', enviadoEm: new Date(), metaJson: doc as any } })
  } else {
    // SIMULADO: gera links fictícios para validar o fluxo sem credencial
    for (const s of env.signatarios) {
      await prisma.acaSignatario.update({ where: { id: s.id }, data: { publicId: `sim-${envelopeId}-${s.id}`, linkAssinatura: `https://assinatura.simulada/local/${envelopeId}/${s.id}` } })
    }
    await prisma.acaAssinatura.update({ where: { id: envelopeId }, data: { provider: 'SIMULADO', documentoExternoId: `sim-${envelopeId}`, status: 'ENVIADO', enviadoEm: new Date() } })
  }
  return prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
}

/** Reconcilia o status consultando o provedor (Autentique). SIMULADO é no-op. */
export async function sincronizar(envelopeId: number) {
  const env = await prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: true } })
  if (!env) throw new Error('Envelope não encontrado')
  if (env.provider === 'AUTENTIQUE' && env.documentoExternoId) {
    const cfg = await aut.getConfig()
    if (cfg.token) {
      const doc = await aut.consultarDocumento(cfg.token, env.documentoExternoId)
      for (const s of env.signatarios) {
        const sig = doc.signatures.find((x) => x.public_id === s.publicId) || doc.signatures.find((x) => (x.email || '').toLowerCase() === (s.email || '').toLowerCase())
        if (!sig) continue
        const status = sig.rejected ? 'REJEITADO' : sig.signed ? 'ASSINADO' : sig.viewed ? 'VISUALIZADO' : 'PENDENTE'
        await prisma.acaSignatario.update({ where: { id: s.id }, data: {
          status: status as any,
          assinadoEm: sig.signed ? new Date(sig.signed.created_at) : null,
          viewedEm: sig.viewed ? new Date(sig.viewed.created_at) : null,
          rejeitadoEm: sig.rejected ? new Date(sig.rejected.created_at) : null,
        } })
      }
    }
  }
  return recompute(envelopeId)
}

/** SIMULADO/manual: marca um signatário como assinado (para testes e fluxo offline). */
export async function simularAssinatura(envelopeId: number, signatarioId: number) {
  const s = await prisma.acaSignatario.findUnique({ where: { id: signatarioId }, select: { id: true, assinaturaId: true } })
  if (!s || s.assinaturaId !== envelopeId) throw new Error('Signatário não pertence ao envelope')
  await prisma.acaSignatario.update({ where: { id: signatarioId }, data: { status: 'ASSINADO', assinadoEm: new Date() } })
  return recompute(envelopeId)
}

export async function cancelar(envelopeId: number) {
  await prisma.acaAssinatura.update({ where: { id: envelopeId }, data: { status: 'CANCELADO' } })
  return prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
}

async function recompute(envelopeId: number) {
  const env = await prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: true } })
  if (!env) throw new Error('Envelope não encontrado')
  if (env.status === 'CANCELADO') return prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
  const novo = statusEnvelope(env.signatarios, !!env.enviadoEm)
  await prisma.acaAssinatura.update({ where: { id: envelopeId }, data: { status: novo as any, finalizadoEm: novo === 'ASSINADO' ? (env.finalizadoEm ?? new Date()) : env.finalizadoEm } })
  return prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
}

/** Webhook da Autentique: tenta achar o documento e reconcilia. */
export async function processarWebhook(body: any): Promise<{ ok: boolean; envelopeId?: number }> {
  // o payload varia; procura um id de documento em chaves comuns
  const docId = body?.document?.id || body?.documentId || body?.partner?.document_id || body?.id || null
  if (!docId) return { ok: true }
  const env = await prisma.acaAssinatura.findFirst({ where: { documentoExternoId: String(docId) }, select: { id: true } })
  if (!env) return { ok: true }
  await sincronizar(env.id).catch(() => {})
  return { ok: true, envelopeId: env.id }
}
