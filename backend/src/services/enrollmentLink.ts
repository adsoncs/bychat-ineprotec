// src/services/enrollmentLink.ts
// Gera link assinado pré-preenchido do portal de matrícula para um lead.
// Usado pelo chatbot ao completar a coleta de dados.

import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { CANDIDATE_SECRET } from '../lib/secrets.js'

export async function generateEnrollmentLinkForLead(leadId: number, portalId: number): Promise<string | null> {
  const [lead, portal] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, nome: true, email: true, whatsapp: true, cidade: true, formData: true },
    }),
    prisma.enrollmentPortal.findUnique({ where: { id: portalId }, select: { slug: true, customDomain: true, active: true } }),
  ])
  if (!lead || !portal || !portal.active) return null

  const fd = (lead.formData as any) || {}
  const prefill = {
    nome: lead.nome || '',
    email: lead.email || '',
    whatsapp: lead.whatsapp || '',
    cidade: lead.cidade || '',
    cpf: fd.cpf || '',
    leadId: lead.id,
    exp: Date.now() + 14 * 24 * 3600 * 1000,
  }

  const secret = CANDIDATE_SECRET
  const body64 = Buffer.from(JSON.stringify(prefill)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body64).digest('base64url')
  const token = `${body64}.${sig}`

  const base = portal.customDomain ? `https://${portal.customDomain}` : `${process.env.APP_URL || 'https://bychat.ia.br'}/portal/${portal.slug}`
  return `${base}?t=${encodeURIComponent(token)}`
}
