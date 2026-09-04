// src/routes/alerts.ts
//
// A caixa de alertas de quem está logado.
//
// Não existe rota para LISTAR alertas de outra pessoa, e é de propósito: o
// destinatário já foi resolvido quando o alerta nasceu (alertService), e deixar
// o front pedir "os alertas do usuário X" abriria justamente o vazamento que a
// audiência existe para impedir — um AGENT pediria os do gestor. Toda rota aqui
// opera sobre `req.user.userId` e mais nada.
//
// Também não existe rota para RESOLVER alerta. Resolver é do produtor, quando a
// condição some de verdade; um botão "resolver" no painel apagaria o aviso sem
// arrumar o problema, e o próximo `raiseAlert` o traria de volta em segundos.
// O que a pessoa pode fazer é marcar como lido ou tirar da própria caixa.

import type { FastifyInstance } from 'fastify'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import type { JwtPayload } from '../lib/auth.js'
import {
  listarAlertasDoUsuario, contarNaoLidos, marcarLido, descartar,
  silenciar, dessilenciar, listarSilencios,
} from '../services/alertService.js'
import { prisma } from '../lib/prisma.js'
import { registrarDesfecho } from '../services/meetingOutcome.js'
import { destinoDoAlerta } from '../services/alertLinks.js'
import { saudeDosAlertas, recomendacao } from '../services/alertHealth.js'
import { acervo } from '../services/alertBacklog.js'

export async function alertsRoutes(app: FastifyInstance) {
  // ── GET /api/alerts — a caixa de quem está logado ──
  app.get('/api/alerts', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      const q = req.query as { unread?: string; limit?: string }
      const limite = Math.min(200, Math.max(1, Number(q.limit) || 50))

      const linhas = await listarAlertasDoUsuario(user.userId, {
        apenasNaoLidos: q.unread === '1' || q.unread === 'true',
        limite,
      })

      return {
        alerts: linhas.map((r) => {
          const meta = (r.alert.metadata || {}) as Record<string, unknown>
          const destino = destinoDoAlerta({
            entityType: r.alert.entityType,
            entityId: r.alert.entityId,
            leadId: typeof meta.leadId === 'number' ? meta.leadId : null,
          })
          return {
          id: r.alert.id,
          kind: r.alert.kind,
          severity: r.alert.severity,
          title: r.alert.title,
          body: r.alert.body,
          entityType: r.alert.entityType,
          entityId: r.alert.entityId,
          metadata: r.alert.metadata,
          // Quando apareceu pela primeira vez e quando foi visto por último: é
          // a diferença entre "acabou de acontecer" e "está assim há dias".
          firstSeenAt: r.alert.firstSeenAt,
          lastSeenAt: r.alert.lastSeenAt,
          occurrences: r.alert.occurrences,
          readAt: r.readAt,
          // Para onde ir e o que dá para fazer sem sair do sino — ver
          // services/alertLinks.ts.
          link: destino.link,
          acoes: destino.acoes,
          }
        }),
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/alerts/unread-count — o número do sino ──
  app.get('/api/alerts/unread-count', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      return { count: await contarNaoLidos(user.userId) }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/alerts/:id/read ──
  app.post('/api/alerts/:id/read', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      const id = Number((req.params as any).id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })
      // `false` aqui quer dizer "já estava lido" ou "não é seu" — os dois casos
      // são inócuos para quem chamou, então nenhum vira erro.
      await marcarLido(id, user.userId)
      return { ok: true, unread: await contarNaoLidos(user.userId) }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/alerts/:id/dismiss — tira da MINHA caixa ──
  app.post('/api/alerts/:id/dismiss', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      const id = Number((req.params as any).id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })
      await descartar(id, user.userId)
      return { ok: true, unread: await contarNaoLidos(user.userId) }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/alerts/:id/action — resolve a CONDIÇÃO, não o alerta ──
  //
  // A distinção importa. Não existe (e não deve existir) um botão "resolver
  // alerta": apagaria o aviso sem arrumar nada, e o próximo raiseAlert o traria
  // de volta em segundos. O que existe é agir sobre o problema — aqui, dar o
  // desfecho da reunião. O alerta fecha como CONSEQUÊNCIA de o problema ter
  // deixado de existir, que é o desenho certo.
  //
  // É o que faz o alerta valer a pena para reunião: o botão de desfecho já
  // existia na Agenda e nunca foi usado, porque exigia voltar a uma tela que
  // ninguém revisita. Aqui a pergunta chega onde a pessoa está.
  app.post('/api/alerts/:id/action', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      const id = Number((req.params as any).id)
      const { action } = (req.body as any) || {}
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })

      // Só age em alerta que é DESTA pessoa: sem isso qualquer um mudaria o
      // desfecho da reunião de qualquer outro passando um id.
      const meu = await prisma.alertRecipient.findFirst({
        where: { alertId: id, userId: user.userId },
        include: { alert: { select: { id: true, kind: true, entityType: true, entityId: true, status: true } } },
      })
      if (!meu) return reply.code(404).send({ error: 'Alerta não encontrado' })
      if (meu.alert.status !== 'open') return reply.code(409).send({ error: 'Este alerta já foi resolvido' })

      if (meu.alert.entityType === 'booking' && meu.alert.entityId) {
        if (action !== 'completed' && action !== 'no_show') {
          return reply.code(400).send({ error: 'Ação inválida para reunião' })
        }
        const ok = await registrarDesfecho(meu.alert.entityId, action)
        if (!ok) return reply.code(409).send({ error: 'A reunião já tinha desfecho' })
        return { ok: true, unread: await contarNaoLidos(user.userId) }
      }

      if (meu.alert.entityType === 'activity' && meu.alert.entityId) {
        if (action !== 'completed') {
          return reply.code(400).send({ error: 'Ação inválida para atividade' })
        }
        // O filtro de status é o que impede desfazer uma conclusão ou reabrir
        // atividade cancelada — mesma trava do desfecho de reunião.
        const r = await prisma.activity.updateMany({
          where: { id: meu.alert.entityId, status: { notIn: ['completed', 'cancelled'] } },
          data: { status: 'completed', completedAt: new Date() },
        })
        if (r.count === 0) return reply.code(409).send({ error: 'A atividade já estava fechada' })
        // A condição deixou de existir: o alerta fecha por consequência, sem
        // esperar a próxima volta do relógio.
        await prisma.alert.updateMany({
          where: { id: meu.alert.id, status: 'open' },
          data: { status: 'resolved', resolvedAt: new Date() },
        })
        return { ok: true, unread: await contarNaoLidos(user.userId) }
      }

      return reply.code(400).send({ error: 'Este alerta não tem ação disponível' })
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/alerts/mute — parar de receber ──
  //
  // Sempre para quem pede, nunca para os outros: cada um decide o que quer ver.
  // Desligar um tipo para a empresa inteira é configuração, não caixa de
  // entrada, e mora em Setting.
  //
  // O silêncio por ITEM existe para que a pessoa não desligue uma família
  // inteira por causa de um caso chato — que é como se perde um alerta bom.
  app.post('/api/alerts/mute', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      const { kind, alertId, dias } = (req.body as any) || {}

      let dedupeKey: string | undefined
      if (alertId) {
        // A chave vem do banco e não do cliente: aceitar `dedupeKey` do corpo
        // deixaria alguém silenciar condição que nunca viu.
        const meu = await prisma.alertRecipient.findFirst({
          where: { alertId: Number(alertId), userId: user.userId },
          include: { alert: { select: { dedupeKey: true } } },
        })
        if (!meu) return reply.code(404).send({ error: 'Alerta não encontrado' })
        dedupeKey = meu.alert.dedupeKey
      }
      if (!kind && !dedupeKey) {
        return reply.code(400).send({ error: 'Informe kind ou alertId' })
      }

      const until = dias ? new Date(Date.now() + Number(dias) * 86400_000) : null
      await silenciar(user.userId, { kind: kind || undefined, dedupeKey }, until)
      return { ok: true, unread: await contarNaoLidos(user.userId) }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/alerts/unmute — voltar a receber ──
  app.post('/api/alerts/unmute', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      const { kind, dedupeKey } = (req.body as any) || {}
      if (!kind && !dedupeKey) return reply.code(400).send({ error: 'Informe kind ou dedupeKey' })
      await dessilenciar(user.userId, { kind, dedupeKey })
      return { ok: true, unread: await contarNaoLidos(user.userId) }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/alerts/mutes — o que eu silenciei ──
  app.get('/api/alerts/mutes', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      return { mutes: await listarSilencios(user.userId) }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/alerts/backlog — o que o sino não mostra de propósito ──
  //
  // Toda janela de corte cria um ponto cego, e o cego aqui tem 71 itens. Isto
  // não é alerta e não interrompe ninguém: é a consulta para quem for decidir o
  // que fazer com o passivo — reconstruir ou aceitar sem dado.
  app.get('/api/alerts/backlog', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const itens = await acervo()
      return { itens, total: itens.reduce((s, i) => s + i.quantidade, 0) }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/alerts/health — a saúde do próprio sino ──
  //
  // `adminOnly` porque a pergunta que isto responde é de produto, não de
  // operação: "algum tipo de alerta virou ruído e deve ser desligado?". Quem
  // atende não decide isso, e o número agregado de outra gente não é da conta
  // dele.
  app.get('/api/alerts/health', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const q = req.query as { dias?: string }
      const dias = Math.min(365, Math.max(1, Number(q.dias) || 30))
      const tipos = await saudeDosAlertas(dias)
      return {
        dias,
        tipos: tipos.map((t) => ({ ...t, recomendacao: recomendacao(t) })),
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/alerts/read-all — zera o sino ──
  app.post('/api/alerts/read-all', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      const r = await prisma.alertRecipient.updateMany({
        where: { userId: user.userId, readAt: null, dismissedAt: null, alert: { status: 'open' } },
        data: { readAt: new Date() },
      })
      return { ok: true, marcados: r.count, unread: 0 }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
