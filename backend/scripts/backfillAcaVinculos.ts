// Cria o vínculo acadêmico (aluno↔curso/matriz) dos alunos que já existem.
//
// Até a Fase 1 o sistema só tinha AcaMatricula (aluno↔turma). O vínculo é a
// âncora que faltava: é contra a MATRIZ dele que histórico, integralização e
// requisitos de formatura passam a ser calculados. Este script reconstrói o
// vínculo a partir do que as matrículas já dizem — turma → oferta → curso.
//
// A situação inicial é derivada das matrículas do aluno naquele curso, na
// ordem de precedência abaixo; a movimentação correspondente é registrada para
// a linha do tempo não nascer vazia.
//
// Idempotente: pula aluno+curso que já tem vínculo.
//
// Uso: npx tsx scripts/backfillAcaVinculos.ts [--apply]
import { prisma } from '../src/lib/prisma.js'
import type { AcaVinculoSituacao } from '@prisma/client'

const APPLY = process.argv.includes('--apply')

/** Status da matrícula em turma → situação do vínculo no curso. */
const DE_PARA: Record<string, AcaVinculoSituacao> = {
  INSCRITO:      'PRE_MATRICULADO',
  PRE_MATRICULA: 'PRE_MATRICULADO',
  MATRICULADO:   'ATIVO',
  TRANCADO:      'TRANCADO',
  TRANSFERIDO:   'TRANSFERIDO',
  CONCLUIDO:     'FORMADO',
  EVADIDO:       'EVADIDO',
  CANCELADO:     'CANCELADO',
}

/** Um aluno com várias matrículas no mesmo curso: vale a mais "viva". */
const PRECEDENCIA: AcaVinculoSituacao[] = [
  'ATIVO', 'TRANCADO', 'PRE_MATRICULADO', 'FORMADO', 'TRANSFERIDO', 'EVADIDO', 'CANCELADO',
]

async function main() {
  console.log(`modo: ${APPLY ? 'APLICAR' : 'DRY-RUN (use --apply)'}`)

  const matriculas = await prisma.acaMatricula.findMany({
    include: {
      turma: { select: { id: true, courseOfferingId: true, matrizId: true, turno: true } },
      aluno: { select: { id: true, ra: true } },
    },
    orderBy: { id: 'asc' },
  })
  console.log(`matrículas encontradas: ${matriculas.length}`)

  // turma → curso: a turma aponta para a oferta, e a oferta para o curso.
  const ofertaIds = [...new Set(matriculas.map((m) => m.turma?.courseOfferingId).filter((x): x is number => !!x))]
  const ofertas = ofertaIds.length
    ? await prisma.courseOffering.findMany({ where: { id: { in: ofertaIds } }, select: { id: true, courseId: true, unitId: true } })
    : []
  const cursoPorOferta = new Map(ofertas.map((o) => [o.id, { courseId: o.courseId, unitId: o.unitId }]))

  // Agrupa por (aluno, curso) — é essa a chave do vínculo.
  interface Grupo {
    alunoId: number; courseId: number; matrizId: number | null; unidadeId: number | null
    ra: string | null; turno: any; situacoes: AcaVinculoSituacao[]; matriculaIds: number[]
    dataIngresso: Date | null
  }
  const grupos = new Map<string, Grupo>()
  let semCurso = 0

  for (const m of matriculas) {
    const oferta = m.turma?.courseOfferingId ? cursoPorOferta.get(m.turma.courseOfferingId) : null
    if (!oferta) { semCurso++; continue }
    const chave = `${m.alunoId}::${oferta.courseId}`
    const situacao = DE_PARA[m.status] ?? 'PRE_MATRICULADO'
    const g = grupos.get(chave)
    if (g) {
      g.situacoes.push(situacao)
      g.matriculaIds.push(m.id)
      if (!g.matrizId && m.turma?.matrizId) g.matrizId = m.turma.matrizId
      if (m.dataMatricula && (!g.dataIngresso || m.dataMatricula < g.dataIngresso)) g.dataIngresso = m.dataMatricula
    } else {
      grupos.set(chave, {
        alunoId: m.alunoId, courseId: oferta.courseId,
        matrizId: m.turma?.matrizId ?? null, unidadeId: oferta.unitId ?? null,
        ra: m.aluno?.ra ?? null, turno: m.turma?.turno ?? null,
        situacoes: [situacao], matriculaIds: [m.id],
        dataIngresso: m.dataMatricula ?? null,
      })
    }
  }

  console.log(`vínculos a criar (aluno×curso): ${grupos.size}`)
  if (semCurso) console.log(`matrículas sem curso resolvível (turma sem oferta): ${semCurso}`)

  let criados = 0, jaExistiam = 0, matriculasLigadas = 0
  for (const g of grupos.values()) {
    const situacao = PRECEDENCIA.find((s) => g.situacoes.includes(s)) ?? 'PRE_MATRICULADO'

    const existente = await prisma.acaVinculo.findFirst({
      where: { alunoId: g.alunoId, courseId: g.courseId },
      select: { id: true },
    })
    if (existente) {
      jaExistiam++
      if (APPLY) {
        const r = await prisma.acaMatricula.updateMany({
          where: { id: { in: g.matriculaIds }, vinculoId: null },
          data: { vinculoId: existente.id },
        })
        matriculasLigadas += r.count
      }
      continue
    }

    console.log(`  aluno ${g.alunoId} · curso ${g.courseId} · ${situacao} · ${g.matriculaIds.length} matrícula(s)`)
    if (APPLY) {
      const vinculo = await prisma.$transaction(async (tx) => {
        const v = await tx.acaVinculo.create({
          data: {
            alunoId: g.alunoId, courseId: g.courseId, matrizId: g.matrizId, unidadeId: g.unidadeId,
            ra: g.ra, turno: g.turno, situacao, dataIngresso: g.dataIngresso ?? new Date(),
            ...(situacao === 'FORMADO' ? { dataConclusao: g.dataIngresso ?? new Date() } : {}),
          },
        })
        // Linha do tempo: criação + situação apurada, ambas marcadas como backfill.
        await tx.acaVinculoMovimentacao.create({
          data: {
            vinculoId: v.id, de: null, para: 'PRE_MATRICULADO',
            motivo: 'Vínculo reconstruído das matrículas existentes',
            dataEfeito: g.dataIngresso ?? new Date(),
            userName: 'Backfill Fase 1', metadata: { backfill: true, matriculaIds: g.matriculaIds },
          },
        })
        if (situacao !== 'PRE_MATRICULADO') {
          await tx.acaVinculoMovimentacao.create({
            data: {
              vinculoId: v.id, de: 'PRE_MATRICULADO', para: situacao,
              motivo: 'Situação apurada das matrículas existentes',
              dataEfeito: g.dataIngresso ?? new Date(),
              userName: 'Backfill Fase 1', metadata: { backfill: true },
            },
          })
        }
        return v
      })
      const r = await prisma.acaMatricula.updateMany({
        where: { id: { in: g.matriculaIds } },
        data: { vinculoId: vinculo.id },
      })
      matriculasLigadas += r.count
    }
    criados++
  }

  console.log('\n=== RESUMO ===')
  console.log(`vínculos ${APPLY ? 'criados' : 'a criar'}      : ${criados}`)
  if (jaExistiam) console.log(`já existiam (pulados)  : ${jaExistiam}`)
  console.log(`matrículas ligadas     : ${matriculasLigadas}`)
  if (semCurso) console.log(`matrículas sem curso   : ${semCurso} (turma sem oferta vinculada — revisar)`)
  if (!APPLY) console.log('\nDRY-RUN — nada foi gravado. Rode de novo com --apply.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
