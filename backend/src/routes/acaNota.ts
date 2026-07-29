// src/routes/acaNota.ts
// Módulo Acadêmico · P6.2 — Avaliações + Notas. Instrumentos por diário, notas
// por aluno e MÉDIA PONDERADA (sum(nota*peso)/sum(peso)). Rotas /api/admin/aca/*.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { resolverEsquema, lerMapaConceitos, valorDoConceito } from '../services/acaAvaliacao.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

/**
 * Esquema de avaliação que rege o diário. O diário conhece a disciplina e a
 * turma; a turma conhece a matriz e a oferta — é essa cadeia que a herança
 * DISCIPLINA→MATRIZ→CURSO→INSTITUCIONAL precisa para resolver.
 */
async function esquemaDoDiario(diarioId: number) {
  const diario = await prisma.acaDiario.findUnique({
    where: { id: diarioId },
    select: { disciplinaId: true, turmaId: true },
  })
  if (!diario) return null
  const turma = diario.turmaId
    ? await prisma.acaTurma.findUnique({
        where: { id: diario.turmaId },
        select: { matrizId: true, courseOfferingId: true },
      })
    : null
  // AcaTurma guarda courseOfferingId escalar, sem @relation — o curso vem numa
  // segunda consulta.
  const oferta = turma?.courseOfferingId
    ? await prisma.courseOffering.findUnique({ where: { id: turma.courseOfferingId }, select: { courseId: true } })
    : null
  return resolverEsquema({
    disciplinaId: diario.disciplinaId,
    matrizId: turma?.matrizId ?? null,
    courseId: oferta?.courseId ?? null,
  })
}

async function matriculadosDaTurma(turmaId: number) {
  return prisma.acaMatricula.findMany({
    where: { turmaId, status: 'MATRICULADO', listaEspera: false },
    select: { id: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } },
    orderBy: { aluno: { lead: { nome: 'asc' } } },
  })
}

export async function acaNotaRoutes(app: FastifyInstance) {
  // ── GET /diarios/:id/notas — avaliações + matriz de notas + médias ──
  app.get('/api/admin/aca/diarios/:id/notas', { preHandler: authMiddleware }, async (req, reply) => {
    const diarioId = Number((req.params as any).id)
    const diario = await prisma.acaDiario.findUnique({ where: { id: diarioId }, select: { turmaId: true } })
    if (!diario) return reply.code(404).send({ error: 'Diário não encontrado' })
    const [avaliacoes, mats] = await Promise.all([
      prisma.acaAvaliacao.findMany({ where: { diarioId }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] }),
      matriculadosDaTurma(diario.turmaId),
    ])
    const avalIds = avaliacoes.map((a) => a.id)
    const notas = avalIds.length ? await prisma.acaNota.findMany({ where: { avaliacaoId: { in: avalIds } } }) : []
    // mapa nota[matriculaId][avaliacaoId] = valor
    const map: Record<number, Record<number, number | null>> = {}
    for (const n of notas) { (map[n.matriculaId] ??= {})[n.avaliacaoId] = n.valor }
    const pesoTotal = avaliacoes.reduce((s, a) => s + a.peso, 0)
    const linhas = mats.map((m) => {
      const row = map[m.id] || {}
      let somaPeso = 0, soma = 0
      for (const a of avaliacoes) { const v = row[a.id]; if (v != null) { soma += v * a.peso; somaPeso += a.peso } }
      const media = somaPeso > 0 ? Math.round((soma / somaPeso) * 10) / 10 : null
      const completo = somaPeso === pesoTotal && pesoTotal > 0
      return { matriculaId: m.id, ra: m.aluno.ra, nome: m.aluno.lead.nome, notas: row, media, completo }
    })
    return { avaliacoes, linhas, matriculados: mats.length }
  })

  // ── POST /diarios/:id/avaliacoes — cria instrumento ──
  app.post('/api/admin/aca/diarios/:id/avaliacoes', { preHandler: authMiddleware }, async (req, reply) => {
    const diarioId = Number((req.params as any).id)
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    const avaliacao = await prisma.acaAvaliacao.create({ data: {
      diarioId, nome: String(b.nome).slice(0, 120), peso: Number(b.peso) || 1,
      valorMaximo: b.valorMaximo != null ? Number(b.valorMaximo) : 10, data: b.data ? new Date(b.data) : null, ordem: Number(b.ordem) || 0,
    } })
    return reply.code(201).send({ avaliacao })
  })

  // ── PATCH /avaliacoes/:id ──
  app.patch('/api/admin/aca/avaliacoes/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('nome' in b) data.nome = String(b.nome).slice(0, 120)
    if ('peso' in b) data.peso = Number(b.peso) || 1
    if ('valorMaximo' in b) data.valorMaximo = Number(b.valorMaximo) || 10
    if ('ordem' in b) data.ordem = Number(b.ordem) || 0
    if ('data' in b) data.data = b.data ? new Date(b.data) : null
    const avaliacao = await prisma.acaAvaliacao.update({ where: { id }, data })
    return { avaliacao }
  })

  // ── DELETE /avaliacoes/:id ──
  app.delete('/api/admin/aca/avaliacoes/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaAvaliacao.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })

  // ── POST /avaliacoes/:id/notas — lança notas (bulk; valor null limpa) ──
  //
  // Aceita a nota como número OU como conceito (A–E) quando o regimento da
  // disciplina adota escala conceitual — o professor lança o que o regimento
  // usa, e o banco continua guardando número, que é o que a fórmula precisa.
  app.post('/api/admin/aca/avaliacoes/:id/notas', { preHandler: authMiddleware }, async (req, reply) => {
    const avaliacaoId = Number((req.params as any).id)
    const aval = await prisma.acaAvaliacao.findUnique({
      where: { id: avaliacaoId },
      select: { valorMaximo: true, diarioId: true },
    })
    if (!aval) return reply.code(404).send({ error: 'Avaliação não encontrada' })

    const esquema = await esquemaDoDiario(aval.diarioId)
    const mapa = esquema?.escala === 'CONCEITO' ? lerMapaConceitos(esquema.mapaConceitos) : null

    const registros = ((req.body as any)?.registros || []) as Array<{
      matriculaId: number; valor?: number | null; conceito?: string | null
      origem?: string; origemObs?: string | null
    }>
    let salvos = 0
    const recusados: string[] = []
    const auditoriaDeNota: Array<{ matriculaId: number; changes: Record<string, unknown> }> = []

    for (const r of registros) {
      // Conceito só é aceito quando existe mapa — senão a conversão seria um
      // palpite, e palpite não entra em histórico escolar.
      let valor: number | null
      if (r.conceito != null && String(r.conceito).trim() !== '') {
        if (!mapa) { recusados.push(`matrícula ${r.matriculaId}: conceito recebido, mas o esquema não usa escala conceitual`); continue }
        const v = valorDoConceito(mapa, String(r.conceito))
        if (v == null) { recusados.push(`matrícula ${r.matriculaId}: conceito "${r.conceito}" não existe no esquema`); continue }
        valor = v
      } else {
        valor = r.valor === null || r.valor === undefined || (r.valor as any) === '' ? null : Number(r.valor)
        if (valor != null) { if (Number.isNaN(valor)) continue; valor = Math.max(0, Math.min(valor, aval.valorMaximo)) }
      }

      const origem = String(r.origem || 'NORMAL').toUpperCase()
      if (origem !== 'NORMAL' && origem !== 'SEGUNDA_CHAMADA') {
        recusados.push(`matrícula ${r.matriculaId}: origem "${origem}" inválida`); continue
      }
      // Marcar como segunda chamada sem o regimento prever é o que transformava
      // o campo em decoração. Ou o esquema habilita, ou a nota não passa.
      if (origem === 'SEGUNDA_CHAMADA' && !esquema?.segundaChamadaHabilitada) {
        recusados.push(`matrícula ${r.matriculaId}: o esquema de avaliação não prevê segunda chamada`); continue
      }

      const dados = {
        valor, origem,
        origemObs: r.origemObs ?? null,
        origemEm: origem === 'SEGUNDA_CHAMADA' ? new Date() : null,
      }
      const matriculaId = Number(r.matriculaId)
      const antes = await prisma.acaNota.findUnique({
        where: { avaliacaoId_matriculaId: { avaliacaoId, matriculaId } },
        select: { valor: true },
      })
      await prisma.acaNota.upsert({
        where: { avaliacaoId_matriculaId: { avaliacaoId, matriculaId } },
        update: dados, create: { avaliacaoId, matriculaId, ...dados },
      })
      // Alteração de nota já lançada é o evento que mais precisa de trilha num
      // ERP acadêmico (RN-1401): fica o valor anterior, o novo, quem mudou e de
      // onde. Lançamento inicial não polui a trilha — só a MUDANÇA.
      if (antes && antes.valor !== valor) {
        auditoriaDeNota.push({
          matriculaId,
          changes: {
            valor: { from: antes.valor, to: valor },
            ...(origem !== 'NORMAL' ? { origem: { from: 'NORMAL', to: origem } } : {}),
          },
        })
      }
      salvos++
    }

    if (auditoriaDeNota.length > 0) {
      const actor = auditActor(req)
      for (const item of auditoriaDeNota) {
        void logUserAudit({
          action: 'aca.nota.alterada', targetType: 'aca_nota', targetUserId: null,
          targetLabel: `Avaliação ${avaliacaoId} · matrícula ${item.matriculaId}`,
          changes: item.changes, ...actor,
        })
      }
    }
    return { ok: true, salvos, ...(recusados.length > 0 ? { recusados } : {}) }
  })
}
