// src/routes/acaSistec.ts
// Módulo Acadêmico · O2.10 — Exportação SISTEC / Censo (educação profissional).
// Consolida matrículas + dados do aluno/curso/situação em CSV, base para a
// prestação de informações ao MEC. O leiaute oficial varia; aqui entregamos a
// extração estruturada com o mapeamento de situação (ajustável ao layout vigente).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { calcular as calcularIntegralizacao } from '../services/acaIntegralizacao.js'
import { mover as moverVinculo } from '../services/acaVinculo.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

/**
 * Situação interna → status do SISTEC, com os nomes que o sistema usa.
 *
 * Duas regras do SISTEC que o mapeamento anterior desrespeitava:
 *
 * 1. **Não existe "Reprovação" para curso técnico** — esse status só está
 *    disponível para FIC e superior. O aluno técnico que não atinge desempenho
 *    permanece "Em curso" e entra nos indicadores como retido. Exportar
 *    reprovação num técnico é informar ao MEC um status que ele não aceita.
 * 2. **Transferência interna e externa são status diferentes**: trocar de curso
 *    na mesma unidade não é a mesma coisa que sair para outra unidade, e a
 *    estatística da unidade depende da distinção.
 *
 * Falta ainda "Integralizar em Fase Escolar", que aqui vem do vínculo
 * (INTEGRALIZANDO) — a matrícula em turma não sabe se o estágio foi entregue.
 */
const SITUACAO: Record<string, string> = {
  MATRICULADO: 'EM_CURSO',
  CONCLUIDO: 'CONCLUIDA',
  EVADIDO: 'EVASAO',
  TRANCADO: 'TRANCADA',
  TRANSFERIDO: 'TRANSFERIDO_EXTERNO',
  CANCELADO: 'DESLIGAMENTO',
  // TRANSFERIDO_INTERNO não entra aqui: é situação do VÍNCULO (troca de curso),
  // não da matrícula em turma — e este mapa também serve de filtro de status,
  // então um valor fora do enum quebra a consulta.
  // Reprovação NÃO é mapeada de propósito: ver a regra 1 acima.
}
const INCLUIR = Object.keys(SITUACAO) // exclui INSCRITO/PRE_MATRICULA

/** Situação do VÍNCULO que tem precedência sobre a da matrícula em turma. */
const SITUACAO_VINCULO: Record<string, string> = {
  INTEGRALIZANDO: 'INTEGRALIZAR_EM_FASE_ESCOLAR',
  TRANSFERIDO_INTERNO: 'TRANSFERIDO_INTERNO',
  FORMADO: 'CONCLUIDA',
  DIPLOMADO: 'CONCLUIDA',
}

/** Rótulos legíveis, iguais aos do SISTEC — a tela mostra estes. */
export const ROTULO_SISTEC: Record<string, string> = {
  EM_CURSO: 'Em curso',
  CONCLUIDA: 'Conclusão',
  INTEGRALIZAR_EM_FASE_ESCOLAR: 'Integralizar em Fase Escolar',
  EVASAO: 'Evasão',
  DESLIGAMENTO: 'Desligamento',
  TRANCADA: 'Trancada',
  TRANSFERIDO_INTERNO: 'Transferência Interna',
  TRANSFERIDO_EXTERNO: 'Transferência Externa',
}

/**
 * Prazo regulamentar: o registro da situação vai até o dia 25 do mês seguinte
 * ao da ocorrência (Portaria nº 31/2022). Passar disso não só atrasa — registrar
 * fora do mês do fato distorce os indicadores da unidade.
 */
export function prazoSistec(hoje = new Date()) {
  const limite = new Date(hoje.getFullYear(), hoje.getMonth(), 25, 23, 59, 59)
  const competencia = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
  const diasRestantes = Math.ceil((limite.getTime() - hoje.getTime()) / 86400_000)
  return {
    competencia: competencia.toISOString().slice(0, 7),
    limite,
    diasRestantes,
    vencido: hoje > limite,
    // Uma semana é o ponto em que ainda dá para levantar as pendências do mês.
    alerta: diasRestantes <= 7,
  }
}

/** Situação a informar: o vínculo manda quando diz algo mais específico. */
function situacaoSistec(statusMatricula: string, situacaoVinculo?: string): string {
  if (situacaoVinculo && SITUACAO_VINCULO[situacaoVinculo]) return SITUACAO_VINCULO[situacaoVinculo]!
  return SITUACAO[statusMatricula] || statusMatricula
}

async function coletar(filtros: { periodoLetivoId?: number; turmaId?: number }) {
  const turmaWhere: any = {}
  if (filtros.turmaId) turmaWhere.id = filtros.turmaId
  if (filtros.periodoLetivoId) turmaWhere.periodoLetivoId = filtros.periodoLetivoId
  const mats = await prisma.acaMatricula.findMany({
    where: { status: { in: INCLUIR as any }, ...(Object.keys(turmaWhere).length ? { turma: turmaWhere } : {}) },
    orderBy: [{ turmaId: 'asc' }, { id: 'asc' }],
    select: {
      status: true, dataMatricula: true, dataConclusao: true,
      vinculoId: true,
      aluno: { select: { ra: true, cpf: true, dataNascimento: true, sexo: true, lead: { select: { nome: true } } } },
      turma: { select: { nome: true, courseOfferingId: true, matrizId: true, periodoLetivo: { select: { codigo: true } } } },
    },
  })
  // A situação do vínculo tem precedência: é ela que sabe se o aluno está
  // integralizando (falta estágio/TCC) ou saiu por transferência interna.
  const vincIds = [...new Set(mats.map((m) => m.vinculoId).filter((x): x is number => !!x))]
  const vinculos = vincIds.length
    ? await prisma.acaVinculo.findMany({ where: { id: { in: vincIds } }, select: { id: true, situacao: true } })
    : []
  const sitVinculo = new Map(vinculos.map((v) => [v.id, String(v.situacao)]))

  // resolve curso + carga horária (matriz) com cache
  const offCache = new Map<number, string>()
  const chCache = new Map<number, number>()
  const out = []
  for (const m of mats) {
    let curso = '—'
    const offId = m.turma.courseOfferingId
    if (offId) {
      if (offCache.has(offId)) curso = offCache.get(offId)!
      else { const off = await prisma.courseOffering.findUnique({ where: { id: offId }, select: { courseId: true } }); if (off) { const c = await prisma.course.findUnique({ where: { id: off.courseId }, select: { nome: true } }); curso = c?.nome || '—' } offCache.set(offId, curso) }
    }
    let chCurso = 0
    if (m.turma.matrizId) {
      if (chCache.has(m.turma.matrizId)) chCurso = chCache.get(m.turma.matrizId)!
      else {
        const comps = await prisma.acaComponente.findMany({ where: { matrizId: m.turma.matrizId }, select: { disciplina: { select: { cargaHoraria: true } } } })
        chCurso = comps.reduce((s, c) => s + (c.disciplina?.cargaHoraria || 0), 0)
        chCache.set(m.turma.matrizId, chCurso)
      }
    }
    out.push({
      cpf: m.aluno.cpf || '', nome: m.aluno.lead.nome, nascimento: m.aluno.dataNascimento, sexo: m.aluno.sexo || '', ra: m.aluno.ra || '',
      curso, turma: m.turma.nome, periodo: m.turma.periodoLetivo?.codigo || '', cargaHoraria: chCurso,
      situacao: situacaoSistec(m.status, m.vinculoId ? sitVinculo.get(m.vinculoId) : undefined),
      dataMatricula: m.dataMatricula, dataConclusao: m.dataConclusao,
    })
  }
  return out
}

export async function acaSistecRoutes(app: FastifyInstance) {
  // ── Prévia (contagens por situação) ──
  app.get('/api/admin/aca/sistec/preview', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const linhas = await coletar({ periodoLetivoId: q.periodoLetivoId ? Number(q.periodoLetivoId) : undefined, turmaId: q.turmaId ? Number(q.turmaId) : undefined })
    const porSituacao: Record<string, number> = {}
    let semCpf = 0
    for (const l of linhas) { porSituacao[l.situacao] = (porSituacao[l.situacao] || 0) + 1; if (!l.cpf) semCpf++ }
    return { total: linhas.length, porSituacao, semCpf, amostra: linhas.slice(0, 8) }
  })

  /**
   * Painel de conformidade: prazo do mês e o que está fora do lugar.
   *
   * Vale mais que a exportação em si — o erro comum não é exportar errado, é
   * deixar passar o dia 25 sem registrar a mudança de situação.
   */
  app.get('/api/admin/aca/sistec/conformidade', { preHandler: authMiddleware }, async () => {
    const prazo = prazoSistec()

    // Alunos que a integralização diz estarem em fase escolar mas cujo vínculo
    // ainda consta ATIVO: são os que o SISTEC receberia com status errado.
    const ativos = await prisma.acaVinculo.findMany({
      where: { situacao: 'ATIVO', matrizId: { not: null } },
      select: { id: true, alunoId: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } },
    })
    const aAjustar: Array<{ vinculoId: number; nome: string; ra: string | null; pendencias: string[] }> = []
    for (const v of ativos) {
      const r = await calcularIntegralizacao(v.id).catch(() => null)
      if (r?.integralizandoEmFaseEscolar) {
        aAjustar.push({
          vinculoId: v.id,
          nome: v.aluno?.lead?.nome ?? `Aluno #${v.alunoId}`,
          ra: v.aluno?.ra ?? null,
          pendencias: r.pendenciasDeFase,
        })
      }
    }

    const [semCpf, jaIntegralizando] = await Promise.all([
      // CPF é obrigatório no SISTEC: sem ele a matrícula não sobe.
      prisma.aluno.count({ where: { cpf: null, vinculos: { some: { situacao: { in: ['ATIVO', 'INTEGRALIZANDO'] } } } } }),
      prisma.acaVinculo.count({ where: { situacao: 'INTEGRALIZANDO' } }),
    ])

    const cursosSemEixo = await prisma.course.count({
      where: { active: true, grau: 'tecnico', eixoTecnologico: null },
    })

    return {
      prazo,
      integralizandoEmFaseEscolar: { registrados: jaIntegralizando, aAjustar },
      pendencias: {
        alunosSemCpf: semCpf,
        cursosTecnicosSemEixo: cursosSemEixo,
      },
      rotulos: ROTULO_SISTEC,
    }
  })

  /**
   * Aplica a situação INTEGRALIZANDO em quem a integralização já classificou
   * assim. Não é automático de propósito: mudar situação de vínculo é ato da
   * secretaria, e ela precisa ver a lista antes.
   */
  app.post('/api/admin/aca/sistec/aplicar-integralizando', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const ids: number[] = Array.isArray(b.vinculoIds) ? b.vinculoIds.map(Number).filter(Boolean) : []
    if (ids.length === 0) return reply.code(400).send({ error: 'Selecione os vínculos a ajustar.' })

    const actor = auditActor(req)
    let ok = 0
    const erros: string[] = []
    for (const id of ids) {
      // Reconfere antes de mover: a lista pode ter sido carregada há horas.
      const r = await calcularIntegralizacao(id).catch(() => null)
      if (!r?.integralizandoEmFaseEscolar) { erros.push(`#${id}: não está em fase escolar`); continue }
      try {
        await moverVinculo({
          vinculoId: id, para: 'INTEGRALIZANDO',
          motivo: `Componentes curriculares cumpridos; pendente: ${r.pendenciasDeFase.join(', ') || 'estágio/TCC'}`,
          ...(actor.actorId ? { userId: actor.actorId } : {}),
          ...(actor.actorName ? { userName: actor.actorName } : {}),
        })
        ok++
      } catch (e: any) { erros.push(`#${id}: ${e?.message}`) }
    }
    void logUserAudit({
      action: 'aca.sistec.integralizando', targetType: 'aca_vinculo', targetUserId: null,
      targetLabel: `${ok} vínculo(s) marcados como Integralizar em Fase Escolar`, ...actor,
    })
    return reply.send({ ajustados: ok, erros })
  })

  // ── Exportação CSV ──
  app.get('/api/admin/aca/sistec/export.csv', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const linhas = await coletar({ periodoLetivoId: q.periodoLetivoId ? Number(q.periodoLetivoId) : undefined, turmaId: q.turmaId ? Number(q.turmaId) : undefined })
    const esc = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const data = (d: any) => (d ? new Date(d).toLocaleDateString('pt-BR') : '')
    const head = ['CPF', 'Nome', 'DataNascimento', 'Sexo', 'RA', 'Curso', 'Turma', 'Periodo', 'CargaHorariaCurso', 'SituacaoSISTEC', 'DataMatricula', 'DataConclusao']
    const rows = linhas.map((l) => [l.cpf, l.nome, data(l.nascimento), l.sexo, l.ra, l.curso, l.turma, l.periodo, l.cargaHoraria, l.situacao, data(l.dataMatricula), data(l.dataConclusao)].map(esc).join(';'))
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="sistec-censo.csv"')
    return reply.send('﻿' + [head.map(esc).join(';'), ...rows].join('\n'))
  })
}
