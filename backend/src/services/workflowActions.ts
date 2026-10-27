// src/services/workflowActions.ts
// Despacha ações de workflow para as filas BullMQ correspondentes

import { createHash } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { queues } from '../lib/queues.js'
import { redis } from '../lib/redis.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { canSendNow, type Channel } from './messageGovernance.js'
import { appendPreferencesLink } from './preferencesToken.js'
import { templateBodyTokens } from '../lib/waTemplateParams.js'
import { ORDEM_CONEXAO_PADRAO } from './whatsappProvider.js'
import { aplicarBlocos } from '../lib/interpolate.js'

/** Heurística simples pra decidir se um corpo é HTML — se contém tags. */
function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s)
}

/**
 * Fecha um passo de ação SÍNCRONA: vai para o próximo passo, ou encerra a
 * execução quando este era o último.
 *
 * Existia só nas ações por fila (`advanceWorkflow` em workers.ts). As síncronas
 * — mudar etapa, etiqueta, atribuir, avisar equipe — apenas paravam: a execução
 * ficava em 'running' PARA SEMPRE, mesmo com o fluxo inteiro já executado. Isso
 * enche a tela de execuções do fluxo com corridas que nunca terminam e bloqueia
 * a re-entrada de quem usa reentryPolicy 'never' / 'after_completion'.
 */
async function finalizarPasso(
  executionId: number,
  stepId: number,
  /** `falhou` encerra como falha; `encerrar` fecha sem seguir para o próximo passo. */
  opts?: { falhou?: boolean; encerrar?: boolean },
): Promise<void> {
  if (opts?.falhou || opts?.encerrar) {
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: opts.falhou ? 'failed' : 'completed', completedAt: new Date() },
    }).catch(() => {})
    return
  }

  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
  if (step?.nextStepId) {
    const { executeNextStep } = await import('./workflowEngine.js')
    await executeNextStep(executionId, step.nextStepId)
    return
  }
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: 'completed', completedAt: new Date() },
  }).catch(() => {})
}

// A5: pré-checagem central de governança antes de enfileirar envios.
//   - opt_out / blacklist / lead_not_found → bloqueio definitivo (step.failed)
//   - silence_window / frequency_cap       → defer (job entra na fila com delay)
async function enforceGovernance(
  leadId: number,
  channel: Channel,
  stepExecId: number,
): Promise<{ allow: true; delayMs: number } | { allow: false }> {
  const result = await canSendNow(leadId, channel)
  if (result.ok) return { allow: true, delayMs: 0 }

  const hardBlock =
    result.reason === 'opt_out' || result.reason === 'blacklist' || result.reason === 'lead_not_found'

  if (hardBlock) {
    await prisma.workflowStepExecution.update({
      where: { id: stepExecId },
      data: {
        status: 'failed',
        error: `Bloqueado por governança: ${result.reason}${result.details ? ` — ${result.details}` : ''}`,
        completedAt: new Date(),
      },
    })
    return { allow: false }
  }

  // silence_window / frequency_cap → defer.
  const delayMs = result.retryAt ? Math.max(0, result.retryAt.getTime() - Date.now()) : 0
  return { allow: true, delayMs }
}

interface ActionConfig {
  actionType: string
  // send_whatsapp / send_sms
  message?: string
  templateId?: number // referência opcional a MessageTemplate (id)
  // send_whatsapp via API Oficial (Cloud API): quando há conexão ativa, o disparo
  // para lead "frio" (fora da janela de 24h) tem de ser um template HSM aprovado.
  // cloudTemplateId → CloudApiTemplate; templateParams resolve {{1}}, {{2}}, ... na
  // ordem, a partir de campos do lead / customFields / valor fixo.
  cloudTemplateId?: number
  // `fallback`: texto usado quando o campo do lead está vazio — a Meta rejeita o
  // disparo inteiro se algum parâmetro chegar em branco (erro 131008).
  templateParams?: Array<{ type: 'lead_field' | 'custom_field' | 'fixed'; value: string; fallback?: string }>
  // send_email
  subject?: string
  body?: string
  to?: string
  // change_stage
  stageKey?: string
  funnelId?: number
  // add_tag / remove_tag
  tagName?: string
  // create_task
  title?: string
  taskType?: string
  description?: string
  // create_task — prazo e responsável (módulo Resumo). Ausentes = vence agora,
  // dono é o responsável pelo lead (comportamento anterior ao módulo).
  dueMode?: string // immediate | hours | days | business_days
  dueValue?: number
  assigneeMode?: string // lead_owner | team | user | round_robin | creator
  assigneeUserId?: number | null
  assigneeTeamId?: number | null
  templateCode?: string | null
  // set_summary
  code?: string
  note?: string
  lossReasonId?: number | null
  // webhook
  url?: string
  method?: string
  headers?: Record<string, string>
  webhookBody?: Record<string, any>
  // assignToTeam / transferToTeam
  teamId?: number
  // assignToUser
  userId?: number
  // transferToTeam
  reason?: string
  // notify_operator (aviso interno ao operador/setor responsável)
  waTemplateId?: number
  emailTemplateId?: number
  // set_campaign
  campaignName?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}

function describeAssignment(
  user: { name?: string | null; email?: string | null } | null,
  team: { name?: string | null } | null,
): string {
  const userPart = user ? (user.name || user.email || 'operador') : 'fila'
  const teamPart = team?.name || 'sem setor'
  return `${userPart} / ${teamPart}`
}

// Resolve variáveis no texto. Aceita {{nome}}, {{empresa}}, {{whatsapp}}, {{email}},
// {{segmento}}, {{cidade}}, {{status}} (do lead) e qualquer chave do triggerData
// (payload do evento que disparou o workflow). Permite chaves aninhadas com
// notação de ponto (ex: {{enrollment.candidateCode}}, {{document.reviewNote}}).
export function resolveVariables(text: string, lead: any, triggerData: any = {}): string {
  if (!text) return ''
  // Achata uma única camada do triggerData pra acesso direto: {{candidateCode}}.
  const flat: Record<string, any> = {
    nome: lead?.nome || '',
    empresa: lead?.empresa || '',
    whatsapp: lead?.whatsapp || '',
    email: lead?.email || '',
    segmento: lead?.segmento || '',
    cidade: lead?.cidade || '',
    status: lead?.status || '',
    data_hoje: new Date().toLocaleDateString('pt-BR'),
  }
  // Trigger payload pode vir como { event, payload } (formato do workflowEngine)
  // ou direto. Suportamos ambos.
  const root = triggerData?.payload && typeof triggerData.payload === 'object' ? triggerData.payload : triggerData
  if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (v !== null && v !== undefined && (typeof v !== 'object' || v instanceof Date)) {
        flat[k] = v instanceof Date ? v.toLocaleDateString('pt-BR') : v
      }
    }
  }
  // Blocos {{#x}}…{{/x}} / {{^x}}…{{/x}} / listas (mesma regra dos Modelos do Sistema).
  const comBlocos = aplicarBlocos(String(text), { ...(root && typeof root === 'object' ? root : {}), ...flat })
  // Substitui {{path.to.value}} suportando 1 nível de aninhamento.
  return comBlocos.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const k = String(key).trim()
    if (k in flat) return String(flat[k] ?? '')
    if (k.includes('.')) {
      const [a, b] = k.split('.')
      const obj = (root as any)?.[a]
      if (obj && typeof obj === 'object' && b in obj) return String(obj[b] ?? '')
    }
    return ''
  })
}

/** Rótulo legível da origem do lead captado ({{origem}} nos modelos). */
const ROTULO_ORIGEM: Record<string, string> = {
  formulario: 'Formulário',
  webhook: 'Webhook / integração',
  meta_lead_ads: 'Anúncio (Meta Lead Ads)',
  chat_web: 'Chat do site',
  chatbot: 'Chatbot',
}

/**
 * Variáveis que todo modelo de fluxo pode usar, além das do lead e do evento:
 * {{marca}} (nome do dono da instalação), {{funil}}, {{etapa_nome}} e
 * {{link_lead}}. O payload do evento tem precedência — se ele já traz uma
 * chave com o mesmo nome, vale a dele.
 */
export async function comVariaveisGlobais(triggerData: any, lead: any): Promise<any> {
  const { getBranding } = await import('../lib/branding.js')
  const { urlNoPainel } = await import('../lib/appUrl.js')
  const marca = (await getBranding().catch(() => null))?.brandName || ''
  let funil = ''
  let etapa = ''
  if (lead?.funnelId) {
    const f = await prisma.funnel.findUnique({ where: { id: lead.funnelId }, select: { name: true } }).catch(() => null)
    funil = f?.name || ''
    if (lead.status) {
      const st = await prisma.stage.findFirst({ where: { funnelId: lead.funnelId, key: lead.status }, select: { name: true } }).catch(() => null)
      etapa = st?.name || lead.status
    }
  }
  const extras: Record<string, string> = {
    marca,
    funil,
    etapa_nome: etapa,
    link_lead: lead?.id ? urlNoPainel(`/app/leads/${lead.id}`) || '' : '',
  }
  const raiz = triggerData?.payload && typeof triggerData.payload === 'object' ? triggerData.payload : null
  if (raiz) {
    const origem = typeof raiz.origem === 'string' ? (ROTULO_ORIGEM[raiz.origem] || raiz.origem) : undefined
    return { ...triggerData, payload: { ...extras, ...raiz, ...(origem !== undefined ? { origem } : {}) } }
  }
  return { ...extras, ...(triggerData || {}) }
}

export async function dispatchAction(
  config: ActionConfig,
  executionId: number,
  stepId: number,
  leadId: number,
  triggerData: any = {},
): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new Error(`Lead ${leadId} não encontrado`)
  triggerData = await comVariaveisGlobais(triggerData, lead)

  // Criar step execution
  const stepExec = await prisma.workflowStepExecution.create({
    data: {
      executionId,
      stepId,
      status: 'running',
      startedAt: new Date(),
    }
  })

  switch (config.actionType) {
    case 'send_whatsapp': {
      // Há conexão Cloud API (API Oficial) ativa? Se sim e o step tem template HSM
      // configurado, o disparo sai pela API oficial como TEMPLATE (obrigatório fora
      // da janela de 24h). Sem conexão ativa OU sem cloudTemplateId, mantém o envio
      // por texto livre via Evolution (comportamento legado do QR Code).
      // Ter QUALQUER conexão ativa decide o caminho (API oficial × Evolution);
      // o número de saída é escolhido mais abaixo, pela conta do modelo.
      const temCloudAtiva = await prisma.cloudApiConnection.findFirst({
        where: { active: true },
        select: { id: true },
      })

      if (temCloudAtiva && config.cloudTemplateId) {
        const hsm = await prisma.cloudApiTemplate.findUnique({ where: { id: config.cloudTemplateId } })
        if (!hsm) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExec.id },
            data: { status: 'failed', error: `Template HSM ${config.cloudTemplateId} não encontrado`, completedAt: new Date() }
          })
          return
        }
        if (hsm.status !== 'APPROVED') {
          await prisma.workflowStepExecution.update({
            where: { id: stepExec.id },
            data: { status: 'failed', error: `Template HSM "${hsm.name}" não está aprovado (status ${hsm.status})`, completedAt: new Date() }
          })
          return
        }
        // O número de saída é o da CONTA (WABA) do modelo. Pegar "a primeira
        // conexão ativa" fazia o fluxo mandar o modelo de uma empresa pelo
        // número da outra, e a Meta recusava cada disparo com 132001 ("template
        // não existe") — falha silenciosa, só visível no histórico do passo.
        const cloudConn = await prisma.cloudApiConnection.findFirst({
          where: { active: true, wabaId: hsm.wabaId },
          orderBy: ORDEM_CONEXAO_PADRAO,
          select: { id: true, wabaId: true },
        })
        if (!cloudConn) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExec.id },
            data: {
              status: 'failed',
              error: `Nenhum número ativo na conta do modelo "${hsm.name}" (WABA ${hsm.wabaId})`,
              completedAt: new Date(),
            },
          })
          return
        }

        // Resolve os parâmetros posicionais ({{1}}, {{2}}, ...) a partir do lead.
        //
        // A Meta REJEITA o disparo inteiro (131008 "Parameter of type text is
        // missing text value") quando qualquer parâmetro chega vazio — e chega
        // vazio sempre que o lead não tem o campo (ex.: leads de Lead Ads sem o
        // nome do aluno). Cada parâmetro pode declarar um `fallback`; sem ele,
        // usamos um texto neutro para não perder a mensagem por um campo em
        // branco. Também colapsamos quebras de linha e espaços múltiplos, que a
        // Cloud API recusa dentro de parâmetros (132000/131008).
        // Último recurso para parâmetro vazio: modelo `hsm_parametro_vazio` (Modelos).
        // A Meta recusa o disparo com parâmetro em branco.
        const { textoDoSistema } = await import('./modelosDoSistema.js')
        const reservaHsm = await textoDoSistema('hsm_parametro_vazio')
        const values = (config.templateParams || []).map((p) => {
          let raw = ''
          if (p.type === 'fixed') {
            raw = p.value || ''
          } else if (p.type === 'custom_field') {
            const cf = (lead.customFields || {}) as Record<string, unknown>
            raw = cf[p.value] != null ? String(cf[p.value]) : ''
          } else {
            const v = (lead as any)[p.value]
            raw = v != null && typeof v !== 'object' ? String(v) : ''
          }
          const clean = raw.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
          if (clean) return clean
          const fb = (p.fallback || '').replace(/[\r\n\t]+/g, ' ').trim()
          return fb || reservaHsm
        })
        // Templates nomeados ({{nome}}) exigem `parameter_name` em cada parâmetro; a
        // configuração do fluxo é uma lista ordenada, então casamos posição a posição
        // com os tokens do template aprovado. Sem isto, a Meta recusa com #132000 —
        // e só templates posicionais ({{1}}) funcionariam nos fluxos.
        const { tokens, named } = templateBodyTokens(hsm.components)
        const components = values.length
          ? [{
            type: 'body',
            parameters: values.map((text, i) => {
              const p: Record<string, unknown> = { type: 'text', text }
              if (named && tokens[i]) p.parameter_name = tokens[i]
              return p
            }),
          }]
          : []

        const gov = await enforceGovernance(leadId, 'whatsapp', stepExec.id)
        if (!gov.allow) return
        const job = await queues.whatsapp.add('send', {
          leadId,
          stepExecutionId: stepExec.id,
          cloudTemplate: {
            connectionId: cloudConn.id,
            name: hsm.name,
            language: hsm.language,
            components,
          },
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          delay: gov.delayMs,
        })
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { jobId: job.id }
        })
        break
      }

      // ─── Caminho legado: texto livre via Evolution ───
      // Resolve template (se templateId) ou usa message inline (fallback).
      let message = config.message || ''
      if (config.templateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: config.templateId } })
        if (!tpl) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExec.id },
            data: { status: 'failed', error: `Template ${config.templateId} não encontrado`, completedAt: new Date() }
          })
          await finalizarPasso(executionId, stepId, { falhou: true })
          return
        }
        // bumpa usageCount (auditoria); silencia falha
        prisma.messageTemplate.update({ where: { id: tpl.id }, data: { usageCount: { increment: 1 } } }).catch(() => {})
        message = tpl.body || ''
      }
      message = resolveVariables(message, lead, triggerData)
      if (!message.trim()) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'Mensagem vazia', completedAt: new Date() }
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }
      // Rede de segurança contra envio repetido: o mesmo texto para o mesmo
      // lead, saindo de automação, só uma vez a cada 10 min — venha de onde
      // vier a execução duplicada. SET NX é atômico, então duas execuções que
      // acordam no mesmo instante não passam juntas (consultar a tabela de
      // mensagens não serviria: a 1ª ainda não foi gravada quando a 2ª olha).
      // Redis fora do ar não bloqueia o envio. Barrado = execução duplicada, encerra.
      const chaveEnvio = `wf:envio:${leadId}:${createHash('sha1').update(message.trim()).digest('hex')}`
      const primeiraVez = await redis.set(chaveEnvio, String(stepExec.id), 'EX', 600, 'NX').catch(() => 'OK')
      if (primeiraVez !== 'OK') {
        console.warn(`[Workflow] envio repetido bloqueado: lead #${leadId}, execução #${executionId}, passo #${stepId}`)
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'skipped', error: 'Mesma mensagem já enviada a este lead nos últimos 10 min', completedAt: new Date() }
        })
        await finalizarPasso(executionId, stepId, { encerrar: true })
        return
      }
      const gov = await enforceGovernance(leadId, 'whatsapp', stepExec.id)
      if (!gov.allow) return
      const job = await queues.whatsapp.add('send', {
        leadId,
        message,
        stepExecutionId: stepExec.id,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        delay: gov.delayMs,
      })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { jobId: job.id }
      })
      break
    }

    case 'send_email': {
      // Resolve template (se templateId) ou usa subject/body inline (fallback).
      let subject = config.subject || ''
      let body = config.body || ''
      if (config.templateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: config.templateId } })
        if (!tpl) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExec.id },
            data: { status: 'failed', error: `Template ${config.templateId} não encontrado`, completedAt: new Date() }
          })
          await finalizarPasso(executionId, stepId, { falhou: true })
          return
        }
        prisma.messageTemplate.update({ where: { id: tpl.id }, data: { usageCount: { increment: 1 } } }).catch(() => {})
        subject = tpl.subject || subject
        // bodyHtml tem prioridade pra email; cai no body texto se vazio.
        body = tpl.bodyHtml || tpl.body || body
      }
      subject = resolveVariables(subject, lead, triggerData)
      body = resolveVariables(body, lead, triggerData)
      const gov = await enforceGovernance(leadId, 'email', stepExec.id)
      if (!gov.allow) return
      // A7: rodapé com link da central de preferências (LGPD).
      body = await appendPreferencesLink(body, leadId, looksLikeHtml(body) ? 'html' : 'text')
      const job = await queues.email.add('send', {
        leadId,
        subject,
        body,
        to: config.to,
        stepExecutionId: stepExec.id,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        delay: gov.delayMs,
      })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { jobId: job.id }
      })
      break
    }

    case 'send_sms': {
      // SMS via provider configurado em Settings (atualmente Comtele).
      // Mesmo fluxo de queue do send_whatsapp/send_email.
      let message = config.message || ''
      if (config.templateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: config.templateId } })
        if (!tpl) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExec.id },
            data: { status: 'failed', error: `Template ${config.templateId} não encontrado`, completedAt: new Date() }
          })
          await finalizarPasso(executionId, stepId, { falhou: true })
          return
        }
        prisma.messageTemplate.update({ where: { id: tpl.id }, data: { usageCount: { increment: 1 } } }).catch(() => {})
        message = tpl.body || ''
      }
      message = resolveVariables(message, lead, triggerData)
      if (!message.trim()) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'Mensagem vazia', completedAt: new Date() }
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }
      const gov = await enforceGovernance(leadId, 'sms', stepExec.id)
      if (!gov.allow) return
      const job = await queues.sms.add('send', {
        leadId,
        message,
        stepExecutionId: stepExec.id,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        delay: gov.delayMs,
      })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { jobId: job.id }
      })
      break
    }

    case 'change_stage': {
      // Executa direto (operação rápida, sem fila). Passa pelo helper central em
      // vez de um `lead.update` cru: era só o update + logEvent, então a passagem
      // não entrava em LeadStageMovement e o Relatório de Funil não enxergava
      // nenhuma etapa movida por automação. O helper também emite
      // lead.stage_changed (permitindo encadear fluxos) e invalida sugestões
      // pendentes da Jornada IA que descrevem a etapa já vencida.
      const { moveLeadStage } = await import('./leadStageMove.js')
      const movimento = await moveLeadStage({
        leadId,
        toStageKey: config.stageKey,
        toFunnelId: config.funnelId ?? null,
        source: 'workflow',
        reason: 'Etapa alterada por workflow',
        metadata: { executionId, stepId },
      })

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          result: {
            oldStatus: movimento.fromStageKey,
            newStatus: movimento.toStageKey,
            // false = lead já estava nesta etapa/funil; o helper é idempotente.
            moved: movimento.moved,
          },
        }
      })

      await finalizarPasso(executionId, stepId)
      break
    }

    case 'add_tag': {
      if (!config.tagName) break
      // Buscar ou criar tag
      let tag = await prisma.tag.findFirst({ where: { name: config.tagName } })
      if (!tag) {
        tag = await prisma.tag.create({ data: { name: config.tagName, color: '#1a73e8' } })
      }
      // Verificar se já tem
      const exists = await prisma.leadTag.findUnique({
        where: { leadId_tagId: { leadId, tagId: tag.id } }
      })
      if (!exists) {
        await prisma.leadTag.create({ data: { leadId, tagId: tag.id } })
        logEvent({
          leadId,
          type: EVENT_TYPES.TAG_ADDED,
          category: 'lifecycle',
          title: `Tag "${config.tagName}" adicionada por workflow`,
          source: 'workflow',
          actorType: 'system',
          newValue: config.tagName,
          metadata: { executionId },
        })
      }

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', completedAt: new Date(), result: { tagName: config.tagName } }
      })

      await finalizarPasso(executionId, stepId)
      break
    }

    case 'remove_tag': {
      if (!config.tagName) break
      const tag = await prisma.tag.findFirst({ where: { name: config.tagName } })
      if (tag) {
        await prisma.leadTag.deleteMany({ where: { leadId, tagId: tag.id } })
        logEvent({
          leadId,
          type: EVENT_TYPES.TAG_REMOVED,
          category: 'lifecycle',
          title: `Tag "${config.tagName}" removida por workflow`,
          source: 'workflow',
          actorType: 'system',
          oldValue: config.tagName,
          metadata: { executionId },
        })
      }

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', completedAt: new Date() }
      })

      await finalizarPasso(executionId, stepId)
      break
    }

    case 'create_task': {
      const job = await queues.internalTask.add('create', {
        leadId,
        title: resolveVariables(config.title || 'Tarefa do workflow', lead),
        type: config.taskType || 'task',
        description: config.description ? resolveVariables(config.description, lead) : undefined,
        // Prazo e responsável (módulo Resumo). Omitidos = comportamento antigo:
        // vence agora, dono é o responsável pelo lead.
        dueMode: config.dueMode || 'immediate',
        dueValue: config.dueValue ?? 0,
        assigneeMode: config.assigneeMode || 'lead_owner',
        assigneeUserId: config.assigneeUserId ?? null,
        assigneeTeamId: config.assigneeTeamId ?? null,
        templateCode: config.templateCode || null,
        stepExecutionId: stepExec.id,
      }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { jobId: job.id }
      })
      break
    }

    case 'assign_to_team': {
      if (!config.teamId) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'teamId não informado', completedAt: new Date() },
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }
      const team = await prisma.team.findUnique({
        where: { id: config.teamId },
        select: { id: true, name: true, active: true },
      })
      if (!team || !team.active) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: `Equipe ${config.teamId} não existe ou está inativa`, completedAt: new Date() },
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }

      // Se já tem operador atribuído mas ele não é membro da nova equipe, libera
      // (mantém o assignedUserId apenas quando faz sentido na nova equipe).
      let nextAssignedUserId = lead.assignedUserId
      if (lead.assignedUserId && lead.teamId !== team.id) {
        const isMember = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: team.id, userId: lead.assignedUserId } },
          select: { id: true },
        })
        if (!isMember) nextAssignedUserId = null
      }

      const oldTeam = lead.teamId
        ? await prisma.team.findUnique({ where: { id: lead.teamId }, select: { name: true } })
        : null
      const oldUser = lead.assignedUserId
        ? await prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { id: true, name: true, email: true } })
        : null
      const newUser = nextAssignedUserId
        ? await prisma.user.findUnique({ where: { id: nextAssignedUserId }, select: { id: true, name: true, email: true } })
        : null

      const oldLabel = describeAssignment(oldUser, oldTeam)
      const newLabel = describeAssignment(newUser, team)

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          teamId: team.id,
          assignedUserId: nextAssignedUserId,
          assignedAt: new Date(),
        },
      })

      logEvent({
        leadId,
        type: EVENT_TYPES.OPERATOR_ASSIGNED,
        category: 'operator',
        title: `Lead atribuído ao setor ${team.name} por workflow`,
        source: 'workflow',
        actorType: 'system',
        oldValue: oldLabel,
        newValue: newLabel,
        metadata: {
          executionId,
          previousAssignedUserId: lead.assignedUserId,
          previousTeamId: lead.teamId,
          newAssignedUserId: nextAssignedUserId,
          newTeamId: team.id,
        },
      })

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          result: { teamId: team.id, teamName: team.name, releasedUser: lead.assignedUserId !== nextAssignedUserId },
        },
      })

      await finalizarPasso(executionId, stepId)
      break
    }

    case 'assign_to_user': {
      if (!config.userId) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'userId não informado', completedAt: new Date() },
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }
      const targetUser = await prisma.user.findUnique({
        where: { id: config.userId },
        select: { id: true, name: true, email: true, active: true },
      })
      if (!targetUser || !targetUser.active) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: `Operador ${config.userId} não existe ou está inativo`, completedAt: new Date() },
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }

      // Coerência de equipe: se a equipe atual não inclui o operador, ajusta
      // para a primeira equipe que ele integra. Sem nenhuma equipe, falha.
      let nextTeamId = lead.teamId
      if (nextTeamId) {
        const isMember = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: nextTeamId, userId: targetUser.id } },
          select: { id: true },
        })
        if (!isMember) nextTeamId = null
      }
      if (!nextTeamId) {
        const firstMembership = await prisma.teamMember.findFirst({
          where: { userId: targetUser.id, team: { active: true } },
          orderBy: { teamId: 'asc' },
          select: { teamId: true },
        })
        if (firstMembership) nextTeamId = firstMembership.teamId
      }
      if (!nextTeamId) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'Operador não pertence a nenhuma equipe ativa', completedAt: new Date() },
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }

      const newTeam = await prisma.team.findUnique({ where: { id: nextTeamId }, select: { id: true, name: true } })
      const oldTeam = lead.teamId
        ? await prisma.team.findUnique({ where: { id: lead.teamId }, select: { name: true } })
        : null
      const oldUser = lead.assignedUserId
        ? await prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { id: true, name: true, email: true } })
        : null

      const oldLabel = describeAssignment(oldUser, oldTeam)
      const newLabel = describeAssignment(targetUser, newTeam)

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          assignedUserId: targetUser.id,
          teamId: nextTeamId,
          assignedAt: new Date(),
        },
      })

      logEvent({
        leadId,
        type: EVENT_TYPES.OPERATOR_ASSIGNED,
        category: 'operator',
        title: `Lead atribuído a ${targetUser.name || targetUser.email} por workflow`,
        source: 'workflow',
        actorType: 'system',
        oldValue: oldLabel,
        newValue: newLabel,
        metadata: {
          executionId,
          previousAssignedUserId: lead.assignedUserId,
          previousTeamId: lead.teamId,
          newAssignedUserId: targetUser.id,
          newTeamId: nextTeamId,
        },
      })

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          result: { userId: targetUser.id, teamId: nextTeamId },
        },
      })

      await finalizarPasso(executionId, stepId)
      break
    }

    case 'transfer_to_team': {
      if (!config.teamId) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'teamId não informado', completedAt: new Date() },
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }
      const team = await prisma.team.findUnique({
        where: { id: config.teamId },
        select: { id: true, name: true, active: true },
      })
      if (!team || !team.active) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: `Equipe ${config.teamId} não existe ou está inativa`, completedAt: new Date() },
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }

      // Transferência sempre devolve o lead para a fila da nova equipe (libera operador).
      const oldTeam = lead.teamId
        ? await prisma.team.findUnique({ where: { id: lead.teamId }, select: { name: true } })
        : null
      const oldUser = lead.assignedUserId
        ? await prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { id: true, name: true, email: true } })
        : null

      const oldLabel = describeAssignment(oldUser, oldTeam)
      const newLabel = describeAssignment(null, team)

      const reason = config.reason ? resolveVariables(config.reason, lead, triggerData) : undefined

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          teamId: team.id,
          assignedUserId: null,
          assignedAt: new Date(),
        },
      })

      logEvent({
        leadId,
        type: EVENT_TYPES.OPERATOR_ASSIGNED,
        category: 'operator',
        title: `Lead transferido para setor ${team.name} por workflow`,
        source: 'workflow',
        actorType: 'system',
        oldValue: oldLabel,
        newValue: newLabel,
        description: reason,
        metadata: {
          executionId,
          previousAssignedUserId: lead.assignedUserId,
          previousTeamId: lead.teamId,
          newAssignedUserId: null,
          newTeamId: team.id,
          transfer: true,
        },
      })

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          result: { teamId: team.id, teamName: team.name, reason: reason ?? null },
        },
      })

      await finalizarPasso(executionId, stepId)
      break
    }

    case 'webhook': {
      const webhookBody = config.webhookBody || {
        leadId: lead.id,
        nome: lead.nome,
        empresa: lead.empresa,
        whatsapp: lead.whatsapp,
        email: lead.email,
        status: lead.status,
        executionId,
      }
      const job = await queues.webhook.add('call', {
        url: config.url,
        method: config.method || 'POST',
        headers: config.headers || {},
        body: webhookBody,
        leadId,
        stepExecutionId: stepExec.id,
      }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30000 },
      })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { jobId: job.id }
      })
      break
    }

    case 'set_summary': {
      // Aplica um Resumo pelo motor. NÃO duplica os efeitos aqui: mover etapa,
      // criar atividade e marcar ganho/perdido saem todos de applyStatusSummary,
      // que é o único lugar onde essas regras vivem.
      if (!config.code) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'code do resumo não informado', completedAt: new Date() },
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }
      try {
        const { applyStatusSummary } = await import('./statusSummaryEngine.js')
        const result = await applyStatusSummary({
          leadId,
          code: String(config.code).trim().toUpperCase(),
          source: 'workflow',
          note: config.note ? resolveVariables(config.note, lead) : undefined,
          lossReasonId: config.lossReasonId ?? null,
          // Workflow não tem operador na frente pra corrigir campo faltando: as
          // travas de governança são de painel, aqui elas só travariam a automação.
          skipGuards: true,
        })
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'completed', result: result as never, completedAt: new Date() },
        })
      } catch (e) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: (e as Error).message, completedAt: new Date() },
        })
        await finalizarPasso(executionId, stepId, { falhou: true })
        return
      }
      await finalizarPasso(executionId, stepId)
      break
    }

    case 'resume_bot': {
      // Devolve a conversa ao chatbot antes de uma retomada automática. Sem isto, o
      // fluxo cutuca um lead que o bot está proibido de atender (a pausa por takeover
      // é definitiva): a pessoa responde e ninguém do outro lado responde.
      const minutes = Number((config as any).skipIfRecentOperatorMin ?? 24 * 60)
      const since = new Date(Date.now() - minutes * 60000)
      const recentOutbound = await prisma.message.findFirst({
        where: { leadId, fromMe: true, isInternal: false, createdAt: { gt: since } },
        select: { id: true },
      })
      if (recentOutbound) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'skipped', result: { reason: 'atendimento humano recente' }, completedAt: new Date() },
        })
        await finalizarPasso(executionId, stepId, { encerrar: true })
        return
      }
      const { resumeBot } = await import('./botTakeover.js')
      const resumed = await resumeBot(leadId, { userId: null, userName: 'Fluxo automático' })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', result: { resumed }, completedAt: new Date() },
      })
      await finalizarPasso(executionId, stepId)
      return
    }

    case 'notify_operator': {
      // Aviso de NOVO LEAD à equipe (não vai ao lead). Envia direto (síncrono), sem
      // governança/opt-out. Destinos GERAIS configuráveis em Configurações › Empresa ›
      // Dados de Notificações (listas de e-mails e WhatsApps; fallback p/ env legada).
      // Cópia opcional para os agentes ativos (toggle ccAgents). Texto vem de
      // MessageTemplate (editável).
      const { getNotificationTargets, sendEmailGeneric, getEmailConfig, getFromAddress } = await import('./notify.js')
      const targets = await getNotificationTargets()
      const generalPhones = targets.whatsapps
      const generalEmail = targets.emails.join(', ')
      // Cópia para os e-mails dos agentes ativos, quando habilitado.
      let ccList = ''
      if (targets.ccAgents) {
        const agents = await prisma.user.findMany({ where: { active: true, isAgent: true }, select: { email: true } })
        ccList = Array.from(new Set(agents.map((a) => a.email).filter(Boolean))).join(', ')
      }
      // Nome do operador responsável (apenas para a variável {{operador}} do template).
      let opName = ''
      if (lead.assignedUserId) {
        const u = await prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { name: true } })
        opName = u?.name || ''
      }
      const pl = triggerData?.payload || {}
      const origem = pl.origem || pl.metadata?.formName || pl.metadata?.formId || ''
      const enriched = { ...triggerData, payload: { ...pl, operador: opName, origem, etapa: pl.etapa_nome || lead.status || '' } }

      // WhatsApp → todos os números gerais
      if (generalPhones.length > 0 && config.waTemplateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: config.waTemplateId } })
        const body = resolveVariables(tpl?.body || '', lead, enriched)
        if (body.trim()) {
          // Aviso interno → Evolution (número conectado da instância). Não usar
          // getDefaultProvider (pode cair na Cloud API, que não entrega texto
          // livre a número fora da janela 24h).
          const { createEvolutionProvider } = await import('./whatsappProvider.js')
          const provider = createEvolutionProvider()
          const { registrarSaidaParaGrupo } = await import('./groupOutboundLog.js')
          for (const phone of generalPhones) {
            try {
              const r = await provider.sendText(phone, body)
              // Destino é grupo acompanhado no painel: a bolha entra na conversa.
              // Sem isso o aviso existia só no WhatsApp, e quem respondesse
              // citando ele chegava aqui sem o trecho citado.
              await registrarSaidaParaGrupo({
                destino: phone, texto: body, externalId: r?.messageId ?? null,
                instanceName: (provider as any).instanceName ?? null,
              })
            } catch (e: any) { console.warn(`[notify_operator] WhatsApp falhou (${phone}):`, e?.message) }
          }
          prisma.messageTemplate.update({ where: { id: config.waTemplateId }, data: { usageCount: { increment: 1 } } }).catch(() => {})
        }
      }
      // E-mail → destino geral + cópia aos agentes
      const email = generalEmail
      if (email && config.emailTemplateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: config.emailTemplateId } })
        const { decodeHtmlIfEscaped } = await import('../lib/interpolate.js')
        const subject = resolveVariables(tpl?.subject || tpl?.name || '', lead, enriched)
        const html = resolveVariables(decodeHtmlIfEscaped(tpl?.bodyHtml) || tpl?.body || '', lead, enriched)
        if (html.trim()) {
          try {
            const cfg = await getEmailConfig()
            await sendEmailGeneric({ from: getFromAddress(cfg), to: email, ...(ccList ? { cc: ccList } : {}), subject, html })
            prisma.messageTemplate.update({ where: { id: config.emailTemplateId }, data: { usageCount: { increment: 1 } } }).catch(() => {})
          } catch (e: any) { console.warn('[notify_operator] e-mail falhou:', e?.message) }
        }
      }
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', completedAt: new Date(), result: { phone: generalPhones.join(', ') || null, email: email || null, cc: ccList || null } },
      })
      await finalizarPasso(executionId, stepId)
      break
    }

    case 'qualify_lead': {
      // Promove "só conversa" (funnelId/qualifiedAt nulos) para lead qualificado —
      // sem isso o Kanban e o Relatório de Funil (que filtram por qualifiedAt
      // != null) não enxergam o que o fluxo acabou de mover pra etapa.
      const { qualifyLead } = await import('./leadQualification.js')
      const resultado = await qualifyLead(leadId, { source: 'workflow' })

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', completedAt: new Date(), result: { qualified: resultado.qualified } },
      })

      await finalizarPasso(executionId, stepId)
      break
    }

    case 'set_campaign': {
      // Rotula a campanha/origem do lead (campo "Campanha" da aba Rastreamento).
      // Meta CTWA não manda nome de campanha amigável no referral — só o
      // fluxo (por reconhecer o texto do anúncio) sabe dizer qual é.
      const data: { campaignName?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string } = {}
      if (config.campaignName) data.campaignName = config.campaignName
      if (config.utmSource) data.utmSource = config.utmSource
      if (config.utmMedium) data.utmMedium = config.utmMedium
      if (config.utmCampaign) data.utmCampaign = config.utmCampaign

      if (Object.keys(data).length > 0) {
        await prisma.lead.update({ where: { id: leadId }, data })
        logEvent({
          leadId,
          type: EVENT_TYPES.LEAD_EDITED,
          category: 'lifecycle',
          title: `Campanha definida por workflow: "${config.campaignName || ''}"`,
          source: 'workflow',
          actorType: 'system',
          newValue: config.campaignName,
          metadata: { executionId },
        })
      }

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', completedAt: new Date(), result: data },
      })

      await finalizarPasso(executionId, stepId)
      break
    }

    default:
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'failed', error: `Action type desconhecido: ${config.actionType}`, completedAt: new Date() }
      })
      await finalizarPasso(executionId, stepId, { falhou: true })
  }
}
