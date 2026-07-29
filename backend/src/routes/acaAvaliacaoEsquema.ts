// src/routes/acaAvaliacaoEsquema.ts
// Esquemas de avaliação (M08): o regimento da IES como dado configurável.
// As regras vivem em services/acaAvaliacao.ts.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import {
  resolverEsquema, validarFormula, calcular, FREQUENCIA_MINIMA_LEGAL,
  type EsquemaCompleto,
} from '../services/acaAvaliacao.js'

const ESCOPOS = ['INSTITUCIONAL', 'CURSO', 'MATRIZ', 'DISCIPLINA']
const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function acaAvaliacaoEsquemaRoutes(app: FastifyInstance) {
  app.get('/api/admin/aca/esquemas', { preHandler: authMiddleware }, async () => {
    const esquemas = await prisma.acaEsquemaAvaliacao.findMany({
      orderBy: [{ escopo: 'asc' }, { nome: 'asc' }],
      include: { componentes: { orderBy: { ordem: 'asc' } } },
    })
    return { esquemas }
  })

  app.get('/api/admin/aca/esquemas/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const esquema = await prisma.acaEsquemaAvaliacao.findUnique({
      where: { id }, include: { componentes: { orderBy: { ordem: 'asc' } } },
    })
    if (!esquema) return reply.code(404).send({ error: 'Esquema não encontrado' })
    return { esquema }
  })

  /** Qual esquema vale para esta disciplina/matriz/curso (mostra a cascata). */
  app.get('/api/admin/aca/esquemas/resolver', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const esquema = await resolverEsquema({
      disciplinaId: num(q?.disciplinaId), matrizId: num(q?.matrizId), courseId: num(q?.courseId),
    })
    return { esquema }
  })

  function montarDados(b: any) {
    const dados: any = {}
    const diretos = ['nome', 'descricao', 'escala', 'arredondamento', 'formulaMedia', 'formulaFinal'] as const
    for (const c of diretos) if (b[c] !== undefined) dados[c] = b[c] || null
    if (b.nome !== undefined) dados.nome = String(b.nome).substring(0, 191)
    for (const c of ['notaMinima', 'notaMaxima', 'mediaAprovacao', 'notaEliminatoria', 'exameMinimo', 'mediaFinalAprovacao'] as const) {
      if (b[c] !== undefined) dados[c] = b[c] === null || b[c] === '' ? null : Number(b[c])
    }
    for (const c of ['casasDecimais', 'limiteDependencias'] as const) {
      if (b[c] !== undefined) dados[c] = b[c] === null || b[c] === '' ? null : Math.trunc(Number(b[c]))
    }
    for (const c of ['exameHabilitado', 'segundaChamadaHabilitada', 'ativo'] as const) {
      if (b[c] !== undefined) dados[c] = !!b[c]
    }
    if (b.mapaConceitos !== undefined) dados.mapaConceitos = b.mapaConceitos ?? undefined
    if (b.frequenciaMinima !== undefined) {
      // Piso legal do ensino superior: a IES pode exigir mais, nunca menos.
      const f = Math.trunc(Number(b.frequenciaMinima))
      dados.frequenciaMinima = Number.isFinite(f) ? Math.max(FREQUENCIA_MINIMA_LEGAL, f) : FREQUENCIA_MINIMA_LEGAL
    }
    return dados
  }

  app.post('/api/admin/aca/esquemas', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const escopo = String(b.escopo || 'INSTITUCIONAL').toUpperCase()
    if (!ESCOPOS.includes(escopo)) return reply.code(400).send({ error: `escopo deve ser um de: ${ESCOPOS.join(', ')}` })
    if (!b.nome) return reply.code(400).send({ error: 'nome é obrigatório' })
    const escopoId = escopo === 'INSTITUCIONAL' ? null : num(b.escopoId)
    if (escopo !== 'INSTITUCIONAL' && !escopoId) return reply.code(400).send({ error: 'escopoId é obrigatório fora do escopo institucional' })

    const componentes = Array.isArray(b.componentes) ? b.componentes : []
    // A fórmula só pode citar siglas que existem — senão a média quebra na apuração.
    if (b.formulaMedia) {
      const v = validarFormula(String(b.formulaMedia), componentes.map((c: any) => String(c.sigla || '')))
      if (!v.ok) return reply.code(400).send({ error: `Fórmula da média inválida: ${v.erro}` })
    }
    try {
      const esquema = await prisma.acaEsquemaAvaliacao.create({
        data: {
          escopo: escopo as any, escopoId, ...montarDados(b),
          nome: String(b.nome).substring(0, 191),
          componentes: {
            create: componentes.map((c: any, i: number) => ({
              sigla: String(c.sigla || `N${i + 1}`).toUpperCase().substring(0, 12),
              nome: String(c.nome || c.sigla || `Nota ${i + 1}`).substring(0, 100),
              peso: Number(c.peso) || 1,
              ordem: c.ordem != null ? Number(c.ordem) : i,
              obrigatorio: c.obrigatorio !== false,
            })),
          },
        },
        include: { componentes: { orderBy: { ordem: 'asc' } } },
      })
      return reply.code(201).send({ esquema })
    } catch (e: any) {
      if (String(e?.code) === 'P2002') return reply.code(409).send({ error: 'Já existe um esquema para este escopo' })
      return reply.code(400).send({ error: e?.message || 'Falha ao criar esquema' })
    }
  })

  app.put('/api/admin/aca/esquemas/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const b = (req.body as any) || {}
    const atual = await prisma.acaEsquemaAvaliacao.findUnique({ where: { id }, include: { componentes: true } })
    if (!atual) return reply.code(404).send({ error: 'Esquema não encontrado' })

    const siglas = Array.isArray(b.componentes)
      ? b.componentes.map((c: any) => String(c.sigla || ''))
      : atual.componentes.map((c) => c.sigla)
    if (b.formulaMedia) {
      const v = validarFormula(String(b.formulaMedia), siglas)
      if (!v.ok) return reply.code(400).send({ error: `Fórmula da média inválida: ${v.erro}` })
    }

    const esquema = await prisma.$transaction(async (tx) => {
      await tx.acaEsquemaAvaliacao.update({ where: { id }, data: montarDados(b) })
      if (Array.isArray(b.componentes)) {
        // Substitui o conjunto: é mais previsível que casar item a item.
        await tx.acaEsquemaComponente.deleteMany({ where: { esquemaId: id } })
        for (const [i, c] of b.componentes.entries()) {
          await tx.acaEsquemaComponente.create({
            data: {
              esquemaId: id,
              sigla: String(c.sigla || `N${i + 1}`).toUpperCase().substring(0, 12),
              nome: String(c.nome || c.sigla || `Nota ${i + 1}`).substring(0, 100),
              peso: Number(c.peso) || 1,
              ordem: c.ordem != null ? Number(c.ordem) : i,
              obrigatorio: c.obrigatorio !== false,
            },
          })
        }
      }
      return tx.acaEsquemaAvaliacao.findUnique({ where: { id }, include: { componentes: { orderBy: { ordem: 'asc' } } } })
    })
    return { esquema }
  })

  app.delete('/api/admin/aca/esquemas/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    // Inativa: o esquema explica notas já lançadas, então não se apaga.
    await prisma.acaEsquemaAvaliacao.update({ where: { id }, data: { ativo: false } })
    return { ok: true }
  })

  /** Valida a fórmula sem salvar — usado enquanto o operador digita. */
  app.post('/api/admin/aca/esquemas/validar-formula', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    const siglas: string[] = Array.isArray(b.siglas) ? b.siglas.map(String) : []
    return validarFormula(String(b.formula || ''), siglas)
  })

  /**
   * Simulador (T-801): dado um conjunto de notas, mostra média, situação e o
   * porquê. É o que permite conferir o regimento antes de valer para o aluno.
   */
  app.post('/api/admin/aca/esquemas/:id/simular', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const esquema = await prisma.acaEsquemaAvaliacao.findUnique({
      where: { id }, include: { componentes: { orderBy: { ordem: 'asc' } } },
    })
    if (!esquema) return reply.code(404).send({ error: 'Esquema não encontrado' })

    const b = (req.body as any) || {}
    const notas: Record<string, number | null> = {}
    for (const [k, v] of Object.entries(b.notas || {})) notas[k.toUpperCase()] = v === null || v === '' ? null : Number(v)
    const frequencia = b.frequencia != null ? Number(b.frequencia) : 100
    const notaExame = b.notaExame != null && b.notaExame !== '' ? Number(b.notaExame) : null

    try {
      return { resultado: calcular(esquema as EsquemaCompleto, notas, frequencia, notaExame) }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message || 'Falha ao simular' })
    }
  })
}
