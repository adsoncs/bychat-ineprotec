// src/services/tokenHealthWatch.ts
//
// Integração que morre em silêncio.
//
// Vinte e nove arquivos do sistema sabem reconhecer um token vencido —
// `invalid_grant`, `OAuthException`, HTTP 190 — e nenhum deles avisava alguém.
// O sync parava, o calendário não sincronizava mais, o e-mail deixava de chegar,
// e a primeira notícia era alguém perguntando por que um lead não apareceu.
//
// Duas formas de descobrir, e as duas importam:
//
//   PROATIVA (aqui): o que já está gravado no banco basta para avisar ANTES.
//   `tokenExpiresAt` do Google e do Cloud API, `watchExpiration` do Gmail,
//   `lastError` das integrações — tudo isso é lido a cada volta do relógio,
//   sem gastar uma única chamada de API externa.
//
//   REATIVA (`registrarFalhaDeIntegracao`, chamada de quem pega o erro): o token
//   pode virar inválido antes da data — revogação, senha trocada, app removido.
//   Nenhuma data prevê isso; só a falha real conta.
//
// Tudo com audiência de gestão: reconectar integração é trabalho de quem tem a
// senha da conta, não de quem atende.

import { prisma } from '../lib/prisma.js'
import { raiseAlert, resolveAlert, resolverAusentes, produtorDesligado, produtorAtivo } from './alertService.js'

export const KIND_TOKEN = 'integration.token'
export const KIND_INTEGRACAO = 'integration.error'

/** Com quantos dias de antecedência avisar que um token vai vencer. */
const AVISO_DIAS = 7

function dias(ate: Date): number {
  return Math.floor((ate.getTime() - Date.now()) / 86400_000)
}

/**
 * Registra a falha de uma integração no momento em que ela acontece.
 *
 * Chamada de dentro do `catch` de quem fala com o provedor. É `void` e engole os
 * próprios erros de propósito: quem estava tentando sincronizar não pode
 * quebrar porque o aviso falhou.
 *
 * `escopo` é o que dá a identidade da condição — "google:3", "meta:1". A mesma
 * integração falhando mil vezes seguidas é UM alerta com mil ocorrências.
 */
export function registrarFalhaDeIntegracao(
  escopo: string,
  titulo: string,
  detalhe?: string | null,
): void {
  // Também respeita a chave por produtor: um tipo desligado tem de ficar
  // desligado nos DOIS caminhos, senão a varredura cala e o `catch` continua
  // falando — e a pessoa que desligou não entende por que o alerta voltou.
  produtorAtivo(KIND_INTEGRACAO).then((ligado) => {
    if (!ligado) return
    raiseAlert({
      dedupeKey: `integration:error:${escopo}`,
      kind: KIND_INTEGRACAO,
      severity: 'critical',
      audience: 'management',
      title: titulo,
      body: detalhe ? String(detalhe).slice(0, 500) : 'A integração recusou a credencial.',
      metadata: { escopo },
    }).catch(() => { /* aviso é secundário: nunca derruba quem chamou */ })
  }).catch(() => {})
}

/** A integração voltou a funcionar — fecha o alerta que a falha abriu. */
export function limparFalhaDeIntegracao(escopo: string): void {
  resolveAlert(`integration:error:${escopo}`).catch(() => {})
}

/**
 * Varre o que já está no banco e levanta o que está vencido ou vencendo.
 *
 * Não chama API externa nenhuma: a validade que o sistema conhece foi gravada
 * quando a conexão nasceu, e é ela que permite avisar antes de quebrar.
 */
export async function varrerTokens(): Promise<{ abertos: number; fechados: number }> {
  const desligado = await produtorDesligado(KIND_TOKEN)
  if (desligado) return desligado

  const vivas: string[] = []

  // ── Google: conta conectada por OAuth ──
  const google = await prisma.googleConnection.findMany({
    where: { active: true },
    select: { id: true, email: true, tokenExpiresAt: true, refreshToken: true, kind: true },
  })
  for (const g of google) {
    const chave = `token:google:${g.id}`
    // Sem refresh token não há como renovar: o acesso morre na data e não volta.
    if (!g.refreshToken?.trim()) {
      vivas.push(chave)
      await raiseAlert({
        dedupeKey: chave, kind: KIND_TOKEN, severity: 'critical', audience: 'management',
        title: `Google sem permissão de renovação: ${g.email}`,
        body: 'A conexão não tem refresh token — quando o acesso vencer, não volta sozinho. Reconecte a conta.',
        entityType: 'google_connection', entityId: g.id,
        metadata: { email: g.email, kind: g.kind },
      })
      continue
    }
    // Com refresh token, o vencimento do access token é rotina e se resolve
    // sozinho: só vira alerta quando já passou bastante da hora, o que indica
    // que a renovação parou de funcionar.
    if (g.tokenExpiresAt && dias(g.tokenExpiresAt) < -1) {
      vivas.push(chave)
      await raiseAlert({
        dedupeKey: chave, kind: KIND_TOKEN, severity: 'critical', audience: 'management',
        title: `Google não renova mais: ${g.email}`,
        body: `O acesso venceu em ${g.tokenExpiresAt.toLocaleDateString('pt-BR')} e não foi renovado desde então.`,
        entityType: 'google_connection', entityId: g.id,
        metadata: { email: g.email, expirou: g.tokenExpiresAt.toISOString() },
      })
    }
  }

  // ── WhatsApp Cloud API ──
  const cloud = await prisma.cloudApiConnection.findMany({
    where: { active: true },
    select: { id: true, displayPhone: true, tokenExpiresAt: true },
  })
  for (const c of cloud) {
    // tokenExpiresAt nulo é o normal aqui: System User Token não expira. Avisar
    // por "validade desconhecida" seria alarme falso permanente.
    if (!c.tokenExpiresAt) continue
    const d = dias(c.tokenExpiresAt)
    if (d > AVISO_DIAS) continue
    const chave = `token:cloud_api:${c.id}`
    vivas.push(chave)
    await raiseAlert({
      dedupeKey: chave, kind: KIND_TOKEN,
      severity: d <= 0 ? 'critical' : 'warning',
      audience: 'management',
      title: d <= 0
        ? `WhatsApp oficial com token vencido: ${c.displayPhone || 'número'}`
        : `WhatsApp oficial vence em ${d} dia(s): ${c.displayPhone || 'número'}`,
      body: d <= 0
        ? 'O número oficial não envia mais nada até o token ser renovado.'
        : 'Renove o token antes de vencer — o número oficial para de enviar quando isso acontece.',
      entityType: 'cloud_api_connection', entityId: c.id,
      metadata: { vence: c.tokenExpiresAt.toISOString(), dias: d },
    })
  }

  // ── Gmail: a escuta de caixa de entrada vence a cada 7 dias ──
  const gmail = await prisma.gmailConfig.findMany({
    where: { active: true, watchExpiration: { not: null } },
    select: { id: true, watchExpiration: true, connection: { select: { email: true } } },
  })
  for (const gm of gmail) {
    if (!gm.watchExpiration || gm.watchExpiration.getTime() > Date.now()) continue
    const chave = `token:gmail_watch:${gm.id}`
    vivas.push(chave)
    await raiseAlert({
      dedupeKey: chave, kind: KIND_TOKEN, severity: 'warning', audience: 'management',
      title: `Gmail parou de receber: ${gm.connection?.email || 'caixa'}`,
      body: `A escuta da caixa venceu em ${gm.watchExpiration.toLocaleDateString('pt-BR')} e não foi renovada. Respostas de cliente não estão entrando.`,
      entityType: 'gmail_config', entityId: gm.id,
      metadata: { venceu: gm.watchExpiration.toISOString() },
    })
  }

  // ── Integrações que guardam o próprio erro ──
  const cal = await prisma.googleCalendarIntegration.findMany({
    where: { active: true, lastError: { not: null } },
    select: { id: true, name: true, lastError: true },
  })
  for (const c of cal) {
    if (!c.lastError?.trim()) continue
    const chave = `integration:calendar:${c.id}`
    vivas.push(chave)
    await raiseAlert({
      dedupeKey: chave, kind: KIND_TOKEN, severity: 'warning', audience: 'management',
      title: `Agenda Google com erro: ${c.name}`,
      body: String(c.lastError).slice(0, 400),
      entityType: 'google_calendar_integration', entityId: c.id,
    })
  }

  const sheets = await prisma.googleSheetIntegration.findMany({
    where: { active: true, lastError: { not: null } },
    select: { id: true, name: true, lastError: true },
  })
  for (const sh of sheets) {
    if (!sh.lastError?.trim()) continue
    const chave = `integration:sheet:${sh.id}`
    vivas.push(chave)
    await raiseAlert({
      dedupeKey: chave, kind: KIND_TOKEN, severity: 'warning', audience: 'management',
      title: `Planilha com erro: ${sh.name}`,
      body: String(sh.lastError).slice(0, 400),
      entityType: 'google_sheet_integration', entityId: sh.id,
    })
  }

  // Só a família proativa é fechada em lote. Os alertas REATIVOS
  // (integration.error) têm família própria de propósito: quem sabe que a
  // credencial voltou a funcionar é quem consegue usá-la, não esta varredura —
  // fechá-los aqui apagaria a falha que ninguém arrumou ainda.
  const fechados = await resolverAusentes(KIND_TOKEN, vivas)
  return { abertos: vivas.length, fechados }
}

// ── Vigilante ───────────────────────────────────────────────────────────────

let handle: ReturnType<typeof setInterval> | null = null
const INTERVALO_MS = 60 * 60 * 1000

export function startTokenHealthWatch(): void {
  setTimeout(async () => {
    await rodar()
    handle = setInterval(rodar, INTERVALO_MS)
    console.log('[tokens] vigia de integrações iniciado — a cada 60min')
  }, 120_000)
}

async function rodar(): Promise<void> {
  try {
    const r = await varrerTokens()
    if (r.abertos || r.fechados) {
      console.log(`[tokens] ${r.abertos} problema(s), ${r.fechados} alerta(s) fechado(s)`)
    }
  } catch (e: any) {
    console.error('[tokens] varredura falhou:', e?.message)
  }
}

export function stopTokenHealthWatch(): void {
  if (handle) { clearInterval(handle); handle = null }
}
