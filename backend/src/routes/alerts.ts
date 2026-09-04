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
  produtorAtivo, definirProdutorAtivo, listarAlertas, tiposComAlerta,
} from '../services/alertService.js'
import { prisma } from '../lib/prisma.js'
import { registrarDesfecho } from '../services/meetingOutcome.js'
import { destinoDoAlerta } from '../services/alertLinks.js'
import { saudeDosAlertas, recomendacao, TIPOS_CONHECIDOS } from '../services/alertHealth.js'
import { acervo, listarAcervo } from '../services/alertBacklog.js'

// Os mesmos papéis da Supervisão: a visão da empresa responde uma pergunta de
// gestão, e o agregado dos outros não é da conta de quem atende.
const GESTAO = new Set(['SUPERADMIN', 'ADMIN', 'MANAGER'])

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

  // ── GET /api/alerts/list — a tela dedicada ──
  //
  // Dois escopos sobre a mesma lista. "minha" é a caixa de quem pediu, com o
  // silêncio dela respeitada — é o sino com filtro, histórico e paginação.
  // "empresa" é outra pergunta: a CONDIÇÃO, que existe uma vez e chega a várias
  // pessoas, com de quem é e quantos ainda não leram. A soma das caixas
  // individuais não responde isso, e por isso não é o mesmo dado.
  //
  // O escopo da empresa é de gestão: os mesmos papéis da Supervisão. Quem
  // atende vê a própria caixa, e o agregado dos outros não é da conta dele.
  app.get('/api/alerts/list', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      const q = req.query as Record<string, string | undefined>
      const escopo = q.escopo === 'empresa' ? 'empresa' : 'minha'
      if (escopo === 'empresa' && !GESTAO.has(String(user.role || ''))) {
        return reply.code(403).send({ error: 'Visão da empresa é restrita à supervisão' })
      }
      const data = await listarAlertas(user.userId, {
        escopo,
        status: q.status,
        kind: q.kind,
        severity: q.severity,
        ownerUserId: q.ownerUserId ? Number(q.ownerUserId) : undefined,
        desde: q.desde ? new Date(q.desde) : undefined,
        ate: q.ate ? new Date(q.ate) : undefined,
        busca: q.busca,
        limite: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      })
      // O destino e as ações vêm do mesmo lugar do sino: a tela não pode
      // discordar da gaveta sobre para onde um alerta leva.
      return {
        ...data,
        itens: data.itens.map((a) => {
          const meta = (a.metadata ?? {}) as Record<string, unknown>
          const d = destinoDoAlerta({
            entityType: a.entityType,
            entityId: a.entityId,
            leadId: typeof meta.leadId === 'number' ? meta.leadId : null,
          })
          return { ...a, link: d.link, acoes: a.status === 'open' ? d.acoes : [] }
        }),
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/alerts/list/kinds — os tipos que existem, para o filtro ──
  app.get('/api/alerts/list/kinds', { preHandler: authMiddleware }, async (_req, reply) => {
    try {
      return { tipos: await tiposComAlerta() }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/alerts/backlog/items — o acervo como lista ──
  //
  // O acervo era só um total no rodapé porque não havia onde listá-lo. Com a
  // tela, vira fila de trabalho. Sem ação em lote: alerta se resolve porque a
  // condição acabou, não porque alguém marcou.
  app.get('/api/alerts/backlog/items', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>
      return await listarAcervo({
        tipo: q.tipo,
        limite: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      })
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
      // Completa com os tipos que nunca abriram nada: "ligado e quieto" é uma
      // resposta, e sem eles a tela esconde justamente o que se quer perguntar.
      const vistos = new Set(tipos.map((t) => t.kind))
      const faltantes = TIPOS_CONHECIDOS.filter((c) => !vistos.has(c.kind)).map((c) => ({
        kind: c.kind, aguardando: 0, abertos: 0, resolvidos: 0, descartes: 0, naoLidos: 0,
        destinatarios: 0, taxaDescarte: 0, taxaNaoLido: 0, horasAteResolver: null,
        ocorrenciasMedia: 0, veredicto: 'sem_amostra' as const,
      }))
      const oque = new Map(TIPOS_CONHECIDOS.map((c) => [c.kind, c.oque]))
      const linhas = [...tipos, ...faltantes]
      const estados = await Promise.all(linhas.map((t) => produtorAtivo(t.kind)))
      return {
        dias,
        tipos: linhas.map((t, i) => ({
          ...t,
          recomendacao: recomendacao(t),
          oque: oque.get(t.kind) ?? null,
          ativo: estados[i],
        })),
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/alerts/producers/:kind — ligar ou desligar um tipo ──
  //
  // Vive aqui e não em Setting genérico porque desligar tem uma consequência
  // que a tela de configuração não saberia executar: o que já estava aberto
  // precisa FECHAR junto. Sem isso o alerta de ontem fica de pé para sempre,
  // porque não sobra produtor que o resolva.
  app.post('/api/alerts/producers/:kind', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const kind = String((req.params as any).kind || '')
      if (!TIPOS_CONHECIDOS.some((t) => t.kind === kind)) {
        return reply.code(400).send({ error: 'Tipo de alerta desconhecido' })
      }
      const ativo = !!(req.body as any)?.ativo
      const fechados = await definirProdutorAtivo(kind, ativo)
      return { ok: true, kind, ativo, fechados }
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
