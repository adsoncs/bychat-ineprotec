// src/services/alertEscalation.ts
//
// O crítico que ninguém viu.
//
// O sino resolve o problema de quem abre o painel. Não resolve o de sexta às
// 19h, quando a linha de WhatsApp cai e o próximo login é na segunda — foi
// exatamente o que aconteceu aqui: o alerta da linha `attrae` ficou aberto,
// correto, no lugar certo, e nenhuma pessoa do time abriu a caixa uma única vez
// desde que o sistema entrou no ar.
//
// Este módulo é a exceção à regra do `alertDigest`, e a exceção é estreita de
// propósito:
//
//   · só `critical` — o que já foi definido como "dinheiro ou atendimento
//     parados agora". Se um tipo não merece acordar alguém, ele não é crítico;
//     o remédio é baixar a severidade, não afrouxar isto aqui;
//   · só depois da CARÊNCIA — quem está no painel vê no sino em minutos, e
//     interromper por algo que já está sendo tratado é o começo do ruído;
//   · só se NINGUÉM leu — leitura de qualquer destinatário prova que o time
//     soube, e a partir daí a decisão é dele;
//   · no máximo DOIS avisos por alerta, o segundo contado a partir do primeiro
//     e não do nascimento do problema. Crítico que segue aberto depois de dois
//     avisos não é falta de aviso: é decisão de não tratar, e a terceira
//     mensagem só ensina a ignorar as próximas.
//
// Nasce DESLIGADO pelo mesmo motivo do resumo diário: canal externo é
// intrusivo, e ligar sozinho um envio de WhatsApp em nome da empresa é o tipo
// de surpresa que não se desfaz.

import { prisma } from '../lib/prisma.js'

/** Teto de avisos por alerta. O terceiro só ensinaria a ignorar. */
const MAX_AVISOS = 2

/** Horas de carência antes do primeiro aviso externo. */
const CARENCIA_H_PADRAO = 2

/** Horas entre o primeiro e o segundo aviso. */
const REFORCO_H_PADRAO = 24

async function setting(key: string, padrao: number): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  const n = Number(String(row?.value ?? '').replace(/"/g, ''))
  return Number.isFinite(n) && n > 0 ? n : padrao
}

async function ligado(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: 'alertas.escalonamento_ativo' } }).catch(() => null)
  return String(row?.value ?? '').replace(/"/g, '') === 'true'
}

export interface AlertaParaEscalar {
  id: number
  title: string
  body: string | null
  firstSeenAt: Date
  escalationCount: number
}

/**
 * Quais críticos merecem interromper alguém agora.
 *
 * Separada do envio para poder ser conferida sem mandar mensagem nenhuma — é o
 * que o `--escalonar` do script de setup usa para mostrar o que sairia.
 */
export async function candidatos(): Promise<AlertaParaEscalar[]> {
  const carenciaH = await setting('alertas.escalonamento_horas', CARENCIA_H_PADRAO)
  const reforcoH = await setting('alertas.escalonamento_reforco_horas', REFORCO_H_PADRAO)
  const agora = Date.now()

  const abertos = await prisma.alert.findMany({
    where: {
      status: 'open',
      severity: 'critical',
      kind: { notIn: ['demo', 'teste'] },
      escalationCount: { lt: MAX_AVISOS },
      firstSeenAt: { lte: new Date(agora - carenciaH * 3600_000) },
    },
    select: {
      id: true, title: true, body: true, firstSeenAt: true,
      escalatedAt: true, escalationCount: true,
      // Uma leitura de qualquer destinatário basta: o time soube.
      recipients: { where: { readAt: { not: null } }, select: { id: true }, take: 1 },
    },
    orderBy: { firstSeenAt: 'asc' },
    take: 20,
  })

  return abertos
    .filter((a) => a.recipients.length === 0)
    .filter((a) => {
      if (a.escalationCount === 0) return true
      // O reforço conta do ÚLTIMO aviso. Contar do nascimento faria os dois
      // avisos saírem quase juntos num alerta que já era velho quando o
      // escalonamento foi ligado.
      return a.escalatedAt ? agora - a.escalatedAt.getTime() >= reforcoH * 3600_000 : true
    })
    .map(({ recipients: _r, escalatedAt: _e, ...a }) => a)
}

/** O texto de UM aviso. Curto: quem recebe está fora do painel. */
export function textoDoAviso(a: AlertaParaEscalar): string {
  const horas = Math.floor((Date.now() - a.firstSeenAt.getTime()) / 3600_000)
  const idade = horas >= 24 ? `há ${Math.floor(horas / 24)} dia(s)` : `há ${Math.max(1, horas)}h`
  const reforco = a.escalationCount > 0 ? ' *(segundo aviso)*' : ''
  return [
    `🔴 *${a.title}*${reforco}`,
    a.body || '',
    '',
    `Aberto ${idade} e ninguém abriu o alerta no painel.`,
  ].filter(Boolean).join('\n')
}

/**
 * Manda os avisos pendentes. Devolve quantos saíram.
 *
 * Mesmo par de canais do resumo diário e do aviso de novo lead — Evolution para
 * o WhatsApp e o e-mail configurado —, porque um caminho de entrega que já roda
 * há tempo vale mais que um novo que ninguém testou no dia em que precisar.
 */
export async function escalarPendentes(): Promise<number> {
  if (!(await ligado())) return 0
  const lista = await candidatos()
  if (!lista.length) return 0

  const { getNotificationTargets, sendEmailGeneric, getEmailConfig, getFromAddress } =
    await import('./notify.js')
  const targets = await getNotificationTargets()
  if (!targets.whatsapps.length && !targets.emails.length) {
    console.warn('[escalonamento] nenhum destino de notificação configurado — nada enviado')
    return 0
  }

  let enviados = 0
  for (const a of lista) {
    const texto = textoDoAviso(a)
    let saiu = false

    if (targets.whatsapps.length) {
      const { createEvolutionProvider } = await import('./whatsappProvider.js')
      const provider = createEvolutionProvider()
      const { registrarSaidaParaGrupo } = await import('./groupOutboundLog.js')
      for (const phone of targets.whatsapps) {
        try {
          const r = await provider.sendText(phone, texto)
          await registrarSaidaParaGrupo({
            destino: phone, texto, externalId: r?.messageId ?? null,
            instanceName: (provider as any).instanceName ?? null,
          })
          saiu = true
        } catch (e: any) {
          console.warn(`[escalonamento] WhatsApp falhou (${phone}):`, e?.message)
        }
      }
    }

    if (targets.emails.length) {
      try {
        const cfg = await getEmailConfig()
        await sendEmailGeneric({
          from: getFromAddress(cfg, 'Alertas'),
          to: targets.emails.join(', '),
          subject: `🔴 ${a.title}`,
          html: `<pre style="font-family:inherit;white-space:pre-wrap">${texto.replace(/\*/g, '')}</pre>`,
        })
        saiu = true
      } catch (e: any) {
        console.warn('[escalonamento] e-mail falhou:', e?.message)
      }
    }

    // Só carimba se algo saiu de verdade. Marcar um envio que falhou queimaria
    // uma das duas tentativas sem que ninguém tenha sido avisado.
    if (saiu) {
      await prisma.alert.update({
        where: { id: a.id },
        data: { escalatedAt: new Date(), escalationCount: { increment: 1 } },
      })
      enviados++
    }
  }
  if (enviados) console.log(`[escalonamento] ${enviados} crítico(s) avisados fora do painel`)
  return enviados
}

// ── Vigilante ───────────────────────────────────────────────────────────────
//
// Vinte minutos: com carência de 2h, um tique mais curto não adianta nada, e um
// mais longo faria a carência configurada virar mentira.

let handle: ReturnType<typeof setInterval> | null = null
const TICK_MS = 20 * 60 * 1000

export function startAlertEscalation(): void {
  setTimeout(async () => {
    await tick()
    handle = setInterval(tick, TICK_MS)
    console.log('[escalonamento] vigia de crítico não visto iniciado — a cada 20min')
  }, 210_000)
}

async function tick(): Promise<void> {
  try {
    await escalarPendentes()
  } catch (e: any) {
    console.error('[escalonamento] falhou:', e?.message)
  }
}

export function stopAlertEscalation(): void {
  if (handle) { clearInterval(handle); handle = null }
}
