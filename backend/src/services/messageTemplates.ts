// src/services/messageTemplates.ts
// Renderização de mensagens a partir de MessageTemplate (editáveis no painel
// "Modelos"), com fallback para um default em código. Usado pelas notificações de
// agendamento para que nenhum texto fique hardcoded — o admin edita o template e
// o texto muda, sem deploy. Busca por `name` + `channel`.

import { prisma } from '../lib/prisma.js'
import { interpolate, decodeHtmlIfEscaped } from '../lib/interpolate.js'

export interface RenderedTemplate { subject: string; body: string }

// Busca o template pela CHAVE estável (`key`), não pelo nome — assim o usuário pode
// renomear o template livremente que o código continua encontrando.
export async function getRenderedTemplate(
  key: string,
  channel: 'whatsapp' | 'email' | 'sms',
  vars: Record<string, any>,
  fallback: { subject?: string; body: string },
): Promise<RenderedTemplate> {
  let subjectTpl = fallback.subject ?? ''
  let bodyTpl = fallback.body
  try {
    const tpl = await prisma.messageTemplate.findFirst({ where: { key, active: true } })
    if (tpl) {
      if (channel === 'email') {
        subjectTpl = tpl.subject || subjectTpl
        // Conserta bodyHtml salvo escapado por engano (ex.: editor antigo).
        bodyTpl = decodeHtmlIfEscaped(tpl.bodyHtml) || tpl.body || bodyTpl
      } else {
        bodyTpl = tpl.body || bodyTpl
      }
      prisma.messageTemplate.update({ where: { id: tpl.id }, data: { usageCount: { increment: 1 } } }).catch(() => {})
    }
  } catch { /* fallback */ }
  return { subject: interpolate(subjectTpl, vars), body: interpolate(bodyTpl, vars) }
}
