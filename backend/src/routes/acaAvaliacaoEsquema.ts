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
    if (b.frequenciaObrigatoria !== undefined) dados.frequenciaObrigatoria = !!b.frequenciaObrigatoria
    if (b.frequenciaMinima !== undefined) {
      const f = Math.trunc(Number(b.frequenciaMinima))
      const bruto = Number.isFinite(f) ? f : FREQUENCIA_MINIMA_LEGAL
      // O piso de 75% vale para o presencial. Em EAD a LDB dispensa a
      // frequência (art. 47, §3º), então elevar o valor à força obrigaria a IES
      // a reprovar por chamada num curso onde a chamada não existe.
      const exigeFrequencia = b.frequenciaObrigatoria !== undefined
        ? !!b.frequenciaObrigatoria
        : true
      dados.frequenciaMinima = exigeFrequencia ? Math.max(FREQUENCIA_MINIMA_LEGAL, bruto) : Math.max(0, Math.min(100, bruto))
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
   * Monta as avaliações do diário a partir do esquema da disciplina.
   *
   * É o passo que faz a fórmula do regimento valer no cálculo: sem a sigla em
   * cada avaliação, o fechamento não sabe qual nota é N1 e qual é N2, e cai na
   * média ponderada genérica.
   */
  app.post('/api/admin/aca/diarios/:id/aplicar-esquema', { preHandler: authMiddleware }, async (req, reply) => {
    const diarioId = num((req.params as any).id)
    if (!diarioId) return reply.code(400).send({ error: 'id inválido' })
    const diario = await prisma.acaDiario.findUnique({ where: { id: diarioId }, select: { id: true, disciplinaId: true } })
    if (!diario) return reply.code(404).send({ error: 'Diário não encontrado' })

    const esquema = await resolverEsquema({ disciplinaId: diario.disciplinaId })
    if (!esquema) return reply.code(404).send({ error: 'Nenhum esquema de avaliação vale para esta disciplina' })
    if (esquema.componentes.length === 0) return reply.code(400).send({ error: 'O esquema não tem componentes de nota' })

    const existentes = await prisma.acaAvaliacao.findMany({ where: { diarioId }, select: { id: true, siglaEsquema: true, nome: true } })
    const comNota = await prisma.acaNota.findMany({
      where: { avaliacaoId: { in: existentes.map((e) => e.id) } },
      select: { avaliacaoId: true },
      distinct: ['avaliacaoId'],
    })
    const temNota = new Set(comNota.map((n) => n.avaliacaoId))

    // Avaliação que já tem nota lançada não é tocada — apagá-la destruiria
    // registro acadêmico. O que dá para fazer é vincular a sigla quando o nome
    // bate, e criar só o que falta.
    let criadas = 0, vinculadas = 0
    const preservadas: string[] = []
    for (const [i, comp] of esquema.componentes.entries()) {
      const jaTem = existentes.find((e) => e.siglaEsquema === comp.sigla)
      if (jaTem) continue
      // Casa com a avaliação que já existe pela sigla OU pelo nome do
      // componente — sem isso, "Prova 1" (com notas lançadas) e o componente
      // "Prova 1" virariam duas avaliações no mesmo diário.
      const alvo = (s: string) => s.trim().toUpperCase()
      const porNome = existentes.find(
        (e) => !e.siglaEsquema && (alvo(e.nome) === alvo(comp.sigla) || alvo(e.nome) === alvo(comp.nome)),
      )
      if (porNome) {
        await prisma.acaAvaliacao.update({ where: { id: porNome.id }, data: { siglaEsquema: comp.sigla } })
        vinculadas++
        continue
      }
      await prisma.acaAvaliacao.create({
        data: {
          diarioId, nome: comp.nome.substring(0, 120), siglaEsquema: comp.sigla,
          peso: Math.max(1, Math.round(comp.peso)), valorMaximo: esquema.notaMaxima, ordem: i,
        },
      })
      criadas++
    }
    for (const e of existentes) {
      if (!e.siglaEsquema && temNota.has(e.id)) preservadas.push(e.nome)
    }
    return { ok: true, esquema: { id: esquema.id, nome: esquema.nome }, criadas, vinculadas, preservadas }
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
