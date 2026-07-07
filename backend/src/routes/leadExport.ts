// src/routes/leadExport.ts
// Exportação de leads: um lead (dossiê completo) ou vários (massa), com seletor
// das seções de dados e 4 formatos (xlsx/csv/pdf/html). Reúne TODOS os dados do
// lead via leadExportData e renderiza via leadExportRender.

import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../lib/auth.js'
import { collectDossier, listSections, ALL_SECTION_IDS } from '../services/leadExportData.js'
import { renderXlsx, renderCsv, renderHtml, renderPdf } from '../services/leadExportRender.js'

const MAX_LEADS = 500

type Format = 'xlsx' | 'csv' | 'pdf' | 'html'
const FORMATS: Format[] = ['xlsx', 'csv', 'pdf', 'html']

export async function leadExportRoutes(app: FastifyInstance) {
  // Catálogo de seções exportáveis (alimenta o seletor do frontend).
  app.get('/api/admin/leads/export/sections', { preHandler: authMiddleware }, async () => {
    return { sections: listSections() }
  })

  // Gera o arquivo. Body: { leadIds:number[], sections?:string[], format }.
  app.post('/api/admin/leads/export', { preHandler: authMiddleware }, async (req, reply) => {
    const body = (req.body as any) || {}
    const leadIds: number[] = Array.isArray(body.leadIds)
      ? body.leadIds.map((n: any) => parseInt(String(n), 10)).filter(Number.isFinite)
      : []
    const format: Format = FORMATS.includes(body.format) ? body.format : 'xlsx'
    const sections: string[] = Array.isArray(body.sections) && body.sections.length
      ? body.sections.filter((s: any) => ALL_SECTION_IDS.includes(s))
      : ALL_SECTION_IDS

    if (!leadIds.length) return reply.code(400).send({ error: 'Nenhum lead informado' })
    if (leadIds.length > MAX_LEADS) {
      return reply.code(400).send({ error: `Máximo de ${MAX_LEADS} leads por exportação` })
    }

    const dossier = await collectDossier(leadIds, sections)
    if (!dossier.leads.length) return reply.code(404).send({ error: 'Leads não encontrados' })

    const stamp = new Date().toISOString().slice(0, 10)
    const nBase = dossier.leads.length === 1
      ? `lead-${dossier.leads[0].uid}`
      : `leads-${dossier.leads.length}`
    const fileBase = `${nBase}-${stamp}`.replace(/[^a-zA-Z0-9._-]/g, '_')

    try {
      if (format === 'xlsx') {
        const buf = renderXlsx(dossier)
        return reply
          .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`)
          .send(buf)
      }
      if (format === 'csv') {
        const csv = renderCsv(dossier)
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${fileBase}.csv"`)
          .send(csv)
      }
      if (format === 'html') {
        const html = await renderHtml(dossier)
        return reply
          .header('Content-Type', 'text/html; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${fileBase}.html"`)
          .send(html)
      }
      // pdf
      const pdf = await renderPdf(dossier)
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${fileBase}.pdf"`)
        .send(pdf)
    } catch (e: any) {
      req.log.error({ err: e }, '[leadExport] falha ao gerar arquivo')
      return reply.code(500).send({ error: `Falha ao gerar ${format.toUpperCase()}: ${e?.message || 'erro'}` })
    }
  })
}
