// src/services/alertaFilaEquipe.ts
//
// Avisa a EQUIPE que tem gente esperando atendimento.
//
// O fluxo de atendimento já tinha metade disso: `queueWarnMinutes` manda uma
// frase para o CLIENTE ("já estamos te atendendo"), e o chatbot promete
// "tempo médio: 5 minutos". Só que ninguém do outro lado era avisado — em
// 03/09/2026 havia 66 leads parados em `waiting_agent`, o mais antigo há 354
// horas, todos sem dono. A promessa saía, a fila não andava.
//
// Aqui o aviso é interno: vai para os números de notificação da empresa
// (Configurações › Empresa › Dados de Notificações), nunca para o lead.
//
// Duas travas contra virar spam:
//   - só entra lead com conversa das últimas 48h (o filtro de quem chama), de
//     modo que passivo histórico não vira enxurrada de aviso na primeira volta;
//   - no máximo `TETO_POR_VOLTA` avisos por ciclo, e no máximo dois por lead
//     (o primeiro e um reforço), sempre em horário comercial.

import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'
import { registrarModelosPadrao } from './modelosDoSistema.js'

// Textos do aviso de contato esperando na fila. Registrados sob demanda
// (services/modelosOpcionais.ts) — só existem onde o fluxo de atendimento está ligado.
export function registrarModelosDaFila(): void {
  registrarModelosPadrao([
    { key: 'aviso_fila_marca_reforco', name: 'Aviso de fila — marca do segundo aviso ({{reforco}} no modelo do aviso)', channel: 'texto', body: ' (2º aviso)' },
    { key: 'aviso_fila_hsm_pedido', name: 'Aviso de fila — campo "pedido" do modelo da Meta ({{espera}})', channel: 'texto', body: 'Aguarda atendimento há {{espera}}{{#reforco}} — 2º aviso{{/reforco}}' },
  ])
}

/** Quantos avisos saem por volta do relógio, no pior caso. */
const TETO_POR_VOLTA = 5
/** Nunca mais que isto por lead: o primeiro e um reforço. */
const MAX_AVISOS_POR_LEAD = 2

async function minutosDeSetting(key: string, padrao: number): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  const n = Number(String(row?.value ?? '').replace(/"/g, ''))
  return Number.isFinite(n) && n > 0 ? n : padrao
}

/** Espera antes do primeiro aviso e antes do reforço, em minutos. */
export async function limitesDaFila(): Promise<{ primeiro: number; reforco: number }> {
  return {
    primeiro: await minutosDeSetting('atendimento.alerta_fila_min', 15),
    reforco: await minutosDeSetting('atendimento.alerta_fila_reforco_min', 60),
  }
}

export interface LeadNaFila {
  id: number
  nome: string | null
  whatsapp: string | null
  funnelId: number | null
  status: string | null
  formData: unknown
  assignedUserId: number | null
}

/**
 * Decide se este lead merece aviso agora. Não envia nada — quem chama controla
 * o teto por volta e só então dispara.
 */
export function precisaAvisar(
  state: any,
  agora: number,
  limites: { primeiro: number; reforco: number },
): boolean {
  if (!state || state.phase !== 'waiting_agent' || !state.handoffAt) return false
  const esperaMin = (agora - new Date(state.handoffAt).getTime()) / 60_000
  if (!Number.isFinite(esperaMin)) return false

  const avisos = Number(state.teamAlertedCount || 0)
  if (avisos >= MAX_AVISOS_POR_LEAD) return false
  if (avisos === 0) return esperaMin >= limites.primeiro

  // Reforço: conta a partir do último aviso, não do handoff — senão o segundo
  // sai colado no primeiro assim que o limite maior é ultrapassado.
  const desdeUltimo = (agora - new Date(state.teamAlertedAt || state.handoffAt).getTime()) / 60_000
  return desdeUltimo >= limites.reforco
}

/** Minutos de espera, para o texto do aviso. */
function esperaEmMinutos(state: any, agora: number): number {
  return Math.max(0, Math.round((agora - new Date(state.handoffAt).getTime()) / 60_000))
}

function humanizar(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
  return `${Math.floor(h / 24)} dia(s)`
}

/**
 * Manda o aviso de um lead para os números de notificação da empresa.
 * Devolve `true` se pelo menos um destino recebeu.
 */
export async function avisarEquipe(lead: LeadNaFila, state: any, agora: number): Promise<boolean> {
  const { getNotificationTargets } = await import('./notify.js')
  const { enviarAutomatico, configDoRoteador } = await import('./outboundRouter.js')

  const targets = await getNotificationTargets()
  if (!targets.whatsapps.length) return false

  const espera = esperaEmMinutos(state, agora)
  const setor = String(state.dept || '').trim() || 'atendimento'
  const reforco = Number(state.teamAlertedCount || 0) > 0

  const tpl = await prisma.messageTemplate.findFirst({ where: { key: 'alerta_fila_equipe' } })
  const { resolveVariables } = await import('./workflowActions.js')
  const { textoDoSistema } = await import('./modelosDoSistema.js')
  const marcaReforco = reforco ? await textoDoSistema('aviso_fila_marca_reforco') : ''
  const texto = resolveVariables(tpl?.body || '', lead as any, {
    payload: { espera: humanizar(espera), setor, reforco: marcaReforco },
  })
  if (!texto.trim()) return false

  // Fora da janela de 24h o texto livre não sai pela linha oficial; o HSM de
  // aviso à equipe (Setting `whatsapp.hsm_aviso_equipe`) tem exatamente estes
  // quatro campos. Sem ele configurado, o aviso vai só como texto livre.
  const nomeHsm = (await configDoRoteador()).hsmAvisoEquipe
  const semDado = await textoDoSistema('aviso_equipe_hsm_sem_dado')
  const hsm = !nomeHsm ? null : {
    name: nomeHsm,
    values: {
      contato: lead.nome || semDado,
      telefone: lead.whatsapp || semDado,
      setor,
      pedido: await textoDoSistema('aviso_fila_hsm_pedido', { espera: humanizar(espera), reforco: reforco ? 'sim' : '' }),
    },
  }

  let entregou = false
  for (const phone of targets.whatsapps) {
    try {
      await enviarAutomatico({ leadId: null, phone, texto, hsm })
      entregou = true
    } catch (e: any) {
      console.warn(`[alertaFila] aviso falhou (${phone}):`, e?.message)
    }
  }
  if (!entregou) return false

  logEvent({
    leadId: lead.id, type: 'queue_team_alert' as any, category: 'system',
    title: `Equipe avisada — lead aguarda há ${humanizar(espera)}`,
    channel: 'whatsapp', source: 'fila', actorType: 'system',
    metadata: { esperaMin: espera, setor, aviso: Number(state.teamAlertedCount || 0) + 1 },
  })
  return true
}

export { TETO_POR_VOLTA }
