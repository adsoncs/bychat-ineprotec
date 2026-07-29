// src/routes/acaCompetencia.ts
//
// Capacidades, critérios e lista de verificação (fase T3).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { garantirEditavel } from '../services/acaMatriz.js'
import { apurar, aferir, listaDeVerificacao, type Resultado } from '../services/acaCompetencia.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
const RESULTADOS = ['ATENDE', 'EM_DESENVOLVIMENTO', 'NAO_ATENDE']
const TIPOS = ['TECNICA', 'SOCIAL', 'ORGANIZATIVA', 'METODOLOGICA']

export async function acaCompetenciaRoutes(app: FastifyInstance) {
  // ─────────── Capacidades e critérios (desenho da matriz) ───────────

  app.get('/api/admin/aca/componentes/:id/capacidades', { preHandler: authMiddleware }, async (req, reply) => {
    const componenteId = num((req.params as any).id)
    if (!componenteId) return reply.code(400).send({ error: 'id inválido' })
    const capacidades = await prisma.acaCapacidade.findMany({
      where: { componenteId },
      orderBy: { ordem: 'asc' },
      include: { criterios: { orderBy: { ordem: 'asc' } } },
    })
    const criticos = capacidades.reduce((s, c) => s + c.criterios.filter((k) => k.peso === 'CRITICO').length, 0)
    return { capacidades, criticos }
  })

  app.post('/api/admin/aca/componentes/:id/capacidades', { preHandler: authMiddleware }, async (req, reply) => {
    const componenteId = num((req.params as any).id)
    const b = (req.body as any) || {}
    if (!componenteId) return reply.code(400).send({ error: 'id inválido' })
    if (!b.descricao?.trim()) return reply.code(400).send({ error: 'Descreva a capacidade.' })
    const tipo = String(b.tipo || 'TECNICA').toUpperCase()
    if (!TIPOS.includes(tipo)) return reply.code(400).send({ error: `tipo deve ser um de: ${TIPOS.join(', ')}` })

    const comp = await prisma.acaComponente.findUnique({ where: { id: componenteId }, select: { matrizId: true } })
    if (!comp) return reply.code(404).send({ error: 'Componente não encontrado' })
    try {
      // Capacidade é desenho curricular: acompanha a imutabilidade da matriz.
      await garantirEditavel(comp.matrizId)
      const ultima = await prisma.acaCapacidade.findFirst({
        where: { componenteId }, orderBy: { ordem: 'desc' }, select: { ordem: true },
      })
      const capacidade = await prisma.acaCapacidade.create({
        data: {
          componenteId, tipo: tipo as any,
          descricao: String(b.descricao),
          ordem: b.ordem != null ? Number(b.ordem) : (ultima ? ultima.ordem + 1 : 0),
        },
      })
      return reply.code(201).send({ capacidade })
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.delete('/api/admin/aca/capacidades/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const cap = await prisma.acaCapacidade.findUnique({
      where: { id }, select: { componente: { select: { matrizId: true } } },
    })
    if (!cap) return reply.code(404).send({ error: 'Capacidade não encontrada' })
    try {
      await garantirEditavel(cap.componente.matrizId)
      await prisma.acaCapacidade.delete({ where: { id } })
      return { ok: true }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.post('/api/admin/aca/capacidades/:id/criterios', { preHandler: authMiddleware }, async (req, reply) => {
    const capacidadeId = num((req.params as any).id)
    const b = (req.body as any) || {}
    if (!capacidadeId) return reply.code(400).send({ error: 'id inválido' })
    if (!b.descricao?.trim()) return reply.code(400).send({ error: 'Descreva o critério.' })
    const peso = String(b.peso || 'DESEJAVEL').toUpperCase()
    if (peso !== 'CRITICO' && peso !== 'DESEJAVEL') return reply.code(400).send({ error: 'peso deve ser CRITICO ou DESEJAVEL' })

    const cap = await prisma.acaCapacidade.findUnique({
      where: { id: capacidadeId }, select: { componente: { select: { matrizId: true } } },
    })
    if (!cap) return reply.code(404).send({ error: 'Capacidade não encontrada' })
    try {
      await garantirEditavel(cap.componente.matrizId)
      const ultima = await prisma.acaCriterio.findFirst({
        where: { capacidadeId }, orderBy: { ordem: 'desc' }, select: { ordem: true },
      })
      const criterio = await prisma.acaCriterio.create({
        data: {
          capacidadeId, descricao: String(b.descricao),
          evidencia: b.evidencia ?? null, peso: peso as any,
          ordem: b.ordem != null ? Number(b.ordem) : (ultima ? ultima.ordem + 1 : 0),
        },
      })
      return reply.code(201).send({ criterio })
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.delete('/api/admin/aca/criterios/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const k = await prisma.acaCriterio.findUnique({
      where: { id }, select: { capacidade: { select: { componente: { select: { matrizId: true } } } } },
    })
    if (!k) return reply.code(404).send({ error: 'Critério não encontrado' })
    try {
      await garantirEditavel(k.capacidade.componente.matrizId)
      await prisma.acaCriterio.delete({ where: { id } })
      return { ok: true }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  // ─────────── Aferição (rotina do docente) ───────────

  /** Lista de verificação do diário: capacidades × alunos. */
  app.get('/api/admin/aca/diarios/:id/lista-verificacao', { preHandler: authMiddleware }, async (req, reply) => {
    const diarioId = num((req.params as any).id)
    if (!diarioId) return reply.code(400).send({ error: 'id inválido' })
    try {
      return await listaDeVerificacao(diarioId)
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.post('/api/admin/aca/afericoes', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const criterioId = num(b.criterioId)
    const matriculaId = num(b.matriculaId)
    const resultado = String(b.resultado || '').toUpperCase()
    if (!criterioId || !matriculaId) return reply.code(400).send({ error: 'criterioId e matriculaId são obrigatórios' })
    if (!RESULTADOS.includes(resultado)) return reply.code(400).send({ error: `resultado deve ser um de: ${RESULTADOS.join(', ')}` })
    const actor = auditActor(req)
    const a = await aferir({
      criterioId, matriculaId, resultado: resultado as Resultado,
      observacao: b.observacao ?? null,
      docenteUserId: actor.actorId ?? null,
    })
    return reply.code(201).send({ afericao: a })
  })

  /** Aferição em lote — o docente fecha uma coluna da lista de uma vez. */
  app.post('/api/admin/aca/afericoes/lote', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const itens: Array<{ criterioId: number; matriculaId: number; resultado: string; observacao?: string }> =
      Array.isArray(b.itens) ? b.itens : []
    if (itens.length === 0) return reply.code(400).send({ error: 'Nada a registrar.' })
    const actor = auditActor(req)
    let ok = 0
    const erros: string[] = []
    for (const it of itens) {
      const resultado = String(it.resultado || '').toUpperCase()
      if (!RESULTADOS.includes(resultado)) { erros.push(`critério ${it.criterioId}: resultado inválido`); continue }
      try {
        await aferir({
          criterioId: Number(it.criterioId), matriculaId: Number(it.matriculaId),
          resultado: resultado as Resultado, observacao: it.observacao ?? null,
          docenteUserId: actor.actorId ?? null,
        })
        ok++
      } catch (e: any) { erros.push(`critério ${it.criterioId}: ${e?.message}`) }
    }
    return reply.send({ registrados: ok, erros })
  })

  /** Apuração de um aluno num componente — é o que o boletim mostra. */
  app.get('/api/admin/aca/competencia/apurar', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const componenteId = num(q?.componenteId)
    const matriculaId = num(q?.matriculaId)
    if (!componenteId || !matriculaId) return reply.code(400).send({ error: 'componenteId e matriculaId são obrigatórios' })
    return apurar(componenteId, matriculaId)
  })

  /**
   * Copia capacidades e critérios de outro componente.
   *
   * Escrever rubrica de competência é o trabalho mais caro da implantação;
   * disciplina equivalente em outra matriz costuma servir com ajuste.
   */
  app.post('/api/admin/aca/componentes/:id/copiar-capacidades', { preHandler: authMiddleware }, async (req, reply) => {
    const destinoId = num((req.params as any).id)
    const origemId = num((req.body as any)?.origemComponenteId)
    if (!destinoId || !origemId) return reply.code(400).send({ error: 'Informe o componente de origem.' })
    if (destinoId === origemId) return reply.code(400).send({ error: 'Origem e destino são o mesmo componente.' })

    const destino = await prisma.acaComponente.findUnique({ where: { id: destinoId }, select: { matrizId: true } })
    if (!destino) return reply.code(404).send({ error: 'Componente de destino não encontrado' })
    try {
      await garantirEditavel(destino.matrizId)
      const jaTem = await prisma.acaCapacidade.count({ where: { componenteId: destinoId } })
      if (jaTem > 0) return reply.code(400).send({ error: 'O componente já tem capacidades. Remova-as antes de copiar.' })

      const origem = await prisma.acaCapacidade.findMany({
        where: { componenteId: origemId },
        orderBy: { ordem: 'asc' },
        include: { criterios: { orderBy: { ordem: 'asc' } } },
      })
      if (origem.length === 0) return reply.code(400).send({ error: 'O componente de origem não tem capacidades.' })

      let capacidades = 0, criterios = 0
      for (const cap of origem) {
        const nova = await prisma.acaCapacidade.create({
          data: { componenteId: destinoId, tipo: cap.tipo, descricao: cap.descricao, ordem: cap.ordem },
        })
        capacidades++
        for (const k of cap.criterios) {
          await prisma.acaCriterio.create({
            data: { capacidadeId: nova.id, descricao: k.descricao, evidencia: k.evidencia, peso: k.peso, ordem: k.ordem },
          })
          criterios++
        }
      }
      const actor = auditActor(req)
      void logUserAudit({
        action: 'aca.capacidades.copiadas', targetType: 'aca_componente', targetUserId: null,
        targetLabel: `${capacidades} capacidade(s) e ${criterios} critério(s) copiados para o componente ${destinoId}`,
        ...actor,
      })
      return reply.code(201).send({ capacidades, criterios })
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })
}
