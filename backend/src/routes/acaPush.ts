// src/routes/acaPush.ts
//
// Assinatura e disparo das notificações push do portal (G6).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { verifyPortalToken } from '../lib/acaPortalToken.js'
import { getConfig, garantirChaves, inscrever, desinscrever, enviarParaAluno } from '../services/acaPush.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

const tokOf = (req: any): string => String((req.query as any)?.t || '')

export async function acaPushRoutes(app: FastifyInstance) {
  // ─────────── Admin ───────────

  app.get('/api/admin/aca/push/config', { preHandler: authMiddleware }, async () => {
    const cfg = await getConfig()
    const [ativas, inativas] = await Promise.all([
      prisma.acaPushInscricao.count({ where: { ativa: true } }),
      prisma.acaPushInscricao.count({ where: { ativa: false } }),
    ])
    return { ...cfg, inscricoesAtivas: ativas, inscricoesInativas: inativas }
  })

  app.post('/api/admin/aca/push/chaves', { preHandler: authMiddleware }, async (req, reply) => {
    const forcar = (req.body as any)?.forcar === true
    const cfg = await garantirChaves(forcar)
    const actor = auditActor(req)
    void logUserAudit({
      action: 'aca.push.chaves', targetType: 'config', targetUserId: null,
      targetLabel: forcar ? 'Chaves VAPID REGERADAS (assinaturas anteriores invalidadas)' : 'Chaves VAPID geradas',
      ...actor,
    })
    return reply.send(cfg)
  })

  /** Disparo manual — usado para testar e para avisos pontuais da secretaria. */
  app.post('/api/admin/aca/push/enviar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const alunoId = Number(b.alunoId)
    if (!alunoId) return reply.code(400).send({ error: 'alunoId é obrigatório' })
    if (!b.titulo?.trim() || !b.corpo?.trim()) return reply.code(400).send({ error: 'Título e mensagem são obrigatórios' })
    const r = await enviarParaAluno(alunoId, {
      titulo: String(b.titulo), corpo: String(b.corpo),
      ...(b.url ? { url: String(b.url) } : {}),
    })
    return reply.send(r)
  })

  // ─────────── Portal (aluno autenticado por token) ───────────

  /** Chave pública para o navegador assinar. Não é segredo — é o par dela que é. */
  app.get('/api/public/aca/push/chave', async (req, reply) => {
    const p = verifyPortalToken(tokOf(req), 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'Link inválido ou expirado' })
    const cfg = await getConfig()
    if (!cfg.configurado) return reply.code(503).send({ error: 'Notificações não configuradas pela instituição.' })
    return { publicKey: cfg.publicKey }
  })

  app.post('/api/public/aca/push/inscrever', async (req, reply) => {
    const p = verifyPortalToken(tokOf(req), 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'Link inválido ou expirado' })
    const b = (req.body as any) || {}
    const endpoint = String(b.endpoint || '')
    const p256dh = String(b.keys?.p256dh || b.p256dh || '')
    const auth = String(b.keys?.auth || b.auth || '')
    if (!endpoint || !p256dh || !auth) return reply.code(400).send({ error: 'Assinatura incompleta' })
    await inscrever({
      alunoId: p.id, endpoint, p256dh, auth,
      userAgent: String(req.headers['user-agent'] || ''),
    })
    return { ok: true }
  })

  app.post('/api/public/aca/push/cancelar', async (req, reply) => {
    const p = verifyPortalToken(tokOf(req), 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'Link inválido ou expirado' })
    const endpoint = String((req.body as any)?.endpoint || '')
    if (endpoint) await desinscrever(endpoint)
    return { ok: true }
  })
}
