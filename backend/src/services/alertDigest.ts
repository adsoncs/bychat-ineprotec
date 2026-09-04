// src/services/alertDigest.ts
//
// Um resumo por dia do que está aberto — e nada mais que isso.
//
// A tentação natural na Fase 4 seria mandar cada alerta crítico por WhatsApp na
// hora. Seis avisos num dia e a pessoa silencia a conversa; silenciada, ela
// perde também o sétimo, que era o que importava. Um resumo diário é lido
// porque chega uma vez e cabe numa tela.
//
// O que sai daqui NÃO substitui o sino: o sino é onde se age (marcar lido,
// dar o desfecho da reunião). O digest existe para quem não abriu o painel
// naquele dia saber que tem coisa esperando.
//
// Escalonamento unitário — crítico que ninguém tocou em X horas — usa os campos
// `notifiedAt`/`notifyCount` que já estão na tabela, e fica para depois de o
// digest rodar algumas semanas: só com uso real se sabe qual crítico merece
// interromper alguém.

import { prisma } from '../lib/prisma.js'

/** Hora do dia (0-23) em que o resumo sai. */
const HORA_PADRAO = 8

/** Não manda resumo de nada: dia sem pendência não gera mensagem. */
const MINIMO = 1

const ROTULO_KIND: Record<string, string> = {
  'integration.token': 'Integrações',
  'integration.error': 'Integrações',
  'channel.down': 'Canais',
  'meeting.no_outcome': 'Reuniões sem desfecho',
  'meeting.bot_failed': 'Gravação de reunião',
  'activity.overdue': 'Atividades atrasadas',
  'negotiation.stalled': 'Propostas paradas',
  'lead.stale': 'Leads sem resposta',
}

function rotulo(kind: string): string {
  return ROTULO_KIND[kind] || kind
}

async function horaConfigurada(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: 'alertas.digest_hora' } }).catch(() => null)
  const n = Number(String(row?.value ?? '').replace(/"/g, ''))
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : HORA_PADRAO
}

async function digestLigado(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: 'alertas.digest_ativo' } }).catch(() => null)
  // Padrão LIGADO seria surpresa: canal externo é intrusivo e ninguém pediu
  // WhatsApp diário ao ativar o sino. Quem quiser, liga.
  return String(row?.value ?? '').replace(/"/g, '') === 'true'
}

/** Monta o texto do resumo. Devolve null quando não há o que dizer. */
export async function montarDigest(): Promise<string | null> {
  const abertos = await prisma.alert.findMany({
    where: { status: 'open' },
    select: { kind: true, severity: true, title: true, firstSeenAt: true },
    orderBy: { firstSeenAt: 'asc' },
    take: 200,
  })
  // Alerta de demonstração não entra num resumo que sai por WhatsApp.
  const reais = abertos.filter((a) => a.kind !== 'demo' && a.kind !== 'teste')
  if (reais.length < MINIMO) return null

  const criticos = reais.filter((a) => a.severity === 'critical')
  const porTipo = new Map<string, number>()
  for (const a of reais) porTipo.set(rotulo(a.kind), (porTipo.get(rotulo(a.kind)) || 0) + 1)

  const linhas: string[] = ['*Pendências do dia*', '']
  if (criticos.length) {
    linhas.push(`🔴 *${criticos.length} crítico(s)* — precisam de alguém hoje:`)
    // Os cinco mais antigos: crítico que está de pé há mais tempo é o que já
    // deveria ter sido resolvido.
    for (const c of criticos.slice(0, 5)) {
      const d = Math.floor((Date.now() - c.firstSeenAt.getTime()) / 86400_000)
      linhas.push(`• ${c.title}${d >= 1 ? ` _(há ${d} dia${d > 1 ? 's' : ''})_` : ''}`)
    }
    if (criticos.length > 5) linhas.push(`• …e mais ${criticos.length - 5}`)
    linhas.push('')
  }

  linhas.push('*Em aberto por tipo:*')
  for (const [tipo, n] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) {
    linhas.push(`• ${tipo}: ${n}`)
  }
  linhas.push('', '_Detalhes e ações no sino do painel._')
  return linhas.join('\n')
}

/**
 * Envia o resumo aos destinos de notificação da empresa.
 *
 * Reusa `getNotificationTargets` e o mesmo par de canais do aviso de novo lead,
 * que já roda há tempo: Evolution para o WhatsApp e o e-mail configurado.
 */
export async function enviarDigest(): Promise<boolean> {
  const texto = await montarDigest()
  if (!texto) return false

  const { getNotificationTargets, sendEmailGeneric, getEmailConfig, getFromAddress } =
    await import('./notify.js')
  const targets = await getNotificationTargets()

  let enviou = false
  if (targets.whatsapps.length) {
    // Mesmo caminho do aviso de novo lead: Evolution, porque a Cloud API não
    // entrega texto livre a número fora da janela de 24h e um resumo não cabe
    // nos campos fixos de um template aprovado.
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
        enviou = true
      } catch (e: any) {
        console.warn(`[digest] WhatsApp falhou (${phone}):`, e?.message)
      }
    }
  }

  if (targets.emails.length) {
    try {
      const cfg = await getEmailConfig()
      await sendEmailGeneric({
        from: getFromAddress(cfg, 'Alertas'),
        to: targets.emails.join(', '),
        subject: 'Pendências do dia',
        html: `<pre style="font-family:inherit;white-space:pre-wrap">${texto.replace(/\*/g, '')}</pre>`,
      })
      enviou = true
    } catch (e: any) {
      console.warn('[digest] e-mail falhou:', e?.message)
    }
  }

  if (enviou) {
    // Marca o que entrou neste resumo: é o que o escalonamento unitário vai
    // consultar depois para não repetir o que já foi contado hoje.
    await prisma.alert.updateMany({
      where: { status: 'open', kind: { notIn: ['demo', 'teste'] } },
      data: { notifiedAt: new Date(), notifyCount: { increment: 1 } },
    })
  }
  return enviou
}

// ── Agendador ───────────────────────────────────────────────────────────────
//
// Confere de 15 em 15 minutos se já é a hora e se hoje ainda não saiu. Guardar
// a data do último envio em memória bastaria até o primeiro restart — e um
// restart às 8h05 mandaria o resumo duas vezes. Por isso a marca fica em
// Setting.

let handle: ReturnType<typeof setInterval> | null = null
const TICK_MS = 15 * 60 * 1000
const CHAVE_ULTIMO = 'alertas.digest_ultimo_envio'

export function startAlertDigest(): void {
  setTimeout(async () => {
    await tick()
    handle = setInterval(tick, TICK_MS)
    console.log('[digest] agendador de resumo diário iniciado')
  }, 180_000)
}

async function tick(): Promise<void> {
  try {
    if (!(await digestLigado())) return
    const agora = new Date()
    if (agora.getHours() < (await horaConfigurada())) return

    const hoje = agora.toISOString().slice(0, 10)
    const ultimo = await prisma.setting.findUnique({ where: { key: CHAVE_ULTIMO } }).catch(() => null)
    if (String(ultimo?.value ?? '').replace(/"/g, '') === hoje) return

    const enviou = await enviarDigest()
    // Grava a data mesmo quando não havia nada a enviar: sem isso, um dia
    // tranquilo faria o tick reavaliar de 15 em 15 minutos até a meia-noite.
    await prisma.setting.upsert({
      where: { key: CHAVE_ULTIMO },
      update: { value: hoje },
      create: { key: CHAVE_ULTIMO, value: hoje, label: 'Último resumo enviado', grp: 'alertas', fieldType: 'text' },
    })
    if (enviou) console.log('[digest] resumo do dia enviado')
  } catch (e: any) {
    console.error('[digest] falhou:', e?.message)
  }
}

export function stopAlertDigest(): void {
  if (handle) { clearInterval(handle); handle = null }
}
