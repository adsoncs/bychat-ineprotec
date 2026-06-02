// Anexos vinculados a uma Activity (prints de WhatsApp físico, documentos
// enviados em reuniões/ligações/tarefas). Sempre fazem parte de uma atividade
// — não existem anexos soltos por lead.
//
// Endpoints:
//   GET    /api/leads/:id/attachments                        → lista anexos do lead (todos, agrupáveis por activityId)
//   GET    /api/activities/:id/attachments                    → lista anexos de uma activity
//   POST   /api/activities/:id/attachments                    → upload multipart (até 25MB) vinculado à activity
//   DELETE /api/activities/:activityId/attachments/:attachmentId → remove DB + arquivo do disco
//
// Storage: `<repo>/uploads/lead-attachments/<leadId>-<timestamp>-<rand>.<ext>`
// servido publicamente via /uploads/* (já registrado em server.ts).

import { FastifyInstance } from 'fastify'
import { promises as fs } from 'fs'
import { join, extname } from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { logEvent } from '../services/leadHistory.js'
import { canUserAccessLead, type AccessRole } from '../lib/teamAccess.js'

const MAX_BYTES = 25 * 1024 * 1024 // 25MB por arquivo

function sanitizeExt(name: string): string {
  const raw = (extname(name).slice(1) || 'bin').toLowerCase()
  return raw.replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin'
}

function fileUrl(storagePath: string): string {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
  return `${base}/uploads/${storagePath}`
}

function serialize(a: {
  id: number; leadId: number; activityId: number; fileName: string; fileSize: number;
  mimeType: string; storagePath: string; uploadedById: number | null;
  uploadedByName: string | null; description: string | null; createdAt: Date;
}) {
  return {
    id: a.id,
    leadId: a.leadId,
    activityId: a.activityId,
    fileName: a.fileName,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    url: fileUrl(a.storagePath),
    uploadedById: a.uploadedById,
    uploadedByName: a.uploadedByName,
    description: a.description,
    createdAt: a.createdAt,
  }
}

export async function leadAttachmentsRoutes(app: FastifyInstance) {

  // GET — todos os anexos de um lead (todas as atividades), mais recentes primeiro.
  app.get('/api/leads/:id/attachments', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    // Isolamento per-agent: AGENT só vê leads dele (scope=own).
    {
      const _user = (req as any).user as { userId: number; role: string }
      const _ok = await canUserAccessLead(_user.userId, _user.role as AccessRole, parseInt(id))
      if (!_ok) return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
    }
    const leadId = parseInt(id)
    if (!Number.isFinite(leadId)) return reply.code(400).send({ error: 'leadId inválido' })

    const rows = await prisma.leadAttachment.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({ attachments: rows.map(serialize) })
  })

  // GET — anexos de uma atividade específica.
  app.get('/api/activities/:id/attachments', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const activityId = parseInt(id)
    if (!Number.isFinite(activityId)) return reply.code(400).send({ error: 'activityId inválido' })

    const rows = await prisma.leadAttachment.findMany({
      where: { activityId },
      orderBy: { createdAt: 'asc' }, // dentro de uma activity, ordem de upload
    })
    return reply.send({ attachments: rows.map(serialize) })
  })

  // POST — upload de 1 arquivo vinculado a uma atividade existente.
  // multipart/form-data: field "file" (obrigatório), opcional "description".
  app.post('/api/activities/:id/attachments', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as { userId?: number; name?: string; email?: string } | undefined
    const { id } = req.params as { id: string }
    const activityId = parseInt(id)
    if (!Number.isFinite(activityId)) return reply.code(400).send({ error: 'activityId inválido' })

    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, leadId: true, title: true },
    })
    if (!activity) return reply.code(404).send({ error: 'Atividade não encontrada' })

    const file = await (req as any).file?.({ limits: { fileSize: MAX_BYTES } })
    if (!file) return reply.code(400).send({ error: 'Nenhum arquivo enviado' })

    const ext = sanitizeExt(file.filename || '')
    const uploadsDir = join(process.cwd(), '..', 'uploads', 'lead-attachments')
    await fs.mkdir(uploadsDir, { recursive: true })

    const savedName = `${activity.leadId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
    const filePath = join(uploadsDir, savedName)

    const chunks: Buffer[] = []
    let total = 0
    for await (const c of file.file) {
      total += c.length
      if (total > MAX_BYTES) {
        return reply.code(413).send({ error: 'Arquivo muito grande (máx 25MB)' })
      }
      chunks.push(c)
    }
    await fs.writeFile(filePath, Buffer.concat(chunks))

    // Após drenar o stream, fields que vieram DEPOIS do arquivo no multipart ficam disponíveis.
    const description = String(file.fields?.description?.value || '').slice(0, 2000) || null

    const storagePath = `lead-attachments/${savedName}`
    const created = await prisma.leadAttachment.create({
      data: {
        leadId: activity.leadId,
        activityId: activity.id,
        fileName: (file.filename || 'arquivo').slice(0, 255),
        fileSize: total,
        mimeType: file.mimetype || 'application/octet-stream',
        storagePath,
        uploadedById: user?.userId ?? null,
        uploadedByName: (user?.name || user?.email || null)?.slice(0, 100) ?? null,
        description,
      },
    })

    logEvent({
      leadId: activity.leadId,
      type: 'attachment_added',
      category: 'operator',
      actorType: 'operator',
      ...(user?.userId ? { userId: user.userId } : {}),
      ...(user?.name || user?.email ? { userName: (user?.name || user?.email)! } : {}),
      title: `Anexo adicionado à atividade "${activity.title}": ${created.fileName}`,
      ...(description ? { description } : {}),
      metadata: { attachmentId: created.id, activityId: activity.id, mimeType: created.mimeType, fileSize: created.fileSize },
    })

    return reply.send({ attachment: serialize(created) })
  })

  // DELETE — remove anexo (DB + disco). Best-effort no disco; se sumiu, segue.
  app.delete('/api/activities/:activityId/attachments/:attachmentId', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as { userId?: number; name?: string; email?: string } | undefined
    const { activityId, attachmentId } = req.params as { activityId: string; attachmentId: string }
    const aId = parseInt(activityId)
    const attId = parseInt(attachmentId)
    if (!Number.isFinite(aId) || !Number.isFinite(attId)) {
      return reply.code(400).send({ error: 'IDs inválidos' })
    }

    const att = await prisma.leadAttachment.findUnique({ where: { id: attId } })
    if (!att || att.activityId !== aId) return reply.code(404).send({ error: 'Anexo não encontrado' })

    await prisma.leadAttachment.delete({ where: { id: attId } })

    try {
      const filePath = join(process.cwd(), '..', 'uploads', att.storagePath)
      await fs.unlink(filePath)
    } catch (err) {
      // Arquivo já apagado ou nunca existiu — não é fatal, registramos.
      console.warn('[lead-attachments] unlink falhou:', (err as Error).message)
    }

    logEvent({
      leadId: att.leadId,
      type: 'attachment_removed',
      category: 'operator',
      actorType: 'operator',
      ...(user?.userId ? { userId: user.userId } : {}),
      ...(user?.name || user?.email ? { userName: (user?.name || user?.email)! } : {}),
      title: `Anexo removido: ${att.fileName}`,
      metadata: { attachmentId: att.id, activityId: att.activityId, fileName: att.fileName },
    })

    return reply.send({ ok: true })
  })
}
