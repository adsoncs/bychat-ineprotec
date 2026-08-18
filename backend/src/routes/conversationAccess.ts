// src/routes/conversationAccess.ts
//
// A API do gerenciador de acesso do Conversas — a tela onde o superadmin marca
// e desmarca quem acompanha o quê.
//
// Só SUPERADMIN entra. Não é preciosismo: a matriz pode ampliar o alcance de um
// papel para além do próprio scope dele, então quem edita aqui edita o teto de
// todo mundo. Deixar isso na mão de ADMIN significaria que um ADMIN pode se dar
// acesso a canais que o superadmin reservou.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { superadminOnly, type JwtPayload } from '../lib/auth.js'
import { logUserAudit } from '../services/userAudit.js'
import { getIp } from '../services/leadHistory.js'
import { invalidarCacheDeAcesso, CANAL_QUALQUER } from '../services/conversationAccess.js'

/** Papéis que a matriz aceita. SUPERADMIN não entra: ele nunca é regido por ela. */
const PAPEIS = ['ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const

const TIPOS = ['contact', 'group'] as const

interface RegraEntrada {
  channelKey?: unknown
  kind?: unknown
  canView?: unknown
  canCreate?: unknown
  canEdit?: unknown
  canDelete?: unknown
}

/**
 * Valida uma linha vinda da tela.
 *
 * `chavesValidas` é o conjunto de canais que existem AGORA. Uma regra apontando
 * para instância excluída ficaria invisível na tela e ativa no resolvedor — o
 * pior tipo de permissão, a que ninguém vê.
 */
function normalizarRegra(r: RegraEntrada, chavesValidas: Set<string>): {
  channelKey: string; kind: string
  canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean
} | null {
  const channelKey = String(r.channelKey ?? '')
  const kind = String(r.kind ?? '')
  if (!chavesValidas.has(channelKey)) return null
  if (!TIPOS.includes(kind as any)) return null

  const canView = !!r.canView
  const canCreate = !!r.canCreate
  const canEdit = !!r.canEdit
  const canDelete = !!r.canDelete
  // Criar, editar ou excluir sem poder ver é uma linha que não descreve nada
  // possível: toda ação começa por abrir a conversa. Guardar assim faria a tela
  // relê-la depois como se fosse uma permissão de verdade.
  if (!canView && (canCreate || canEdit || canDelete)) return null
  // Linha totalmente desmarcada não vira registro: some da tabela e, se for a
  // última do sujeito, ele volta ao comportamento padrão. É o "desmarcar tudo
  // para voltar atrás" sem botão especial.
  if (!canView && !canCreate && !canEdit && !canDelete) return null

  return { channelKey, kind, canView, canCreate, canEdit, canDelete }
}

export async function conversationAccessRoutes(app: FastifyInstance) {

  // ── GET /api/admin/conversation-access — tudo que a tela precisa ──
  // Canais, papéis, usuários e as regras já gravadas, em uma chamada só: a tela
  // é uma matriz e não tem estado útil pela metade.
  app.get('/api/admin/conversation-access', { preHandler: superadminOnly }, async () => {
    const [instancias, conexoes, usuarios, regras] = await Promise.all([
      prisma.whatsAppInstance.findMany({
        where: { active: true },
        orderBy: { id: 'asc' },
        select: { id: true, instanceName: true, name: true, phone: true, color: true, visibility: true, receiveGroups: true },
      }),
      prisma.cloudApiConnection.findMany({
        where: { active: true },
        orderBy: { id: 'asc' },
        select: { id: true, displayName: true, displayPhone: true, color: true, visibility: true },
      }),
      prisma.user.findMany({
        where: { active: true, role: { not: 'SUPERADMIN' } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true, role: true },
      }),
      prisma.conversationAccessRule.findMany({ orderBy: { id: 'asc' } }),
    ])

    const canais = [
      {
        key: CANAL_QUALQUER,
        label: 'Todos os canais',
        // A tela precisa dizer isto: é a linha que cobre Instagram, Messenger e
        // conversa que ainda não tem mensagem nenhuma — e é a única que cobre.
        hint: 'Inclui Instagram, Messenger e conversas sem número definido',
        number: null as string | null,
        color: null as string | null,
        provider: 'any',
        recebeGrupos: true,
      },
      ...instancias.map((i) => ({
        key: `evolution:${i.id}`,
        label: i.name && i.name !== i.instanceName ? i.name : i.instanceName,
        hint: i.visibility === 'restricted' ? 'Número reservado' : null,
        number: i.phone,
        color: i.color,
        provider: 'evolution',
        // Instância com o toggle desligado nunca vai ter conversa de grupo; a
        // tela usa isso para explicar a coluna vazia em vez de deixar o
        // superadmin marcar algo que não vai acontecer.
        recebeGrupos: i.receiveGroups,
      })),
      ...conexoes.map((c) => ({
        key: `cloud:${c.id}`,
        label: c.displayName || c.displayPhone || `Cloud #${c.id}`,
        hint: c.visibility === 'restricted' ? 'Número reservado' : null,
        number: c.displayPhone,
        color: c.color,
        provider: 'cloud_api',
        // A Cloud API oficial não entrega grupos — a Groups API do Meta só
        // gerencia grupos criados por ela mesma.
        recebeGrupos: false,
      })),
    ]

    // Quais sujeitos estão sob a matriz hoje. A tela destaca isso porque é a
    // diferença entre "configurado" e "segue o padrão", que é o eixo da feature.
    const configurados = {
      roles: [...new Set(regras.filter((r) => r.subjectType === 'role').map((r) => r.subjectId))],
      users: [...new Set(regras.filter((r) => r.subjectType === 'user').map((r) => Number(r.subjectId)))],
    }

    return { canais, papeis: PAPEIS, usuarios, regras, configurados }
  })

  // ── PUT /api/admin/conversation-access/:subjectType/:subjectId ──
  // Substitui TODAS as regras do sujeito pelas enviadas. Lista vazia apaga as
  // dele e o devolve ao comportamento padrão — é o "desmarcar tudo".
  app.put('/api/admin/conversation-access/:subjectType/:subjectId', { preHandler: superadminOnly }, async (req, reply) => {
    const ator = (req as any).user as JwtPayload
    const { subjectType, subjectId } = req.params as any
    const body = (req.body ?? {}) as { rules?: RegraEntrada[] }

    if (subjectType !== 'role' && subjectType !== 'user') {
      return reply.code(400).send({ error: 'Sujeito inválido' })
    }

    let rotulo = ''
    if (subjectType === 'role') {
      if (!PAPEIS.includes(subjectId)) {
        return reply.code(400).send({ error: 'Papel inválido. SUPERADMIN não é regido pela matriz.' })
      }
      rotulo = `papel ${subjectId}`
    } else {
      const uid = parseInt(String(subjectId))
      const alvo = Number.isFinite(uid)
        ? await prisma.user.findUnique({ where: { id: uid }, select: { id: true, name: true, email: true, role: true } })
        : null
      if (!alvo) return reply.code(404).send({ error: 'Usuário não encontrado' })
      if (alvo.role === 'SUPERADMIN') {
        return reply.code(400).send({ error: 'SUPERADMIN não é regido pela matriz.' })
      }
      rotulo = `usuário ${alvo.name || alvo.email}`
    }

    // Canais que existem agora — regra órfã não entra.
    const [instancias, conexoes] = await Promise.all([
      prisma.whatsAppInstance.findMany({ where: { active: true }, select: { id: true } }),
      prisma.cloudApiConnection.findMany({ where: { active: true }, select: { id: true } }),
    ])
    const chavesValidas = new Set<string>([
      CANAL_QUALQUER,
      ...instancias.map((i) => `evolution:${i.id}`),
      ...conexoes.map((c) => `cloud:${c.id}`),
    ])

    const entradas = Array.isArray(body.rules) ? body.rules : []
    const normalizadas = entradas
      .map((r) => normalizarRegra(r, chavesValidas))
      .filter((r): r is NonNullable<typeof r> => r !== null)

    // Deduplica por (canal, tipo): a tela não deveria mandar repetido, mas o
    // createMany quebraria no índice único e o superadmin veria um erro de
    // banco no lugar de um aviso.
    const porChave = new Map<string, (typeof normalizadas)[number]>()
    for (const r of normalizadas) porChave.set(`${r.channelKey}|${r.kind}`, r)
    const finais = [...porChave.values()]

    const anteriores = await prisma.conversationAccessRule.count({
      where: { subjectType, subjectId: String(subjectId) },
    })

    // Troca completa numa transação: um estado intermediário sem regra nenhuma
    // devolveria o sujeito ao comportamento padrão por uma fração de segundo, e
    // uma listagem concorrente veria conversas que a matriz esconde.
    await prisma.$transaction([
      prisma.conversationAccessRule.deleteMany({
        where: { subjectType, subjectId: String(subjectId) },
      }),
      ...(finais.length
        ? [prisma.conversationAccessRule.createMany({
            data: finais.map((r) => ({ ...r, subjectType, subjectId: String(subjectId) })),
          })]
        : []),
    ])

    // O cache é por usuário, e mudar a linha de um PAPEL afeta todo mundo dele:
    // limpar inteiro é mais barato que descobrir quem é quem.
    invalidarCacheDeAcesso()

    await logUserAudit({
      action: 'conversation_access.update',
      actorId: ator.userId,
      actorName: ator.name || ator.email,
      targetUserId: subjectType === 'user' ? parseInt(String(subjectId)) : null,
      targetType: 'module_permission',
      targetLabel: `Acesso ao Conversas — ${rotulo}`,
      changes: { regras: { from: anteriores, to: finais.length } },
      ipAddress: getIp(req),
    })

    return { ok: true, rules: finais.length, configurado: finais.length > 0 }
  })
}
