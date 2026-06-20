// src/services/acaAssinatura.ts
// Ambiente completo de contratos: templates por negócio, criação (escrito/upload/template),
// interpolação de variáveis, recursos Autentique (ações, delivery, prazo, lembrete, ordem,
// recusável), gatilhos automáticos por evento, e modo SIMULADO (sem rede).

import { prisma } from '../lib/prisma.js'
import { getDocHeader, dataExtenso } from './acaDocRender.js'
import { pdfContrato } from './acaPdf.js'
import * as aut from './autentique.js'

const PAPEL_LABEL: Record<string, string> = { ALUNO: 'Aluno(a)', RESPONSAVEL: 'Responsável', FIADOR: 'Fiador(a)', INSTITUICAO: 'Instituição', TESTEMUNHA: 'Testemunha' }
function reais(c: number) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

// ───────────────────────── Variáveis (interpolação) ─────────────────────────
export const VARIAVEIS_DISPONIVEIS = [
  { chave: 'aluno.nome', desc: 'Nome do aluno' }, { chave: 'aluno.cpf', desc: 'CPF do aluno' },
  { chave: 'aluno.ra', desc: 'RA do aluno' }, { chave: 'aluno.email', desc: 'E-mail do aluno' },
  { chave: 'curso', desc: 'Nome do curso/turma' }, { chave: 'valor', desc: 'Valor total do contrato' },
  { chave: 'parcelas', desc: 'Quantidade de parcelas' }, { chave: 'instituicao', desc: 'Nome da instituição' },
  { chave: 'cnpj', desc: 'CNPJ da instituição' }, { chave: 'data', desc: 'Data por extenso' },
]

async function resolverVars(p: { alunoId?: number | null; matriculaId?: number | null; contratoId?: number | null }): Promise<Record<string, string>> {
  const h = await getDocHeader()
  const v: Record<string, string> = { instituicao: h.instituicao, cnpj: h.cnpj || '', data: dataExtenso() }
  if (p.alunoId) {
    const a = await prisma.aluno.findUnique({ where: { id: p.alunoId }, select: { ra: true, cpf: true, lead: { select: { nome: true, email: true } } } })
    if (a) { v['aluno.nome'] = a.lead.nome; v['aluno.cpf'] = a.cpf || ''; v['aluno.ra'] = a.ra || ''; v['aluno.email'] = a.lead.email || '' }
  }
  if (p.contratoId) {
    const c = await prisma.acaContrato.findUnique({ where: { id: p.contratoId }, select: { valorTotalCentavos: true, matricula: { select: { turma: { select: { nome: true } } } }, _count: { select: { parcelas: true } } } })
    if (c) { v['valor'] = reais(c.valorTotalCentavos); v['curso'] = c.matricula?.turma?.nome || ''; v['parcelas'] = String(c._count.parcelas) }
  }
  if (!v['curso'] && p.matriculaId) {
    const m = await prisma.acaMatricula.findUnique({ where: { id: p.matriculaId }, select: { turma: { select: { nome: true } } } })
    if (m) v['curso'] = m.turma?.nome || ''
  }
  return v
}
export function interpolar(texto: string, vars: Record<string, string>): string {
  return (texto || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => (vars[k] != null ? vars[k] : `{{${k}}}`))
}

function corpoPadrao(): string {
  return [
    'Pelo presente instrumento particular de Contrato de Prestação de Serviços Educacionais, de um lado a {{instituicao}} (CONTRATADA) e de outro {{aluno.nome}}, CPF {{aluno.cpf}} (CONTRATANTE), têm entre si justo e acertado o seguinte:',
    '',
    'CLÁUSULA 1ª — A CONTRATADA prestará ao CONTRATANTE os serviços educacionais referentes a {{curso}}, conforme projeto pedagógico e calendário acadêmico vigentes.',
    '',
    'CLÁUSULA 2ª — Pelos serviços, o CONTRATANTE pagará o valor total de {{valor}}, em {{parcelas}} parcela(s), nas datas do plano de pagamento.',
    '',
    'CLÁUSULA 3ª — Este contrato é firmado por assinatura eletrônica, reconhecida sua validade jurídica (MP 2.200-2/2001 e Lei 14.063/2020).',
    '',
    'E por estarem assim justas e contratadas, as partes assinam eletronicamente.',
  ].join('\n')
}

// ───────────────────────── PDF ─────────────────────────
export async function gerarPdf(envelopeId: number): Promise<{ buffer: Buffer; titulo: string }> {
  const env = await prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
  if (!env) throw new Error('Envelope não encontrado')
  if (env.origem === 'UPLOAD' && env.arquivoBase64) {
    return { buffer: Buffer.from(env.arquivoBase64, 'base64'), titulo: env.titulo }
  }
  const vars = await resolverVars(env)
  const corpo = interpolar(env.corpoTexto || env.termoTexto || corpoPadrao(), vars)
  const header = await getDocHeader()
  const partes = env.signatarios.map((s) => ({ nome: s.nome, papel: PAPEL_LABEL[s.papel] || s.papel }))
  if (!partes.length) partes.push({ nome: '{{aluno.nome}}', papel: 'Aluno(a)' })
  partes.push({ nome: header.instituicao, papel: 'Instituição (Contratada)' })
  const buffer = await pdfContrato(header, env.titulo, dataExtenso(), corpo, partes)
  return { buffer, titulo: env.titulo }
}

// ───────────────────────── Criar ─────────────────────────
export interface NovoSignatario { nome: string; email?: string | null; telefone?: string | null; papel?: string; acao?: string; deliveryMethod?: string; cpf?: string | null; exigeCpf?: boolean; exigeSelfie?: boolean }
export interface CriarEnvelope {
  alunoId?: number | null; matriculaId?: number | null; contratoId?: number | null
  titulo: string; origem?: string; templateId?: number | null; tipoNegocio?: string | null
  corpoTexto?: string | null; arquivoBase64?: string | null; arquivoNome?: string | null
  deadlineEm?: string | null; reminder?: string | null; sortable?: boolean; refusable?: boolean; mensagem?: string | null
  signatarios?: NovoSignatario[]
}

async function signatariosAuto(alunoId: number): Promise<NovoSignatario[]> {
  const out: NovoSignatario[] = []
  const a = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { cpf: true, lead: { select: { nome: true, email: true } } } })
  if (a) out.push({ nome: a.lead.nome, email: a.lead.email, papel: 'ALUNO', acao: 'SIGN', cpf: a.cpf })
  const resp = await prisma.acaResponsavel.findFirst({ where: { alunoId, tipo: { in: ['CONTRATO', 'FINANCEIRO'] }, email: { not: null } }, select: { nome: true, email: true } })
  if (resp?.email) out.push({ nome: resp.nome, email: resp.email, papel: 'RESPONSAVEL', acao: 'SIGN' })
  return out
}

export async function criar(p: CriarEnvelope) {
  let signatarios = p.signatarios || []
  if (!signatarios.length && p.alunoId) signatarios = await signatariosAuto(p.alunoId)
  const env = await prisma.acaAssinatura.create({
    data: {
      alunoId: p.alunoId ?? null, matriculaId: p.matriculaId ?? null, contratoId: p.contratoId ?? null,
      titulo: p.titulo.slice(0, 191), origem: (p.origem as any) || 'ESCRITO', templateId: p.templateId ?? null,
      tipoNegocio: p.tipoNegocio || null, corpoTexto: p.corpoTexto || null,
      arquivoBase64: p.arquivoBase64 || null, arquivoNome: p.arquivoNome || null,
      deadlineEm: p.deadlineEm ? new Date(p.deadlineEm) : null, reminder: p.reminder || null,
      sortable: !!p.sortable, refusable: p.refusable !== false, mensagem: p.mensagem || null,
      status: 'RASCUNHO',
      signatarios: { create: signatarios.map((s, i) => ({
        nome: s.nome.slice(0, 191), email: s.email || null, telefone: s.telefone || null, cpf: s.cpf || null,
        papel: (s.papel as any) || 'ALUNO', acao: (s.acao as any) || 'SIGN', deliveryMethod: (s.deliveryMethod as any) || 'EMAIL',
        exigeCpf: !!s.exigeCpf, exigeSelfie: !!s.exigeSelfie, ordem: i,
      })) },
    },
    include: { signatarios: { orderBy: { ordem: 'asc' } } },
  })
  return env
}

/** Cria um envelope a partir de um template (interpola corpo + signatários padrão). */
export async function criarDeTemplate(templateId: number, ctx: { alunoId?: number | null; matriculaId?: number | null; contratoId?: number | null; titulo?: string }) {
  const t = await prisma.acaContratoTemplate.findUnique({ where: { id: templateId } })
  if (!t) throw new Error('Template não encontrado')
  const cfg = (t.config as any) || {}
  const vars = await resolverVars(ctx)
  let signatarios: NovoSignatario[] = []
  const padrao = (t.signatariosPadrao as any) || []
  if (ctx.alunoId) {
    const auto = await signatariosAuto(ctx.alunoId)
    if (padrao.length) {
      // aplica papéis/ações configurados no template sobre os signatários resolvidos
      signatarios = padrao.map((cfgS: any, i: number) => ({ ...(auto[i] || auto[0] || { nome: vars['aluno.nome'] || 'Contratante' }), papel: cfgS.papel || auto[i]?.papel || 'ALUNO', acao: cfgS.acao || 'SIGN', deliveryMethod: cfgS.deliveryMethod || 'EMAIL', exigeCpf: !!cfgS.exigeCpf, exigeSelfie: !!cfgS.exigeSelfie }))
    } else signatarios = auto
  }
  return criar({
    alunoId: ctx.alunoId, matriculaId: ctx.matriculaId, contratoId: ctx.contratoId,
    titulo: ctx.titulo || interpolar(t.nome, vars), origem: 'TEMPLATE', templateId: t.id, tipoNegocio: t.tipoNegocio,
    corpoTexto: t.corpoTexto, signatarios,
    deadlineEm: cfg.deadlineDias ? new Date(Date.now() + cfg.deadlineDias * 864e5).toISOString() : null,
    reminder: cfg.reminder || null, sortable: !!cfg.sortable, refusable: cfg.refusable !== false, mensagem: cfg.mensagem || null,
  })
}

// ───────────────────────── Enviar / status ─────────────────────────
function statusEnvelope(sigs: Array<{ status: string }>, enviado: boolean): 'RASCUNHO' | 'ENVIADO' | 'PARCIAL' | 'ASSINADO' | 'REJEITADO' {
  if (!sigs.length) return enviado ? 'ENVIADO' : 'RASCUNHO'
  if (sigs.some((s) => s.status === 'REJEITADO')) return 'REJEITADO'
  if (sigs.every((s) => s.status === 'ASSINADO')) return 'ASSINADO'
  if (sigs.some((s) => s.status === 'ASSINADO')) return 'PARCIAL'
  return enviado ? 'ENVIADO' : 'RASCUNHO'
}

export async function enviar(envelopeId: number) {
  const env = await prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
  if (!env) throw new Error('Envelope não encontrado')
  if (env.status !== 'RASCUNHO') throw new Error('Envelope já enviado')
  if (!env.signatarios.length) throw new Error('Adicione ao menos um signatário')
  for (const s of env.signatarios) {
    if (s.deliveryMethod === 'EMAIL' && !s.email) throw new Error(`Signatário ${s.nome}: e-mail obrigatório`)
    if ((s.deliveryMethod === 'SMS' || s.deliveryMethod === 'WHATSAPP') && !s.telefone) throw new Error(`Signatário ${s.nome}: telefone obrigatório p/ ${s.deliveryMethod}`)
  }
  const { buffer } = await gerarPdf(envelopeId)
  const cfg = await aut.getConfig()

  if (cfg.modo === 'AUTENTIQUE' && cfg.token) {
    const opts: aut.DocOptions = { message: env.mensagem, reminder: env.reminder, sortable: env.sortable, refusable: env.refusable, deadlineAt: env.deadlineEm?.toISOString() || null }
    const signers: aut.CriarDocSigner[] = env.signatarios.map((s) => ({ nome: s.nome, email: s.email, telefone: s.telefone, acao: s.acao, delivery: s.deliveryMethod, cpf: s.cpf, exigeCpf: s.exigeCpf, exigeSelfie: s.exigeSelfie }))
    const doc = await aut.criarDocumento(cfg.token, cfg.sandbox, env.titulo, signers, buffer, opts)
    for (const s of env.signatarios) {
      const sig = doc.signatures.find((x) => (x.email || '').toLowerCase() === (s.email || '').toLowerCase()) || doc.signatures.find((x) => (x.name || '') === s.nome)
      if (sig) await prisma.acaSignatario.update({ where: { id: s.id }, data: { publicId: sig.public_id, linkAssinatura: sig.link?.short_link || null } })
    }
    await prisma.acaAssinatura.update({ where: { id: envelopeId }, data: { provider: 'AUTENTIQUE', documentoExternoId: doc.id, status: 'ENVIADO', enviadoEm: new Date(), metaJson: doc as any } })
  } else {
    for (const s of env.signatarios) await prisma.acaSignatario.update({ where: { id: s.id }, data: { publicId: `sim-${envelopeId}-${s.id}`, linkAssinatura: `https://assinatura.simulada/local/${envelopeId}/${s.id}` } })
    await prisma.acaAssinatura.update({ where: { id: envelopeId }, data: { provider: 'SIMULADO', documentoExternoId: `sim-${envelopeId}`, status: 'ENVIADO', enviadoEm: new Date() } })
  }
  return prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
}

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
      if (doc.files?.signed) await prisma.acaAssinatura.update({ where: { id: envelopeId }, data: { arquivoAssinadoUrl: doc.files.signed } })
    }
  }
  return recompute(envelopeId)
}

export async function simularAssinatura(envelopeId: number, signatarioId: number) {
  const s = await prisma.acaSignatario.findUnique({ where: { id: signatarioId }, select: { id: true, assinaturaId: true } })
  if (!s || s.assinaturaId !== envelopeId) throw new Error('Signatário não pertence ao envelope')
  await prisma.acaSignatario.update({ where: { id: signatarioId }, data: { status: 'ASSINADO', assinadoEm: new Date() } })
  return recompute(envelopeId)
}

export async function cancelar(envelopeId: number) {
  const env = await prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, select: { provider: true, documentoExternoId: true } })
  if (env?.provider === 'AUTENTIQUE' && env.documentoExternoId) {
    const cfg = await aut.getConfig()
    if (cfg.token) await aut.removerDocumento(cfg.token, env.documentoExternoId).catch(() => {})
  }
  await prisma.acaAssinatura.update({ where: { id: envelopeId }, data: { status: 'CANCELADO' } })
  return prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
}

export async function reenviar(envelopeId: number) {
  const env = await prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: true } })
  if (!env) throw new Error('Envelope não encontrado')
  if (env.provider === 'AUTENTIQUE' && env.documentoExternoId) {
    const cfg = await aut.getConfig()
    const pend = env.signatarios.filter((s) => s.status !== 'ASSINADO' && s.publicId).map((s) => s.publicId!)
    if (cfg.token && pend.length) await aut.reenviarAssinaturas(cfg.token, pend)
  }
  return { ok: true }
}

async function recompute(envelopeId: number) {
  const env = await prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: true } })
  if (!env) throw new Error('Envelope não encontrado')
  if (env.status === 'CANCELADO') return prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
  const novo = statusEnvelope(env.signatarios, !!env.enviadoEm)
  await prisma.acaAssinatura.update({ where: { id: envelopeId }, data: { status: novo as any, finalizadoEm: novo === 'ASSINADO' ? (env.finalizadoEm ?? new Date()) : env.finalizadoEm } })
  return prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
}

export async function processarWebhook(body: any): Promise<{ ok: boolean; envelopeId?: number }> {
  const docId = body?.document?.id || body?.documentId || body?.partner?.document_id || body?.id || null
  if (!docId) return { ok: true }
  const env = await prisma.acaAssinatura.findFirst({ where: { documentoExternoId: String(docId) }, select: { id: true } })
  if (!env) return { ok: true }
  await sincronizar(env.id).catch(() => {})
  return { ok: true, envelopeId: env.id }
}

// ───────────────────────── Gatilhos (disparo automático) ─────────────────────────
/** Dispara os gatilhos ativos de um evento. Fire-and-forget nos pontos de origem. */
export async function dispararEvento(evento: string, ctx: { alunoId?: number | null; matriculaId?: number | null; contratoId?: number | null; tipoNegocio?: string | null }): Promise<number[]> {
  const gatilhos = await prisma.acaContratoGatilho.findMany({ where: { evento: evento as any, ativo: true } })
  const criados: number[] = []
  for (const g of gatilhos) {
    if (g.filtroTipoNegocio && ctx.tipoNegocio && g.filtroTipoNegocio !== ctx.tipoNegocio) continue
    try {
      const env = await criarDeTemplate(g.templateId, ctx)
      if (g.autoEnviar) await enviar(env.id).catch(() => {})
      criados.push(env.id)
    } catch { /* gatilho não deve quebrar o fluxo de origem */ }
  }
  return criados
}
