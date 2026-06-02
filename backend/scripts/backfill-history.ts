// scripts/backfill-history.ts
// Popula o histórico retroativamente para leads existentes antes da feature
// Uso: npx tsx scripts/backfill-history.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function backfill() {
  console.log('Backfilling lead history...')

  const leads = await prisma.lead.findMany({
    include: { messages: { orderBy: { timestamp: 'asc' } } },
    orderBy: { createdAt: 'asc' }
  })

  let totalEvents = 0

  for (const lead of leads) {
    // Skip leads that already have events
    const existingCount = await prisma.leadEvent.count({ where: { leadId: lead.id } })
    if (existingCount > 0) {
      console.log(`  Lead #${lead.id} (${lead.empresa}) - já tem ${existingCount} eventos, pulando...`)
      continue
    }

    const events: any[] = []
    const fd = (lead.formData || {}) as any
    const source = fd._source || 'unknown'
    const channel = source === 'whatsapp' ? 'whatsapp' : 'web_form'

    // 1. Lead criado
    events.push({
      leadId: lead.id,
      type: 'lead_created',
      category: 'lifecycle',
      title: `Lead criado via ${channel === 'whatsapp' ? 'WhatsApp' : 'formulário/chat web'}`,
      channel,
      source: source === 'whatsapp' ? 'webhook' : 'form',
      actorType: 'lead',
      description: `Lead "${lead.empresa || 'sem nome'}" (${lead.whatsapp || 'sem WhatsApp'}) entrou no sistema`,
      metadata: { empresa: lead.empresa, whatsapp: lead.whatsapp, email: lead.email, backfilled: true },
      createdAt: lead.createdAt,
    })

    // 2. Diagnóstico iniciado (se tem chatMessages)
    if (fd._chatMessages && fd._chatMessages.length > 0) {
      events.push({
        leadId: lead.id,
        type: 'diagnosis_started',
        category: 'lifecycle',
        title: `Diagnóstico iniciado via ${channel === 'whatsapp' ? 'WhatsApp' : 'chat web'}`,
        channel,
        source: 'chatbot',
        actorType: 'lead',
        createdAt: lead.createdAt,
      })
    }

    // 3. Mensagens recebidas/enviadas
    for (const msg of lead.messages) {
      events.push({
        leadId: lead.id,
        type: msg.fromMe ? (msg.isInternal ? 'message_internal' : 'message_sent') : 'message_received',
        category: 'communication',
        title: msg.fromMe
          ? (msg.isInternal ? 'Nota interna adicionada' : `Mensagem enviada${msg.senderName ? ' por ' + msg.senderName : ''}`)
          : 'Mensagem recebida via WhatsApp',
        channel: msg.isInternal ? 'system' : 'whatsapp',
        source: msg.fromMe ? (msg.senderName === 'Beyond AI' ? 'chatbot' : 'panel') : 'webhook',
        actorType: msg.fromMe ? (msg.senderName === 'Beyond AI' ? 'ai' : 'operator') : 'lead',
        userName: msg.fromMe && msg.senderName !== 'Beyond AI' ? msg.senderName : undefined,
        description: (msg.body || '').substring(0, 150),
        metadata: { mediaType: msg.mediaType, messageId: msg.id, backfilled: true },
        createdAt: msg.timestamp || msg.createdAt,
      })
    }

    // 4. Progresso do diagnóstico (por etapa)
    if (lead.lastStep > 0) {
      for (let step = 1; step <= lead.lastStep; step++) {
        events.push({
          leadId: lead.id,
          type: 'diagnosis_progress',
          category: 'lifecycle',
          title: `Diagnóstico avançou para etapa ${step}`,
          channel,
          source: 'chatbot',
          actorType: 'lead',
          oldValue: String(step - 1),
          newValue: String(step),
          metadata: { backfilled: true },
          // Estimate time based on creation + proportional
          createdAt: new Date(lead.createdAt.getTime() + (step * 60000)),
        })
      }
    }

    // 5. Diagnóstico completo
    if (lead.completed) {
      const sc = (lead.scores || {}) as any
      events.push({
        leadId: lead.id,
        type: 'diagnosis_completed',
        category: 'lifecycle',
        title: `Diagnóstico completo via ${channel === 'whatsapp' ? 'WhatsApp' : 'chat/formulário'}`,
        channel,
        source: 'chatbot',
        actorType: 'lead',
        description: `Score: ${sc.geral || 0}/100, Maturidade: ${lead.maturidade || '–'}, Solução: ${lead.solucaoNome || '–'}`,
        metadata: { scores: lead.scores, maturidade: lead.maturidade, solucao: lead.solucaoNome, backfilled: true },
        createdAt: lead.updatedAt || lead.createdAt,
      })

      // Scores calculated
      if (sc.geral) {
        events.push({
          leadId: lead.id,
          type: 'scores_calculated',
          category: 'system',
          title: 'Scores calculados automaticamente',
          source: 'system',
          actorType: 'ai',
          metadata: { scores: lead.scores, backfilled: true },
          createdAt: lead.updatedAt || lead.createdAt,
        })
      }
    }

    // 6. Inatividade (se fechado por inatividade)
    if (fd._closedReason === 'inactivity') {
      events.push({
        leadId: lead.id,
        type: 'inactivity_closed',
        category: 'system',
        title: 'Lead fechado por inatividade',
        channel: source === 'whatsapp' ? 'whatsapp' : 'system',
        source: 'inactivity_service',
        actorType: 'system',
        description: 'Lead fechado automaticamente por inatividade',
        metadata: { closedAt: fd._closedAt, backfilled: true },
        createdAt: fd._closedAt ? new Date(fd._closedAt) : lead.updatedAt,
      })
    }

    // 7. Notificações de inatividade
    if (fd._inactivityNotifyCount > 0) {
      for (let i = 1; i <= fd._inactivityNotifyCount; i++) {
        events.push({
          leadId: lead.id,
          type: 'inactivity_notified',
          category: 'system',
          title: `Notificação de inatividade #${i} enviada`,
          channel: 'whatsapp',
          source: 'inactivity_service',
          actorType: 'system',
          metadata: { attempt: i, backfilled: true },
          createdAt: lead.inactiveNotifiedAt || lead.updatedAt,
        })
      }
    }

    // 8. AI Sentiment (se existe)
    if (lead.aiSentiment) {
      const sent = lead.aiSentiment as any
      events.push({
        leadId: lead.id,
        type: 'ai_sentiment_generated',
        category: 'system',
        title: 'Análise de sentimento IA gerada',
        source: 'panel',
        actorType: 'ai',
        description: `Probabilidade de fechamento: ${sent.probabilidade || '?'}%`,
        metadata: { probabilidade: sent.probabilidade, backfilled: true },
        createdAt: lead.updatedAt,
      })
    }

    // 9. Status diferente de NOVO (mudança de status aconteceu)
    if (lead.status !== 'NOVO') {
      events.push({
        leadId: lead.id,
        type: 'status_changed',
        category: 'lifecycle',
        title: `Status alterado: NOVO → ${lead.status}`,
        source: 'panel',
        actorType: 'operator',
        oldValue: 'NOVO',
        newValue: lead.status,
        metadata: { backfilled: true },
        createdAt: lead.updatedAt,
      })
    }

    // Insert all events
    if (events.length > 0) {
      // Prisma MySQL doesn't support createMany with skipDuplicates,
      // so insert one by one
      for (const ev of events) {
        await prisma.leadEvent.create({ data: ev })
      }
      totalEvents += events.length
      console.log(`  Lead #${lead.id} (${lead.empresa || '–'}) - ${events.length} eventos criados`)
    }
  }

  console.log(`\nBackfill concluído! ${totalEvents} eventos criados para ${leads.length} leads.`)
  await prisma.$disconnect()
}

backfill().catch(err => {
  console.error('Backfill error:', err)
  process.exit(1)
})
