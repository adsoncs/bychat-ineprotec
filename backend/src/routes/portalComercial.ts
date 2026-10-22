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
