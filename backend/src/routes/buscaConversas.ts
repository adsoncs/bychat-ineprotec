/**
 * Busca do Conversas, no formato do WhatsApp Web.
 *
 *  • GET /api/atendimento/busca/mensagens — a seção "Mensagens" da busca da
 *    lista: mensagens com o termo, de todas as conversas que a pessoa pode abrir.
 *    (Contatos e Conversas saem da própria lista, com `searchFields`.)
 *  • GET /api/atendimento/tickets/:leadId/busca — "Pesquisar mensagens" dentro
 *    de uma conversa: todas as mensagens com o termo, da mais nova para a mais
 *    antiga, e não só as que estão carregadas na tela.
 *
 * Quem pode ver o quê NÃO é decidido aqui. A seção de mensagens pergunta à
 * própria lista de conversas quais conversas a pessoa enxerga (escopo, matriz
 * do gerenciador, números reservados) e só procura dentro delas; a busca da
 * conversa passa pela mesma checagem de acesso que abrir a conversa. Uma regra
 * de permissão copiada para cá envelheceria separada da original.
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'

/** Fuso das datas escolhidas na tela ("dia 12/09" é o dia 12 no Brasil). */
const FUSO = '-03:00'

const CAMPOS_MENSAGEM = {
  id: true,
  leadId: true,
  body: true,
  timestamp: true,
  fromMe: true,
  senderName: true,
  mediaType: true,
  mediaName: true,
  isInternal: true,
} as const

async function comMencoes<T extends { body: string | null }>(mensagens: T[]): Promise<T[]> {
  // Menção de grupo chega como "@<número>"; na lista de resultados ela precisa
  // aparecer com o nome, como aparece na bolha.
  const { resolverMencoesEmLote } = await import('../services/mentionResolver.js')
  return (await resolverMencoesEmLote(mensagens as any).catch(() => mensagens)) as T[]
}

export async function buscaConversasRoutes(app: FastifyInstance) {
  app.get('/api/atendimento/busca/mensagens', { preHandler: authMiddleware }, async (req, reply) => {
    const query = req.query as any
    const q = String(query.q ?? '').trim()
    // Mesmo piso da busca da lista: com uma ou duas letras o LIKE '%x%' varre
    // a tabela inteira e devolve quase tudo.
    if (q.length < 3) return { mensagens: [], conversas: {}, mais: false }
    const limite = Math.min(parseInt(query.limite) || 30, 60)
    const antes = query.antes ? new Date(String(query.antes)) : null

    // Conversas que ESTA pessoa pode abrir e que têm o termo em alguma mensagem —
    // respondido pela lista de conversas, com todas as regras dela.
    const params = new URLSearchParams({
      bucket: 'qualquer', search: q, searchFields: 'mensagens', limit: '200', semContadores: '1',
    })
    const r = await app.inject({
      method: 'GET',
      url: `/api/atendimento/tickets?${params}`,
      headers: { authorization: req.headers.authorization ?? '' },
    })
    if (r.statusCode !== 200) return reply.code(r.statusCode).send(r.json())
    const tickets = (r.json() as { tickets: any[] }).tickets ?? []
    if (!tickets.length) return { mensagens: [], conversas: {}, mais: false }

    const achadas = await prisma.message.findMany({
      where: {
        leadId: { in: tickets.map((t) => t.id) },
        body: { contains: q },
        isDeleted: false,
        deletedForAll: false,
        ...(antes && !isNaN(antes.getTime()) ? { timestamp: { lt: antes } } : {}),
      },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: limite + 1,
      select: CAMPOS_MENSAGEM,
    })
    const pagina = await comMencoes(achadas.slice(0, limite))
    const usadas = new Set(pagina.map((m) => m.leadId))
    const conversas: Record<number, unknown> = {}
    for (const t of tickets) {
      if (!usadas.has(t.id)) continue
      conversas[t.id] = {
        id: t.id, nome: t.nome, whatsapp: t.whatsapp, profilePicUrl: t.profilePicUrl,
        isGroup: t.isGroup, channel: t.channel,
      }
    }
    return { mensagens: pagina, conversas, mais: achadas.length > limite }
  })

  app.get('/api/atendimento/tickets/:leadId/busca', { preHandler: authMiddleware }, async (req, reply) => {
    const lid = parseInt((req.params as any).leadId)
    if (!Number.isFinite(lid)) return reply.code(400).send({ error: 'Conversa inválida' })
    const { checarAcessoTicket } = await import('./atendimento.js')
    const acesso = await checarAcessoTicket((req as any).user as JwtPayload, lid, 'view')
    if (!acesso.ok) return reply.code(acesso.status).send({ error: acesso.error })

    const query = req.query as any
    const q = String(query.q ?? '').trim()
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(query.dia ?? '')) ? String(query.dia) : null
    if (!q && !dia) return { total: 0, mensagens: [] }
    const limite = Math.min(parseInt(query.limite) || 50, 100)
    const offset = Math.max(parseInt(query.offset) || 0, 0)

    const where: any = { leadId: lid, isDeleted: false, deletedForAll: false }
    // Texto da mensagem e nome do arquivo (o WhatsApp acha o PDF pelo nome).
    if (q) where.OR = [{ body: { contains: q } }, { mediaName: { contains: q } }]
    if (dia) {
      const ini = new Date(`${dia}T00:00:00${FUSO}`)
      where.timestamp = { gte: ini, lt: new Date(ini.getTime() + 86_400_000) }
    }
    const [total, achadas] = await Promise.all([
      prisma.message.count({ where }),
      prisma.message.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limite,
        select: CAMPOS_MENSAGEM,
      }),
    ])
    return { total, mensagens: await comMencoes(achadas) }
  })
}
