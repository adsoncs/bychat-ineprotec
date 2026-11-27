// src/services/novoAceite.ts
//
// Novo aceite do contrato/termo da inscrição.
//
// O aceite no portal congela o documento: quem aceitou leu aquele texto. Quando
// o texto muda e a escola precisa que o aluno concorde com a versão nova (ex.:
// termo que citava um contrato inexistente — Matrícula EAD, 23/11), a
// secretaria pede um novo aceite. O aluno lê o documento atualizado no Meu
// Portal e aceita de novo; o aceite anterior fica no histórico.
//
// O que NÃO muda enquanto o pedido está aberto: a etapa "Contrato" continua
// feita (funil, tarefas da secretaria e AVA não voltam atrás) e contratoAceite
// continua preenchido (Moodle/SEI seguem liberados). Nada é enviado daqui: o
// evento `enrollment.contrato_novo_aceite` é para os fluxos (Automação ›
// Fluxos), que decidem canal e texto.
//
// Só vale para o aceite no portal (provider PORTAL). Assinatura na Autentique
// ou na Clicksign se refaz pelo provedor.

import { prisma } from '../lib/prisma.js'

export interface PedidoDeNovoAceite {
  pedidoEm: string
  motivo: string
  porUserId: number | null
  porNome: string
  /** Envelope do aceite que este pedido substitui. */
  envelopeAnteriorId: number | null
}

interface ItemDoHistorico extends PedidoDeNovoAceite {
  atendidoEm?: string
  envelopeNovoId?: number
  canceladoEm?: string
  canceladoPor?: string
}

/** O pedido em aberto, lido do formData da inscrição. */
export function pedidoDeNovoAceite(formData: unknown): PedidoDeNovoAceite | null {
  const p = (formData as any)?._novoAceite
  return p && typeof p === 'object' && p.pedidoEm ? (p as PedidoDeNovoAceite) : null
}

export function historicoDeNovoAceite(formData: unknown): ItemDoHistorico[] {
  const h = (formData as any)?._novoAceiteHistorico
  return Array.isArray(h) ? h : []
}

export async function novoAceitePendente(registrationId: number): Promise<PedidoDeNovoAceite | null> {
  const r = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { formData: true } }).catch(() => null)
  return pedidoDeNovoAceite(r?.formData)
}

type Resultado = { ok: true } | { ok: false; status: number; erro: string }

export async function pedirNovoAceite(registrationId: number, p: { motivo: string; porUserId: number | null; porNome: string }): Promise<Resultado> {
  const motivo = String(p.motivo || '').trim().slice(0, 500)
  if (motivo.length < 5) return { ok: false, status: 400, erro: 'Escreva o motivo do novo aceite (o aluno não vê; fica no histórico).' }
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, leadId: true, candidateCode: true, status: true, formData: true, contratoAceite: true },
  })
  if (!reg) return { ok: false, status: 404, erro: 'Inscrição não encontrada' }
  if (reg.status === 'cancelled' || reg.status === 'transferred') return { ok: false, status: 400, erro: 'Inscrição cancelada ou transferida: não há o que aceitar de novo.' }
  if (pedidoDeNovoAceite(reg.formData)) return { ok: false, status: 409, erro: 'Já existe um pedido de novo aceite aguardando o aluno.' }

  const cp = await import('./contratoDoPortal.js')
  const env = await cp.envelopeDaInscricao(registrationId)
  if (!env || env.status !== 'ASSINADO') return { ok: false, status: 400, erro: 'O aluno ainda não aceitou o contrato desta inscrição — o aceite atual já será sobre o texto novo.' }
  if (env.provider !== 'PORTAL') return { ok: false, status: 400, erro: 'Este contrato foi assinado na plataforma de assinatura: refaça pelo provedor, não pelo novo aceite do portal.' }
  const modelo = await cp.modeloDaInscricao(registrationId)
  if (!modelo) return { ok: false, status: 400, erro: 'Não há modelo de contrato em Word para o portal/curso desta inscrição.' }
  if (await cp.assinaturaEletronicaAtiva(modelo, registrationId)) return { ok: false, status: 400, erro: 'O modelo atual é assinado na plataforma de assinatura, não por aceite no portal.' }

  const pedido: PedidoDeNovoAceite = {
    pedidoEm: new Date().toISOString(), motivo, porUserId: p.porUserId, porNome: String(p.porNome || '').slice(0, 191),
    envelopeAnteriorId: env.id,
  }
  await gravarFormData(registrationId, (f) => ({ ...f, _novoAceite: pedido }))

  const { logEvent } = await import('./leadHistory.js')
  if (reg.leadId) {
    logEvent({
      leadId: reg.leadId, type: 'contract_reaccept_requested', category: 'lifecycle', title: 'Novo aceite do contrato pedido',
      source: 'panel', actorType: 'operator', userId: p.porUserId ?? undefined, userName: p.porNome || undefined,
      description: `Inscrição ${reg.candidateCode} — ${motivo}`,
      metadata: { registrationId, envelopeAnteriorId: env.id, modeloId: modelo.id },
    })
  }
  await anunciar(registrationId, motivo).catch((e) => console.warn(`[novo-aceite] evento #${registrationId}:`, e?.message || e))
  return { ok: true }
}

export async function cancelarNovoAceite(registrationId: number, porNome: string): Promise<Resultado> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { formData: true } })
  const pedido = pedidoDeNovoAceite(reg?.formData)
  if (!pedido) return { ok: false, status: 404, erro: 'Não há pedido de novo aceite em aberto.' }
  await gravarFormData(registrationId, (f) => {
    const { _novoAceite, ...resto } = f
    return { ...resto, _novoAceiteHistorico: [...historicoDeNovoAceite(f), { ...pedido, canceladoEm: new Date().toISOString(), canceladoPor: String(porNome || '').slice(0, 191) }] }
  })
  return { ok: true }
}

/**
 * Fecha o pedido depois do aceite novo (contratoDoPortal.aceitarContratoNoPortal
 * com `novoAceite`): liga os dois envelopes, o novo vira o aceite da inscrição e
 * o anterior vai para `anteriores`, e o pedido vai para o histórico.
 */
export async function concluirNovoAceite(registrationId: number, envelopeNovoId: number, a: { nome: string; ip: string | null }): Promise<void> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { leadId: true, candidateCode: true, formData: true, contratoAceite: true } })
  const pedido = pedidoDeNovoAceite(reg?.formData)
  if (!reg || !pedido) return
  const novo = await prisma.acaAssinatura.findUnique({ where: { id: envelopeNovoId }, select: { id: true, titulo: true, finalizadoEm: true, metaJson: true } })
  if (!novo) return
  const anterior = pedido.envelopeAnteriorId
    ? await prisma.acaAssinatura.findUnique({ where: { id: pedido.envelopeAnteriorId }, select: { id: true, metaJson: true, alunoId: true, matriculaId: true, contratoId: true } })
    : null
  if (anterior) {
    await prisma.acaAssinatura.update({ where: { id: anterior.id }, data: { metaJson: { ...((anterior.metaJson as any) ?? {}), substituidoPor: novo.id, substituidoEm: new Date().toISOString() } as any } })
  }
  await prisma.acaAssinatura.update({
    where: { id: novo.id },
    data: {
      metaJson: { ...((novo.metaJson as any) ?? {}), substitui: anterior?.id ?? null, novoAceite: { pedidoEm: pedido.pedidoEm, motivo: pedido.motivo } } as any,
      // A matrícula do ERP que adotou o envelope anterior passa a apontar para o novo.
      ...(anterior?.alunoId ? { alunoId: anterior.alunoId } : {}),
      ...(anterior?.matriculaId ? { matriculaId: anterior.matriculaId } : {}),
      ...(anterior?.contratoId ? { contratoId: anterior.contratoId } : {}),
    },
  })
  const atual = (reg.contratoAceite ?? null) as any
  const { dadosDoContratoDaInscricao } = await import('./contratoDoPortal.js')
  const dados = await dadosDoContratoDaInscricao(registrationId).catch(() => null)
  const aceite = {
    termo: `${novo.titulo} — aceito eletronicamente no portal (novo aceite).`,
    nome: a.nome.slice(0, 191), ip: String(a.ip || '').slice(0, 60), userAgent: '',
    em: (novo.finalizadoEm ?? new Date()).toISOString(), via: 'PORTAL', envelopeId: novo.id,
    plano: dados?.plano ?? null,
    anteriores: atual?.em ? [{ ...atual, anteriores: undefined }, ...(Array.isArray(atual.anteriores) ? atual.anteriores : [])] : [],
  }
  await prisma.$executeRaw`UPDATE bychat_enrollment_registrations SET contratoAceite = ${JSON.stringify(aceite)} WHERE id = ${registrationId}`
  await gravarFormData(registrationId, (f) => {
    const { _novoAceite, ...resto } = f
    return { ...resto, _novoAceiteHistorico: [...historicoDeNovoAceite(f), { ...pedido, atendidoEm: new Date().toISOString(), envelopeNovoId: novo.id }] }
  })
  if (reg.leadId) {
    const { logEvent } = await import('./leadHistory.js')
    logEvent({
      leadId: reg.leadId, type: 'contract_reaccepted', category: 'lifecycle', title: 'Contrato aceito de novo',
      source: 'system', actorType: 'system',
      description: `${novo.titulo} — inscrição ${reg.candidateCode} (novo aceite).`,
      metadata: { registrationId, envelopeId: novo.id, envelopeAnteriorId: anterior?.id ?? null },
    })
  }
}

/** Para a tela da secretaria: pedido aberto e o histórico. */
export async function situacaoDoNovoAceite(registrationId: number) {
  const r = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { formData: true } })
  return { pendente: pedidoDeNovoAceite(r?.formData), historico: historicoDeNovoAceite(r?.formData) }
}

// ─── internos ───────────────────────────────────────────────────────────────

async function gravarFormData(registrationId: number, muda: (f: Record<string, any>) => Record<string, any>) {
  const r = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { formData: true } })
  const f = ((r?.formData as Record<string, any>) ?? {})
  await prisma.enrollmentRegistration.update({ where: { id: registrationId }, data: { formData: muda(f) as any } })
}

/**
 * `enrollment.contrato_novo_aceite` para os fluxos. Variáveis: as da inscrição
 * ({{candidateCode}}, {{portalLoginUrl}}, {{courseName}}…) e {{novoAceiteMotivo}},
 * {{novoAceiteUrl}} (login do Meu Portal que abre na aba Contratos).
 */
async function anunciar(registrationId: number, motivo: string) {
  const { buildEnrollmentPayload } = await import('./enrollmentNotify.js')
  const ctx = await buildEnrollmentPayload(registrationId)
  if (!ctx) return
  const { eventBus } = await import('../lib/eventBus.js')
  const login = String((ctx.payload as any).portalLoginUrl || '')
  eventBus.emitDomain({
    type: 'enrollment.contrato_novo_aceite',
    leadId: ctx.lead.id,
    payload: { ...ctx.payload, registrationId, novoAceiteMotivo: motivo, novoAceiteUrl: login ? `${login}#etapa-contrato` : '' },
    timestamp: new Date(),
  } as any)
}
