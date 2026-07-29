// src/routes/acaRegimeEspecial.ts
//
// Regime de exercícios domiciliares / tratamento excepcional.
//
// No ensino superior não há abono de faltas — salvo os casos legais. Este
// módulo registra o amparo, e o cálculo de frequência (acaFechamento) passa a
// desconsiderar as aulas do período DEFERIDO, sem apagar nada do diário.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

/** Amparo legal sugerido por tipo — a secretaria pode sobrescrever. */
const AMPARO: Record<string, string> = {
  GESTANTE: 'Lei nº 6.202/1975',
  SAUDE: 'Decreto-Lei nº 1.044/1969',
  MILITAR: 'Lei nº 4.375/1964 (serviço militar)',
  OUTRO: '',
}
const TIPOS = Object.keys(AMPARO)
const STATUS = ['SOLICITADO', 'DEFERIDO', 'INDEFERIDO', 'ENCERRADO']

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function acaRegimeEspecialRoutes(app: FastifyInstance) {
  app.get('/api/admin/aca/regimes-especiais', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q?.alunoId) where.alunoId = Number(q.alunoId)
    if (q?.status) where.status = String(q.status).toUpperCase()
    const regimes = await prisma.acaRegimeEspecial.findMany({
      where,
      orderBy: [{ dataInicio: 'desc' }],
      include: { aluno: { select: { ra: true, lead: { select: { nome: true } } } } },
    })
    const hoje = Date.now()
    return {
      regimes: regimes.map((r) => ({
        ...r,
        vigente: r.status === 'DEFERIDO' && r.dataInicio.getTime() <= hoje && r.dataFim.getTime() >= hoje,
      })),
    }
  })

  app.post('/api/admin/aca/regimes-especiais', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const alunoId = num(b.alunoId)
    const tipo = String(b.tipo || '').toUpperCase()
    if (!alunoId) return reply.code(400).send({ error: 'alunoId é obrigatório' })
    if (!TIPOS.includes(tipo)) return reply.code(400).send({ error: `tipo deve ser um de: ${TIPOS.join(', ')}` })
    if (!b.dataInicio || !b.dataFim) return reply.code(400).send({ error: 'dataInicio e dataFim são obrigatórias' })
    const ini = new Date(b.dataInicio), fim = new Date(b.dataFim)
    if (!(ini <= fim)) return reply.code(400).send({ error: 'dataFim não pode ser anterior a dataInicio' })

    const regime = await prisma.acaRegimeEspecial.create({
      data: {
        alunoId, vinculoId: num(b.vinculoId), tipo,
        dataInicio: ini, dataFim: fim,
        // Amparo legal é preenchido por padrão para não depender de a secretaria
        // lembrar a norma — é ele que sustenta a decisão em auditoria.
        amparoLegal: (b.amparoLegal ?? AMPARO[tipo] ?? '') || null,
        atestadoUrl: b.atestadoUrl ?? null,
        observacao: b.observacao ?? null,
        planoAtividades: b.planoAtividades ?? null,
        status: 'SOLICITADO',
      },
    })
    return reply.code(201).send({ regime })
  })

  /** Deferir/indeferir/encerrar. Só DEFERIDO afeta o cálculo de frequência. */
  app.post('/api/admin/aca/regimes-especiais/:id/status', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    const b = (req.body as any) || {}
    const status = String(b.status || '').toUpperCase()
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    if (!STATUS.includes(status)) return reply.code(400).send({ error: `status deve ser um de: ${STATUS.join(', ')}` })

    const atual = await prisma.acaRegimeEspecial.findUnique({ where: { id }, select: { status: true, alunoId: true } })
    if (!atual) return reply.code(404).send({ error: 'Regime não encontrado' })

    const actor = auditActor(req)
    const regime = await prisma.acaRegimeEspecial.update({
      where: { id },
      data: {
        status,
        ...(status === 'DEFERIDO' ? { deferidoPor: actor.actorId ?? null, deferidoEm: new Date() } : {}),
        ...(b.observacao !== undefined ? { observacao: b.observacao } : {}),
        ...(b.planoAtividades !== undefined ? { planoAtividades: b.planoAtividades } : {}),
      },
    })
    // Deferir muda o cálculo de frequência de quem está no período — precisa de trilha.
    void logUserAudit({
      action: 'aca.regime_especial.status',
      targetType: 'aluno', targetUserId: null,
      targetLabel: `Regime #${id} → ${status}`,
      changes: { de: atual.status, para: status, alunoId: atual.alunoId },
      ...actor,
    })
    return { regime }
  })

  app.put('/api/admin/aca/regimes-especiais/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const b = (req.body as any) || {}
    const data: any = {}
    if (b.dataInicio) data.dataInicio = new Date(b.dataInicio)
    if (b.dataFim) data.dataFim = new Date(b.dataFim)
    if (data.dataInicio && data.dataFim && data.dataInicio > data.dataFim) {
      return reply.code(400).send({ error: 'dataFim não pode ser anterior a dataInicio' })
    }
    for (const c of ['amparoLegal', 'atestadoUrl', 'observacao', 'planoAtividades'] as const) {
      if (b[c] !== undefined) data[c] = b[c] || null
    }
    if (b.tipo !== undefined) {
      const tipo = String(b.tipo).toUpperCase()
      if (!TIPOS.includes(tipo)) return reply.code(400).send({ error: 'tipo inválido' })
      data.tipo = tipo
    }
    const regime = await prisma.acaRegimeEspecial.update({ where: { id }, data })
    return { regime }
  })

  /** Amparos legais sugeridos — a UI usa para preencher e explicar. */
  app.get('/api/admin/aca/regimes-especiais/tipos', { preHandler: authMiddleware }, async () => ({
    tipos: [
      { id: 'GESTANTE', label: 'Gestante', amparo: AMPARO.GESTANTE, ajuda: 'A partir do 8º mês e por 3 meses, ou conforme atestado médico.' },
      { id: 'SAUDE', label: 'Tratamento de saúde', amparo: AMPARO.SAUDE, ajuda: 'Afecções, infecções ou traumatismos com incapacidade relativa, mediante atestado.' },
      { id: 'MILITAR', label: 'Serviço militar', amparo: AMPARO.MILITAR, ajuda: 'Convocação que impeça a frequência.' },
      { id: 'OUTRO', label: 'Outro', amparo: '', ajuda: 'Informe o amparo legal aplicável.' },
    ],
  }))
}
