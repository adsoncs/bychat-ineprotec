// src/routes/supervision.ts
//
// Supervisão — painel gerencial do módulo Conversas.
//
// Não existe entidade própria: uma "conversa" É o Lead, exatamente como em
// routes/atendimento.ts. Este módulo é a visão de cima daquela inbox — os
// mesmos quatro baldes (Caixa / Atendimento / Aguardando / Resolvidos), só que
// sem o recorte por operador e com os números agregados.
//
// Diferença deliberada de escopo: o Conversas filtra por dono/equipe
// (getLeadScope); aqui quem entra é gestão e enxerga TUDO. Por isso o guard é
// por papel (requireSupervisor) e não por canUserAccessLead — quem vê, age.
//
// As ações reaproveitam os mesmos serviços do Conversas (leadConversation,
// botTakeover, routing/helpers), então encerrar por aqui é indistinguível de
// encerrar por lá: mesmo evento na timeline, mesmo efeito no lead.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { resolvePeriod } from '../lib/period.js'
import { logEvent, EVENT_TYPES, getIp, getOperator } from '../services/leadHistory.js'
import { reassignPendingCadenceActivities } from '../services/routing/helpers.js'
import { broadcastRealtimeEvent } from './realtime.js'

const SUPERVISOR_ROLES = new Set(['SUPERADMIN', 'ADMIN', 'MANAGER'])

/**
 * O recorte que o gerenciador do Conversas impõe a quem abre a Supervisão.
 *
 * O painel foi desenhado para ignorar o alcance por dono/setor — "quem entra é
 * gestão e enxerga tudo". Isso continua valendo enquanto ninguém configurou a
 * matriz. A partir do momento em que o superadmin diz por escrito quais canais
 * um papel acompanha, a Supervisão não pode ser a porta dos fundos que devolve
 * o que a tela principal esconde.
 *
 * Devolve `{}` (nenhum recorte) quando não há matriz para o usuário.
 */
async function recorteDaMatriz(req: any): Promise<Record<string, any>> {
  const user = req.user as JwtPayload
  const { mapaDeAcesso, filtroDeConversas } = await import('../services/conversationAccess.js')
  const mapa = await mapaDeAcesso(user.userId, user.role)
  return (await filtroDeConversas(mapa)) ?? {}
}

/**
 * O recorte dos números RESERVADOS, do mesmo jeito que a tela de Conversas faz.
 *
 * Some qualquer conversa que tenha PASSADO por um número reservado ao qual este
 * usuário não tem acesso — e não só as que hoje pertencem a ele: metade de um
 * histórico visível não protege nada.
 *
 * Devolve `{}` quando não há canal reservado, que é o caso de toda instalação
 * que nunca mexeu nisso.
 */
async function recorteDeCanaisReservados(req: any): Promise<Record<string, any>> {
  const user = req.user as JwtPayload
  const { filtroDeCanaisVisiveis } = await import('../services/channelVisibility.js')
  return (await filtroDeCanaisVisiveis(user.userId, user.role)) ?? {}
}

/**
 * Das conversas pedidas, as que este supervisor pode de fato EDITAR.
 *
 * As ações do painel são em lote. Recusar o lote inteiro porque uma conversa
 * está fora do alcance seria pior que inútil — o gestor não tem como saber
 * qual delas travou. Aqui as fora de alcance apenas não entram, e o retorno
 * de cada rota já distingue o que foi feito do que não foi.
 */
async function idsQuePodeEditar(req: any, ids: number[]): Promise<number[]> {
  const user = req.user as JwtPayload
  const { mapaDeAcesso, permissoesNaConversa, permite } = await import('../services/conversationAccess.js')
  const mapa = await mapaDeAcesso(user.userId, user.role)
  if (!mapa.configurado) return ids

  const permitidos: number[] = []
  for (const id of ids) {
    const perms = await permissoesNaConversa(mapa, id)
    if (perms && permite(perms, 'edit')) permitidos.push(id)
  }
  return permitidos
}

/** Só gestão entra. Retorna false já tendo respondido 403. */
function requireSupervisor(req: any, reply: any): boolean {
  const user = req.user as JwtPayload
  if (!SUPERVISOR_ROLES.has(String(user?.role || ''))) {
    reply.code(403).send({ error: 'Painel restrito a supervisão (admin ou gestor)' })
    return false
  }
  return true
}

// ── Baldes ────────────────────────────────────────────────────────────────
// Cópia fiel do lifecycle de routes/atendimento.ts. Se lá mudar, muda aqui:
//   raw      Caixa       — chegou mensagem, ninguém assumiu (inclui o contato
//                          que voltou a falar depois de resolvido)
//   inbox    Atendimento — conversa aberta e não encerrada
//   snoozed  Aguardando  — adormecida OU atribuída sem atendimento iniciado
//   resolved Resolvidos  — conversa encerrada e sem retorno pendente
// O critério é o mesmo de routes/atendimento.ts (condicaoDaCaixa): mudar lá sem
// mudar aqui faz a supervisão contar um mundo e a tela de Conversas outro.
export type Bucket = 'raw' | 'inbox' | 'snoozed' | 'resolved'

function bucketWhere(bucket: Bucket, now: Date): Record<string, unknown> {
  const notSnoozed = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] }
  switch (bucket) {
    case 'raw':
      return {
        AND: [notSnoozed, {
          OR: [
            { conversationOpenedAt: null, lastMessageAt: { not: null }, assignedUserId: null },
            { conversationReopenedAt: { not: null }, assignedUserId: null },
          ],
        }],
      }
    case 'inbox':
      return { conversationOpenedAt: { not: null }, conversationClosedAt: null, AND: [notSnoozed] }
    case 'snoozed':
      return {
        AND: [{
          OR: [
            { snoozedUntil: { gt: now } },
            { assignedUserId: { not: null }, conversationOpenedAt: null, conversationClosedAt: null, lastMessageAt: { not: null } },
            { conversationReopenedAt: { not: null }, assignedUserId: { not: null } },
          ],
        }],
      }
    case 'resolved':
      return { conversationClosedAt: { not: null }, conversationReopenedAt: null }
  }
}

/** Conversas "vivas" — o que a gestão acompanha no dia a dia (exclui resolvidas). */
function activeWhere(now: Date): Record<string, unknown> {
  return {
    OR: [bucketWhere('raw', now), bucketWhere('inbox', now), bucketWhere('snoozed', now)],
  }
}

// ── Filtros da tela ───────────────────────────────────────────────────────
interface Filters {
  bucket?: string
  userId?: string
  teamId?: string
  funnelId?: string
  channel?: string
  bot?: string
  search?: string
  stale?: string
  unread?: string
  kind?: string
  /** '1' = só conversas cuja última mensagem é do contato (tratado na rota, não aqui). */
  waiting?: string
}

function filtersToWhere(q: Filters, now: Date): Record<string, any> {
  const and: any[] = []

  const bucket = (q.bucket || 'active').toString()
  if (bucket === 'active') and.push(activeWhere(now))
  else if (bucket !== 'all') and.push(bucketWhere(bucket as Bucket, now))

  if (q.userId === 'none') and.push({ assignedUserId: null })
  else if (q.userId) {
    const id = parseInt(String(q.userId))
    if (Number.isFinite(id)) and.push({ assignedUserId: id })
  }

  if (q.teamId === 'none') and.push({ teamId: null })
  else if (q.teamId) {
    const id = parseInt(String(q.teamId))
    if (Number.isFinite(id)) and.push({ teamId: id })
  }

  if (q.funnelId === 'none') and.push({ funnelId: null })
  else if (q.funnelId) {
    const id = parseInt(String(q.funnelId))
    if (Number.isFinite(id)) and.push({ funnelId: id })
  }

  // Canal = provider da conversa. Guardado na própria mensagem, então filtra por
  // "tem ao menos uma mensagem deste canal" (mesma abordagem do Conversas).
  const ch = (q.channel || '').toString()
  if (ch === 'cloud_api' || ch === 'evolution') and.push({ messages: { some: { provider: ch } } })
  else if (ch.startsWith('evolution:')) and.push({ messages: { some: { evolutionInstance: ch.slice(10) } } })
  else if (ch.startsWith('cloud:')) {
    const cid = parseInt(ch.slice(6))
    if (Number.isFinite(cid)) and.push({ messages: { some: { cloudApiConnectionId: cid } } })
  }

  if (q.kind === 'groups') and.push({ isGroup: true })
  else if (q.kind === 'contacts') and.push({ isGroup: false })

  if (q.unread === '1') and.push({ unreadMessages: { gt: 0 } })

  // Paradas: sem nenhuma mensagem há mais de N minutos (default 60).
  if (q.stale) {
    const min = parseInt(String(q.stale))
    if (Number.isFinite(min) && min > 0) {
      and.push({ lastMessageAt: { lt: new Date(now.getTime() - min * 60_000) } })
    }
  }

  const search = (q.search || '').toString().trim()
  if (search) {
    and.push({
      OR: [
        { nome: { contains: search } },
        { empresa: { contains: search } },
        { whatsapp: { contains: search } },
        { email: { contains: search } },
      ],
    })
  }

  return and.length ? { AND: and } : {}
}

// ── Estado do chatbot ─────────────────────────────────────────────────────
// Vive em lead.formData: `_botPaused` (humano assumiu), `_aiJourney` (jornada
// IA) e `_script` (fluxo com passos). Ver services/botTakeover.ts.
interface BotState {
  /** quem conduz a conversa agora */
  driver: 'human' | 'bot' | 'none'
  engine: 'ai_journey' | 'scripted' | null
  phase: string | null
  /** passo atual do fluxo com script (1-based para leitura humana) */
  step: number | null
  pausedAt: string | null
  pausedBy: string | null
}

function readBotState(formData: unknown): BotState {
  const fd = (formData || {}) as any
  const paused = fd._botPaused && typeof fd._botPaused === 'object' && fd._botPaused.at ? fd._botPaused : null
  const ai = fd._aiJourney && typeof fd._aiJourney === 'object' ? fd._aiJourney : null
  const script = fd._script && typeof fd._script === 'object' ? fd._script : null

  const engine: BotState['engine'] = ai ? 'ai_journey' : script ? 'scripted' : null
  const phase = ai?.phase ?? script?.phase ?? null
  const step = script && Number.isFinite(script.stepIndex) ? Number(script.stepIndex) + 1 : null

  // Jornada encerrada não conta como "bot conduzindo" — ninguém está tocando.
  const botRunning = !!engine && phase !== 'done' && phase !== 'disqualified'

  return {
    driver: paused ? 'human' : botRunning ? 'bot' : 'none',
    engine,
    phase,
    step,
    pausedAt: paused?.at ?? null,
    pausedBy: paused?.byName ?? null,
  }
}

/** Balde a que a conversa pertence, calculado no mesmo critério das queries. */
function resolveBucket(lead: {
  conversationOpenedAt: Date | null
  conversationClosedAt: Date | null
  conversationReopenedAt: Date | null
  snoozedUntil: Date | null
  assignedUserId: number | null
  lastMessageAt: Date | null
}, now: Date): Bucket {
  // Antes do teste de encerrada: com retorno pendente a conversa saiu de
  // Resolvidos. Vai para a fila de quem tem de responder — Aguardando quando há
  // responsável, Caixa quando não há.
  if (lead.conversationReopenedAt) return lead.assignedUserId ? 'snoozed' : 'raw'
  if (lead.conversationClosedAt) return 'resolved'
  if (lead.snoozedUntil && lead.snoozedUntil > now) return 'snoozed'
  if (lead.conversationOpenedAt) return 'inbox'
  if (lead.assignedUserId && lead.lastMessageAt) return 'snoozed'
  return 'raw'
}

function minutesBetween(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 60_000)
}

export async function supervisionRoutes(app: FastifyInstance) {
  // ── GET /api/supervision/overview — KPIs + distribuições ──
  // `days` recorta apenas os indicadores de fluxo (resolvidas, 1ª resposta,
  // tempo de resolução); as fotos de agora (baldes, fila) são sempre do estado atual.
  app.get('/api/supervision/overview', { preHandler: authMiddleware }, async (req, reply) => {
    if (!requireSupervisor(req, reply)) return
    try {
      const q = (req.query as any) || {}
      const now = new Date()
      // Aceita `from`/`to` (intervalo personalizado da tela) e `range`/`days`.
      const { from: since, to: until, days } = resolvePeriod(q, 7)
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      // As métricas somavam as conversas do número reservado mesmo quando a
      // lista as escondia: o total denunciava o que a linha protegia.
      const base = { AND: [filtersToWhere({ ...q, bucket: 'all' }, now), await recorteDaMatriz(req), await recorteDeCanaisReservados(req)] }
      const withBase = (extra: Record<string, unknown>) => ({ AND: [base, extra] })

      const [raw, inbox, snoozed, resolvedNow, unassigned, unread, resolvedToday, resolvedPeriod, groups, reabertas] =
        await Promise.all([
          prisma.lead.count({ where: withBase(bucketWhere('raw', now)) }),
          prisma.lead.count({ where: withBase(bucketWhere('inbox', now)) }),
          prisma.lead.count({ where: withBase(bucketWhere('snoozed', now)) }),
          prisma.lead.count({ where: withBase(bucketWhere('resolved', now)) }),
          prisma.lead.count({ where: withBase({ AND: [activeWhere(now), { assignedUserId: null }] }) }),
          prisma.lead.count({ where: withBase({ AND: [activeWhere(now), { unreadMessages: { gt: 0 } }] }) }),
          prisma.lead.count({ where: withBase({ conversationClosedAt: { gte: todayStart } }) }),
          prisma.lead.count({ where: withBase({ conversationClosedAt: { gte: since, lte: until } }) }),
          prisma.lead.count({ where: withBase({ AND: [activeWhere(now), { isGroup: true }] }) }),
          // Voltou a falar depois de resolvido: encerramento que não resolveu.
          prisma.lead.count({ where: withBase({ conversationReopenedAt: { gte: since, lte: until } }) }),
        ])

      const activeTotal = raw + inbox + snoozed

      // ── Os conjuntos de ids, sem truncamento ────────────────────────────
      //
      // O `take: 5000` que existia aqui cortava em silêncio E sem `orderBy`:
      // acima de cinco mil conversas a média era de uma amostra arbitrária,
      // decidida pelo plano de execução do banco. Agora o recorte do período
      // é feito onde ele de fato existe — só conversa com mensagem no período
      // pode ter turno no período —, o que mantém a lista curta sem inventar
      // um teto.
      const [idsAtivosRows, idsPeriodoRows] = await Promise.all([
        prisma.lead.findMany({ where: withBase(activeWhere(now)), select: { id: true } }),
        prisma.lead.findMany({
          where: withBase({
            OR: [
              { lastMessageAt: { gte: since, lte: until } },
              { conversationClosedAt: { gte: since, lte: until } },
            ],
          }),
          select: { id: true },
        }),
      ])
      const activeIds = idsAtivosRows.map((r) => r.id)
      const idsPeriodo = idsPeriodoRows.map((r) => r.id)
      const idList = activeIds.join(',')

      /** Quantas linhas cada gaveta de cartão mostra antes do "ver todas". */
      const AMOSTRA_GAVETA = 4

      // ── Ritmo: tempo de resposta medido pelas MENSAGENS ─────────────────
      //
      // O que estava aqui era `assignedAt → firstResponseAt` e
      // `conversationOpenedAt → conversationClosedAt` — os dois dependentes de
      // clique, e o primeiro gravado num único ponto do sistema (concluir uma
      // Atividade), o que o deixava preenchido em 5% dos leads. Ver o cabeçalho
      // de services/responseTime.ts para o diagnóstico completo.
      const {
        relogioDaCasa, metaDeResposta, duracaoDeAtendimento, MIN_AMOSTRA,
        medirTurnos, resumirTurnos, serieDiaria, porOperador, coberturaPorHora, faixasDoRelogio,
      } = await import('../services/responseTime.js')
      const relogio = await relogioDaCasa()
      const metaMin = await metaDeResposta()

      // Janela anterior de MESMO tamanho, para a comparação de ritmo e
      // resultado. "Mediana 5 min" é um fato; "5 min, era 12" é uma direção, e
      // é a direção que a reunião de segunda pergunta.
      const duracaoMs = Math.max(1, until.getTime() - since.getTime())
      const antesDe = new Date(since.getTime() - duracaoMs)
      const antesAte = new Date(since.getTime() - 1)
      const idsAnteriorRows = await prisma.lead.findMany({
        where: withBase({
          OR: [
            { lastMessageAt: { gte: antesDe, lte: antesAte } },
            { conversationClosedAt: { gte: antesDe, lte: antesAte } },
          ],
        }),
        select: { id: true },
      })
      const idsAnterior = idsAnteriorRows.map((r) => r.id)

      const [turnos, turnosAntes, duracao, duracaoAntes, cobertura] = await Promise.all([
        medirTurnos(idsPeriodo, since, until, relogio),
        medirTurnos(idsAnterior, antesDe, antesAte, relogio),
        duracaoDeAtendimento(idsPeriodo, since, until, relogio),
        duracaoDeAtendimento(idsAnterior, antesDe, antesAte, relogio),
        coberturaPorHora(idsPeriodo, since, until, relogio),
      ])
      const ritmo = resumirTurnos(turnos, metaMin, relogio)
      const ritmoAntes = resumirTurnos(turnosAntes, metaMin, relogio)
      const serie = serieDiaria(turnos, relogio)

      // Dono de cada conversa do período, para o comparativo por operador.
      const donos = await prisma.lead.findMany({
        where: { id: { in: idsPeriodo.length ? idsPeriodo : [-1] } },
        select: { id: true, assignedUserId: true },
      })
      const donoDoLead = new Map(donos.map((d) => [d.id, d.assignedUserId]))

      // Quem falou e nunca foi respondido, do mais antigo para o mais novo. Sai
      // do mesmo conjunto de turnos já medido — sem consulta nova para o cálculo,
      // só a busca dos nomes das quatro primeiras linhas.
      const semRespostaOrdenado = turnos
        .filter((t) => t.minutos === null)
        .sort((a, b) => a.pergunta.getTime() - b.pergunta.getTime())
      const idsSemResposta = [...new Set(semRespostaOrdenado.map((t) => t.leadId))].slice(0, AMOSTRA_GAVETA)
      const detalhesSemResposta = idsSemResposta.length
        ? await prisma.lead.findMany({
            where: { id: { in: idsSemResposta } },
            select: {
              id: true, nome: true, empresa: true,
              assignedUser: { select: { name: true, email: true } },
            },
          })
        : []
      const semRespostaPorId = new Map(detalhesSemResposta.map((d) => [d.id, d]))
      const amostraSemResposta = idsSemResposta.map((id) => {
        const d = semRespostaPorId.get(id)
        const turno = semRespostaOrdenado.find((t) => t.leadId === id)
        return {
          id,
          nome: d?.nome || d?.empresa || `#${id}`,
          dono: d?.assignedUser ? (d.assignedUser.name || d.assignedUser.email) : null,
          desdeMin: turno ? minutesBetween(turno.pergunta, now) : null,
        }
      })

      // Nomes de TODOS os operadores que aparecem no período, não só dos que
      // têm fila hoje: quem atendeu bem e ficou sem conversa ativa apareceria
      // no comparativo como "#2".
      const idsOperadores = [...new Set(donos.map((d) => d.assignedUserId).filter((v): v is number => !!v))]
      const nomesOperadores = idsOperadores.length
        ? await prisma.user.findMany({
            where: { id: { in: idsOperadores } },
            select: { id: true, name: true, email: true },
          })
        : []

      // ── Fila de agora: de quem é a bola ─────────────────────────────────
      //
      // "Não lidas" contava o contador que zera quando alguém ABRE a conversa,
      // e abrir não é responder — no beyond o painel dizia 0 com dez clientes
      // esperando. Aqui a pergunta é outra: a última palavra é do contato? É o
      // mesmo critério que a lista desta tela já usa por linha
      // (`waitingSinceMin`), agora também no topo.
      const esperando = activeIds.length
        ? await prisma.$queryRawUnsafe<Array<{ id: number; nome: string | null; desde: Date }>>(
            `SELECT l.id, l.nome, ult.timestamp AS desde
               FROM bychat_leads l
               JOIN bychat_messages ult ON ult.id = (
                 SELECT m2.id FROM bychat_messages m2
                  WHERE m2.leadId = l.id AND m2.isInternal = 0
                  ORDER BY m2.timestamp DESC, m2.id DESC LIMIT 1)
              WHERE l.id IN (${idList}) AND ult.fromMe = 0
              ORDER BY ult.timestamp ASC`,
          ).catch(() => [])
        : []
      // "Espera mais antiga" mede a fila de HOJE, não o arquivo morto.
      //
      // Sem teto, o cartão era sequestrado por uma conversa esquecida em junho
      // e anunciava "85d" todo santo dia — um número verdadeiro e inútil, que
      // não muda com o trabalho da equipe e some da vista justamente porque
      // ninguém pode fazer nada com ele hoje. As esquecidas continuam contadas,
      // à parte: viram um aviso próprio, que é o convite para uma varredura.
      const TETO_ESPERA_DIAS = 30
      const limiteEspera = new Date(now.getTime() - TETO_ESPERA_DIAS * 86_400_000)
      const esperandoRecentes = esperando.filter((e) => new Date(e.desde) >= limiteEspera)
      const esquecidas = esperando.length - esperandoRecentes.length
      const maisAntiga = esperandoRecentes[0] ?? null

      // ── Microdado das gavetas ───────────────────────────────────────────
      //
      // As quatro primeiras linhas de cada cartão vêm JUNTO com o resumo, numa
      // resposta só: o cartão diz "11 esperando" e abre com nome, trecho e
      // tempo sem nova consulta e sem passar pela busca. O número que interessa
      // ao gestor é o nome.
      const idsEsperando = esperando.slice(0, AMOSTRA_GAVETA).map((e) => Number(e.id))
      const detalhesEsperando = idsEsperando.length
        ? await prisma.lead.findMany({
            where: { id: { in: idsEsperando } },
            select: {
              id: true, nome: true, empresa: true,
              assignedUser: { select: { name: true, email: true } },
              messages: {
                where: { isInternal: false },
                orderBy: { timestamp: 'desc' },
                take: 1,
                select: { body: true, timestamp: true },
              },
            },
          })
        : []
      const porId = new Map(detalhesEsperando.map((d) => [d.id, d]))
      const amostraEsperando = esperando.slice(0, AMOSTRA_GAVETA).map((e) => {
        const d = porId.get(Number(e.id))
        return {
          id: Number(e.id),
          nome: d?.nome || d?.empresa || `#${e.id}`,
          dono: d?.assignedUser ? (d.assignedUser.name || d.assignedUser.email) : null,
          trecho: (d?.messages?.[0]?.body || '').slice(0, 90),
          esperaMin: minutesBetween(new Date(e.desde), now),
        }
      })

      // Sem responsável: as que esperam há mais tempo primeiro — é a fila que o
      // gestor distribui na segunda de manhã.
      const amostraSemResponsavel = activeIds.length
        ? await prisma.lead.findMany({
            where: { AND: [{ id: { in: activeIds } }, { assignedUserId: null }] },
            orderBy: { lastMessageAt: 'asc' },
            take: AMOSTRA_GAVETA,
            select: { id: true, nome: true, empresa: true, team: { select: { name: true } }, lastMessageAt: true },
          })
        : []

      const amostraSemNinguem = activeIds.length
        ? await prisma.lead.findMany({
            where: {
              AND: [
                { id: { in: activeIds } },
                { assignedUserId: null },
                withBase(activeWhere(now)),
              ],
            },
            orderBy: { lastMessageAt: 'asc' },
            take: AMOSTRA_GAVETA,
            select: { id: true, nome: true, empresa: true, source: true, lastMessageAt: true },
          })
        : []

      // Quem conduz e por qual canal: as duas dependem de dados que o Prisma não
      // agrega (JSON aninhado e "última mensagem de cada conversa"), então vão de
      // SQL. Para respeitarem os MESMOS filtros da tela, o SQL recebe os ids do
      // conjunto já filtrado em vez de reconsultar por conta própria.
      //
      // O cálculo antigo era `bot = ativas − humanas`: conversa que nunca teve
      // chatbot nenhum entrava como se o bot estivesse conduzindo, e o painel
      // do beyond anunciava 23 conversas "com chatbot" quando havia UMA. São
      // três estados, e o terceiro é o que pede ação: ninguém conduzindo.
      // Mesmos critérios de readBotState() — jornada em fase terminal não
      // conduz coisa alguma.
      const conducao = activeIds.length
        ? await prisma.$queryRawUnsafe<Array<{ humano: bigint; bot: bigint; ninguem: bigint }>>(
            `WITH f AS (
               SELECT assignedUserId,
                      (JSON_EXTRACT(formData, '$._botPaused') IS NOT NULL) AS humano,
                      ((JSON_EXTRACT(formData, '$._aiJourney') IS NOT NULL
                        OR JSON_EXTRACT(formData, '$._script') IS NOT NULL)
                       AND COALESCE(
                             JSON_UNQUOTE(JSON_EXTRACT(formData, '$._aiJourney.phase')),
                             JSON_UNQUOTE(JSON_EXTRACT(formData, '$._script.phase')), ''
                           ) NOT IN ('done', 'disqualified')) AS bot_ativo
                 FROM bychat_leads WHERE id IN (${idList})
             )
             SELECT COALESCE(SUM(humano), 0) AS humano,
                    COALESCE(SUM(NOT humano AND bot_ativo), 0) AS bot,
                    COALESCE(SUM(NOT humano AND NOT bot_ativo AND assignedUserId IS NULL), 0) AS ninguem
               FROM f`,
          ).catch(() => [])
        : []
      const comHumano = Number(conducao?.[0]?.humano ?? 0)
      const comBot = Number(conducao?.[0]?.bot ?? 0)
      const semNinguem = Number(conducao?.[0]?.ninguem ?? 0)

      // Distribuições — groupBy nativo; nomes resolvidos depois em lote.
      const [byUser, byTeam, byFunnel, byStage] = await Promise.all([
        prisma.lead.groupBy({ by: ['assignedUserId'], where: withBase(activeWhere(now)), _count: { _all: true } }),
        prisma.lead.groupBy({ by: ['teamId'], where: withBase(activeWhere(now)), _count: { _all: true } }),
        prisma.lead.groupBy({ by: ['funnelId'], where: withBase(activeWhere(now)), _count: { _all: true } }),
        prisma.lead.groupBy({ by: ['status'], where: withBase(activeWhere(now)), _count: { _all: true } }),
      ])

      const userIds = byUser.map((r) => r.assignedUserId).filter((v): v is number => !!v)
      const teamIds = byTeam.map((r) => r.teamId).filter((v): v is number => !!v)
      const funnelIds = byFunnel.map((r) => r.funnelId).filter((v): v is number => !!v)
      const [users, teams, funnels] = await Promise.all([
        userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
        teamIds.length ? prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true, color: true } }) : [],
        funnelIds.length ? prisma.funnel.findMany({ where: { id: { in: funnelIds } }, select: { id: true, name: true } }) : [],
      ])
      const userById = new Map(users.map((u) => [u.id, u.name || u.email]))
      const teamById = new Map(teams.map((t) => [t.id, t]))
      const funnelById = new Map(funnels.map((f) => [f.id, f.name]))

      // Canal: provider/instância da ÚLTIMA mensagem de cada conversa do conjunto filtrado.
      const channelRows = activeIds.length
        ? await prisma.$queryRawUnsafe<Array<{ channel: string | null; total: bigint }>>(
            `SELECT canal AS channel, COUNT(*) AS total FROM (
               SELECT (SELECT CONCAT(m.provider, CASE WHEN m.provider = 'evolution'
                                                      THEN CONCAT(':', COALESCE(m.evolutionInstance, ''))
                                                      ELSE CONCAT(':', COALESCE(m.cloudApiConnectionId, '')) END)
                       FROM bychat_messages m WHERE m.leadId = l.id ORDER BY m.timestamp DESC LIMIT 1) AS canal
               FROM bychat_leads l WHERE l.id IN (${idList})
             ) x GROUP BY canal ORDER BY total DESC`,
          ).catch(() => [])
        : []

      return {
        generatedAt: now.toISOString(),
        periodDays: days,
        buckets: { raw, inbox, snoozed, resolved: resolvedNow, active: activeTotal },
        // Três blocos, e cada um diz o que é: `agora` é foto do estado (não
        // responde ao seletor de período), `ritmo` e `resultado` são do período.
        // Misturar os dois sem dizer qual é qual foi metade da confusão que o
        // painel antigo criava na reunião de gestão.
        kpis: {
          agora: {
            activeTotal,
            unassigned,
            esperandoResposta: esperando.length,
            esperaMaisAntigaMin: maisAntiga ? minutesBetween(new Date(maisAntiga.desde), now) : null,
            esperaMaisAntigaLead: maisAntiga ? { id: Number(maisAntiga.id), nome: maisAntiga.nome } : null,
            /** Esperando há mais de 30 dias — fora do cartão de espera, contadas aqui. */
            esquecidas,
            esquecidasDias: TETO_ESPERA_DIAS,
            comHumano,
            comBot,
            semNinguem,
            groups,
            unread,
          },
          ritmo: {
            respostaMedianaMin: ritmo.resposta.mediana,
            respostaP90Min: ritmo.resposta.p90,
            respostaMediaMin: ritmo.resposta.media,
            amostra: ritmo.resposta.amostra,
            insuficiente: ritmo.resposta.insuficiente,
            dentroDaMetaPct: ritmo.dentroDaMetaPct,
            dentroDaMeta: ritmo.dentroDaMeta,
            metaMin: ritmo.metaMin,
            semResposta: ritmo.semResposta,
            turnos: ritmo.turnos,
            relogio: ritmo.relogio,
          },
          resultado: {
            atendidas: ritmo.turnos - ritmo.semResposta,
            encerradasHoje: resolvedToday,
            encerradasPeriodo: resolvedPeriod,
            encerradasEmLote: duracao.emLote,
            reabertas,
            duracaoMedianaMin: duracao.duracao.mediana,
            duracaoP90Min: duracao.duracao.p90,
            duracaoAmostra: duracao.duracao.amostra,
            duracaoInsuficiente: duracao.duracao.insuficiente,
          },
          minAmostra: MIN_AMOSTRA,
          // O período imediatamente anterior, de mesmo tamanho. Só ritmo e
          // resultado: foto do agora não tem "período anterior".
          anterior: {
            respostaMedianaMin: ritmoAntes.resposta.mediana,
            respostaP90Min: ritmoAntes.resposta.p90,
            dentroDaMetaPct: ritmoAntes.dentroDaMetaPct,
            semResposta: ritmoAntes.semResposta,
            amostra: ritmoAntes.resposta.amostra,
            insuficiente: ritmoAntes.resposta.insuficiente,
            atendidas: ritmoAntes.turnos - ritmoAntes.semResposta,
            encerradas: duracaoAntes.encerradas + duracaoAntes.emLote,
            encerradasEmLote: duracaoAntes.emLote,
            duracaoMedianaMin: duracaoAntes.duracao.mediana,
            duracaoInsuficiente: duracaoAntes.duracao.insuficiente,
            de: antesDe.toISOString(),
            ate: antesAte.toISOString(),
          },
        },
        // As quatro primeiras linhas de cada gaveta, para o cartão abrir sem
        // nova consulta.
        amostras: {
          esperando: amostraEsperando,
          semResponsavel: amostraSemResponsavel.map((l) => ({
            id: l.id,
            nome: l.nome || l.empresa || `#${l.id}`,
            setor: l.team?.name ?? null,
            paradoDesdeMin: l.lastMessageAt ? minutesBetween(l.lastMessageAt, now) : null,
          })),
          semResposta: amostraSemResposta,
          semNinguem: amostraSemNinguem.map((l) => ({
            id: l.id,
            nome: l.nome || l.empresa || `#${l.id}`,
            origem: l.source,
            paradoDesdeMin: l.lastMessageAt ? minutesBetween(l.lastMessageAt, now) : null,
          })),
        },
        // Séries dos gráficos — todas do mesmo conjunto já medido.
        serie: {
          porDia: serie,
          porHora: cobertura,
          expediente: faixasDoRelogio(relogio),
        },
        porOperador: porOperador(
          turnos,
          donoDoLead,
          new Map([...users, ...nomesOperadores].map((u) => [u.id, u.name || u.email])),
          new Map(byUser.map((r) => [r.assignedUserId, r._count._all])),
          metaMin,
        ),
        byUser: byUser
          .map((r) => ({
            id: r.assignedUserId,
            name: r.assignedUserId ? (userById.get(r.assignedUserId) ?? `#${r.assignedUserId}`) : 'Sem responsável',
            total: r._count._all,
          }))
          .sort((a, b) => b.total - a.total),
        byTeam: byTeam
          .map((r) => ({
            id: r.teamId,
            name: r.teamId ? (teamById.get(r.teamId)?.name ?? `#${r.teamId}`) : 'Sem setor',
            color: r.teamId ? (teamById.get(r.teamId)?.color ?? null) : null,
            total: r._count._all,
          }))
          .sort((a, b) => b.total - a.total),
        byFunnel: byFunnel
          .map((r) => ({
            id: r.funnelId,
            name: r.funnelId ? (funnelById.get(r.funnelId) ?? `#${r.funnelId}`) : 'Sem funil',
            total: r._count._all,
          }))
          .sort((a, b) => b.total - a.total),
        byStage: byStage
          .map((r) => ({ key: r.status, total: r._count._all }))
          .sort((a, b) => b.total - a.total),
        byChannel: (channelRows || []).map((r) => ({ channel: r.channel || 'sem mensagem', total: Number(r.total) })),
      }
    } catch (err: any) {
      app.log.error(`Supervision overview error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/supervision/conversations — lista detalhada ──
  app.get('/api/supervision/conversations', { preHandler: authMiddleware }, async (req, reply) => {
    if (!requireSupervisor(req, reply)) return
    try {
      const q = (req.query as any) || {}
      const now = new Date()
      const limit = Math.min(parseInt(q.limit) || 50, 200)
      const offset = parseInt(q.offset) || 0
      // A Supervisão nasceu antes dos números reservados e nunca aplicou o
      // recorte deles: as conversas que passaram pela linha pessoal apareciam
      // inteiras para qualquer supervisor. É o mesmo filtro que a tela de
      // Conversas usa — aqui faltava.
      const where: any = { AND: [filtersToWhere(q, now), await recorteDaMatriz(req), await recorteDeCanaisReservados(req)] }

      // ?waiting=1 — só as conversas em que a bola está com a operação (a última
      // mensagem é do contato). É o filtro que faz o cartão "Esperando resposta"
      // do topo virar lista com um clique.
      //
      // Vai de SQL porque "a ÚLTIMA mensagem" não é expressável no where do
      // Prisma: `messages: { some: ... }` responde "existe alguma", que é outra
      // pergunta — e foi justamente a confusão entre as duas que fazia o painel
      // dizer "0 não lidas" com gente esperando.
      if (String(q.waiting || '') === '1') {
        const bolaConosco = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
          `SELECT l.id FROM bychat_leads l
             JOIN bychat_messages ult ON ult.id = (
               SELECT m2.id FROM bychat_messages m2
                WHERE m2.leadId = l.id AND m2.isInternal = 0
                ORDER BY m2.timestamp DESC, m2.id DESC LIMIT 1)
            WHERE ult.fromMe = 0
              AND (l.conversationClosedAt IS NULL OR l.conversationReopenedAt IS NOT NULL)`,
        ).catch(() => [])
        const ids = (bolaConosco || []).map((r) => Number(r.id))
        where.AND.push({ id: { in: ids.length ? ids : [-1] } })
      }

      // Ordenação da lista. As colunas de Contato, Responsável, Setor e Funil
      // viraram cabeçalho clicável quando esses filtros saíram da barra: quem
      // perde o menu precisa de outro jeito de agrupar o que é parecido.
      //
      // Canal fica de fora de propósito — ele não é coluna do lead, é derivado
      // da ÚLTIMA mensagem, e ordenar por isso exigiria resolver a última
      // mensagem de cada conversa antes de paginar. Prometer uma ordenação que
      // pagina errado é pior que não ter.
      const sort = (q.sort || 'recent').toString()
      const ORDENACOES: Record<string, any> = {
        recent: { lastMessageAt: 'desc' as const },
        oldest: { lastMessageAt: 'asc' as const },
        unread: { unreadMessages: 'desc' as const },
        name: { nome: 'asc' as const },
        'name-desc': { nome: 'desc' as const },
        owner: { assignedUser: { name: 'asc' as const } },
        'owner-desc': { assignedUser: { name: 'desc' as const } },
        team: { team: { name: 'asc' as const } },
        'team-desc': { team: { name: 'desc' as const } },
        funnel: { funnel: { name: 'asc' as const } },
        'funnel-desc': { funnel: { name: 'desc' as const } },
      }
      const orderBy = ORDENACOES[sort] ?? ORDENACOES.recent

      const [rows, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          orderBy,
          take: limit,
          skip: offset,
          select: {
            id: true, nome: true, empresa: true, whatsapp: true, email: true,
            status: true, funnelId: true, source: true, isGroup: true,
            unreadMessages: true, lastMessageAt: true, createdAt: true,
            assignedUserId: true, assignedAt: true, firstResponseAt: true,
            conversationOpenedAt: true, conversationClosedAt: true, snoozedUntil: true,
            conversationReopenedAt: true,
            profilePicUrl: true, formData: true, chatbotId: true,
            assignedUser: { select: { id: true, name: true, email: true } },
            team: { select: { id: true, name: true, color: true } },
            funnel: { select: { id: true, name: true } },
            messages: {
              orderBy: { timestamp: 'desc' },
              take: 1,
              select: {
                body: true, fromMe: true, timestamp: true, provider: true,
                evolutionInstance: true,
                cloudApiConnection: { select: { id: true, displayPhone: true, displayName: true } },
              },
            },
          },
        }),
        prisma.lead.count({ where }),
      ])

      // Nome da etapa: status é a chave; o rótulo vive em Stage, por funil.
      const funnelIds = Array.from(new Set(rows.map((r) => r.funnelId).filter((v): v is number => !!v)))
      const stages = funnelIds.length
        ? await prisma.stage.findMany({ where: { funnelId: { in: funnelIds } }, select: { funnelId: true, key: true, name: true } })
        : []
      const stageLabel = new Map(stages.map((s) => [`${s.funnelId}:${s.key}`, s.name]))

      const conversations = rows.map((r) => {
        const last = r.messages[0] ?? null
        const bot = readBotState(r.formData)
        const bucket = resolveBucket(r, now)
        // "Esperando desde": só conta quando a última mensagem é do lead — se o
        // último a falar fomos nós, a bola está com ele, não com a operação.
        const waitingSinceMin = last && !last.fromMe ? minutesBetween(last.timestamp, now) : null
        return {
          id: r.id,
          nome: r.nome,
          empresa: r.empresa,
          whatsapp: r.whatsapp,
          email: r.email,
          profilePicUrl: r.profilePicUrl,
          isGroup: r.isGroup,
          bucket,
          stageKey: r.status,
          stageName: r.funnelId ? (stageLabel.get(`${r.funnelId}:${r.status}`) ?? r.status) : r.status,
          funnel: r.funnel ? { id: r.funnel.id, name: r.funnel.name } : null,
          source: r.source,
          assignedUser: r.assignedUser ? { id: r.assignedUser.id, name: r.assignedUser.name || r.assignedUser.email } : null,
          team: r.team ?? null,
          unreadMessages: r.unreadMessages,
          lastMessageAt: r.lastMessageAt,
          lastMessage: last ? { body: (last.body || '').slice(0, 140), fromMe: last.fromMe, at: last.timestamp } : null,
          channel: last
            ? {
                provider: last.provider,
                instance: last.evolutionInstance,
                connectionId: last.cloudApiConnection?.id ?? null,
                label: last.provider === 'cloud_api'
                  ? (last.cloudApiConnection?.displayName || last.cloudApiConnection?.displayPhone || 'API Oficial')
                  : (last.evolutionInstance || 'WhatsApp'),
              }
            : null,
          bot,
          chatbotId: r.chatbotId,
          waitingSinceMin,
          firstResponseMin: minutesBetween(r.assignedAt, r.firstResponseAt),
          openMin: minutesBetween(r.conversationOpenedAt, r.conversationClosedAt ?? now),
          snoozedUntil: r.snoozedUntil,
          conversationOpenedAt: r.conversationOpenedAt,
          conversationClosedAt: r.conversationClosedAt,
          createdAt: r.createdAt,
        }
      })

      return { conversations, total, limit, offset }
    } catch (err: any) {
      app.log.error(`Supervision list error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/supervision/filters — opções dos seletores ──
  app.get('/api/supervision/filters', { preHandler: authMiddleware }, async (req, reply) => {
    if (!requireSupervisor(req, reply)) return
    try {
      const user = (req as any).user as JwtPayload
      const [users, teams, funnels, todasInstances, todasConnections] = await Promise.all([
        prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
        prisma.team.findMany({ where: { active: true }, select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } }),
        prisma.funnel.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.whatsAppInstance.findMany({ select: { instanceName: true, phone: true } }).catch(() => []),
        prisma.cloudApiConnection.findMany({ where: { active: true }, select: { id: true, displayName: true, displayPhone: true } }).catch(() => []),
      ])
      // O filtro por número listava TODOS os canais, reservados inclusive: o
      // nome e o telefone da linha pessoal apareciam para qualquer supervisor.
      const { podarCanaisReservados } = await import('../services/channelVisibility.js')
      const [instances, connections] = await Promise.all([
        podarCanaisReservados(todasInstances as any[], user.userId, user.role, (i: any) => ({ instanceName: i.instanceName })),
        podarCanaisReservados(todasConnections as any[], user.userId, user.role, (c: any) => ({ conexaoId: c.id })),
      ])
      return {
        users: users.map((u) => ({ id: u.id, name: u.name || u.email })),
        teams,
        funnels,
        channels: [
          ...instances.map((i: any) => ({ value: `evolution:${i.instanceName}`, label: i.phone ? `${i.instanceName} (${i.phone})` : i.instanceName })),
          ...connections.map((c: any) => ({ value: `cloud:${c.id}`, label: c.displayName || c.displayPhone || `Conexão #${c.id}` })),
        ],
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/supervision/conversations/close — encerrar (uma ou várias) ──
  app.post('/api/supervision/conversations/close', { preHandler: authMiddleware }, async (req, reply) => {
    if (!requireSupervisor(req, reply)) return
    try {
      const user = (req as any).user as JwtPayload
      const ids = normalizeIds((req.body as any)?.leadIds)
      if (!ids.length) return reply.code(400).send({ error: 'Informe leadIds' })
      const alvos = await idsQuePodeEditar(req, ids)
      if (!alvos.length) return reply.code(403).send({ error: 'Sem permissão sobre estas conversas' })

      const { closeConversation } = await import('../services/leadConversation.js')
      const done: number[] = []
      const failed: Array<{ id: number; error: string }> = []
      for (const id of alvos) {
        try {
          await closeConversation(id, { byUserId: user.userId, byUserName: user.name || user.email })
          await prisma.lead.update({ where: { id }, data: { completed: true } })
          done.push(id)
        } catch (e: any) {
          failed.push({ id, error: e?.message || 'falhou' })
        }
      }
      broadcastRealtimeEvent({ type: 'ticket:closed', payload: { leadIds: done, via: 'supervision' } }).catch(() => {})
      return { ok: true, closed: done.length, failed }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/supervision/conversations/reopen ──
  app.post('/api/supervision/conversations/reopen', { preHandler: authMiddleware }, async (req, reply) => {
    if (!requireSupervisor(req, reply)) return
    try {
      const user = (req as any).user as JwtPayload
      const ids = normalizeIds((req.body as any)?.leadIds)
      if (!ids.length) return reply.code(400).send({ error: 'Informe leadIds' })
      const alvos = await idsQuePodeEditar(req, ids)
      if (!alvos.length) return reply.code(403).send({ error: 'Sem permissão sobre estas conversas' })

      const { openConversation } = await import('../services/leadConversation.js')
      let count = 0
      for (const id of alvos) {
        try {
          await openConversation(id, { byUserId: user.userId, byUserName: user.name || user.email, reason: 'manual' })
          await prisma.lead.update({ where: { id }, data: { completed: false } })
          count++
        } catch { /* segue para os demais */ }
      }
      broadcastRealtimeEvent({ type: 'ticket:opened', payload: { leadIds: ids, via: 'supervision' } }).catch(() => {})
      return { ok: true, reopened: count }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/supervision/conversations/resume-bot — devolver ao chatbot ──
  app.post('/api/supervision/conversations/resume-bot', { preHandler: authMiddleware }, async (req, reply) => {
    if (!requireSupervisor(req, reply)) return
    try {
      const user = (req as any).user as JwtPayload
      const ids = normalizeIds((req.body as any)?.leadIds)
      if (!ids.length) return reply.code(400).send({ error: 'Informe leadIds' })
      const alvos = await idsQuePodeEditar(req, ids)
      if (!alvos.length) return reply.code(403).send({ error: 'Sem permissão sobre estas conversas' })

      const { resumeBot } = await import('../services/botTakeover.js')
      let count = 0
      for (const id of alvos) {
        const ok = await resumeBot(id, { userId: user.userId, userName: user.name || user.email }).catch(() => false)
        if (ok) count++
      }
      return { ok: true, resumed: count }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/supervision/conversations/assign — transferir operador/setor ──
  // body: { leadIds: number[], userId?: number|null, teamId?: number|null, reason?: string }
  // Mesma semântica do Conversas (null solta para a fila), sem o teto de escopo:
  // supervisão transfere qualquer conversa, para qualquer operador ativo.
  app.post('/api/supervision/conversations/assign', { preHandler: authMiddleware }, async (req, reply) => {
    if (!requireSupervisor(req, reply)) return
    try {
      const body = (req.body as any) || {}
      const ids = normalizeIds(body.leadIds)
      if (!ids.length) return reply.code(400).send({ error: 'Informe leadIds' })
      const alvos = await idsQuePodeEditar(req, ids)
      if (!alvos.length) return reply.code(403).send({ error: 'Sem permissão sobre estas conversas' })

      const hasUser = body.userId !== undefined
      const hasTeam = body.teamId !== undefined
      if (!hasUser && !hasTeam) return reply.code(400).send({ error: 'Informe userId e/ou teamId' })

      const newUserId = body.userId === null ? null : (hasUser ? parseInt(body.userId) : undefined)
      const newTeamId = body.teamId === null ? null : (hasTeam ? parseInt(body.teamId) : undefined)

      if (newUserId) {
        const u = await prisma.user.findUnique({ where: { id: newUserId }, select: { id: true, active: true, name: true, email: true } })
        if (!u?.active) return reply.code(400).send({ error: 'Operador destino inválido ou inativo' })
      }
      if (newTeamId) {
        const t = await prisma.team.findUnique({ where: { id: newTeamId }, select: { id: true, active: true, name: true } })
        if (!t?.active) return reply.code(400).send({ error: 'Setor destino inválido ou inativo' })
      }

      const [destUser, destTeam] = await Promise.all([
        newUserId ? prisma.user.findUnique({ where: { id: newUserId }, select: { name: true, email: true } }) : null,
        newTeamId ? prisma.team.findUnique({ where: { id: newTeamId }, select: { name: true } }) : null,
      ])
      const destLabel = `${destUser ? (destUser.name || destUser.email) : 'fila'} / ${destTeam?.name || 'sem setor'}`

      let count = 0
      for (const id of alvos) {
        const prev = await prisma.lead.findUnique({
          where: { id },
          select: { assignedUserId: true, teamId: true },
        })
        if (!prev) continue
        const data: Record<string, unknown> = {}
        if (newUserId !== undefined) data.assignedUserId = newUserId
        if (newTeamId !== undefined) data.teamId = newTeamId
        data.assignedAt = (newUserId ?? prev.assignedUserId) || (newTeamId ?? prev.teamId) ? new Date() : null
        await prisma.lead.update({ where: { id }, data })

        // Cadência acompanha o novo responsável (mesmo efeito do Conversas).
        if (newUserId !== undefined && newUserId !== prev.assignedUserId) {
          await reassignPendingCadenceActivities(id, newUserId).catch(() => 0)
        }

        // Aviso ao contato — mesma regra do Conversas. Em lote isso poderia virar
        // rajada, mas o serviço só avisa uma vez por conversa a cada 10 minutos e
        // ignora quem ainda não recebeu mensagem humana.
        if (newUserId) {
          const { notifyAssignmentChange } = await import('../services/operatorIdentity.js')
          notifyAssignmentChange({
            leadId: id,
            novoUserId: newUserId,
            novoTeamId: newTeamId ?? prev.teamId ?? null,
            actorUserId: (req as any).user.userId,
            actorRole: (req as any).user.role,
          }).catch(() => {})
        }

        logEvent({
          leadId: id,
          type: EVENT_TYPES.OPERATOR_ASSIGNED,
          category: 'operator',
          title: newUserId === null && newTeamId === undefined
            ? 'Lead devolvido à fila pela Supervisão'
            : `Transferido pela Supervisão para ${destLabel}`,
          source: 'panel',
          ...getOperator(req),
          newValue: destLabel,
          description: body.reason || null,
          metadata: { via: 'supervision', previousAssignedUserId: prev.assignedUserId, previousTeamId: prev.teamId },
          ipAddress: getIp(req),
        })
        count++
      }
      return { ok: true, assigned: count }
    } catch (err: any) {
      app.log.error(`Supervision assign error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/supervision/conversations/snooze — adormecer / acordar ──
  // body: { leadIds: number[], until?: string|null }  (until null = acordar)
  app.post('/api/supervision/conversations/snooze', { preHandler: authMiddleware }, async (req, reply) => {
    if (!requireSupervisor(req, reply)) return
    try {
      const body = (req.body as any) || {}
      const ids = normalizeIds(body.leadIds)
      if (!ids.length) return reply.code(400).send({ error: 'Informe leadIds' })
      const alvos = await idsQuePodeEditar(req, ids)
      if (!alvos.length) return reply.code(403).send({ error: 'Sem permissão sobre estas conversas' })

      let until: Date | null = null
      if (body.until) {
        until = new Date(body.until)
        if (Number.isNaN(until.getTime())) return reply.code(400).send({ error: 'Data inválida' })
        if (until.getTime() <= Date.now()) return reply.code(400).send({ error: 'Data deve ser no futuro' })
      }

      await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { snoozedUntil: until } })
      for (const id of alvos) {
        logEvent({
          leadId: id,
          type: EVENT_TYPES.OPERATOR_ASSIGNED,
          category: 'operator',
          title: until ? `Adormecido pela Supervisão até ${until.toISOString()}` : 'Acordado pela Supervisão',
          source: 'panel',
          ...getOperator(req),
          metadata: { via: 'supervision', snoozedUntil: until?.toISOString() ?? null },
          ipAddress: getIp(req),
        })
      }
      return { ok: true, updated: alvos.length }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}

/** Aceita number | number[] e devolve ids únicos e válidos. */
function normalizeIds(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  return Array.from(new Set(arr.map((v) => parseInt(String(v))).filter((n) => Number.isFinite(n) && n > 0)))
}
