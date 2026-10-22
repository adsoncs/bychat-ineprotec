// Portal › Comercial — inscrição vira proposta (Negociações/Metas/Comissões).
// Fase 2 da integração (22/10/2026). Motor em services/propostaDaInscricao.ts.
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { guardTela } from '../lib/eduTelas.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

export async function portalComercialRoutes(app: FastifyInstance) {
  const portalDe = async (req: any, reply: any) => {
    const id = Number(req.params?.id)
    const p = Number.isInteger(id) ? await prisma.enrollmentPortal.findUnique({ where: { id }, select: { id: true, nome: true } }) : null
    if (!p) { reply.code(404).send({ error: 'Portal não encontrado' }); return null }
    return p
  }

  app.get('/api/admin/enrollment-portals/:id/comercial', { preHandler: guardTela('admin') }, async (req, reply) => {
    const p = await portalDe(req, reply); if (!p) return
    const { configDoPortal } = await import('../services/propostaDaInscricao.js')
    // Propostas ligadas às inscrições DESTE portal.
    const regIds = (await prisma.enrollmentRegistration.findMany({ where: { portalId: p.id }, select: { id: true } })).map((r) => r.id)
    const props = regIds.length ? await prisma.negotiation.findMany({ where: { registrationId: { in: regIds } }, select: { resultado: true, valorFinal: true, origem: true } }) : []
    const soma = (f: (x: typeof props[number]) => boolean) => Math.round(props.filter(f).reduce((s, x) => s + Number(x.valorFinal ?? 0), 0) * 100) / 100
    return {
      config: await configDoPortal(p.id),
      propostas: {
        total: props.length,
        abertas: props.filter((x) => !x.resultado).length,
        ganhas: props.filter((x) => x.resultado === 'won').length,
        perdidas: props.filter((x) => x.resultado === 'lost').length,
        valorGanho: soma((x) => x.resultado === 'won'),
        geradasPeloPortal: props.filter((x) => x.origem === 'portal').length,
      },
    }
  })

  app.put('/api/admin/enrollment-portals/:id/comercial', { preHandler: guardTela('admin') }, async (req, reply) => {
    const p = await portalDe(req, reply); if (!p) return
    const b = (req.body as any) || {}
    const svc = await import('../services/propostaDaInscricao.js')
    const antes = await svc.configDoPortal(p.id)
    const depois = await svc.salvarConfigDoPortal(p.id, { modo: b.modo, marco: b.marco })
    void logUserAudit({ action: 'portal.comercial', targetType: 'portal', targetLabel: `Comercial do portal ${p.nome}`, changes: { antes, depois }, ...auditActor(req) })
    // Ligou agora: as inscrições existentes entram já (mesma decisão da simulação).
    const aplicado = antes.modo !== 'ativo' && depois.modo === 'ativo' ? await svc.aplicarPortal(p.id) : null
    return { config: depois, aplicado }
  })

  app.post('/api/admin/enrollment-portals/:id/comercial/simular', { preHandler: guardTela('admin') }, async (req, reply) => {
    const p = await portalDe(req, reply); if (!p) return
    const marco = (req.body as any)?.marco === 'jornada' ? 'jornada' : (req.body as any)?.marco === 'pagamento' ? 'pagamento' : undefined
    const { simularPortal } = await import('../services/propostaDaInscricao.js')
    return simularPortal(p.id, marco)
  })
}

// ── Educacional › Comercial (Fase 3): painel e metas por portal ─────────────
export async function educacionalComercialRoutes(app: FastifyInstance) {
  const num = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null }
  const mesAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7)

  app.get('/api/admin/educacional/comercial/painel', { preHandler: guardTela('admin') }, async (req) => {
    const q = (req.query as any) || {}
    const { painelComercial } = await import('../services/comercialEducacional.js')
    return painelComercial({
      mes: /^\d{4}-\d{2}$/.test(String(q.mes || '')) ? String(q.mes) : mesAtual(),
      portalId: num(q.portalId), courseId: num(q.courseId), campusId: num(q.campusId), vendedorId: num(q.vendedorId),
    })
  })

  app.put('/api/admin/educacional/comercial/metas', { preHandler: guardTela('admin') }, async (req, reply) => {
    const b = (req.body as any) || {}
    const portalId = num(b.portalId)
    if (!portalId || !/^\d{4}-\d{2}$/.test(String(b.mes || ''))) return reply.code(400).send({ error: 'portalId e mes (AAAA-MM) são obrigatórios' })
    const { salvarMetaDoPortal } = await import('../services/comercialEducacional.js')
    const meta = await salvarMetaDoPortal(portalId, String(b.mes), { valor: b.valor, quantidade: b.quantidade })
    void logUserAudit({ action: 'portal.meta_comercial', targetType: 'portal', targetLabel: `Meta comercial do portal #${portalId} em ${b.mes}`, changes: meta as any, ...auditActor(req) })
    return { meta }
  })

  // Card "Comercial" no detalhe da inscrição: proposta + comissão.
  app.get('/api/admin/enrollment-registrations/:id/comercial', { preHandler: guardTela('admin') }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const { comercialDaInscricao } = await import('../services/comercialEducacional.js')
    return comercialDaInscricao(id)
  })
}
