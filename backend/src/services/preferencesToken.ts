// src/services/preferencesToken.ts
// Sales Engagement A6: helper para gerar/recuperar Lead.optOutToken.
// O token alimenta a página pública /preferencias/:token (compliance LGPD).
// Gerado on-demand: lead pode existir há meses sem token; só vai ganhar
// quando algum envio outbound precisar do link de opt-out.

import { randomBytes } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { appUrlObrigatoria } from '../lib/appUrl.js'

/** 32 bytes hex = 64 chars (cabe em VARCHAR(64) UNIQUE). */
function newToken(): string {
  return randomBytes(32).toString('hex')
}

/** Retorna o optOutToken do lead — gera e persiste se ainda não existe.
 * Em caso raro de colisão (UNIQUE), tenta novamente até 3x. */
export async function getOrCreateOptOutToken(leadId: number): Promise<string> {
  const existing = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { optOutToken: true },
  })
  if (!existing) throw new Error(`Lead ${leadId} não encontrado`)
  if (existing.optOutToken) return existing.optOutToken

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = newToken()
    try {
      await prisma.lead.update({
        where: { id: leadId },
        data: { optOutToken: token },
      })
      return token
    } catch (err: any) {
      // P2002 = unique constraint violation no Prisma. Tenta de novo.
      if (err?.code !== 'P2002') throw err
    }
  }
  throw new Error('Não foi possível gerar optOutToken único após 3 tentativas')
}

/** Monta a URL pública da central de preferências para um lead.
 * Garante token válido (gera on-demand). */
export async function getPreferencesUrl(leadId: number): Promise<string> {
  const token = await getOrCreateOptOutToken(leadId)
  // Link de preferências/opt-out (LGPD): sem endereço não há o que entregar ao
  // titular, e um domínio chutado seria pior que o erro.
  const base = appUrlObrigatoria()
  return `${base}/preferencias/${token}`
}

/** Anexa rodapé "Não quer mais receber? <link>" ao corpo da mensagem.
 * `format`:
 *   - 'text' → linha em branco + texto curto + URL
 *   - 'html' → <hr> + parágrafo com <a>
 * Idempotente por marcador HTML simples (`data-pref-link`); pra texto basta não
 * chamar duas vezes. */
export async function appendPreferencesLink(
  body: string,
  leadId: number,
  format: 'text' | 'html' = 'text',
): Promise<string> {
  const url = await getPreferencesUrl(leadId)
  if (format === 'html') {
    if (body.includes('data-pref-link')) return body
    const footer =
      `<hr style="margin:24px 0;border:0;border-top:1px solid #e5e7eb"/>` +
      `<p data-pref-link style="font-size:12px;color:#6b7280;text-align:center">` +
      `Não quer mais receber estes e-mails? ` +
      `<a href="${url}" style="color:#6b7280;text-decoration:underline">Atualize suas preferências</a>.` +
      `</p>`
    return `${body}\n${footer}`
  }
  return `${body}\n\n---\nNão quer mais receber? Atualize suas preferências em ${url}`
}
