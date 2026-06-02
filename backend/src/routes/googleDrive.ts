import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { driveCreateFolder, driveFindFolder, driveUploadFile, driveListFiles } from '../lib/google.js'

export async function googleDriveRoutes(app: FastifyInstance) {

  // GET /api/admin/google/drive/config
  app.get('/api/admin/google/drive/config', { preHandler: adminOnly }, async () => {
    const config = await prisma.googleDriveConfig.findFirst({ where: { active: true } })
    return { data: config }
  })

  // POST /api/admin/google/drive/config — Setup Drive integration
  app.post('/api/admin/google/drive/config', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.connectionId) return reply.code(400).send({ error: 'connectionId obrigatorio' })

    const user = (req as any).user

    // Create or find root folder "ByChat CRM"
    let rootFolder = await driveFindFolder(parseInt(body.connectionId), 'ByChat CRM')
    if (!rootFolder) {
      const created = await driveCreateFolder(parseInt(body.connectionId), 'ByChat CRM')
      rootFolder = { id: created.id, webViewLink: created.link }
    }

    const config = await prisma.googleDriveConfig.create({
      data: {
        connectionId: parseInt(body.connectionId),
        rootFolderId: rootFolder.id,
        rootFolderLink: rootFolder.webViewLink || '',
        autoUploadChat: body.autoUploadChat === true,
        createdBy: user?.userId || null,
      },
    })

    return reply.code(201).send({ data: config })
  })

  // PUT /api/admin/google/drive/config/:id
  app.put('/api/admin/google/drive/config/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    if (body.autoUploadChat !== undefined) data.autoUploadChat = body.autoUploadChat
    if (body.active !== undefined) data.active = body.active
    const updated = await prisma.googleDriveConfig.update({ where: { id: parseInt(id) }, data })
    return { data: updated }
  })

  // DELETE /api/admin/google/drive/config/:id
  app.delete('/api/admin/google/drive/config/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    await prisma.googleDriveConfig.delete({ where: { id: parseInt(id) } })
    return { ok: true }
  })

  // POST /api/admin/google/drive/lead-folder — Create/get folder for a lead
  app.post('/api/admin/google/drive/lead-folder', { preHandler: adminOnly }, async (req, reply) => {
    const { leadId } = req.body as any
    if (!leadId) return reply.code(400).send({ error: 'leadId obrigatorio' })

    const config = await prisma.googleDriveConfig.findFirst({ where: { active: true } })
    if (!config?.rootFolderId) return reply.code(400).send({ error: 'Google Drive nao configurado' })

    const lead = await prisma.lead.findUnique({ where: { id: parseInt(leadId) }, select: { nome: true, empresa: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead nao encontrado' })

    const folderName = `${lead.nome || 'Lead'}${lead.empresa ? ' - ' + lead.empresa : ''}`

    let folder = await driveFindFolder(config.connectionId, folderName, config.rootFolderId)
    if (!folder) {
      const created = await driveCreateFolder(config.connectionId, folderName, config.rootFolderId)
      folder = { id: created.id, webViewLink: created.link }
    }

    return { data: { folderId: folder.id, link: folder.webViewLink } }
  })

  // GET /api/admin/google/drive/files/:folderId
  app.get('/api/admin/google/drive/files/:folderId', { preHandler: adminOnly }, async (req, reply) => {
    const { folderId } = req.params as any
    const config = await prisma.googleDriveConfig.findFirst({ where: { active: true } })
    if (!config) return reply.code(400).send({ error: 'Google Drive nao configurado' })

    try {
      const files = await driveListFiles(config.connectionId, folderId)
      return { data: files }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/admin/google/drive/upload — Upload file to lead folder
  app.post('/api/admin/google/drive/upload', { preHandler: adminOnly }, async (req, reply) => {
    const config = await prisma.googleDriveConfig.findFirst({ where: { active: true } })
    if (!config?.rootFolderId) return reply.code(400).send({ error: 'Google Drive nao configurado' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'Nenhum arquivo enviado' })

    const folderId = (data.fields as any)?.folderId?.value
    if (!folderId) return reply.code(400).send({ error: 'folderId obrigatorio' })

    try {
      const buf = await data.toBuffer()
      const result = await driveUploadFile(config.connectionId, {
        name: data.filename,
        mimeType: data.mimetype,
        body: buf,
        parentId: folderId,
      })
      return { data: result }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
