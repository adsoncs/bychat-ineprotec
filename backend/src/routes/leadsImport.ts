// src/routes/leadsImport.ts
// Endpoints do módulo de importação de leads via planilha.
//
// Endpoints:
//   POST /api/admin/leads/import/preview
//     multipart com `file`. Devolve { importId, summary, rows, headers, suggestedMapping }
//   POST /api/admin/leads/import/commit
//     Body: { importId, mapping, options, acceptedLineIndices }
//     Executa em chunks, atualiza row LeadImport com status=running→done.
//   GET /api/admin/leads/import/history?limit=20
//     Lista de imports passados.
//
// Política: SUPERADMIN/ADMIN ou role com canCreate=true no módulo 'leads'.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { resolvePermissions } from '../lib/permissions.js'
import {
  parseFile, suggestMapping, buildPreview, executeImport,
  type MappingEntry, type ImportOptions, MAX_ROWS,
} from '../services/leadsImport.js'

async function requireLeadsCreate(req: any, reply: any) {
  await authMiddleware(req, reply)
  if (reply.sent) return false
  const user = req.user as JwtPayload
  if (user.role === 'SUPERADMIN' || user.role === 'ADMIN') return true
  const perms = await resolvePermissions(user.userId, user.role)
  if (perms['leads']?.canCreate) return true
  reply.code(403).send({ error: 'Sem permissão para importar leads (precisa canCreate em leads)' })
  return false
}

const PREVIEW_TTL_HOURS = 6

export async function leadsImportRoutes(app: FastifyInstance) {
  // ── POST /preview ──────────────────────────────────────────────────────
  app.post('/api/admin/leads/import/preview', async (req: any, reply: any) => {
    const ok = await requireLeadsCreate(req, reply)
    if (!ok) return
    const user = req.user as JwtPayload

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'Arquivo é obrigatório (multipart "file")' })
    const fileName = data.filename || 'planilha.csv'
    const buffer = await data.toBuffer()
    if (buffer.length === 0) return reply.code(400).send({ error: 'Arquivo vazio' })

    let parsed
    try {
      parsed = parseFile(buffer, fileName)
    } catch (err) {
      return reply.code(400).send({ error: `Falha ao ler planilha: ${(err as Error).message}` })
    }
    if (parsed.rows.length === 0) {
      return reply.code(400).send({ error: 'Planilha sem dados (apenas cabeçalho?)' })
    }
    if (parsed.rows.length > MAX_ROWS) {
      return reply.code(413).send({
        error: `Planilha excede o limite de ${MAX_ROWS} linhas (${parsed.rows.length}). Divida em partes.`,
      })
    }

    const suggested = suggestMapping(parsed.headers)
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_HOURS * 3600_000)

    const importRow = await prisma.leadImport.create({
      data: {
        importedByUserId: user.userId,
        fileName: fileName.slice(0, 255),
        fileSize: buffer.length,
        status: 'preview',
        mapping: suggested as any,
        parsedRows: JSON.stringify({ headers: parsed.headers, rows: parsed.rows }),
        previewExpiresAt: expiresAt,
      },
    })

    return {
      importId: importRow.id,
      fileName,
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 5),
      totalRows: parsed.rows.length,
      suggestedMapping: suggested,
      previewExpiresAt: expiresAt.toISOString(),
    }
  })

  // ── POST /preview/plan ─────────────────────────────────────────────────
  // Recalcula o plano com base no mapping editado pelo admin (sem confirmar).
  app.post<{ Body: { importId: number; mapping: MappingEntry[]; options: ImportOptions } }>(
    '/api/admin/leads/import/preview/plan',
    async (req: any, reply: any) => {
      const ok = await requireLeadsCreate(req, reply)
      if (!ok) return
      const { importId, mapping, options } = req.body || ({} as any)
      if (typeof importId !== 'number') return reply.code(400).send({ error: 'importId inválido' })
      if (!Array.isArray(mapping)) return reply.code(400).send({ error: 'mapping deve ser array' })

      const importRow = await prisma.leadImport.findUnique({ where: { id: importId } })
      if (!importRow) return reply.code(404).send({ error: 'Import não encontrado' })
      if (importRow.status !== 'preview') return reply.code(409).send({ error: `Import já está em status "${importRow.status}"` })
      if (!importRow.parsedRows) return reply.code(500).send({ error: 'Arquivo parseado não encontrado (TTL expirado?)' })

      const parsed = JSON.parse(importRow.parsedRows)
      const sheet = { headers: parsed.headers, rows: parsed.rows, sheetNames: [], selectedSheet: '' } as any

      const plan = await buildPreview(sheet, mapping, options)

      // Salva o mapping definitivo
      await prisma.leadImport.update({
        where: { id: importId },
        data: { mapping: mapping as any },
      })

      return plan
    },
  )

  // ── POST /commit ──────────────────────────────────────────────────────
  app.post<{
    Body: {
      importId: number
      mapping: MappingEntry[]
      options: ImportOptions
      acceptedLineIndices: number[]
    }
  }>(
    '/api/admin/leads/import/commit',
    async (req: any, reply: any) => {
      const ok = await requireLeadsCreate(req, reply)
      if (!ok) return
      const user = req.user as JwtPayload
      const { importId, mapping, options, acceptedLineIndices } = req.body || ({} as any)
      if (typeof importId !== 'number') return reply.code(400).send({ error: 'importId inválido' })
      if (!Array.isArray(mapping)) return reply.code(400).send({ error: 'mapping inválido' })
      if (!Array.isArray(acceptedLineIndices)) return reply.code(400).send({ error: 'acceptedLineIndices inválido' })

      const importRow = await prisma.leadImport.findUnique({ where: { id: importId } })
      if (!importRow) return reply.code(404).send({ error: 'Import não encontrado' })
      if (importRow.status !== 'preview') return reply.code(409).send({ error: `Import já está em status "${importRow.status}"` })
      if (!importRow.parsedRows) return reply.code(500).send({ error: 'Arquivo parseado não encontrado' })

      const parsed = JSON.parse(importRow.parsedRows)
      const sheet = { headers: parsed.headers, rows: parsed.rows, sheetNames: [], selectedSheet: '' } as any

      await prisma.leadImport.update({
        where: { id: importId },
        data: { status: 'running', startedAt: new Date(), mapping: mapping as any },
      })

      const accepted = new Set<number>(acceptedLineIndices)
      try {
        const result = await executeImport(sheet, mapping, options, accepted, user.userId)
        await prisma.leadImport.update({
          where: { id: importId },
          data: {
            status: 'done',
            finishedAt: new Date(),
            totals: result as any,
            errors: result.failed.length > 0 ? (result.failed as any) : undefined,
            parsedRows: null, // libera espaço — preserva auditoria
          },
        })
        return { ok: true, result }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await prisma.leadImport.update({
          where: { id: importId },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            errors: [{ error: msg }] as any,
          },
        })
        return reply.code(500).send({ error: msg })
      }
    },
  )

  // ── GET /history ──────────────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string } }>(
    '/api/admin/leads/import/history',
    async (req: any, reply: any) => {
      const ok = await requireLeadsCreate(req, reply)
      if (!ok) return
      const limit = Math.min(parseInt(req.query?.limit || '20'), 100)
      const imports = await prisma.leadImport.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true, fileName: true, fileSize: true, status: true,
          totals: true, errors: true, createdAt: true, finishedAt: true,
          importedBy: { select: { id: true, name: true, email: true } },
        },
      })
      return { imports }
    },
  )
}
