// services/trash.ts — Lixeira centralizada (Trash / Recycle Bin)
// Snapshot completo antes de deletar, restauração por SUPERADMIN

import { prisma } from '../lib/prisma.js'

const TRASH_RETENTION_DAYS = 90

export type TrashEntityType =
  | 'lead'
  | 'funnel'
  | 'chatbot'
  | 'tag'
  | 'template'
  | 'form'
  | 'page'
  | 'workflow'
  | 'user'
  | 'edu_level'
  | 'edu_modality'
  | 'edu_unit'
  | 'edu_campus'
  | 'edu_course'
  | 'edu_offering'
  | 'edu_selection_process'
  | 'edu_entry_mode'

interface TrashOptions {
  entityType: TrashEntityType
  entityId: number
  entityLabel: string
  snapshot: any
  deletedBy?: number
  deletedByName?: string
  reason?: string
}

// ── Mover para lixeira ──────────────────────────
export async function moveToTrash(opts: TrashOptions) {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + TRASH_RETENTION_DAYS)

  return prisma.trashItem.create({
    data: {
      entityType: opts.entityType,
      entityId: opts.entityId,
      entityLabel: opts.entityLabel,
      snapshot: opts.snapshot,
      deletedBy: opts.deletedBy,
      deletedByName: opts.deletedByName,
      reason: opts.reason,
      expiresAt,
    },
  })
}

// ── Snapshot completo de um Lead (com relações) ──
export async function snapshotLead(id: number) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      messages: true,
      events: true,
      activities: true,
      tags: { include: { tag: true } },
      detectedSales: true,
    },
  })
  return lead
}

// ── Snapshot de múltiplos Leads ──
export async function snapshotLeads(ids: number[]) {
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids } },
    include: {
      messages: true,
      events: true,
      activities: true,
      tags: { include: { tag: true } },
      detectedSales: true,
    },
  })
  return leads
}

// ── Snapshot Funnel + stages ──
export async function snapshotFunnel(id: number) {
  return prisma.funnel.findUnique({
    where: { id },
    include: { stages: true },
  })
}

// ── Snapshot Chatbot + questions ──
export async function snapshotChatbot(id: number) {
  return prisma.chatbot.findUnique({
    where: { id },
    include: { questions: true },
  })
}

// ── Snapshot genérico (entidade simples sem relações profundas) ──
export async function snapshotEntity(type: TrashEntityType, id: number) {
  switch (type) {
    case 'tag':
      return prisma.tag.findUnique({ where: { id }, include: { leads: true } })
    case 'template':
      return prisma.messageTemplate.findUnique({ where: { id } })
    case 'form':
      return prisma.form.findUnique({ where: { id }, include: { formSubmissions: true } })
    case 'page':
      return prisma.landingPage.findUnique({ where: { id } })
    case 'workflow':
      return prisma.workflow.findUnique({ where: { id }, include: { steps: true } })
    case 'user':
      return prisma.user.findUnique({ where: { id } })
    case 'edu_level':
      return prisma.educationalLevel.findUnique({ where: { id } })
    case 'edu_modality':
      return prisma.modality.findUnique({ where: { id } })
    case 'edu_unit':
      return prisma.educationalUnit.findUnique({ where: { id } })
    case 'edu_campus':
      return prisma.campus.findUnique({ where: { id } })
    case 'edu_course':
      return prisma.course.findUnique({ where: { id } })
    case 'edu_offering':
      return prisma.courseOffering.findUnique({ where: { id }, include: { campuses: true } })
    case 'edu_selection_process':
      return prisma.selectionProcess.findUnique({ where: { id }, include: { documentRequirements: true } })
    case 'edu_entry_mode':
      return prisma.entryMode.findUnique({ where: { id }, include: { documentRequirements: true } })
    default:
      return null
  }
}

// ── Restaurar Lead ──────────────────────────────
async function restoreLead(snapshot: any) {
  const { messages, events, activities, tags, detectedSales, ...leadData } = snapshot

  // Remove campos auto-gerados que conflitam
  delete leadData.id
  delete leadData.funnel

  // Criar o lead
  const lead = await prisma.lead.create({ data: leadData })

  // Restaurar mensagens
  if (messages?.length) {
    for (const msg of messages) {
      delete msg.id
      delete msg.lead
      await prisma.message.create({ data: { ...msg, leadId: lead.id } })
    }
  }

  // Restaurar eventos
  if (events?.length) {
    for (const evt of events) {
      delete evt.id
      delete evt.lead
      await prisma.leadEvent.create({ data: { ...evt, leadId: lead.id } })
    }
  }

  // Restaurar atividades
  if (activities?.length) {
    for (const act of activities) {
      delete act.id
      delete act.lead
      await prisma.activity.create({ data: { ...act, leadId: lead.id } })
    }
  }

  // Restaurar tags (vincular tags existentes)
  if (tags?.length) {
    for (const lt of tags) {
      const tagExists = await prisma.tag.findUnique({ where: { id: lt.tagId } })
      if (tagExists) {
        await prisma.leadTag.create({ data: { leadId: lead.id, tagId: lt.tagId } }).catch(() => {})
      }
    }
  }

  // Restaurar vendas detectadas
  if (detectedSales?.length) {
    for (const sale of detectedSales) {
      delete sale.id
      delete sale.lead
      await prisma.detectedSale.create({ data: { ...sale, leadId: lead.id } })
    }
  }

  return lead
}

// ── Restaurar Funnel ──────────────────────────────
async function restoreFunnel(snapshot: any) {
  const { stages, leads, ...funnelData } = snapshot
  delete funnelData.id

  const funnel = await prisma.funnel.create({ data: funnelData })

  if (stages?.length) {
    for (const stage of stages) {
      delete stage.id
      delete stage.funnel
      await prisma.stage.create({ data: { ...stage, funnelId: funnel.id } })
    }
  }

  return funnel
}

// ── Restaurar Chatbot ──────────────────────────────
async function restoreChatbot(snapshot: any) {
  const { questions, ...chatbotData } = snapshot
  delete chatbotData.id
  delete chatbotData.funnel

  const chatbot = await prisma.chatbot.create({ data: chatbotData })

  if (questions?.length) {
    for (const q of questions) {
      delete q.id
      delete q.chatbot
      await prisma.chatQuestion.create({ data: { ...q, chatbotId: chatbot.id } })
    }
  }

  return chatbot
}

// ── Restaurar entidades simples ──────────────────
async function restoreSimpleEntity(type: TrashEntityType, snapshot: any) {
  const data = { ...snapshot }
  delete data.id

  switch (type) {
    case 'tag': {
      const { leads, ...tagData } = data
      return prisma.tag.create({ data: tagData })
    }
    case 'template':
      return prisma.messageTemplate.create({ data })
    case 'form': {
      const { formSubmissions, ...formData } = data
      return prisma.form.create({ data: formData })
    }
    case 'page':
      return prisma.landingPage.create({ data })
    case 'workflow': {
      const { steps, executions, ...wfData } = data
      const wf = await prisma.workflow.create({ data: wfData })
      if (steps?.length) {
        for (const s of steps) {
          delete s.id
          delete s.workflow
          await prisma.workflowStep.create({ data: { ...s, workflowId: wf.id } })
        }
      }
      return wf
    }
    case 'user': {
      return prisma.user.create({ data })
    }
    case 'edu_level':
      return prisma.educationalLevel.create({ data })
    case 'edu_modality':
      return prisma.modality.create({ data })
    case 'edu_unit':
      return prisma.educationalUnit.create({ data })
    case 'edu_campus':
      return prisma.campus.create({ data })
    case 'edu_course':
      return prisma.course.create({ data })
    case 'edu_offering': {
      const { campuses, ...offData } = data
      const off = await prisma.courseOffering.create({ data: offData })
      if (Array.isArray(campuses) && campuses.length) {
        for (const c of campuses) {
          await prisma.courseOfferingCampus.create({ data: { offeringId: off.id, campusId: c.campusId } }).catch(() => {})
        }
      }
      return off
    }
    case 'edu_selection_process': {
      const { documentRequirements, ...spData } = data
      const sp = await prisma.selectionProcess.create({ data: spData })
      if (Array.isArray(documentRequirements) && documentRequirements.length) {
        for (const r of documentRequirements) {
          delete r.id
          delete r.createdAt
          await prisma.selectionProcessDocumentRequirement.create({ data: { ...r, selectionProcessId: sp.id } }).catch(() => {})
        }
      }
      return sp
    }
    case 'edu_entry_mode': {
      const { documentRequirements, ...emData } = data
      const em = await prisma.entryMode.create({ data: emData })
      if (Array.isArray(documentRequirements) && documentRequirements.length) {
        for (const r of documentRequirements) {
          delete r.id
          delete r.createdAt
          await prisma.entryModeDocumentRequirement.create({ data: { ...r, entryModeId: em.id } }).catch(() => {})
        }
      }
      return em
    }
    default:
      throw new Error(`Tipo não suportado para restauração: ${type}`)
  }
}

// ── Restaurar item da lixeira (dispatcher) ──────
export async function restoreFromTrash(trashItemId: number, restoredBy: number) {
  const item = await prisma.trashItem.findUnique({ where: { id: trashItemId } })
  if (!item) throw new Error('Item não encontrado na lixeira')
  if (item.restoredAt) throw new Error('Item já foi restaurado')

  const snapshot = item.snapshot as any
  let restored: any

  switch (item.entityType) {
    case 'lead':
      restored = await restoreLead(snapshot)
      break
    case 'funnel':
      restored = await restoreFunnel(snapshot)
      break
    case 'chatbot':
      restored = await restoreChatbot(snapshot)
      break
    default:
      restored = await restoreSimpleEntity(item.entityType as TrashEntityType, snapshot)
  }

  // Marcar como restaurado
  await prisma.trashItem.update({
    where: { id: trashItemId },
    data: { restoredAt: new Date(), restoredBy },
  })

  return { trashItem: item, restored }
}

// ── Auto-purge: deletar itens expirados ──────────
export async function purgeExpiredTrash() {
  const result = await prisma.trashItem.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
      restoredAt: null, // não purgar itens já restaurados (são registros de auditoria)
    },
  })
  if (result.count > 0) {
    console.log(`[Trash] Purged ${result.count} expired items`)
  }
  return result.count
}

// ── Iniciar scheduler de auto-purge (roda 1x/dia) ──
export function startTrashPurgeScheduler() {
  // Rodar imediatamente na inicialização
  purgeExpiredTrash().catch(err => console.error('[Trash] Purge error:', err))

  // Depois a cada 24h
  setInterval(() => {
    purgeExpiredTrash().catch(err => console.error('[Trash] Purge error:', err))
  }, 24 * 60 * 60 * 1000)
}
