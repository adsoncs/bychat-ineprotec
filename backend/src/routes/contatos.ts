// src/routes/contatos.ts
//
// Módulo Contatos — quem falou com a empresa e ainda não virou Lead.
//
// Não existe tabela nova: contato e lead são o MESMO registro em estados
// diferentes (`qualifiedAt = null` × `qualifiedAt != null`). A separação já era
// doutrina do sistema desde `services/leadQualification.ts` ("Conversa ≠ Lead");
// o que faltava era porta de entrada — o backend já aceitava
// `GET /leads?onlyUnqualified=1` e nenhuma tela chamava.
//
// Duas regras desenham o recorte:
//
//   1. SÓ ENTRA QUEM JÁ CONVERSOU. Contato que está na agenda do celular mas
//      nunca trocou mensagem não aparece. Isso é porta de entrada e base legal
//      ao mesmo tempo: a lista só mostra quem tem relacionamento demonstrável,
//      então não há como selecionar por engano quem nunca falou com a empresa
//      para um disparo. Medido antes de escrever: a regra barra 101 dos 391 no
//      elementus e 18 dos 862 no kobogo — corta pouco e protege o que importa.
//
//   2. NÚMERO RESERVADO CONTINUA RESERVADO. A lista é aberta a todos, mas quem
//      não pode ver aquele número não vê os contatos dele — a mesma regra que
//      já vale no Conversas, aplicada aqui como cláusula de listagem. Sem isso
//      o módulo seria uma porta lateral para o que a reserva protege (no kobogo
//      são 99 contatos numa linha pessoal).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { requireModule } from '../lib/permissions.js'
import { phoneKey as phoneKeyDe } from '../lib/phone.js'
import { logEvent, EVENT_TYPES } from '../services/leadHistory.js'
import { filtroDeCanaisVisiveis } from '../services/channelVisibility.js'
import { mapaDeAcesso, filtroDeConversas } from '../services/conversationAccess.js'

/** Campos que a lista mostra. Enxuto de propósito: a tela é de varredura. */
const SELECAO = {
  id: true,
  nome: true,
  whatsapp: true,
  email: true,
  empresa: true,
  source: true,
  instanceName: true,
  isGroup: true,
  profilePicUrl: true,
  pushName: true,
  nomeWhatsappAgenda: true,
  unreadMessages: true,
  lastMessageAt: true,
  createdAt: true,
  assignedUserId: true,
  assignedUser: { select: { id: true, name: true } },
  teamId: true,
  team: { select: { id: true, name: true, color: true } },
  conversationOpenedAt: true,
  conversationClosedAt: true,
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} as const

/**
 * O recorte do módulo, montado por usuário.
 *
 * `respondeu` existe porque "já conversou" tem dois graus: recebemos mensagem
 * dele (obrigatório para entrar na lista) e nós respondemos (indica atendimento
 * de fato). A tela oferece o segundo como filtro.
 */
async function montarWhere(
  user: JwtPayload,
  opts: { busca?: string; canal?: string; origem?: string; grupos?: 'incluir' | 'excluir' | 'apenas'; respondeu?: boolean },
): Promise<any> {
  const and: any[] = [
    // O estado que define o módulo.
    { qualifiedAt: null },
    // Regra 1: só quem já mandou mensagem para a empresa — OU quem o operador
    // cadastrou aqui de propósito.
    //
    // A regra existe para barrar a agenda do celular entrando em massa sem
    // relacionamento nenhum. Cadastro feito à mão é o oposto disso: é a empresa
    // dizendo que conhece a pessoa. Barrá-lo faria o botão "Novo contato" criar
    // uma ficha que some da tela no mesmo instante.
    {
      OR: [
        { messages: { some: { fromMe: false } } },
        { source: 'manual' },
      ],
    },
  ]

  // Regra 2: número reservado continua reservado.
  const canaisVisiveis = await filtroDeCanaisVisiveis(user.userId, user.role)
  if (canaisVisiveis) and.push(canaisVisiveis)

  // Gerenciador do Conversas: quando há matriz configurada, ela decide o
  // universo de conversas desta pessoa — e contato é conversa.
  const mapa = await mapaDeAcesso(user.userId, user.role)
  const filtroMatriz = await filtroDeConversas(mapa)
  if (filtroMatriz) and.push(filtroMatriz)

  if (opts.respondeu) and.push({ messages: { some: { fromMe: true } } })

  if (opts.grupos === 'excluir') and.push({ isGroup: false })
  else if (opts.grupos === 'apenas') and.push({ isGroup: true })

  if (opts.canal) and.push({ instanceName: opts.canal })
  if (opts.origem) and.push({ source: opts.origem })

  const busca = (opts.busca ?? '').trim()
  if (busca) {
    const alvos: any[] = [
      { nome: { contains: busca } },
      { whatsapp: { contains: busca } },
      { email: { contains: busca } },
      { empresa: { contains: busca } },
      { pushName: { contains: busca } },
    ]
    // Telefone é guardado só com dígitos, e ninguém digita assim: a pessoa
    // copia "(62) 91111-2222" da tela e colava numa busca que não achava nada.
    // Com 4 dígitos ou mais, a versão sem máscara entra junto.
    const digitos = busca.replace(/\D/g, '')
    if (digitos.length >= 4) {
      alvos.push({ whatsapp: { contains: digitos } })
      alvos.push({ phoneKey: { contains: digitos } })
    }
    and.push({ OR: alvos })
  }

  return { AND: and }
}

export async function contatosRoutes(app: FastifyInstance) {
  // ── GET /api/contatos — a lista ─────────────────────────────────────────
  app.get('/api/contatos', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const q = req.query as any
      const user = (req as any).user as JwtPayload
      const limit = Math.min(parseInt(q.limit) || 50, 200)
      const offset = parseInt(q.offset) || 0

      const where = await montarWhere(user, {
        busca: q.search,
        canal: q.canal || undefined,
        origem: q.origem || undefined,
        grupos: q.grupos === 'apenas' ? 'apenas' : q.grupos === 'incluir' ? 'incluir' : 'excluir',
        respondeu: q.respondeu === '1',
      })

      const [contatos, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          // Quem NUNCA conversou (cadastrado à mão) não tem `lastMessageAt`, e
          // ordenação decrescente joga nulo para o fim: a pessoa cadastrava um
          // contato e ele ia parar na última página. `nulls: 'first'` põe no
          // topo quem ainda espera o primeiro contato, que é onde ele é útil.
          //
          // Depois `createdAt`, para o recém-cadastrado ficar à frente dos
          // outros sem conversa. E o id no fim como desempate: sem ele, dois
          // contatos com o mesmo instante trocam de lugar entre páginas e a
          // rolagem repete.
          orderBy: [
            { lastMessageAt: { sort: 'desc', nulls: 'first' } },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          take: limit,
          skip: offset,
          select: SELECAO,
        }),
        prisma.lead.count({ where }),
      ])

      return {
        contatos: contatos.map((c) => ({
          ...c,
          tags: c.tags.map((t) => t.tag),
        })),
        total,
      }
    } catch (err: any) {
      app.log.error(`[contatos] lista: ${err?.message || err}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/contatos/resumo — contador e recortes do topo ──────────────
  // O contador existe para o acúmulo deixar de ser invisível: hoje ninguém sabe
  // quantas conversas estão fora do alcance do resto do sistema.
  app.get('/api/contatos/resumo', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const q = req.query as any
      const user = (req as any).user as JwtPayload
      // Os contadores usam o MESMO recorte da lista — busca e filtro de número
      // incluídos. Número de topo que não bate com o que está na tela ensina o
      // operador a desconfiar dos dois.
      const recorte = {
        busca: q.search,
        canal: q.canal || undefined,
        origem: q.origem || undefined,
        // O filtro "já respondidos" também é recorte da tela. Ficou de fora na
        // primeira correção e os cards voltaram a divergir da lista — a suíte
        // pegou: lista 60, cards 79.
        respondeu: q.respondeu === '1',
      }
      const base = await montarWhere(user, { ...recorte, grupos: 'excluir' })
      const comGrupo = await montarWhere(user, { ...recorte, grupos: 'apenas' })
      const respondidos = await montarWhere(user, { ...recorte, grupos: 'excluir', respondeu: true })

      const [total, grupos, respondeu] = await Promise.all([
        prisma.lead.count({ where: base }),
        prisma.lead.count({ where: comGrupo }),
        prisma.lead.count({ where: respondidos }),
      ])
      return { total, grupos, respondeu, semResposta: total - respondeu }
    } catch (err: any) {
      app.log.error(`[contatos] resumo: ${err?.message || err}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/contatos/canais — as opções dos filtros da tela ────────────
  // Só os números que REALMENTE têm contato nesta lista, e só os que este
  // usuário pode ver: um filtro que oferece uma linha reservada já entrega a
  // informação que a reserva esconde.
  app.get('/api/contatos/canais', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      const where = await montarWhere(user, { grupos: 'incluir' })
      const grupos = await prisma.lead.groupBy({
        by: ['instanceName'],
        where,
        _count: { _all: true },
      })
      const instancias = await prisma.whatsAppInstance.findMany({
        select: { instanceName: true, name: true, phone: true },
      })
      const porNome = new Map(instancias.map((i) => [i.instanceName, i]))
      // As origens presentes, pelo mesmo recorte. Sai daqui junto com os canais
      // porque é a mesma pergunta ("o que dá para filtrar?") e evita um segundo
      // pedido só para preencher um seletor.
      const porOrigem = await prisma.lead.groupBy({
        by: ['source'],
        where,
        _count: { _all: true },
      })

      return {
        canais: grupos
          .filter((g) => !!g.instanceName)
          .map((g) => {
            const inst = porNome.get(g.instanceName as string)
            return {
              instanceName: g.instanceName as string,
              label: inst?.name || (g.instanceName as string),
              number: inst?.phone ?? null,
              contatos: g._count._all,
            }
          })
          .sort((a, b) => b.contatos - a.contatos),
        origens: porOrigem
          .filter((o) => !!o.source)
          .map((o) => ({ source: o.source as string, contatos: o._count._all }))
          .sort((a, b) => b.contatos - a.contatos),
      }
    } catch (err: any) {
      app.log.error(`[contatos] canais: ${err?.message || err}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/contatos — cadastrar um contato à mão ─────────────────────
  // O equivalente ao "Nova conversa" do Conversas, sem abrir atendimento: a
  // empresa conhece a pessoa e quer a ficha antes de haver mensagem. Nasce
  // `source: 'manual'` — é o que a lista usa para acolher quem ainda não
  // escreveu.
  app.post('/api/contatos', { preHandler: [authMiddleware, requireModule('contatos', 'create')] }, async (req, reply) => {
    try {
      const b = (req.body ?? {}) as any
      const user = (req as any).user as JwtPayload
      const nome = String(b.nome ?? '').trim()
      const telefone = String(b.telefone ?? '').replace(/\D/g, '')
      const email = String(b.email ?? '').trim()
      const empresa = String(b.empresa ?? '').trim()

      if (!nome) return reply.code(400).send({ error: 'Informe o nome do contato.' })
      if (!telefone || telefone.length < 10) {
        return reply.code(400).send({ error: 'Informe um telefone válido com DDD.' })
      }
      const chave = phoneKeyDe(telefone)
      if (!chave) return reply.code(400).send({ error: 'Número não reconhecido como telefone válido.' })

      // Já existe? Devolve o que existe em vez de criar uma segunda ficha — é o
      // mesmo princípio do "Nova conversa": um telefone, um contato.
      const existente = await prisma.lead.findFirst({
        where: { phoneKey: chave },
        orderBy: { createdAt: 'desc' },
        select: { id: true, nome: true, qualifiedAt: true },
      })
      if (existente) {
        return reply.code(409).send({
          error: existente.qualifiedAt
            ? `Esse número já é o Lead "${existente.nome}".`
            : `Esse número já está em Contatos como "${existente.nome}".`,
          leadId: existente.id,
          jaEhLead: !!existente.qualifiedAt,
        })
      }

      const criado = await prisma.lead.create({
        data: {
          nome: nome.slice(0, 191),
          // `nomeOrigem: manual` trava o nome contra a sincronização de agenda:
          // quem digitou sabe o nome melhor que o aparelho.
          nomeOrigem: 'manual',
          whatsapp: telefone,
          phoneKey: chave,
          email: email.slice(0, 191),
          empresa: empresa.slice(0, 191),
          source: 'manual',
          // Cadastro é atividade: sem isto o contato nasce sem nenhuma marca de
          // tempo e some no meio de listas ordenadas por movimentação.
          lastActivityAt: new Date(),
          formData: {},
          scores: {},
          // Contato NÃO é lead: sem qualifiedAt, não entra em funil, relatório
          // nem kanban até alguém promover.
          qualifiedAt: null,
        },
        select: { id: true, nome: true, whatsapp: true },
      })

      logEvent({
        leadId: criado.id,
        type: EVENT_TYPES.LEAD_CREATED,
        category: 'lifecycle',
        title: 'Contato cadastrado à mão',
        source: 'panel',
        actorType: 'operator',
        userId: user.userId,
        userName: user.name || user.email,
      })
      return { ok: true, contato: criado }
    } catch (err: any) {
      app.log.error(`[contatos] criar: ${err?.message || err}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── PATCH /api/contatos/:id — editar o cadastro ─────────────────────────
  app.patch('/api/contatos/:id', { preHandler: [authMiddleware, requireModule('contatos', 'edit')] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id)
      const b = (req.body ?? {}) as any
      const user = (req as any).user as JwtPayload

      const atual = await prisma.lead.findUnique({
        where: { id },
        select: { id: true, nome: true, whatsapp: true, email: true, empresa: true, qualifiedAt: true },
      })
      if (!atual) return reply.code(404).send({ error: 'Contato não encontrado.' })
      // A tela é de contatos; editar um Lead por aqui contornaria a permissão do
      // módulo Leads, que pode ser mais restrita.
      if (atual.qualifiedAt) {
        return reply.code(400).send({ error: 'Esse registro já é um Lead — edite pela tela de Leads.' })
      }

      const data: Record<string, unknown> = {}
      const mudou: string[] = []

      if (typeof b.nome === 'string' && b.nome.trim() && b.nome.trim() !== atual.nome) {
        data.nome = b.nome.trim().slice(0, 191)
        // Nome digitado vence qualquer sincronização posterior.
        data.nomeOrigem = 'manual'
        mudou.push('nome')
      }
      if (typeof b.telefone === 'string') {
        const tel = b.telefone.replace(/\D/g, '')
        if (tel && tel !== atual.whatsapp) {
          if (tel.length < 10) return reply.code(400).send({ error: 'Informe um telefone válido com DDD.' })
          const chave = phoneKeyDe(tel)
          if (!chave) return reply.code(400).send({ error: 'Número não reconhecido como telefone válido.' })
          const outro = await prisma.lead.findFirst({ where: { phoneKey: chave, id: { not: id } }, select: { id: true, nome: true } })
          if (outro) return reply.code(409).send({ error: `Esse número já pertence a "${outro.nome}".`, leadId: outro.id })
          data.whatsapp = tel
          data.phoneKey = chave
          mudou.push('telefone')
        }
      }
      if (typeof b.email === 'string' && b.email.trim() !== (atual.email ?? '')) {
        data.email = b.email.trim().slice(0, 191)
        mudou.push('e-mail')
      }
      if (typeof b.empresa === 'string' && b.empresa.trim() !== (atual.empresa ?? '')) {
        data.empresa = b.empresa.trim().slice(0, 191)
        mudou.push('empresa')
      }

      if (!mudou.length) return { ok: true, alterado: false }

      await prisma.lead.update({ where: { id }, data })
      logEvent({
        leadId: id,
        type: EVENT_TYPES.LEAD_EDITED,
        category: 'operator',
        title: `Contato editado: ${mudou.join(', ')}`,
        source: 'panel',
        actorType: 'operator',
        userId: user.userId,
        userName: user.name || user.email,
      })
      return { ok: true, alterado: true, campos: mudou }
    } catch (err: any) {
      app.log.error(`[contatos] editar: ${err?.message || err}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── DELETE /api/contatos/:id — apagar o contato ─────────────────────────
  // Vai para a LIXEIRA, não some: apagar um contato leva junto o histórico da
  // conversa, e quem clica errado precisa de volta.
  app.delete('/api/contatos/:id', { preHandler: [authMiddleware, requireModule('contatos', 'delete')] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id)
      const user = (req as any).user as JwtPayload

      const alvo = await prisma.lead.findUnique({
        where: { id },
        select: { id: true, nome: true, qualifiedAt: true, _count: { select: { messages: true } } },
      })
      if (!alvo) return reply.code(404).send({ error: 'Contato não encontrado.' })
      if (alvo.qualifiedAt) {
        return reply.code(400).send({ error: 'Esse registro já é um Lead — apague pela tela de Leads.' })
      }

      const { moveToTrash, snapshotLead } = await import('../services/trash.js')
      const snapshot = await snapshotLead(id)
      await moveToTrash({
        entityType: 'lead',
        entityId: id,
        entityLabel: alvo.nome || `Contato #${id}`,
        snapshot,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
        reason: 'Apagado no módulo Contatos',
      })
      await prisma.lead.delete({ where: { id } })
      return { ok: true, mensagensApagadas: alvo._count.messages }
    } catch (err: any) {
      app.log.error(`[contatos] apagar: ${err?.message || err}`)
      return reply.code(500).send({ error: err.message })
    }
  })
}
