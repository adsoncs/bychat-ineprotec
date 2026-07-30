// src/routes/acaFundacao.ts
//
// Fase 1 da fundação acadêmica: hierarquia institucional (mantenedora → IES →
// atos autorizativos), ciclo de vida da matriz curricular e vínculo acadêmico
// do aluno com máquina de estados.
//
// As regras vivem nos serviços (acaVinculo.ts, acaMatriz.ts); aqui só há
// transporte HTTP e validação de entrada.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import * as Vinculo from '../services/acaVinculo.js'
import * as Matriz from '../services/acaMatriz.js'
import * as Integralizacao from '../services/acaIntegralizacao.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import {
  FORMAS_INGRESSO, CRITERIOS_CLASSIFICACAO, validarForma, avisosDeIngresso,
  rotuloForma, rotuloCriterio,
} from '../services/acaFormaIngresso.js'
import { conformidadeLatoSensu, ehLatoSensu } from '../services/acaLatoSensu.js'

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function acaFundacaoRoutes(app: FastifyInstance) {
  // ─────────────────────────────────────────
  // Hierarquia institucional (G5)
  // ─────────────────────────────────────────

  app.get('/api/admin/aca/mantenedoras', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.acaMantenedora.findMany({
      orderBy: { razaoSocial: 'asc' },
      include: { _count: { select: { ies: true } } },
    })
    return { mantenedoras: rows }
  })

  app.post('/api/admin/aca/mantenedoras', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.razaoSocial) return reply.code(400).send({ error: 'razaoSocial é obrigatória' })
    const row = await prisma.acaMantenedora.create({
      data: {
        razaoSocial: String(b.razaoSocial).substring(0, 191),
        nomeFantasia: b.nomeFantasia ?? null, cnpj: b.cnpj ?? null,
        repNome: b.repNome ?? null, repCpf: b.repCpf ?? null, repCargo: b.repCargo ?? null,
        enderecoJson: b.endereco ?? undefined, telefone: b.telefone ?? null, email: b.email ?? null,
      },
    })
    return { mantenedora: row }
  })

  app.put('/api/admin/aca/mantenedoras/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const b = (req.body as any) || {}
    const row = await prisma.acaMantenedora.update({
      where: { id },
      data: {
        ...(b.razaoSocial !== undefined ? { razaoSocial: String(b.razaoSocial).substring(0, 191) } : {}),
        ...(b.nomeFantasia !== undefined ? { nomeFantasia: b.nomeFantasia } : {}),
        ...(b.cnpj !== undefined ? { cnpj: b.cnpj } : {}),
        ...(b.repNome !== undefined ? { repNome: b.repNome } : {}),
        ...(b.repCpf !== undefined ? { repCpf: b.repCpf } : {}),
        ...(b.repCargo !== undefined ? { repCargo: b.repCargo } : {}),
        ...(b.endereco !== undefined ? { enderecoJson: b.endereco } : {}),
        ...(b.telefone !== undefined ? { telefone: b.telefone } : {}),
        ...(b.email !== undefined ? { email: b.email } : {}),
        ...(b.ativo !== undefined ? { ativo: !!b.ativo } : {}),
      },
    })
    return { mantenedora: row }
  })

  app.get('/api/admin/aca/ies', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where = q?.mantenedoraId ? { mantenedoraId: Number(q.mantenedoraId) } : {}
    const rows = await prisma.acaIes.findMany({ where, orderBy: { nome: 'asc' }, include: { mantenedora: { select: { razaoSocial: true } } } })
    return { ies: rows }
  })

  app.post('/api/admin/aca/ies', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const mantenedoraId = num(b.mantenedoraId)
    if (!mantenedoraId || !b.nome) return reply.code(400).send({ error: 'mantenedoraId e nome são obrigatórios' })
    const row = await prisma.acaIes.create({
      data: {
        mantenedoraId, nome: String(b.nome).substring(0, 191), sigla: b.sigla ?? null,
        codigoEmec: b.codigoEmec ?? null, categoriaAdmin: b.categoriaAdmin ?? null,
        organizacaoAcad: b.organizacaoAcad ?? null, enderecoJson: b.endereco ?? undefined,
        dirigenteNome: b.dirigenteNome ?? null, dirigenteCpf: b.dirigenteCpf ?? null, dirigenteEmail: b.dirigenteEmail ?? null,
        piNome: b.piNome ?? null, piCpf: b.piCpf ?? null, piEmail: b.piEmail ?? null,
      },
    })
    return { ies: row }
  })

  app.put('/api/admin/aca/ies/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const b = (req.body as any) || {}
    const campos = ['nome', 'sigla', 'codigoEmec', 'categoriaAdmin', 'organizacaoAcad',
      'dirigenteNome', 'dirigenteCpf', 'dirigenteEmail', 'piNome', 'piCpf', 'piEmail'] as const
    const data: any = {}
    for (const c of campos) if (b[c] !== undefined) data[c] = b[c]
    if (b.endereco !== undefined) data.enderecoJson = b.endereco
    if (b.ativo !== undefined) data.ativo = !!b.ativo
    const row = await prisma.acaIes.update({ where: { id }, data })
    return { ies: row }
  })

  // ── Atos autorizativos (com alerta de vencimento) ──
  app.get('/api/admin/aca/atos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q?.escopo) where.escopo = String(q.escopo).toUpperCase()
    if (q?.entidadeId) where.entidadeId = Number(q.entidadeId)
    const rows = await prisma.acaAtoAutorizativo.findMany({ where, orderBy: [{ validadeAte: 'asc' }] })
    // O alerta é o ponto do requisito RF-102: vencimento em 180/90/30 dias.
    const hoje = Date.now()
    const atos = rows.map((a) => {
      const dias = a.validadeAte ? Math.ceil((a.validadeAte.getTime() - hoje) / 86400_000) : null
      return {
        ...a,
        diasParaVencer: dias,
        alerta: dias == null ? null : dias < 0 ? 'vencido' : dias <= 30 ? 'critico' : dias <= 90 ? 'atencao' : dias <= 180 ? 'proximo' : null,
      }
    })
    return { atos }
  })

  app.post('/api/admin/aca/atos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const entidadeId = num(b.entidadeId)
    const escopo = String(b.escopo || '').toUpperCase()
    if (!entidadeId || (escopo !== 'IES' && escopo !== 'CURSO')) {
      return reply.code(400).send({ error: 'escopo (IES|CURSO) e entidadeId são obrigatórios' })
    }
    if (!b.tipo) return reply.code(400).send({ error: 'tipo é obrigatório' })
    const row = await prisma.acaAtoAutorizativo.create({
      data: {
        escopo: escopo as any, entidadeId, tipo: String(b.tipo).substring(0, 40),
        numero: b.numero ?? null,
        dataPublicacao: b.dataPublicacao ? new Date(b.dataPublicacao) : null,
        dataDou: b.dataDou ? new Date(b.dataDou) : null,
        validadeAte: b.validadeAte ? new Date(b.validadeAte) : null,
        observacao: b.observacao ?? null, arquivoUrl: b.arquivoUrl ?? null,
      },
    })
    return { ato: row }
  })

  app.delete('/api/admin/aca/atos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    // Ato é documento regulatório: inativa, não apaga (RN-103).
    await prisma.acaAtoAutorizativo.update({ where: { id }, data: { ativo: false } })
    return { ok: true }
  })

  // ─────────────────────────────────────────
  // Matriz curricular — ciclo de vida (G4)
  // ─────────────────────────────────────────

  app.get('/api/admin/aca/matrizes/:id/validacao', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    try {
      return await Matriz.validar(id)
    } catch (e: any) {
      return reply.code(404).send({ error: e?.message || 'Matriz não encontrada' })
    }
  })

  app.post('/api/admin/aca/matrizes/:id/ativar', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const actor = auditActor(req)
    try {
      const matriz = await Matriz.ativar(id, { userId: actor.actorId ?? undefined })
      void logUserAudit({ action: 'aca.matriz.ativada', targetType: 'matriz', targetLabel: `Matriz ${matriz.versao}`, changes: { matrizId: id }, ...actor })
      return { matriz }
    } catch (e: any) {
      // A validação estrutural devolve a lista de problemas para a tela mostrar.
      return reply.code(400).send({ error: e?.message || 'Falha ao ativar', problemas: e?.problemas ?? [] })
    }
  })

  app.post('/api/admin/aca/matrizes/:id/status', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    const para = String((req.body as any)?.status || '').toUpperCase()
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    if (!['ATIVA', 'SUSPENSA', 'EXTINTA'].includes(para)) return reply.code(400).send({ error: 'status deve ser ATIVA, SUSPENSA ou EXTINTA' })
    try {
      const matriz = await Matriz.mudarStatus(id, para as any)
      return { matriz }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.post('/api/admin/aca/matrizes/:id/clonar', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    const versao = String((req.body as any)?.versao || '').trim()
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    if (!versao) return reply.code(400).send({ error: 'versao é obrigatória (ex.: "2027.1")' })
    try {
      const matriz = await Matriz.clonar(id, versao)
      return { matriz }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  // ─────────────────────────────────────────
  // Vínculo acadêmico (G3)
  // ─────────────────────────────────────────

  app.get('/api/admin/aca/vinculos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q?.situacao) where.situacao = String(q.situacao).toUpperCase()
    if (q?.courseId) where.courseId = Number(q.courseId)
    if (q?.alunoId) where.alunoId = Number(q.alunoId)
    const [vinculos, total] = await Promise.all([
      prisma.acaVinculo.findMany({
        where,
        take: Math.min(Number(q?.limit) || 50, 200),
        skip: Number(q?.offset) || 0,
        orderBy: { id: 'desc' },
        include: {
          aluno: { select: { id: true, ra: true, lead: { select: { nome: true, whatsapp: true } } } },
          _count: { select: { matriculas: true, movimentacoes: true } },
        },
      }),
      prisma.acaVinculo.count({ where }),
    ])
    return { vinculos, total }
  })

  app.get('/api/admin/aca/vinculos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const vinculo = await prisma.acaVinculo.findUnique({
      where: { id },
      include: {
        aluno: { select: { id: true, ra: true, cpf: true, lead: { select: { nome: true, whatsapp: true, email: true } } } },
        movimentacoes: { orderBy: { dataEfeito: 'desc' } },
        matriculas: { select: { id: true, turmaId: true, status: true, dataMatricula: true } },
      },
    })
    if (!vinculo) return reply.code(404).send({ error: 'Vínculo não encontrado' })
    // Curso de origem só é lido aqui (relação não declarada de propósito: o
    // Course vive no módulo educacional e não queremos acoplar os schemas).
    const cursoOrigem = vinculo.cursoOrigemId
      ? await prisma.course.findUnique({ where: { id: vinculo.cursoOrigemId }, select: { id: true, nome: true } })
      : null
    return {
      vinculo,
      proximasSituacoes: Vinculo.proximasSituacoes(vinculo.situacao),
      cursoOrigem,
      ingresso: {
        formaRotulo: rotuloForma(vinculo.formaIngresso),
        criterioRotulo: rotuloCriterio(vinculo.criterioClassificacao),
        avisos: avisosDeIngresso({
          formaIngresso: vinculo.formaIngresso,
          criterioClassificacao: vinculo.criterioClassificacao,
          cursoOrigemId: vinculo.cursoOrigemId,
          amparoUrl: vinculo.amparoUrl,
        }),
      },
    }
  })

  app.post('/api/admin/aca/vinculos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const alunoId = num(b.alunoId), courseId = num(b.courseId)
    if (!alunoId || !courseId) return reply.code(400).send({ error: 'alunoId e courseId são obrigatórios' })
    const actor = auditActor(req)
    try {
      const vinculo = await Vinculo.criar({
        alunoId, courseId,
        matrizId: num(b.matrizId), unidadeId: num(b.unidadeId),
        ra: b.ra ?? null, formaIngresso: b.formaIngresso ?? null, turno: b.turno ?? null,
        criterioClassificacao: b.criterioClassificacao ?? null,
        entryModeId: num(b.entryModeId), cursoOrigemId: num(b.cursoOrigemId),
        amparoUrl: b.amparoUrl ?? null,
        dataIngresso: b.dataIngresso ? new Date(b.dataIngresso) : null,
        userId: actor.actorId ?? null, userName: actor.actorName ?? null,
      })
      return { vinculo }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message || 'Falha ao criar vínculo' })
    }
  })

  /**
   * Conformidade dos cursos de pós-graduação lato sensu (Res. CNE/CES 1/2018).
   *
   * Sem `courseId`, varre todos os cursos e devolve só os de especialização —
   * é o painel que a secretaria olha antes de emitir certificado.
   */
  app.get('/api/admin/aca/lato-sensu/conformidade', { preHandler: authMiddleware }, async (req) => {
    const courseId = num((req.query as any)?.courseId)
    if (courseId) {
      const r = await conformidadeLatoSensu(courseId)
      return { cursos: r ? [r] : [] }
    }
    const cursos = await prisma.course.findMany({
      where: { active: true },
      select: { id: true, grau: true, level: { select: { nome: true, codigo: true } } },
    })
    // Filtra antes de apurar: apurar curso técnico só para descartar depois
    // seria uma varredura de diários por nada.
    const latoIds = cursos.filter((c) => ehLatoSensu(c)).map((c) => c.id)
    const resultados = await Promise.all(latoIds.map((id) => conformidadeLatoSensu(id)))
    const lista = resultados.filter((r): r is NonNullable<typeof r> => !!r)
    return {
      cursos: lista,
      resumo: {
        total: lista.length,
        comImpedimento: lista.filter((c) => c.pendencias.some((p) => p.gravidade === 'impedimento')).length,
        comAtencao: lista.filter((c) => c.pendencias.some((p) => p.gravidade === 'atencao')).length,
        // Nenhum curso lato sensu cadastrado não é conformidade — é ausência de
        // dado. A tela precisa distinguir os dois casos.
        semCursoLatoSensu: lista.length === 0,
      },
    }
  })

  /**
   * Catálogo das formas de ingresso do Censo e dos critérios de classificação.
   * A tela consome daqui em vez de repetir a lista — a lista é normativa e não
   * pode divergir entre backend e frontend.
   */
  app.get('/api/admin/aca/formas-ingresso', { preHandler: authMiddleware }, async () => ({
    formas: FORMAS_INGRESSO,
    criterios: CRITERIOS_CLASSIFICACAO,
  }))

  /**
   * Corrige os dados de ingresso de um vínculo existente. Não toca em `situacao`
   * — essa só muda por movimentação (RN-006).
   */
  app.patch('/api/admin/aca/vinculos/:id/ingresso', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    const b = (req.body as any) || {}
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const atual = await prisma.acaVinculo.findUnique({
      where: { id },
      select: { formaIngresso: true, criterioClassificacao: true, cursoOrigemId: true, courseId: true },
    })
    if (!atual) return reply.code(404).send({ error: 'Vínculo não encontrado' })

    const data: any = {}
    if (b.formaIngresso !== undefined) {
      try {
        data.formaIngresso = b.formaIngresso ? validarForma(b.formaIngresso) : null
      } catch (e: any) {
        return reply.code(400).send({ error: e?.message })
      }
    }
    if (b.criterioClassificacao !== undefined) data.criterioClassificacao = b.criterioClassificacao || null
    if (b.amparoUrl !== undefined) data.amparoUrl = b.amparoUrl || null
    if (b.cursoOrigemId !== undefined) {
      const origem = num(b.cursoOrigemId)
      // Curso de origem igual ao de destino não descreve transferência nenhuma.
      if (origem && origem === atual.courseId) {
        return reply.code(400).send({ error: 'O curso de origem não pode ser o mesmo curso do vínculo.' })
      }
      data.cursoOrigemId = origem
    }
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'Nada a alterar.' })

    const vinculo = await prisma.acaVinculo.update({ where: { id }, data })
    const actor = auditActor(req)
    // Forma de ingresso vai para o Censo — alteração precisa de trilha.
    void logUserAudit({
      action: 'aca.vinculo.ingresso', targetType: 'aca_vinculo', targetUserId: null,
      targetLabel: `Vínculo #${id} · ingresso`,
      changes: { de: atual, para: data }, ...actor,
    })
    return {
      vinculo,
      avisos: avisosDeIngresso({
        formaIngresso: vinculo.formaIngresso,
        criterioClassificacao: vinculo.criterioClassificacao,
        cursoOrigemId: vinculo.cursoOrigemId,
        amparoUrl: vinculo.amparoUrl,
      }),
    }
  })

  /** Movimenta a situação — é o único caminho para mudar `situacao`. */
  app.post('/api/admin/aca/vinculos/:id/mover', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    const b = (req.body as any) || {}
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const para = String(b.para || '').toUpperCase()
    if (!para) return reply.code(400).send({ error: 'para (situação destino) é obrigatório' })
    const actor = auditActor(req)
    try {
      const r = await Vinculo.mover({
        vinculoId: id, para: para as any,
        motivo: b.motivo, observacao: b.observacao,
        dataEfeito: b.dataEfeito ? new Date(b.dataEfeito) : undefined,
        documentoUrl: b.documentoUrl,
        userId: actor.actorId ?? undefined, userName: actor.actorName ?? undefined,
      })
      void logUserAudit({ action: 'aca.vinculo.movimentado', targetType: 'vinculo', targetLabel: `Vínculo ${id} → ${para}`, changes: { para, motivo: b.motivo }, ...actor })
      return r
    } catch (e: any) {
      const invalida = e?.name === 'TransicaoInvalidaError'
      return reply.code(invalida ? 409 : 400).send({ error: e?.message, transicaoInvalida: invalida })
    }
  })

  /**
   * Integralização do vínculo — "o que falta para se formar". Mesma engine que
   * alimenta o plano de estudos, a apuração de formandos e a trava da colação,
   * para que aluno e secretaria nunca vejam números diferentes.
   */
  app.get('/api/admin/aca/vinculos/:id/integralizacao', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    try {
      return await Integralizacao.calcular(id)
    } catch (e: any) {
      return reply.code(404).send({ error: e?.message || 'Vínculo não encontrado' })
    }
  })

  /** Prováveis formandos: quem já integralizou tudo e ainda não consta formado. */
  app.get('/api/admin/aca/formandos', { preHandler: authMiddleware }, async (req) => {
    const courseId = num((req.query as any)?.courseId)
    const formandos = await Integralizacao.provaveisFormandos(courseId ?? undefined)
    return { formandos, total: formandos.length }
  })

  app.post('/api/admin/aca/vinculos/movimentacoes/:movId/estornar', { preHandler: authMiddleware }, async (req, reply) => {
    const movId = num((req.params as any).movId)
    if (!movId) return reply.code(400).send({ error: 'id inválido' })
    const actor = auditActor(req)
    try {
      const r = await Vinculo.estornar(movId, { userId: actor.actorId ?? undefined, userName: actor.actorName ?? undefined, motivo: (req.body as any)?.motivo })
      void logUserAudit({ action: 'aca.vinculo.estornado', targetType: 'vinculo', targetLabel: `Movimentação ${movId} estornada`, changes: { movId }, ...actor })
      return r
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })
}
