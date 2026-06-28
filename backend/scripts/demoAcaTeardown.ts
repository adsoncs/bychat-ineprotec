// scripts/demoAcaTeardown.ts
// Remove TODA a carga de demonstração criada por demoAcaSeed.ts, deixando o
// módulo acadêmico limpo. Seguro: só toca em registros com os marcadores DEMO.

import { prisma } from '../src/lib/prisma.js'
import { cleanupPlus } from './demoAcaSeedPlus.js'

const TURMA_TAG = 'DEMO — '

async function main() {
  // remove primeiro a carga dos módulos novos (F5–F22 + F16/F17/F19), que
  // referencia matrículas/alunos demo ainda existentes neste ponto.
  await cleanupPlus().catch((e) => console.warn('cleanupPlus:', e?.message))
  // turmas demo
  const turmas = await prisma.acaTurma.findMany({ where: { nome: { startsWith: TURMA_TAG } }, select: { id: true } })
  const turmaIds = turmas.map((t) => t.id)
  // alunos demo (RA DEMO…) e seus leads (source demo_aca)
  const alunos = await prisma.aluno.findMany({ where: { ra: { startsWith: 'DEMO' } }, select: { id: true, leadId: true } })
  const alunoIds = alunos.map((a) => a.id)
  const leadIds = alunos.map((a) => a.leadId)

  // diários das turmas demo
  const diarios = turmaIds.length ? await prisma.acaDiario.findMany({ where: { turmaId: { in: turmaIds } }, select: { id: true } }) : []
  const diarioIds = diarios.map((d) => d.id)
  const aulas = diarioIds.length ? await prisma.acaAula.findMany({ where: { diarioId: { in: diarioIds } }, select: { id: true } }) : []
  const aulaIds = aulas.map((a) => a.id)
  const avals = diarioIds.length ? await prisma.acaAvaliacao.findMany({ where: { diarioId: { in: diarioIds } }, select: { id: true } }) : []
  const avalIds = avals.map((a) => a.id)

  // matrículas / contratos demo
  const mats = alunoIds.length ? await prisma.acaMatricula.findMany({ where: { alunoId: { in: alunoIds } }, select: { id: true } }) : []
  const matIds = mats.map((m) => m.id)
  const contratos = matIds.length ? await prisma.acaContrato.findMany({ where: { matriculaId: { in: matIds } }, select: { id: true } }) : []
  const contratoIds = contratos.map((c) => c.id)

  // ordem de deleção respeitando dependências
  if (diarioIds.length) await prisma.acaMaterial.deleteMany({ where: { diarioId: { in: diarioIds } } })
  if (diarioIds.length) await prisma.acaPlanoEnsino.deleteMany({ where: { diarioId: { in: diarioIds } } })
  if (avalIds.length) await prisma.acaNota.deleteMany({ where: { avaliacaoId: { in: avalIds } } })
  if (aulaIds.length) await prisma.acaFrequencia.deleteMany({ where: { aulaId: { in: aulaIds } } })
  if (diarioIds.length) await prisma.acaResultado.deleteMany({ where: { diarioId: { in: diarioIds } } })
  if (avalIds.length) await prisma.acaAvaliacao.deleteMany({ where: { id: { in: avalIds } } })
  if (aulaIds.length) await prisma.acaAula.deleteMany({ where: { id: { in: aulaIds } } })
  if (diarioIds.length) await prisma.acaDiario.deleteMany({ where: { id: { in: diarioIds } } })
  if (turmaIds.length) await prisma.acaConselho.deleteMany({ where: { turmaId: { in: turmaIds } } })
  if (turmaIds.length) await prisma.acaHorario.deleteMany({ where: { turmaId: { in: turmaIds } } })

  if (contratoIds.length) await prisma.acaParcela.deleteMany({ where: { contratoId: { in: contratoIds } } })
  if (contratoIds.length) await prisma.acaContrato.deleteMany({ where: { id: { in: contratoIds } } })

  if (alunoIds.length) {
    await prisma.acaEstagio.deleteMany({ where: { alunoId: { in: alunoIds } } })
    await prisma.acaAtividadeComplementar.deleteMany({ where: { alunoId: { in: alunoIds } } })
    await prisma.acaRequerimento.deleteMany({ where: { alunoId: { in: alunoIds } } })
    await prisma.acaAcordo.deleteMany({ where: { alunoId: { in: alunoIds } } })
    await prisma.acaNotaFiscal.deleteMany({ where: { alunoId: { in: alunoIds } } })
    await prisma.acaComunicacao.deleteMany({ where: { alunoId: { in: alunoIds } } })
    await prisma.acaDocumento.deleteMany({ where: { alunoId: { in: alunoIds } } })
    await prisma.acaOcorrencia.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaResponsavel.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
  }
  if (matIds.length) await prisma.acaMatricula.deleteMany({ where: { id: { in: matIds } } })
  if (turmaIds.length) await prisma.acaDocumento.deleteMany({ where: { turmaId: { in: turmaIds } } })
  if (turmaIds.length) await prisma.acaTurma.deleteMany({ where: { id: { in: turmaIds } } })
  if (alunoIds.length) await prisma.aluno.deleteMany({ where: { id: { in: alunoIds } } })
  if (leadIds.length) await prisma.lead.deleteMany({ where: { id: { in: leadIds }, source: 'demo_aca' } })

  const restam = await prisma.aluno.count({ where: { ra: { startsWith: 'DEMO' } } })
  console.log(`✅ Carga de demonstração removida. Alunos DEMO restantes: ${restam} | turmas DEMO: ${await prisma.acaTurma.count({ where: { nome: { startsWith: TURMA_TAG } } })}`)
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error('ERRO:', e); prisma.$disconnect(); process.exit(1) })
