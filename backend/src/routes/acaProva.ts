// src/routes/acaProva.ts
// Prova online (T-203): banco de questões e aplicação pública por token.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import {
  novoToken, estadoAplicacao, questoesParaCandidato,
  iniciar, salvarResposta, entregar, corrigirDissertativa, lerRubrica,
} from '../services/acaProva.js'
import { auditActor } from '../services/userAudit.js'

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
const tokOf = (req: any): string => String((req.query as any)?.t || (req.body as any)?.t || '')

export async function acaProvaRoutes(app: FastifyInstance) {
  // ── Banco de questões ──
  app.get('/api/admin/aca/questoes', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = { ativa: true }
    if (q?.area) where.area = String(q.area)
    if (q?.tipo) where.tipo = String(q.tipo).toUpperCase()
    return { questoes: await prisma.acaQuestao.findMany({ where, orderBy: { id: 'desc' }, take: 300 }) }
  })

  app.post('/api/admin/aca/questoes', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.enunciado?.trim()) return reply.code(400).send({ error: 'Enunciado é obrigatório' })
    const tipo = String(b.tipo || 'OBJETIVA').toUpperCase()
    if (tipo === 'OBJETIVA') {
      if (!Array.isArray(b.alternativas) || b.alternativas.length < 2) {
        return reply.code(400).send({ error: 'Questão objetiva precisa de ao menos 2 alternativas' })
      }
      if (!b.gabarito) return reply.code(400).send({ error: 'Informe o gabarito da questão objetiva' })
      const ids = b.alternativas.map((a: any) => String(a.id).toLowerCase())
      if (!ids.includes(String(b.gabarito).toLowerCase())) {
        return reply.code(400).send({ error: 'O gabarito precisa corresponder a uma das alternativas' })
      }
    }
    const questao = await prisma.acaQuestao.create({
      data: {
        area: String(b.area || 'Geral').substring(0, 60), enunciado: String(b.enunciado), tipo,
        alternativas: tipo === 'OBJETIVA' ? b.alternativas : undefined,
        gabarito: tipo === 'OBJETIVA' ? String(b.gabarito) : null,
        peso: Number(b.peso) || 1, dificuldade: b.dificuldade ?? null,
        // Rubrica só faz sentido em dissertativa; gravar em objetiva seria
        // deixar no banco uma régua que nunca vai ser usada.
        rubricaJson: tipo !== 'OBJETIVA' && Array.isArray(b.rubrica) && b.rubrica.length > 0
          ? (lerRubrica(b.rubrica) as any)
          : undefined,
      },
    })
    return reply.code(201).send({ questao })
  })

  // ── Provas ──
  app.get('/api/admin/aca/provas', { preHandler: authMiddleware }, async () => ({
    provas: await prisma.acaProva.findMany({
      orderBy: { id: 'desc' },
      include: { _count: { select: { itens: true, aplicacoes: true } } },
    }),
  }))

  app.post('/api/admin/aca/provas', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.titulo?.trim()) return reply.code(400).send({ error: 'Título é obrigatório' })
    const questaoIds: number[] = Array.isArray(b.questaoIds) ? b.questaoIds.map(Number).filter(Boolean) : []
    const prova = await prisma.acaProva.create({
      data: {
        titulo: String(b.titulo).substring(0, 191), instrucoes: b.instrucoes ?? null,
        processoId: num(b.processoId), duracaoMinutos: Number(b.duracaoMinutos) || 120,
        notaMaxima: Number(b.notaMaxima) || 100,
        inicioEm: b.inicioEm ? new Date(b.inicioEm) : null,
        fimEm: b.fimEm ? new Date(b.fimEm) : null,
        itens: { create: questaoIds.map((questaoId, i) => ({ questaoId, ordem: i, peso: 1 })) },
      },
      include: { itens: true },
    })
    return reply.code(201).send({ prova })
  })

  app.post('/api/admin/aca/provas/:id/publicar', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const itens = await prisma.acaProvaItem.count({ where: { provaId: id } })
    if (itens === 0) return reply.code(400).send({ error: 'A prova não tem questões — publicar deixaria o candidato sem nada para responder' })
    const prova = await prisma.acaProva.update({ where: { id }, data: { publicada: true } })
    return { prova }
  })

  /** Gera o acesso do candidato (link único por pessoa). */
  app.post('/api/admin/aca/provas/:id/candidatos', { preHandler: authMiddleware }, async (req, reply) => {
    const provaId = num((req.params as any).id)
    const b = (req.body as any) || {}
    if (!provaId) return reply.code(400).send({ error: 'id inválido' })
    if (!b.nome?.trim()) return reply.code(400).send({ error: 'Nome do candidato é obrigatório' })
    const token = novoToken()
    const aplicacao = await prisma.acaProvaAplicacao.create({
      data: {
        provaId, token, candidatoNome: String(b.nome).substring(0, 191),
        candidatoCpf: b.cpf ?? null, inscricaoId: num(b.inscricaoId),
      },
    })
    const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || 'https'
    return reply.code(201).send({
      aplicacao,
      url: `${proto}://${req.headers.host}/prova?t=${encodeURIComponent(token)}`,
    })
  })

  app.get('/api/admin/aca/provas/:id/aplicacoes', { preHandler: authMiddleware }, async (req, reply) => {
    const provaId = num((req.params as any).id)
    if (!provaId) return reply.code(400).send({ error: 'id inválido' })
    return {
      aplicacoes: await prisma.acaProvaAplicacao.findMany({
        where: { provaId },
        orderBy: [{ notaFinal: 'desc' }, { candidatoNome: 'asc' }],
        include: { _count: { select: { respostas: true } } },
      }),
    }
  })

  /** Fila de correção — dissertativas entregues e ainda sem nota. */
  app.get('/api/admin/aca/provas/correcao/fila', { preHandler: authMiddleware }, async () => {
    const aplicacoes = await prisma.acaProvaAplicacao.findMany({
      where: { status: 'ENTREGUE' },
      include: {
        prova: { include: { itens: { include: { questao: true } } } },
        respostas: true,
      },
      take: 100,
    })
    const fila = aplicacoes.flatMap((ap) =>
      ap.prova.itens
        .filter((i) => i.questao.tipo !== 'OBJETIVA')
        .map((i) => {
          const r = ap.respostas.find((x) => x.questaoId === i.questaoId)
          return {
            aplicacaoId: ap.id, candidato: ap.candidatoNome, provaId: ap.provaId, prova: ap.prova.titulo,
            questaoId: i.questaoId, enunciado: i.questao.enunciado,
            resposta: r?.resposta ?? null, notaManual: r?.notaManual ?? null,
            rubrica: lerRubrica(i.questao.rubricaJson),
            rubricaNotas: (r?.rubricaNotasJson as Record<string, number> | null) ?? null,
          }
        })
        .filter((x) => x.notaManual == null),
    )
    return { fila, total: fila.length }
  })

  app.post('/api/admin/aca/provas/correcao', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const aplicacaoId = num(b.aplicacaoId), questaoId = num(b.questaoId)
    if (!aplicacaoId || !questaoId) return reply.code(400).send({ error: 'aplicacaoId e questaoId são obrigatórios' })
    // A validação da faixa fica no serviço: com rubrica, quem manda é o teto de
    // cada critério, não o 0–10 da nota final.
    const actor = auditActor(req)
    try {
      await corrigirDissertativa({
        aplicacaoId, questaoId,
        ...(b.nota !== undefined ? { nota: Number(b.nota) } : {}),
        ...(b.rubrica ? { rubrica: b.rubrica as Record<string, number> } : {}),
        parecer: b.parecer ?? null, corretorId: actor.actorId ?? null,
      })
      const ap = await prisma.acaProvaAplicacao.findUnique({ where: { id: aplicacaoId } })
      return { aplicacao: ap }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  // ── Aplicação pública (candidato) ──
  app.get('/api/public/aca/prova', async (req, reply) => {
    const st = await estadoAplicacao(tokOf(req))
    if ('erro' in st) return reply.code(403).send({ error: st.erro })
    const respostas = await prisma.acaProvaResposta.findMany({
      where: { aplicacaoId: st.aplicacao.id },
      select: { questaoId: true, resposta: true },
    })
    return {
      candidato: st.aplicacao.candidatoNome,
      prova: { titulo: st.prova.titulo, instrucoes: st.prova.instrucoes, duracaoMinutos: st.prova.duracaoMinutos },
      status: st.aplicacao.status,
      iniciada: !!st.aplicacao.iniciadaEm,
      entregue: !!st.aplicacao.entregueEm,
      expirada: st.expirada,
      segundosRestantes: st.segundosRestantes,
      // Sem gabarito: a correção é no servidor.
      questoes: questoesParaCandidato(st.prova.itens as any),
      respostas,
    }
  })

  app.post('/api/public/aca/prova/iniciar', async (req, reply) => {
    try {
      const st = await iniciar(tokOf(req))
      if ('erro' in st) return reply.code(403).send({ error: st.erro })
      return { ok: true, segundosRestantes: st.segundosRestantes }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.post('/api/public/aca/prova/responder', async (req, reply) => {
    const b = (req.body as any) || {}
    try {
      await salvarResposta(tokOf(req), Number(b.questaoId), String(b.resposta ?? ''))
      return { ok: true }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.post('/api/public/aca/prova/entregar', async (req, reply) => {
    try {
      const ap = await entregar(tokOf(req))
      return { ok: true, status: ap.status, notaObjetiva: ap.notaObjetiva, notaFinal: ap.notaFinal }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })
}
