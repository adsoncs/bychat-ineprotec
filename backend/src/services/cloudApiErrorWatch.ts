// src/services/cloudApiErrorWatch.ts
//
// Vigia os erros que a Meta devolve nos envios da Cloud API e avisa a equipe
// quando o problema é da CONTA — não da mensagem.
//
// O que motivou: o severiano acumulou **105 recusas com o código 131042
// ("Business eligibility payment issue") entre 23/07 e 03/09/2026** sem que
// ninguém fosse avisado. Cada uma delas é um template que não chegou ao
// destinatário. A operadora só descobriu ao tentar falar com uma lead e ver a
// mensagem falhar na tela — seis semanas depois do primeiro caso.
//
// A distinção que faz este vigia útil: erro POR MENSAGEM é rotina e não vale
// aviso (131026 = número não existe, 131052 = mídia não baixou). Erro de CONTA
// bloqueia todo mundo ao mesmo tempo e não se resolve sozinho — pagamento
// pendente, conta travada, bloqueio por política. É só desse grupo que o vigia
// fala.
//
// O aviso NÃO sai pela Cloud API, de propósito: um alerta dizendo que o canal
// oficial está bloqueado não pode depender dele para chegar. Vai por e-mail e
// pela Evolution (linha não-oficial, independente da Meta), e basta um dos dois
// entregar. No severiano os dois estavam quebrados de formas diferentes — chave
// do Resend inválida e o campo de WhatsApp de notificação com um e-mail dentro
// —, então o vigia grita no log quando não tem para onde avisar em vez de
// fracassar em silêncio, que é o problema que ele existe para resolver.

import { prisma } from '../lib/prisma.js'

/**
 * Erros que travam a conta inteira. Cada um continua acontecendo até alguém
 * agir no WhatsApp Manager — por isso valem aviso, e os de mensagem não.
 */
const ERROS_DE_CONTA: Record<string, string> = {
  '131042': 'Pendência de pagamento na conta WhatsApp Business — nenhum template é entregue até regularizar a forma de pagamento no WhatsApp Manager.',
  '131031': 'Conta WhatsApp Business bloqueada pela Meta.',
  '368': 'Conta temporariamente bloqueada por violação de política da Meta.',
  '131057': 'Conta em modo de manutenção na Meta.',
  '133010': 'Número não registrado na Cloud API.',
  '133004': 'Serviço da Meta indisponível para este número.',
}

/** De quanto em quanto tempo o mesmo problema pode ser reavisado. */
const REAVISO_HORAS = 24
/** Janela olhada em cada volta. Maior que o intervalo, para nada escapar. */
const JANELA_HORAS = 2

const INTERVALO_MS = 30 * 60 * 1000
let handle: ReturnType<typeof setInterval> | null = null

function chaveDoAviso(codigo: string): string {
  return `cloudapi.error_alert.${codigo}`
}

/**
 * Para quem o aviso vai.
 *
 * Preferência para o que o admin configurou em Configurações › Empresa. Sem
 * isso, cai nos e-mails dos SUPERADMIN ativos: no severiano os destinos estavam
 * vazios, e um vigia que não avisa ninguém por falta de configuração é o mesmo
 * silêncio que ele existe para quebrar.
 */
async function destinatarios(): Promise<string[]> {
  const { getNotificationTargets } = await import('./notify.js')
  const t = await getNotificationTargets().catch(() => null)
  const configurados = (t?.emails || []).filter((e) => e.includes('@'))
  if (configurados.length) return configurados

  const admins = await prisma.user.findMany({
    where: { active: true, role: 'SUPERADMIN' as any },
    select: { email: true },
    orderBy: { id: 'asc' },
    take: 3,
  })
  return admins.map((a) => a.email).filter((e) => e && e.includes('@'))
}

/** Números internos para o aviso por WhatsApp (nunca o do lead). */
async function numerosDeAviso(): Promise<string[]> {
  const { getNotificationTargets } = await import('./notify.js')
  const t = await getNotificationTargets().catch(() => null)
  // Filtra o que não é telefone: o campo legado do severiano guardava um
  // e-mail, e mandar mensagem para "adsoncs@gmail.com" só produz erro no log.
  return (t?.whatsapps || [])
    .map((n) => String(n).replace(/\D/g, ''))
    .filter((n) => n.length >= 10)
}

/** Uma volta do vigia. Exportada para poder ser chamada à mão e em teste. */
export async function verificarErrosDaCloudApi(): Promise<{ avisados: string[]; ignorados: string[] }> {
  const desde = new Date(Date.now() - JANELA_HORAS * 3600_000)
  const recentes = await prisma.cloudApiMessageLog.groupBy({
    by: ['errorCode'],
    where: { errorCode: { not: null }, createdAt: { gte: desde } },
    _count: { _all: true },
    _max: { createdAt: true },
  })

  const avisados: string[] = []
  const ignorados: string[] = []

  for (const r of recentes) {
    const codigo = String(r.errorCode)
    const descricao = ERROS_DE_CONTA[codigo]
    if (!descricao) { ignorados.push(codigo); continue }

    // Reaviso no máximo uma vez por dia: o erro se repete a cada tentativa de
    // envio, e um e-mail por tentativa faria o time criar filtro para a caixa.
    const chave = chaveDoAviso(codigo)
    const ultimo = await prisma.setting.findUnique({ where: { key: chave } }).catch(() => null)
    if (ultimo?.value) {
      const quando = new Date(String(ultimo.value).replace(/"/g, '')).getTime()
      if (Number.isFinite(quando) && Date.now() - quando < REAVISO_HORAS * 3600_000) continue
    }

    const total = await prisma.cloudApiMessageLog.count({ where: { errorCode: codigo } })
    const primeiro = await prisma.cloudApiMessageLog.findFirst({
      where: { errorCode: codigo }, orderBy: { createdAt: 'asc' }, select: { createdAt: true },
    })

    const enviou = await avisar(codigo, descricao, {
      naJanela: r._count._all,
      total,
      desdeQuando: primeiro?.createdAt ?? null,
      ultimo: r._max.createdAt ?? null,
    })
    if (!enviou) continue

    await prisma.setting.upsert({
      where: { key: chave },
      update: { value: new Date().toISOString() },
      create: {
        key: chave, value: new Date().toISOString(),
        label: `Último aviso do erro ${codigo} da Cloud API`, grp: 'sistema', fieldType: 'text',
      },
    }).catch(() => {})
    avisados.push(codigo)
  }
  return { avisados, ignorados }
}

const fmt = (d: Date | null) => (d ? d.toLocaleString('pt-BR') : '—')

async function avisar(
  codigo: string,
  descricao: string,
  dados: { naJanela: number; total: number; desdeQuando: Date | null; ultimo: Date | null },
): Promise<boolean> {
  const para = await destinatarios()
  if (!para.length) {
    console.warn(`[cloudApiErrorWatch] erro ${codigo} detectado e NINGUÉM para avisar (sem e-mail configurado nem SUPERADMIN ativo)`)
    return false
  }

  const html = `
    <p><strong>O WhatsApp Oficial está recusando envios.</strong></p>
    <p>${descricao}</p>
    <table cellpadding="6" style="border-collapse:collapse">
      <tr><td>Código da Meta</td><td><strong>${codigo}</strong></td></tr>
      <tr><td>Recusas nas últimas ${JANELA_HORAS}h</td><td>${dados.naJanela}</td></tr>
      <tr><td>Total acumulado</td><td><strong>${dados.total}</strong></td></tr>
      <tr><td>Primeira ocorrência</td><td>${fmt(dados.desdeQuando)}</td></tr>
      <tr><td>Mais recente</td><td>${fmt(dados.ultimo)}</td></tr>
    </table>
    <p>Cada recusa é uma mensagem que <strong>não chegou</strong> ao destinatário.
    Resolver depende de ação no WhatsApp Manager da Meta — o sistema não consegue
    contornar por conta própria.</p>
    <p style="color:#666;font-size:12px">Este aviso sai no máximo uma vez a cada ${REAVISO_HORAS}h por código de erro.</p>`

  let entregou = false

  try {
    const { sendEmailGeneric, getEmailConfig, getFromAddress } = await import('./notify.js')
    const cfg = await getEmailConfig()
    await sendEmailGeneric({
      from: getFromAddress(cfg, 'Alerta WhatsApp'),
      to: para.join(', '),
      subject: `WhatsApp Oficial recusando envios (erro ${codigo})`,
      html,
    })
    entregou = true
    console.log(`[cloudApiErrorWatch] erro ${codigo} avisado por e-mail a ${para.length} destinatário(s)`)
  } catch (e: any) {
    console.warn(`[cloudApiErrorWatch] e-mail falhou para ${codigo}:`, e?.message)
  }

  // Pela Evolution: linha não-oficial, não passa pela Meta, então continua de pé
  // exatamente na situação que este aviso denuncia.
  const numeros = await numerosDeAviso()
  if (numeros.length) {
    const texto = [
      `⚠️ *WhatsApp Oficial recusando envios*`,
      '',
      descricao,
      '',
      `Código da Meta: *${codigo}*`,
      `Recusas nas últimas ${JANELA_HORAS}h: ${dados.naJanela}`,
      `Total acumulado: *${dados.total}*`,
      `Desde: ${fmt(dados.desdeQuando)}`,
      '',
      'Cada recusa é uma mensagem que não chegou. Resolver depende de ação no WhatsApp Manager.',
    ].join('\n')
    try {
      // Instância resolvida pelo BANCO, não pelo .env: no severiano o
      // EVOLUTION_INSTANCE aponta para `severiano_n1`, desconectada, enquanto a
      // linha viva é `oficial_sever`. Um aviso que sai pela instância morta
      // falha com 400 e volta ao silêncio que ele deveria quebrar.
      const linha = await prisma.whatsAppInstance.findFirst({
        where: { active: true },
        orderBy: { id: 'asc' },
        select: { instanceName: true },
      })
      if (!linha) throw new Error('nenhuma instância Evolution ativa')
      const { createEvolutionProviderFor } = await import('./whatsappProvider.js')
      const provider = createEvolutionProviderFor(linha.instanceName)
      for (const n of numeros) await provider.sendText(n, texto)
      entregou = true
      console.log(`[cloudApiErrorWatch] erro ${codigo} avisado por WhatsApp a ${numeros.length} número(s)`)
    } catch (e: any) {
      console.warn(`[cloudApiErrorWatch] WhatsApp falhou para ${codigo}:`, e?.message)
    }
  }

  if (!entregou) {
    console.error(
      `[cloudApiErrorWatch] ⚠️ erro ${codigo} com ${dados.total} recusas acumuladas e NENHUM canal de aviso funcionando. ` +
      `Configure Configurações › Empresa › Dados de Notificações (e-mail e WhatsApp) — sem isso o problema segue invisível.`,
    )
  }
  return entregou
}

export function startCloudApiErrorWatch(): void {
  // Só faz sentido onde existe Cloud API; sem conexão, o vigia nem sobe.
  setTimeout(async () => {
    const conns = await prisma.cloudApiConnection.count({ where: { active: true } }).catch(() => 0)
    if (!conns) return
    await rodar()
    handle = setInterval(rodar, INTERVALO_MS)
    console.log('[cloudApiErrorWatch] vigia de erro da Meta iniciado — a cada 30min')
  }, 120_000)
}

async function rodar(): Promise<void> {
  try {
    await verificarErrosDaCloudApi()
  } catch (e: any) {
    console.error('[cloudApiErrorWatch] volta falhou:', e?.message)
  }
}

export function stopCloudApiErrorWatch(): void {
  if (handle) { clearInterval(handle); handle = null }
}
