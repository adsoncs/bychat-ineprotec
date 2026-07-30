// src/services/acaDocumentos.ts
// Emissão de documentos acadêmicos NUMERADOS (histórico, declarações, ata,
// recibo). Compartilhado entre a Secretaria (admin) e o Portal do Aluno
// (self-service · O2.1). Retorna o AcaDocumento criado.

import { prisma } from '../lib/prisma.js'
import { ehLatoSensu, atoCredenciamento, corpoDocenteEfetivo } from './acaLatoSensu.js'

export async function proximoNumero(): Promise<string> {
  const ano = new Date().getFullYear()
  const count = await prisma.acaDocumento.count({ where: { numero: { startsWith: `${ano}/` } } })
  return `${ano}/${String(count + 1).padStart(4, '0')}`
}

/** Histórico consolidado do aluno (períodos × disciplinas). */
export async function montarHistorico(alunoId: number) {
  const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { ra: true, cpf: true, lead: { select: { nome: true } } } })
  if (!aluno) return null
  const matriculas = await prisma.acaMatricula.findMany({
    where: { alunoId, status: { in: ['MATRICULADO', 'CONCLUIDO', 'TRANCADO'] as any } },
    select: { id: true, turmaId: true, turma: { select: { nome: true, courseOfferingId: true, periodoLetivo: { select: { codigo: true, descricao: true } } } } },
    orderBy: { dataMatricula: 'asc' },
  })
  let curso = '—'
  // Res. CNE/CP 1/2021, art. 49, §4º: o histórico que acompanha certificados e
  // diplomas DEVE explicitar o perfil profissional de conclusão. Sem isso o
  // documento sai incompleto para a educação profissional.
  let perfilConclusao: string | null = null
  let eixoTecnologico: string | null = null
  let courseId: number | null = null
  // Res. CNE/CES 1/2018, art. 8º: o histórico do lato sensu tem exigências
  // próprias (ato de credenciamento, período de realização, corpo docente com
  // titulação). Só as monta quando o curso é de especialização.
  let latoSensu = false
  const offId = matriculas.find((m) => m.turma.courseOfferingId)?.turma.courseOfferingId
  if (offId) {
    const off = await prisma.courseOffering.findUnique({ where: { id: offId }, select: { courseId: true } })
    if (off) {
      const c = await prisma.course.findUnique({
        where: { id: off.courseId },
        select: {
          id: true, nome: true, perfilConclusao: true, eixoTecnologico: true,
          grau: true, level: { select: { nome: true, codigo: true } },
        },
      })
      if (c) {
        curso = c.nome; perfilConclusao = c.perfilConclusao; eixoTecnologico = c.eixoTecnologico
        courseId = c.id
        latoSensu = ehLatoSensu(c)
      }
    }
  }

  // Qualificações intermediárias já certificadas entram no histórico: são parte
  // do itinerário do aluno, não documento solto.
  const qualificacoes = (await prisma.acaDocumento.findMany({
    where: { alunoId, tipo: 'CERTIFICADO_QUALIFICACAO' },
    orderBy: { emitidoEm: 'asc' },
    select: { numero: true, emitidoEm: true, dadosJson: true },
  })).map((d) => {
    const m = (d.dadosJson as any)?.modulo ?? {}
    return {
      numero: d.numero, emitidoEm: d.emitidoEm,
      titulo: m.titulo ?? null, modulo: m.nome ?? null, cargaHoraria: m.cargaHoraria ?? null,
    }
  })
  const periodos: any[] = []
  let chTotal = 0
  for (const m of matriculas) {
    const diarios = await prisma.acaDiario.findMany({ where: { turmaId: m.turmaId }, select: { id: true, disciplinaId: true } })
    if (!diarios.length) continue
    const resultados = await prisma.acaResultado.findMany({ where: { diarioId: { in: diarios.map((d) => d.id) }, matriculaId: m.id } })
    if (!resultados.length) continue
    const discById = new Map(diarios.map((d) => [d.id, d.disciplinaId]))
    const discIds = [...new Set(resultados.map((r) => discById.get(r.diarioId)!))]
    const discs = await prisma.acaDisciplina.findMany({ where: { id: { in: discIds } }, select: { id: true, nome: true, cargaHoraria: true } })
    const dMap = new Map(discs.map((d) => [d.id, d]))
    const disciplinas = resultados.map((r) => {
      const disc = dMap.get(discById.get(r.diarioId)!)
      if (r.situacao === 'APROVADO') chTotal += disc?.cargaHoraria || 0
      return { nome: disc?.nome || '—', cargaHoraria: disc?.cargaHoraria || 0, media: r.mediaFinal, freqPct: r.frequenciaPct, situacao: r.situacao }
    })
    periodos.push({ periodo: m.turma.periodoLetivo?.codigo || '—', turma: m.turma.nome, disciplinas })
  }
  // F6 — aproveitamentos DEFERIDOS entram como bloco extra e somam carga horária.
  const aproveitamentos = await prisma.acaAproveitamento.findMany({
    where: { matriculaId: { in: matriculas.map((m) => m.id) }, status: 'DEFERIDO' },
    select: { componenteId: true, cargaHorariaAproveitada: true, nota: true, instituicaoOrigem: true },
  })
  if (aproveitamentos.length) {
    const compIds = [...new Set(aproveitamentos.map((a) => a.componenteId))]
    const comps = await prisma.acaComponente.findMany({ where: { id: { in: compIds } }, select: { id: true, disciplina: { select: { nome: true, cargaHoraria: true } } } })
    const cMap = new Map(comps.map((c) => [c.id, c.disciplina]))
    const disciplinas = aproveitamentos.map((a) => {
      const disc = cMap.get(a.componenteId)
      const ch = a.cargaHorariaAproveitada || disc?.cargaHoraria || 0
      chTotal += ch
      return { nome: disc?.nome || '—', cargaHoraria: ch, media: a.nota, freqPct: 100, situacao: 'APROVEITADO' }
    })
    periodos.push({ periodo: 'Aproveitamento', turma: 'Aproveitamento de estudos', disciplinas })
  }
  // ── Exigências do lato sensu (Res. CNE/CES 1/2018, art. 8º) ──
  //
  // Sem estes três blocos o certificado de especialização sai irregular, e é o
  // erro mais comum: instituição imprime o histórico da graduação e entrega.
  let credenciamento = null
  let corpoDocente: Awaited<ReturnType<typeof corpoDocenteEfetivo>> = []
  let periodoRealizacao: { inicio: string | null; fim: string | null } | null = null
  if (latoSensu) {
    credenciamento = await atoCredenciamento()          // art. 8º, I
    corpoDocente = await corpoDocenteEfetivo(alunoId)   // art. 8º, III
    // art. 8º, II — período de realização, extraído das aulas efetivamente
    // lançadas; é o que descreve a duração real, não a prevista no cadastro.
    const turmaIds = matriculas.map((m) => m.turmaId)
    if (turmaIds.length) {
      const dias = await prisma.acaDiario.findMany({ where: { turmaId: { in: turmaIds } }, select: { id: true } })
      if (dias.length) {
        const agg = await prisma.acaAula.aggregate({
          where: { diarioId: { in: dias.map((d) => d.id) } },
          _min: { data: true }, _max: { data: true },
        })
        if (agg._min.data || agg._max.data) {
          periodoRealizacao = {
            inicio: agg._min.data ? agg._min.data.toISOString() : null,
            fim: agg._max.data ? agg._max.data.toISOString() : null,
          }
        }
      }
    }
  }

  return {
    aluno: { nome: aluno.lead.nome, ra: aluno.ra, cpf: aluno.cpf },
    curso, courseId, periodos, chTotal,
    // Educação profissional (art. 49, §4º): campos nulos em curso de graduação,
    // onde não se aplicam.
    perfilConclusao, eixoTecnologico,
    ...(qualificacoes.length > 0 ? { qualificacoes } : {}),
    // Lato sensu: campos ausentes em curso técnico ou de graduação, onde a
    // Res. CNE/CES 1/2018 não se aplica.
    latoSensu,
    ...(credenciamento ? { credenciamento } : {}),
    ...(corpoDocente.length > 0 ? { corpoDocente } : {}),
    ...(periodoRealizacao ? { periodoRealizacao } : {}),
  }
}

export async function frequenciaGlobal(alunoId: number): Promise<number | null> {
  const hist = await montarHistorico(alunoId)
  if (!hist) return null
  const freqs = hist.periodos.flatMap((p: any) => p.disciplinas.map((d: any) => d.freqPct).filter((f: any) => f != null))
  if (!freqs.length) return null
  return Math.round(freqs.reduce((s: number, f: number) => s + f, 0) / freqs.length)
}

async function cursoETurmaAtual(alunoId: number) {
  const mat = await prisma.acaMatricula.findFirst({ where: { alunoId, status: 'MATRICULADO' }, orderBy: { dataMatricula: 'desc' }, select: { turma: { select: { nome: true, courseOfferingId: true } } } })
  let curso = '—'
  if (mat?.turma.courseOfferingId) { const off = await prisma.courseOffering.findUnique({ where: { id: mat.turma.courseOfferingId }, select: { courseId: true } }); if (off) { const c = await prisma.course.findUnique({ where: { id: off.courseId }, select: { nome: true } }); if (c) curso = c.nome } }
  return { curso, turma: mat?.turma.nome || '—' }
}

export type DocTipo = 'HISTORICO' | 'DECLARACAO_MATRICULA' | 'DECLARACAO_FREQUENCIA' | 'ATA_RESULTADOS'
  | 'QUITACAO_ANUAL' | 'CARTEIRINHA' | 'INFORME_IR' | 'CERTIFICADO_QUALIFICACAO'

/**
 * Declaração de quitação anual de débito (Lei 12.007/09).
 *
 * A lei obriga a instituição a entregar, até maio do ano seguinte, declaração
 * de quitação referente ao ano anterior — e ela só vale quando TODAS as
 * parcelas do período estão pagas. Não é opcional nem sob demanda: é obrigação
 * anual, e a ausência disso era uma lacuna real (nenhuma ocorrência no código).
 *
 * A declaração discrimina os meses quitados, como a lei exige.
 */
export async function emitirQuitacaoAnual(alunoId: number, ano: number, userId: number | null = null) {
  const aluno = await prisma.aluno.findUnique({
    where: { id: alunoId },
    select: { ra: true, cpf: true, lead: { select: { nome: true } } },
  })
  if (!aluno) throw new Error('Aluno não encontrado')

  const inicio = new Date(ano, 0, 1)
  const fim = new Date(ano, 11, 31, 23, 59, 59)

  const contratos = await prisma.acaContrato.findMany({ where: { matricula: { alunoId } }, select: { id: true } })
  if (contratos.length === 0) throw new Error('Aluno sem contrato — não há o que declarar')

  const parcelas = await prisma.acaParcela.findMany({
    where: { contratoId: { in: contratos.map((c) => c.id) }, dataVencimento: { gte: inicio, lte: fim } },
    orderBy: { dataVencimento: 'asc' },
    select: { tipo: true, dataVencimento: true, valorBrutoCentavos: true, valorPagoCentavos: true, situacao: true, pagoEm: true },
  })
  if (parcelas.length === 0) throw new Error(`Nenhuma parcela com vencimento em ${ano}`)

  // "Quitação" pressupõe TODAS as parcelas do ano pagas — emitir com pendência
  // seria declarar algo falso em documento oficial.
  const emAberto = parcelas.filter((p) => p.situacao !== 'PAGA' && p.situacao !== 'CANCELADA')
  if (emAberto.length > 0) {
    throw new Error(`Há ${emAberto.length} parcela(s) não quitada(s) em ${ano} — a declaração de quitação não pode ser emitida`)
  }

  const pagas = parcelas.filter((p) => p.situacao === 'PAGA')
  const totalCentavos = pagas.reduce((s, p) => s + (p.valorPagoCentavos || p.valorBrutoCentavos), 0)
  const { curso } = await cursoETurmaAtual(alunoId)

  const dados = {
    aluno: { nome: aluno.lead.nome, ra: aluno.ra, cpf: aluno.cpf },
    curso, ano,
    totalCentavos,
    parcelas: pagas.map((p) => ({
      tipo: p.tipo,
      vencimento: p.dataVencimento,
      pagoEm: p.pagoEm,
      valorCentavos: p.valorPagoCentavos || p.valorBrutoCentavos,
    })),
  }
  const numero = await proximoNumero()
  return prisma.acaDocumento.create({
    data: {
      numero, tipo: 'QUITACAO_ANUAL', alunoId,
      titulo: `Declaração de Quitação ${ano} — ${aluno.lead.nome}`,
      dadosJson: dados as any, emitidoPorUserId: userId,
    },
  })
}

/**
 * Informe de pagamentos para o Imposto de Renda (T-907).
 *
 * NÃO se confunde com a declaração de quitação anual: a quitação atesta que
 * nada ficou em aberto e só pode ser emitida se tudo foi pago; o informe
 * declara QUANTO foi efetivamente pago no ano-calendário, para o aluno (ou
 * quem paga por ele) deduzir despesa de instrução. Aluno inadimplente também
 * tem direito ao informe — pelo que pagou.
 *
 * O critério é a data do PAGAMENTO, não a do vencimento: o IR é por regime de
 * caixa, e uma mensalidade de dezembro paga em janeiro pertence ao ano
 * seguinte.
 */
export async function emitirInformeIR(alunoId: number, ano: number, userId: number | null = null) {
  const aluno = await prisma.aluno.findUnique({
    where: { id: alunoId },
    select: { ra: true, cpf: true, lead: { select: { nome: true } } },
  })
  if (!aluno) throw new Error('Aluno não encontrado')

  const contratos = await prisma.acaContrato.findMany({ where: { matricula: { alunoId } }, select: { id: true } })
  if (contratos.length === 0) throw new Error('Aluno sem contrato — não há pagamentos a informar')

  const inicio = new Date(ano, 0, 1)
  const fim = new Date(ano, 11, 31, 23, 59, 59)
  const pagas = await prisma.acaParcela.findMany({
    where: { contratoId: { in: contratos.map((c) => c.id) }, situacao: 'PAGA', pagoEm: { gte: inicio, lte: fim } },
    orderBy: { pagoEm: 'asc' },
    select: { tipo: true, nroParcela: true, dataVencimento: true, pagoEm: true, valorPagoCentavos: true, valorBrutoCentavos: true },
  })
  if (pagas.length === 0) throw new Error(`Nenhum pagamento registrado em ${ano}`)

  const totalCentavos = pagas.reduce((s, p) => s + (p.valorPagoCentavos || p.valorBrutoCentavos), 0)
  const { curso } = await cursoETurmaAtual(alunoId)

  const dados = {
    aluno: { nome: aluno.lead.nome, ra: aluno.ra, cpf: aluno.cpf },
    curso, ano, totalCentavos,
    pagamentos: pagas.map((p) => ({
      tipo: p.tipo,
      nroParcela: p.nroParcela,
      vencimento: p.dataVencimento,
      pagoEm: p.pagoEm,
      valorCentavos: p.valorPagoCentavos || p.valorBrutoCentavos,
    })),
  }
  const numero = await proximoNumero()
  return prisma.acaDocumento.create({
    data: {
      numero, tipo: 'INFORME_IR', alunoId,
      titulo: `Informe de Pagamentos ${ano} (IR) — ${aluno.lead.nome}`,
      dadosJson: dados as any, emitidoPorUserId: userId,
    },
  })
}

/**
 * Carteirinha digital do estudante (RF-706). O número do documento já serve de
 * código de verificação — a validação pública existente confere autenticidade.
 */
export async function emitirCarteirinha(alunoId: number, userId: number | null = null) {
  const aluno = await prisma.aluno.findUnique({
    where: { id: alunoId },
    select: { ra: true, cpf: true, dataNascimento: true, fotoUrl: true, lead: { select: { nome: true } } },
  })
  if (!aluno) throw new Error('Aluno não encontrado')
  const { curso, turma } = await cursoETurmaAtual(alunoId)
  if (curso === '—') throw new Error('Aluno sem matrícula ativa — carteirinha exige vínculo vigente')

  // Validade até o fim do período letivo corrente; sem período, fim do ano.
  const periodo = await prisma.acaPeriodoLetivo.findFirst({ where: { ativo: true }, orderBy: { id: 'desc' }, select: { dataFim: true, codigo: true } })
  const validade = periodo?.dataFim ?? new Date(new Date().getFullYear(), 11, 31)

  const dados = {
    aluno: { nome: aluno.lead.nome, ra: aluno.ra, cpf: aluno.cpf, nascimento: aluno.dataNascimento, fotoUrl: aluno.fotoUrl },
    curso, turma, periodo: periodo?.codigo ?? null, validade,
  }
  const numero = await proximoNumero()
  return prisma.acaDocumento.create({
    data: {
      numero, tipo: 'CARTEIRINHA', alunoId,
      titulo: `Carteirinha — ${aluno.lead.nome}`,
      dadosJson: dados as any, emitidoPorUserId: userId,
    },
  })
}

/** Emite o certificado de conclusão (a partir de uma matrícula CONCLUÍDA). */
export async function emitirCertificado(matriculaId: number, userId: number | null = null) {
  const mat = await prisma.acaMatricula.findUnique({
    where: { id: matriculaId },
    select: { status: true, dataConclusao: true, alunoId: true, aluno: { select: { ra: true, cpf: true, lead: { select: { nome: true } } } }, turma: { select: { courseOfferingId: true } } },
  })
  if (!mat) throw new Error('Matrícula não encontrada')
  if (mat.status !== 'CONCLUIDO') throw new Error('A matrícula precisa estar concluída para certificar.')
  let curso = '—'
  if (mat.turma.courseOfferingId) { const off = await prisma.courseOffering.findUnique({ where: { id: mat.turma.courseOfferingId }, select: { courseId: true } }); if (off) { const c = await prisma.course.findUnique({ where: { id: off.courseId }, select: { nome: true } }); if (c) curso = c.nome } }
  const hist = await montarHistorico(mat.alunoId)
  const cargaHoraria = hist?.chTotal ?? 0
  const conclusao = (mat.dataConclusao ? new Date(mat.dataConclusao) : new Date()).toLocaleDateString('pt-BR')
  const dados = { aluno: { nome: mat.aluno.lead.nome, ra: mat.aluno.ra, cpf: mat.aluno.cpf }, curso, cargaHoraria, conclusao }
  const numero = await proximoNumero()
  return prisma.acaDocumento.create({ data: { numero, tipo: 'CERTIFICADO', alunoId: mat.alunoId, titulo: `Certificado — ${mat.aluno.lead.nome}`, dadosJson: dados as any, emitidoPorUserId: userId } })
}

/** Emite um documento do aluno (gera número + snapshot). Lança Error se inválido. */
export async function emitirDocumentoAluno(tipo: DocTipo, alunoId: number, userId: number | null = null) {
  const numero = await proximoNumero()
  if (tipo === 'HISTORICO') {
    const hist = await montarHistorico(alunoId)
    if (!hist) throw new Error('Aluno não encontrado')
    return prisma.acaDocumento.create({ data: { numero, tipo, alunoId, titulo: `Histórico Escolar — ${hist.aluno.nome}`, dadosJson: hist as any, emitidoPorUserId: userId } })
  }
  if (tipo === 'DECLARACAO_MATRICULA' || tipo === 'DECLARACAO_FREQUENCIA') {
    const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { ra: true, cpf: true, lead: { select: { nome: true } } } })
    if (!aluno) throw new Error('Aluno não encontrado')
    const { curso, turma } = await cursoETurmaAtual(alunoId)
    const freq = tipo === 'DECLARACAO_FREQUENCIA' ? await frequenciaGlobal(alunoId) : null
    const dados = { aluno: { nome: aluno.lead.nome, ra: aluno.ra, cpf: aluno.cpf }, curso, turma, freq }
    const titulo = tipo === 'DECLARACAO_MATRICULA' ? 'Declaração de Matrícula' : 'Declaração de Frequência'
    return prisma.acaDocumento.create({ data: { numero, tipo, alunoId, titulo: `${titulo} — ${aluno.lead.nome}`, dadosJson: dados as any, emitidoPorUserId: userId } })
  }
  throw new Error('tipo inválido')
}

/** Emite a ata de resultados de uma turma. */
export async function emitirAtaTurma(turmaId: number, userId: number | null = null) {
  const turma = await prisma.acaTurma.findUnique({ where: { id: turmaId }, select: { nome: true } })
  if (!turma) throw new Error('Turma não encontrada')
  const numero = await proximoNumero()
  const diarios = await prisma.acaDiario.findMany({ where: { turmaId }, select: { id: true } })
  const resultados = diarios.length ? await prisma.acaResultado.findMany({ where: { diarioId: { in: diarios.map((d) => d.id) } } }) : []
  const mats = await prisma.acaMatricula.findMany({ where: { turmaId, status: 'MATRICULADO', listaEspera: false }, select: { id: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } }, orderBy: { aluno: { lead: { nome: 'asc' } } } })
  const REPROVADAS = new Set(['REPROVADO_NOTA', 'REPROVADO_FREQUENCIA', 'REPROVADO'])
  const byMat = new Map<number, any[]>()
  for (const r of resultados) (byMat.get(r.matriculaId) ?? byMat.set(r.matriculaId, []).get(r.matriculaId)!).push(r)
  const linhas = mats.map((m) => {
    const rs = byMat.get(m.id) || []
    const reprovadas = rs.filter((r) => REPROVADAS.has(r.situacao)).length
    const recuperacoes = rs.filter((r) => r.situacao === 'RECUPERACAO').length
    const situacaoGeral = reprovadas > 0 ? 'REPROVADO' : recuperacoes > 0 ? 'RECUPERACAO' : rs.length > 0 ? 'APROVADO' : 'EM_ANDAMENTO'
    return { nome: m.aluno.lead.nome, ra: m.aluno.ra, situacaoGeral, reprovadas, recuperacoes }
  })
  const conselho = await prisma.acaConselho.findUnique({ where: { turmaId }, select: { ata: true } })
  const dados = { turma: turma.nome, linhas, ata: conselho?.ata ?? null }
  return prisma.acaDocumento.create({ data: { numero, tipo: 'ATA_RESULTADOS', turmaId, titulo: `Ata de Resultados — ${turma.nome}`, dadosJson: dados as any, emitidoPorUserId: userId } })
}
