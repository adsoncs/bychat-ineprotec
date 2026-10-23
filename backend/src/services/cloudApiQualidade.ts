// src/services/cloudApiQualidade.ts
//
// Qualidade do número (GREEN/YELLOW/RED) gravada na conexão.
//
// A coluna só era preenchida ao conectar o número; depois disso a tela do canal
// mostrava o valor daquele dia para sempre, enquanto a barra de status lia a
// Meta ao vivo. Caso real (ineprotec, 23/10): o 0505 caiu para YELLOW (clientes
// bloqueando) e a barra avisava "qualidade média" com o canal ainda em "Alta".
// Agora toda leitura da Meta que traz a qualidade grava aqui, e o webhook
// `phone_number_quality_update` força uma releitura na hora.

import { prisma } from '../lib/prisma.js'
import { cloudApiFetch, decryptToken } from './cloudApi.js'

/** Grava a qualidade que a Meta acabou de devolver, se mudou. */
export async function gravarQualidadeDoNumero(connectionId: number, quality: string | null | undefined): Promise<void> {
  const q = String(quality || '').toUpperCase()
  if (!q) return
  await prisma.cloudApiConnection.updateMany({
    where: { id: connectionId, OR: [{ qualityRating: null }, { qualityRating: { not: q } }] },
    data: { qualityRating: q },
  }).catch(() => {})
}

/** Relê a qualidade na Meta e grava. Devolve o valor lido (ou null se falhou). */
export async function atualizarQualidadeDoNumero(connectionId: number): Promise<string | null> {
  const c = await prisma.cloudApiConnection.findUnique({
    where: { id: connectionId },
    select: { phoneNumberId: true, systemUserToken: true },
  })
  if (!c) return null
  try {
    const r = await cloudApiFetch(`/${c.phoneNumberId}?fields=quality_rating`, decryptToken(c.systemUserToken))
    await gravarQualidadeDoNumero(connectionId, r?.quality_rating)
    return r?.quality_rating ?? null
  } catch {
    return null
  }
}

/** Webhook `phone_number_quality_update`: acha a conexão da WABA/número e relê. */
export async function handlePhoneQualityWebhook(wabaId: string, value: any): Promise<void> {
  const conexoes = await prisma.cloudApiConnection.findMany({
    where: { wabaId },
    select: { id: true, displayPhone: true },
  })
  const digitos = (s: string | null | undefined) => String(s || '').replace(/\D/g, '')
  const fone = digitos(value?.display_phone_number)
  const alvo = conexoes.filter((c) => !fone || digitos(c.displayPhone) === fone)
  for (const c of alvo.length ? alvo : conexoes) await atualizarQualidadeDoNumero(c.id)
}
