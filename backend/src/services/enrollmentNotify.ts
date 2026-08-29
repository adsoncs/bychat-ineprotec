// src/services/enrollmentNotify.ts
// Notificações do ciclo de inscrição/documentos.
//
// Esta camada NÃO mais envia email/WhatsApp diretamente. Cada função emite um
// domain event no eventBus que é consumido pelo workflowEngine. Os workflows
// "padrão" são criados via seed (notificationSeed.ts) e podem ser editados pelo
// admin (canal, template, condições) sem mexer no código.
//
// Os payloads abaixo contêm TODAS as variáveis úteis para serem usadas em
// {{variáveis}} dentro dos templates: candidateCode, portalNome, courseName,
// paymentUrl, paymentAmount, paymentDeadline, docName, reviewNote, etc.

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { appUrlObrigatoria } from '../lib/appUrl.js'

function getAppUrl() { return appUrlObrigatoria() }

export interface EnrollmentConfirmationInput {
  enrollmentId: number
}

// ── Carrega payload comum a partir do enrollment ──
async function buildEnrollmentPayload(enrollmentId: number) {
  const e = await prisma.enrollmentRegistration.findUnique({
    where: { id: enrollmentId },
    include: {
      lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
      portal: { select: { id: true, nome: true, slug: true, ctaMessage: true, unit: { select: { nome: true } } } },
      processRegistration: { include: { offering: { select: { nome: true, course: { select: { nome: true } } } } } },
    },
  })
  if (!e || !e.lead) return null
  const courseName = e.processRegistration?.offering?.course?.nome || e.processRegistration?.offering?.nome || ''
  const amount = e.paymentAmount ? `R$ ${Number(e.paymentAmount).toFixed(2).replace('.', ',')}` : ''
  const deadline = e.paymentExpiresAt ? new Date(e.paymentExpiresAt).toLocaleString('pt-BR') : ''
  const candidateUrl = `${getAppUrl()}/candidato/${e.candidateCode}`
  return {
    enrollment: e,
    lead: e.lead,
    portal: e.portal,
    payload: {
      enrollmentId: e.id,
      candidateCode: e.candidateCode,
      portalNome: e.portal?.nome || '',
      portalUnit: e.portal?.unit?.nome || '',
      courseName,
      paymentUrl: e.paymentUrl || '',
      paymentAmount: amount,
      paymentDeadline: deadline,
      candidateUrl,
      ctaMessage: e.portal?.ctaMessage || '',
    },
  }
}

export async function sendEnrollmentConfirmation(input: EnrollmentConfirmationInput): Promise<void> {
  const ctx = await buildEnrollmentPayload(input.enrollmentId)
  if (!ctx) return
  eventBus.emitDomain({
    type: 'enrollment.submitted',
    leadId: ctx.lead.id,
    payload: ctx.payload,
    timestamp: new Date(),
  })
}

export async function sendPaymentConfirmation(input: EnrollmentConfirmationInput): Promise<void> {
  const ctx = await buildEnrollmentPayload(input.enrollmentId)
  if (!ctx) return
  eventBus.emitDomain({
    type: 'enrollment.payment_confirmed',
    leadId: ctx.lead.id,
    payload: ctx.payload,
    timestamp: new Date(),
  })
}

export async function sendPaymentReminder(input: EnrollmentConfirmationInput): Promise<void> {
  const ctx = await buildEnrollmentPayload(input.enrollmentId)
  if (!ctx) return
  if (ctx.enrollment.paymentStatus === 'paid') return
  eventBus.emitDomain({
    type: 'enrollment.payment_pending_reminder',
    leadId: ctx.lead.id,
    payload: ctx.payload,
    timestamp: new Date(),
  })
}

// Notifica o candidato quando um documento é aprovado.
export async function sendDocumentApprovalNotice(documentId: number): Promise<void> {
  const doc = await prisma.enrollmentDocument.findUnique({
    where: { id: documentId },
    include: {
      registration: { include: { lead: { select: { id: true } } } },
      type: { select: { name: true, code: true } },
    },
  })
  if (!doc || doc.status !== 'approved' || !doc.registration?.lead) return
  const ctx = await buildEnrollmentPayload(doc.registration.id)
  if (!ctx) return
  eventBus.emitDomain({
    type: 'enrollment.document_approved',
    leadId: ctx.lead.id,
    payload: {
      ...ctx.payload,
      documentId: doc.id,
      docName: doc.type?.name || doc.label || doc.typeCode || 'Documento',
    },
    timestamp: new Date(),
  })
}

// Notifica o candidato quando um documento é rejeitado.
export async function sendDocumentRejectionNotice(documentId: number): Promise<void> {
  const doc = await prisma.enrollmentDocument.findUnique({
    where: { id: documentId },
    include: {
      registration: { include: { lead: { select: { id: true } } } },
      type: { select: { name: true, code: true } },
    },
  })
  if (!doc || doc.status !== 'rejected' || !doc.registration?.lead) return
  const ctx = await buildEnrollmentPayload(doc.registration.id)
  if (!ctx) return
  eventBus.emitDomain({
    type: 'enrollment.document_rejected',
    leadId: ctx.lead.id,
    payload: {
      ...ctx.payload,
      documentId: doc.id,
      docName: doc.type?.name || doc.label || doc.typeCode || 'Documento',
      reviewNote: doc.reviewNote || 'O documento precisa ser corrigido e reenviado.',
    },
    timestamp: new Date(),
  })
}
