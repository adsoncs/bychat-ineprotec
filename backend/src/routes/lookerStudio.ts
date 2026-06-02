import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { requireApiKey } from '../lib/apiKey.js'

// Looker Studio Community Connector — data endpoints
// These endpoints return data in a flat tabular format suitable for Looker Studio
// Authentication via API Key (same as public API v1)

export async function lookerStudioRoutes(app: FastifyInstance) {

  // GET /api/v1/looker/leads — Leads data for Looker Studio
  app.get('/api/v1/looker/leads', { preHandler: requireApiKey('leads:read') }, async (req) => {
    const q = req.query as any
    const days = parseInt(q.days) || 90
    const since = new Date(Date.now() - days * 86400_000)

    const leads = await prisma.lead.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true, uid: true, nome: true, empresa: true, whatsapp: true, email: true,
        segmento: true, cidade: true, status: true, source: true, originType: true,
        saleDetected: true, saleValue: true, funnelId: true,
        createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    // Flat format for Looker Studio
    return {
      schema: [
        { name: 'id', dataType: 'NUMBER' },
        { name: 'uid', dataType: 'STRING' },
        { name: 'nome', dataType: 'STRING' },
        { name: 'empresa', dataType: 'STRING' },
        { name: 'whatsapp', dataType: 'STRING' },
        { name: 'email', dataType: 'STRING' },
        { name: 'segmento', dataType: 'STRING' },
        { name: 'cidade', dataType: 'STRING' },
        { name: 'etapa', dataType: 'STRING' },
        { name: 'origem', dataType: 'STRING' },
        { name: 'tipo_origem', dataType: 'STRING' },
        { name: 'venda_detectada', dataType: 'BOOLEAN' },
        { name: 'valor_venda', dataType: 'NUMBER' },
        { name: 'funil_id', dataType: 'NUMBER' },
        { name: 'data_criacao', dataType: 'STRING' },
        { name: 'data_atualizacao', dataType: 'STRING' },
      ],
      rows: leads.map(l => ({
        id: l.id,
        uid: l.uid || '',
        nome: l.nome || '',
        empresa: l.empresa || '',
        whatsapp: l.whatsapp || '',
        email: l.email || '',
        segmento: l.segmento || '',
        cidade: l.cidade || '',
        etapa: l.status || '',
        origem: l.source || '',
        tipo_origem: l.originType || '',
        venda_detectada: l.saleDetected,
        valor_venda: l.saleValue || 0,
        funil_id: l.funnelId || 0,
        data_criacao: l.createdAt.toISOString(),
        data_atualizacao: l.updatedAt.toISOString(),
      })),
      total: leads.length,
    }
  })

  // GET /api/v1/looker/sales — Sales/conversions data
  app.get('/api/v1/looker/sales', { preHandler: requireApiKey('leads:read') }, async (req) => {
    const q = req.query as any
    const days = parseInt(q.days) || 90
    const since = new Date(Date.now() - days * 86400_000)

    const leads = await prisma.lead.findMany({
      where: { saleDetected: true, updatedAt: { gte: since } },
      select: {
        id: true, nome: true, empresa: true, source: true, originType: true,
        saleValue: true,
        status: true, funnelId: true, gclid: true, ctwaClid: true,
        createdAt: true, updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    })

    return {
      schema: [
        { name: 'lead_id', dataType: 'NUMBER' },
        { name: 'nome', dataType: 'STRING' },
        { name: 'empresa', dataType: 'STRING' },
        { name: 'origem', dataType: 'STRING' },
        { name: 'tipo_origem', dataType: 'STRING' },
        { name: 'valor', dataType: 'NUMBER' },
        { name: 'produto', dataType: 'STRING' },
        { name: 'confianca', dataType: 'STRING' },
        { name: 'etapa', dataType: 'STRING' },
        { name: 'gclid', dataType: 'STRING' },
        { name: 'ctwa_clid', dataType: 'STRING' },
        { name: 'data_venda', dataType: 'STRING' },
        { name: 'data_lead', dataType: 'STRING' },
      ],
      rows: leads.map(l => ({
        lead_id: l.id,
        nome: l.nome || '',
        empresa: l.empresa || '',
        origem: l.source || '',
        tipo_origem: l.originType || '',
        valor: l.saleValue || 0,
        produto: '',
        confianca: '',
        etapa: l.status || '',
        gclid: l.gclid || '',
        ctwa_clid: l.ctwaClid || '',
        data_venda: l.updatedAt.toISOString(),
        data_lead: l.createdAt.toISOString(),
      })),
      total: leads.length,
    }
  })

  // GET /api/v1/looker/funnel — Funnel stages with counts
  app.get('/api/v1/looker/funnel', { preHandler: requireApiKey('funnels:read') }, async (req) => {
    const q = req.query as any
    const days = parseInt(q.days) || 30
    const since = new Date(Date.now() - days * 86400_000)

    const funnels = await prisma.funnel.findMany({
      include: {
        stages: {
          orderBy: { position: 'asc' },
          select: { id: true, name: true, key: true, position: true, color: true },
        },
      },
    })

    const rows: any[] = []
    for (const funnel of funnels) {
      for (const stage of funnel.stages) {
        const count = await prisma.lead.count({
          where: { funnelId: funnel.id, status: stage.key, createdAt: { gte: since } },
        })
        const saleCount = await prisma.lead.count({
          where: { funnelId: funnel.id, status: stage.key, saleDetected: true, createdAt: { gte: since } },
        })
        rows.push({
          funil: funnel.name,
          funil_id: funnel.id,
          etapa: stage.name,
          etapa_key: stage.key,
          posicao: stage.position,
          leads: count,
          vendas: saleCount,
        })
      }
    }

    return {
      schema: [
        { name: 'funil', dataType: 'STRING' },
        { name: 'funil_id', dataType: 'NUMBER' },
        { name: 'etapa', dataType: 'STRING' },
        { name: 'etapa_key', dataType: 'STRING' },
        { name: 'posicao', dataType: 'NUMBER' },
        { name: 'leads', dataType: 'NUMBER' },
        { name: 'vendas', dataType: 'NUMBER' },
      ],
      rows,
      total: rows.length,
    }
  })

  // GET /api/v1/looker/activities — Activities summary
  app.get('/api/v1/looker/activities', { preHandler: requireApiKey('activities:read') }, async (req) => {
    const q = req.query as any
    const days = parseInt(q.days) || 30
    const since = new Date(Date.now() - days * 86400_000)

    const activities = await prisma.activity.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true, type: true, title: true, status: true,
        userName: true, scheduledAt: true, completedAt: true,
        leadId: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return {
      schema: [
        { name: 'id', dataType: 'NUMBER' },
        { name: 'tipo', dataType: 'STRING' },
        { name: 'titulo', dataType: 'STRING' },
        { name: 'status', dataType: 'STRING' },
        { name: 'operador', dataType: 'STRING' },
        { name: 'lead_id', dataType: 'NUMBER' },
        { name: 'data_agendada', dataType: 'STRING' },
        { name: 'data_concluida', dataType: 'STRING' },
        { name: 'data_criacao', dataType: 'STRING' },
      ],
      rows: activities.map(a => ({
        id: a.id,
        tipo: a.type,
        titulo: a.title,
        status: a.status,
        operador: a.userName || '',
        lead_id: a.leadId,
        data_agendada: a.scheduledAt.toISOString(),
        data_concluida: a.completedAt?.toISOString() || '',
        data_criacao: a.createdAt.toISOString(),
      })),
      total: activities.length,
    }
  })
}
