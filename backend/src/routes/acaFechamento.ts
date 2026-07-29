// src/routes/acaFechamento.ts
// Módulo Acadêmico · P6.3 — Fechamento + Conselho de Classe.
// Consolida MÉDIA (P6.2) + FREQUÊNCIA (P6.1) por diário → situação do aluno,
// conforme regras CONFIGURÁVEIS (Settings grp=academico). Snapshot em
// AcaResultado e ata por turma (AcaConselho). Rotas /api/admin/aca/*.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { resolverEsquema, calcular as calcularPeloEsquema, type EsquemaCompleto } from '../services/acaAvaliacao.js'
import { logUserAudit, auditActor, diffFields } from '../services/userAudit.js'
import { apurar as apurarCompetencia } from '../services/acaCompetencia.js'

const CFG_KEYS = ['aca.media_aprovacao', 'aca.frequencia_minima', 'aca.recuperacao_habilitada', 'aca.recuperacao_min', 'aca.media_aprovacao_recuperacao'] as const
const CFG_DEFAULTS: Record<string, any> = {
  'aca.media_aprovacao': 6, 'aca.frequencia_minima': 75, 'aca.recuperacao_habilitada': true,
  'aca.recuperacao_min': 4, 'aca.media_aprovacao_recuperacao': 6,
}

interface Regras { mediaAprovacao: number; frequenciaMinima: number; frequenciaObrigatoria: boolean; recuperacaoHabilitada: boolean; recuperacaoMin: number; mediaAprovacaoRecuperacao: number }

async function getRegras(): Promise<Regras> {
  const rows = await prisma.setting.findMany({ where: { key: { in: CFG_KEYS as unknown as string[] } } })
  const v = (k: string) => { const r = rows.find((x) => x.key === k); return r ? (r.value as any) : CFG_DEFAULTS[k] }
  return {
    mediaAprovacao: Number(v('aca.media_aprovacao')),
    frequenciaMinima: Number(v('aca.frequencia_minima')),
    // Sem esquema cadastrado o comportamento é o histórico: presencial.
    frequenciaObrigatoria: true,
    recuperacaoHabilitada: !!v('aca.recuperacao_habilitada'),
    recuperacaoMin: Number(v('aca.recuperacao_min')),
    mediaAprovacaoRecuperacao: Number(v('aca.media_aprovacao_recuperacao')),
  }
}

/**
 * Situação por competência: quem manda é o atendimento aos critérios CRÍTICOS.
 *
 * Devolve null quando o componente não tem capacidades cadastradas — aí o
 * fechamento cai na regra de nota, que é o comportamento de sempre. Sem esse
 * cuidado, ligar a avaliação por competência num curso ainda não modelado
 * reprovaria a turma inteira por ausência de dado.
 */
async function decidirPorCompetencia(
  disciplinaId: number | null | undefined,
  matrizId: number | null | undefined,
  matriculaId: number,
  freqPct: number,
  r: Regras,
): Promise<{ situacao: string; explicacao: string; nivel: string | null; nota: number | null } | null> {
  if (!disciplinaId || !matrizId) return null
  const componente = await prisma.acaComponente.findFirst({
    where: { matrizId, disciplinaId }, select: { id: true },
  })
  if (!componente) return null
  const ap = await apurarCompetencia(componente.id, matriculaId)
  if (ap.criticosTotal === 0) return null

  const reprovadoFreq = r.frequenciaObrigatoria && freqPct < r.frequenciaMinima
  if (ap.semAfericao > 0 && !ap.apto) {
    return {
      situacao: reprovadoFreq ? 'REPROVADO_FREQUENCIA' : 'EM_ANDAMENTO',
      explicacao: ap.explicacao, nivel: ap.nivel, nota: ap.notaEquivalente,
    }
  }
  const situacao = ap.apto
    ? (reprovadoFreq ? 'REPROVADO_FREQUENCIA' : 'APROVADO')
    : (reprovadoFreq ? 'REPROVADO_NOTA_FREQUENCIA' : 'REPROVADO_NOTA')
  return {
    situacao,
    explicacao: reprovadoFreq
      ? `Frequência ${freqPct}% abaixo do mínimo de ${r.frequenciaMinima}%. ${ap.explicacao}`
      : ap.explicacao,
    nivel: ap.nivel, nota: ap.notaEquivalente,
  }
}

/** Decide a situação a partir de média, frequência e regras. */
function decidir(media: number | null, freqPct: number, r: Regras): string {
  // Em EAD a frequência não reprova (LDB art. 47, §3º).
  if (r.frequenciaObrigatoria && freqPct < r.frequenciaMinima) return 'REPROVADO_FREQUENCIA'
  if (media == null) return 'EM_ANDAMENTO'
  if (media >= r.mediaAprovacao) return 'APROVADO'
  if (r.recuperacaoHabilitada && media >= r.recuperacaoMin) return 'RECUPERACAO'
  return 'REPROVADO_NOTA'
}

/**
 * Regras que valem para uma disciplina: o esquema de avaliação da Fase 2 tem
 * precedência sobre os Settings globais. Sem esquema cadastrado, nada muda —
 * é o que permite ligar o motor novo sem reconfigurar quem já opera.
 */
async function regrasDaDisciplina(disciplinaId: number | null | undefined, fallback: Regras): Promise<Regras> {
  if (!disciplinaId) return fallback
  const esquema = await resolverEsquema({ disciplinaId }).catch(() => null)
  if (!esquema) return fallback
  return {
    mediaAprovacao: esquema.mediaAprovacao,
    frequenciaMinima: esquema.frequenciaMinima,
    frequenciaObrigatoria: esquema.frequenciaObrigatoria,
    recuperacaoHabilitada: esquema.exameHabilitado,
    recuperacaoMin: esquema.exameMinimo ?? fallback.recuperacaoMin,
    mediaAprovacaoRecuperacao: esquema.mediaFinalAprovacao ?? esquema.mediaAprovacao,
  }
}

async function matriculadosDaTurma(turmaId: number) {
  return prisma.acaMatricula.findMany({
    where: { turmaId, status: 'MATRICULADO', listaEspera: false },
    select: { id: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } },
    orderBy: { aluno: { lead: { nome: 'asc' } } },
  })
}

/**
 * Calcula média e frequência% de cada matrícula de um diário.
 *
 * Quando existe esquema para a disciplina E as avaliações estão vinculadas aos
 * componentes (siglaEsquema), a média sai da FÓRMULA do regimento. Sem isso,
 * cai na média ponderada pelos pesos das avaliações — o comportamento antigo.
 */
async function calcular(diarioId: number, turmaId: number, esquema?: EsquemaCompleto | null) {
  const [avaliacoes, mats, aulas] = await Promise.all([
    prisma.acaAvaliacao.findMany({ where: { diarioId } }),
    matriculadosDaTurma(turmaId),
    prisma.acaAula.findMany({ where: { diarioId }, select: { id: true, quantidadeAulas: true, data: true } }),
  ])
  const avalIds = avaliacoes.map((a) => a.id)
  const aulaIds = aulas.map((a) => a.id)
  const [notas, freqs] = await Promise.all([
    avalIds.length ? prisma.acaNota.findMany({ where: { avaliacaoId: { in: avalIds } } }) : [],
    aulaIds.length ? prisma.acaFrequencia.findMany({ where: { aulaId: { in: aulaIds } }, select: { matriculaId: true, presente: true, aulaId: true } }) : [],
  ])
  const pesoTotal = avaliacoes.reduce((s, a) => s + a.peso, 0)
  const totalAulas = aulas.reduce((s, a) => s + a.quantidadeAulas, 0)
  const qtdByAula = new Map(aulas.map((a) => [a.id, a.quantidadeAulas]))
  const dataByAula = new Map(aulas.map((a) => [a.id, a.data]))

  // Regime de exercícios domiciliares (Dec-Lei 1.044/69, Lei 6.202/75): a falta
  // continua registrada no diário — quem desconsidera as aulas do período é o
  // CÁLCULO. Sem isso, o aluno amparado por lei reprovaria por frequência.
  const alunoIdPorMatricula = new Map<number, number>()
  for (const m of await prisma.acaMatricula.findMany({ where: { turmaId }, select: { id: true, alunoId: true } })) {
    alunoIdPorMatricula.set(m.id, m.alunoId)
  }
  const regimes = await prisma.acaRegimeEspecial.findMany({
    where: { status: 'DEFERIDO', alunoId: { in: [...new Set(alunoIdPorMatricula.values())] } },
    select: { alunoId: true, dataInicio: true, dataFim: true },
  })
  const regimesPorAluno = new Map<number, Array<{ ini: number; fim: number }>>()
  for (const r of regimes) {
    const lista = regimesPorAluno.get(r.alunoId) ?? []
    lista.push({ ini: r.dataInicio.getTime(), fim: r.dataFim.getTime() })
    regimesPorAluno.set(r.alunoId, lista)
  }
  const emRegime = (matriculaId: number, aulaId: number): boolean => {
    const alunoId = alunoIdPorMatricula.get(matriculaId)
    const lista = alunoId != null ? regimesPorAluno.get(alunoId) : undefined
    if (!lista || lista.length === 0) return false
    const d = dataByAula.get(aulaId)
    if (!d) return false
    const t = d.getTime()
    return lista.some((r) => t >= r.ini && t <= r.fim)
  }
  const notaMap: Record<number, Record<number, number | null>> = {}
  for (const n of notas) (notaMap[n.matriculaId] ??= {})[n.avaliacaoId] = n.valor
  const faltasByMat = new Map<number, number>()
  /// Aulas que não entram no denominador do aluno por estarem em regime especial.
  const abonadasByMat = new Map<number, number>()
  for (const f of freqs) {
    const qtd = qtdByAula.get(f.aulaId) || 1
    // Só a AUSÊNCIA amparada sai do denominador. Tirar também as presenças do
    // período encolheria a base e faria a frequência PIORAR — o amparo legal
    // não pode prejudicar quem ele protege.
    if (!f.presente && emRegime(f.matriculaId, f.aulaId)) {
      abonadasByMat.set(f.matriculaId, (abonadasByMat.get(f.matriculaId) || 0) + qtd)
      continue
    }
    if (!f.presente) faltasByMat.set(f.matriculaId, (faltasByMat.get(f.matriculaId) || 0) + qtd)
  }
  // A fórmula do esquema só entra quando TODOS os componentes obrigatórios têm
  // avaliação vinculada — senão o cálculo seria feito com nota faltando.
  const porSigla = new Map<string, number>()
  for (const a of avaliacoes) if (a.siglaEsquema) porSigla.set(a.siglaEsquema, a.id)
  const usaFormula = !!esquema
    && esquema.componentes.filter((c) => c.obrigatorio).every((c) => porSigla.has(c.sigla))

  // Quando o esquema é por competência, a apuração é assíncrona (lê a lista de
  // verificação) — resolvemos depois do map.
  const porCompetencia: Array<{ matriculaId: number; ra: string | null; nome: string; faltas: number; freqPct: number; abonadas: number }> = []

  const linhas = mats.map((m) => {
    const row = notaMap[m.id] || {}
    const faltas = faltasByMat.get(m.id) || 0
    const abonadas = abonadasByMat.get(m.id) || 0
    const base = Math.max(0, totalAulas - abonadas)
    const freqPct = base > 0 ? Math.round(((base - faltas) / base) * 100) : 100

    // Avaliação por competência tem precedência sobre a fórmula: a nota deixa de
    // ser o critério de decisão e passa a expressar o desempenho.
    if (esquema?.avaliacaoPorCompetencia) {
      porCompetencia.push({ matriculaId: m.id, ra: m.aluno.ra, nome: m.aluno.lead.nome, faltas, freqPct, abonadas })
      return {
        matriculaId: m.id, ra: m.aluno.ra, nome: m.aluno.lead.nome,
        media: null, completo: false, faltas, freqPct, aulasEmRegimeEspecial: abonadas,
      }
    }

    if (usaFormula && esquema) {
      const notas: Record<string, number | null> = {}
      for (const c of esquema.componentes) {
        const avalId = porSigla.get(c.sigla)
        notas[c.sigla] = avalId != null ? (row[avalId] ?? null) : null
      }
      const r = calcularPeloEsquema(esquema, notas, freqPct)
      return {
        matriculaId: m.id, ra: m.aluno.ra, nome: m.aluno.lead.nome,
        media: r.media, completo: r.faltamNotas.length === 0, faltas, freqPct,
        aulasEmRegimeEspecial: abonadas,
        situacaoEsquema: r.situacao, explicacao: r.explicacao,
      }
    }

    let somaPeso = 0, soma = 0
    for (const a of avaliacoes) { const val = row[a.id]; if (val != null) { soma += val * a.peso; somaPeso += a.peso } }
    const media = somaPeso > 0 ? Math.round((soma / somaPeso) * 10) / 10 : null
    const completo = somaPeso === pesoTotal && pesoTotal > 0
    return { matriculaId: m.id, ra: m.aluno.ra, nome: m.aluno.lead.nome, media, completo, faltas, freqPct, aulasEmRegimeEspecial: abonadas }
  })

  if (porCompetencia.length > 0) {
    const disciplinaId = (await prisma.acaDiario.findUnique({ where: { id: diarioId }, select: { disciplinaId: true } }))?.disciplinaId
    const matrizId = (await prisma.acaTurma.findUnique({ where: { id: turmaId }, select: { matrizId: true } }))?.matrizId
    const regras = await getRegras()
    const efetivas: Regras = esquema
      ? {
          mediaAprovacao: esquema.mediaAprovacao, frequenciaMinima: esquema.frequenciaMinima,
          frequenciaObrigatoria: esquema.frequenciaObrigatoria,
          recuperacaoHabilitada: esquema.exameHabilitado,
          recuperacaoMin: esquema.exameMinimo ?? regras.recuperacaoMin,
          mediaAprovacaoRecuperacao: esquema.mediaFinalAprovacao ?? esquema.mediaAprovacao,
        }
      : regras
    for (const pc of porCompetencia) {
      const r = await decidirPorCompetencia(disciplinaId, matrizId, pc.matriculaId, pc.freqPct, efetivas)
      const linha = linhas.find((l) => l.matriculaId === pc.matriculaId)
      if (!linha) continue
      if (!r) {
        // Componente sem capacidades: avisa em vez de fingir que apurou.
        ;(linha as any).situacaoEsquema = 'EM_ANDAMENTO'
        ;(linha as any).explicacao = 'Avaliação por competência ligada, mas o componente não tem capacidades cadastradas.'
        continue
      }
      ;(linha as any).media = r.nota
      ;(linha as any).completo = r.situacao !== 'EM_ANDAMENTO'
      ;(linha as any).situacaoEsquema = r.situacao
      ;(linha as any).explicacao = r.explicacao
      ;(linha as any).nivelCompetencia = r.nivel
      ;(linha as any).porCompetencia = true
    }
  }

  return linhas
}

export async function acaFechamentoRoutes(app: FastifyInstance) {
  // ── GET /config — regras de aprovação (configuráveis) ──
  app.get('/api/admin/aca/config', { preHandler: authMiddleware }, async () => ({ regras: await getRegras() }))

  // ── PUT /config — atualiza regras (upsert nos Settings) ──
  app.put('/api/admin/aca/config', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    const map: Record<string, any> = {
      'aca.media_aprovacao': b.mediaAprovacao, 'aca.frequencia_minima': b.frequenciaMinima,
      'aca.recuperacao_habilitada': b.recuperacaoHabilitada, 'aca.recuperacao_min': b.recuperacaoMin,
      'aca.media_aprovacao_recuperacao': b.mediaAprovacaoRecuperacao,
    }
    for (const k of CFG_KEYS) {
      if (map[k] === undefined) continue
      const val = k === 'aca.recuperacao_habilitada' ? !!map[k] : Number(map[k])
      await prisma.setting.upsert({ where: { key: k }, update: { value: val as any }, create: { key: k, label: k, grp: 'academico', fieldType: k === 'aca.recuperacao_habilitada' ? 'boolean' : 'number', value: val as any } })
    }
    return { regras: await getRegras() }
  })

  // ── GET /diarios/:id/fechamento — prévia da situação + flag de fechado ──
  app.get('/api/admin/aca/diarios/:id/fechamento', { preHandler: authMiddleware }, async (req, reply) => {
    const diarioId = Number((req.params as any).id)
    const diario = await prisma.acaDiario.findUnique({ where: { id: diarioId }, select: { turmaId: true, disciplinaId: true } })
    if (!diario) return reply.code(404).send({ error: 'Diário não encontrado' })
    const esquema = await resolverEsquema({ disciplinaId: diario.disciplinaId }).catch(() => null)
    const [regrasGlobais, linhas, resultados, disciplina] = await Promise.all([
      getRegras(), calcular(diarioId, diario.turmaId, esquema),
      prisma.acaResultado.findMany({ where: { diarioId } }),
      prisma.acaDisciplina.findUnique({ where: { id: diario.disciplinaId }, select: { nome: true } }),
    ])
    const regras = await regrasDaDisciplina(diario.disciplinaId, regrasGlobais)
    const resByMat = new Map(resultados.map((r) => [r.matriculaId, r]))
    const out = linhas.map((l) => {
      const fechado = resByMat.get(l.matriculaId)
      return {
        ...l,
        // O esquema já devolve a situação com a explicação; decidir() é o fallback.
        situacao: fechado ? fechado.situacao : ((l as any).situacaoEsquema ?? decidir(l.media, l.freqPct, regras)),
        // A explicação descreve o cálculo ATUAL. Se o diário já foi fechado, a
        // situação exibida é o snapshot gravado — misturar as duas mostraria
        // "aprovado" ao lado de "média abaixo da mínima".
        explicacao: fechado ? null : ((l as any).explicacao ?? null),
        /** Sinaliza que o snapshot foi calculado com regra diferente da vigente. */
        divergenteDoSnapshot: !!fechado && !!(l as any).situacaoEsquema && fechado.situacao !== (l as any).situacaoEsquema,
        observacao: fechado?.observacao ?? null,
        fechadoEm: fechado?.fechadoEm ?? null,
      }
    })
    return { regras, disciplina, linhas: out, fechado: resultados.length > 0 }
  })

  // ── POST /diarios/:id/fechar — grava o resultado (snapshot) por aluno ──
  app.post('/api/admin/aca/diarios/:id/fechar', { preHandler: authMiddleware }, async (req, reply) => {
    const diarioId = Number((req.params as any).id)
    const diario = await prisma.acaDiario.findUnique({ where: { id: diarioId }, select: { turmaId: true, disciplinaId: true } })
    if (!diario) return reply.code(404).send({ error: 'Diário não encontrado' })
    const esquema = await resolverEsquema({ disciplinaId: diario.disciplinaId }).catch(() => null)
    const [regrasGlobais, linhas] = await Promise.all([getRegras(), calcular(diarioId, diario.turmaId, esquema)])
    // Esquema da disciplina manda; sem esquema, seguem as regras globais.
    const regras = await regrasDaDisciplina(diario.disciplinaId, regrasGlobais)
    const agora = new Date()
    let gravados = 0
    for (const l of linhas) {
      const situacao = (l as any).situacaoEsquema ?? decidir(l.media, l.freqPct, regras)
      await prisma.acaResultado.upsert({
        where: { diarioId_matriculaId: { diarioId, matriculaId: l.matriculaId } },
        update: { mediaFinal: l.media, frequenciaPct: l.freqPct, situacao, fechadoEm: agora },
        create: { diarioId, matriculaId: l.matriculaId, mediaFinal: l.media, frequenciaPct: l.freqPct, situacao, fechadoEm: agora },
      })
      gravados++
    }
    return { ok: true, gravados }
  })

  // ── PATCH /resultados/:id — ajuste do conselho (situação/observação) ──
  app.patch('/api/admin/aca/resultados/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('situacao' in b) data.situacao = String(b.situacao).slice(0, 30)
    if ('observacao' in b) data.observacao = b.observacao ? String(b.observacao).slice(0, 2000) : null

    // Mudar a situação de um resultado é transformar reprovado em aprovado (ou
    // o contrário) na vida de alguém. RN-1401: fica registrado o valor de
    // antes, o de depois, quem mudou e de qual IP.
    const antes = await prisma.acaResultado.findUnique({
      where: { id }, select: { situacao: true, observacao: true, matriculaId: true, diarioId: true },
    })
    const resultado = await prisma.acaResultado.update({ where: { id }, data })
    if (antes) {
      const mudancas = diffFields(
        antes as any, resultado as any,
        ['situacao', 'observacao'].filter((c) => c in b) as any[],
      )
      if (Object.keys(mudancas).length > 0) {
        const actor = auditActor(req)
        void logUserAudit({
          action: 'aca.resultado.alterado', targetType: 'aca_resultado', targetUserId: null,
          targetLabel: `Resultado #${id} (matrícula ${antes.matriculaId}, diário ${antes.diarioId})`,
          changes: mudancas, ...actor,
        })
      }
    }
    return { resultado }
  })

  // ── GET /turmas/:id/conselho — quadro consolidado aluno × disciplina + ata ──
  app.get('/api/admin/aca/turmas/:id/conselho', { preHandler: authMiddleware }, async (req, reply) => {
    const turmaId = Number((req.params as any).id)
    const turma = await prisma.acaTurma.findUnique({ where: { id: turmaId }, select: { nome: true } })
    if (!turma) return reply.code(404).send({ error: 'Turma não encontrada' })
    const [diarios, mats, conselho] = await Promise.all([
      prisma.acaDiario.findMany({ where: { turmaId }, select: { id: true, disciplinaId: true } }),
      matriculadosDaTurma(turmaId),
      prisma.acaConselho.findUnique({ where: { turmaId } }),
    ])
    const discIds = [...new Set(diarios.map((d) => d.disciplinaId))]
    const discs = await prisma.acaDisciplina.findMany({ where: { id: { in: discIds } }, select: { id: true, nome: true } })
    const diarioIds = diarios.map((d) => d.id)
    const resultados = diarioIds.length ? await prisma.acaResultado.findMany({ where: { diarioId: { in: diarioIds } } }) : []
    const discByDiario = new Map(diarios.map((d) => [d.id, d.disciplinaId]))
    // resByMat[matriculaId][disciplinaId] = { resultadoId, situacao, media, freq }
    const grid: Record<number, Record<number, any>> = {}
    for (const r of resultados) {
      const disc = discByDiario.get(r.diarioId)!
      ;(grid[r.matriculaId] ??= {})[disc] = { resultadoId: r.id, situacao: r.situacao, media: r.mediaFinal, freqPct: r.frequenciaPct, observacao: r.observacao }
    }
    const REPROVADAS = new Set(['REPROVADO_NOTA', 'REPROVADO_FREQUENCIA', 'REPROVADO'])
    const linhas = mats.map((m) => {
      const cells = grid[m.id] || {}
      const valores = Object.values(cells) as any[]
      const reprovadas = valores.filter((c) => REPROVADAS.has(c.situacao)).length
      const recuperacoes = valores.filter((c) => c.situacao === 'RECUPERACAO').length
      const situacaoGeral = reprovadas > 0 ? 'REPROVADO' : recuperacoes > 0 ? 'RECUPERACAO' : valores.length === discs.length && discs.length > 0 ? 'APROVADO' : 'EM_ANDAMENTO'
      return { matriculaId: m.id, ra: m.aluno.ra, nome: m.aluno.lead.nome, cells, situacaoGeral, reprovadas, recuperacoes }
    })
    return { turma, disciplinas: discs, linhas, ata: conselho?.ata ?? null, fechadoEm: conselho?.fechadoEm ?? null }
  })

  // ── PUT /turmas/:id/conselho — salva ata (e marca fechado quando solicitado) ──
  app.put('/api/admin/aca/turmas/:id/conselho', { preHandler: authMiddleware }, async (req) => {
    const turmaId = Number((req.params as any).id); const b = (req.body as any) || {}
    const ata = b.ata != null ? String(b.ata).slice(0, 10000) : null
    const fechadoEm = b.fechar ? new Date() : b.fechar === false ? null : undefined
    const conselho = await prisma.acaConselho.upsert({
      where: { turmaId },
      update: { ata, ...(fechadoEm !== undefined ? { fechadoEm } : {}) },
      create: { turmaId, ata, fechadoEm: fechadoEm ?? null },
    })
    return { conselho }
  })
}
