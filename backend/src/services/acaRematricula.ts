// src/services/acaRematricula.ts
// Módulo Acadêmico · O2.4 — (Re)matrícula online pelo portal do aluno.
// Lista turmas com matrícula aberta, faz preview do termo/valor e efetiva:
// cria a matrícula MATRICULADO, gera o financeiro (contrato+parcelas) e registra
// o aceite do contrato. Bloqueia se o aluno estiver inadimplente.

import { prisma } from '../lib/prisma.js'
import { gerarContratoEParcelas } from './acaFinanceiro.js'
import { getTermoTemplate, registrarAceite } from './acaContrato.js'
import { statusBloqueio } from './acaBloqueio.js'

const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function planoDaOferta(courseOfferingId: number | null) {
  if (!courseOfferingId) return null
  return prisma.acaPlanoPagamento.findFirst({ where: { courseOfferingId, ativo: true }, orderBy: { id: 'asc' } })
}
async function cursoDaOferta(courseOfferingId: number | null): Promise<string> {
  if (!courseOfferingId) return '—'
  const off = await prisma.courseOffering.findUnique({ where: { id: courseOfferingId }, select: { courseId: true } })
  if (!off) return '—'
  const c = await prisma.course.findUnique({ where: { id: off.courseId }, select: { nome: true } })
  return c?.nome || '—'
}

/** Turmas com matrícula aberta nas quais o aluno ainda não está matriculado. */
export async function ofertasAbertas(alunoId: number) {
  // exclui turmas onde o aluno já tem QUALQUER matrícula (a constraint única
  // impede recriar; rematrícula real é sempre em outra turma/período).
  const jaMat = await prisma.acaMatricula.findMany({ where: { alunoId }, select: { turmaId: true } })
  const excl = new Set(jaMat.map((m) => m.turmaId))
  const turmas = await prisma.acaTurma.findMany({ where: { matriculaAberta: true, ativo: true }, select: { id: true, nome: true, capacidade: true, courseOfferingId: true, periodoLetivo: { select: { codigo: true } } } })
  const out = []
  for (const t of turmas) {
    if (excl.has(t.id)) continue
    const ocupadas = await prisma.acaMatricula.count({ where: { turmaId: t.id, status: 'MATRICULADO', listaEspera: false } })
    const plano = await planoDaOferta(t.courseOfferingId)
    out.push({
      turmaId: t.id, nome: t.nome, periodo: t.periodoLetivo?.codigo || '—', curso: await cursoDaOferta(t.courseOfferingId),
      capacidade: t.capacidade, ocupadas, lotada: !!(t.capacidade && ocupadas >= t.capacidade),
      temPlano: !!plano, numParcelas: plano?.numParcelas ?? 0, valorParcela: plano?.valorParcelaCentavos ?? 0, taxaMatricula: plano?.taxaMatriculaCentavos ?? 0,
    })
  }
  return out
}

/** Preview do termo do contrato para uma turma (sem criar nada). */
export async function previewTermoRematricula(alunoId: number, turmaId: number) {
  const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { ra: true, lead: { select: { nome: true } } } })
  const turma = await prisma.acaTurma.findUnique({ where: { id: turmaId }, select: { nome: true, courseOfferingId: true, matriculaAberta: true, ativo: true } })
  if (!aluno || !turma || !turma.matriculaAberta || !turma.ativo) return null
  const plano = await planoDaOferta(turma.courseOfferingId)
  if (!plano) return null
  const valorTotal = plano.taxaMatriculaCentavos + plano.valorParcelaCentavos * plano.numParcelas
  const curso = await cursoDaOferta(turma.courseOfferingId)
  const tpl = await getTermoTemplate()
  const vars: Record<string, string> = {
    nome: aluno.lead.nome, ra: aluno.ra || '—', curso, turma: turma.nome,
    valorTotal: money(valorTotal), numParcelas: String(plano.numParcelas), valorParcela: money(plano.valorParcelaCentavos),
  }
  const termo = tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`))
  return { curso, turma: turma.nome, valorTotal, numParcelas: plano.numParcelas, valorParcela: plano.valorParcelaCentavos, taxaMatricula: plano.taxaMatriculaCentavos, termo }
}

export async function efetivarRematricula(alunoId: number, turmaId: number, nome: string, ip: string): Promise<{ ok: boolean; erro?: string; matriculaId?: number; contratoId?: number }> {
  const turma = await prisma.acaTurma.findUnique({ where: { id: turmaId }, select: { matriculaAberta: true, ativo: true, capacidade: true, courseOfferingId: true } })
  if (!turma || !turma.matriculaAberta || !turma.ativo) return { ok: false, erro: 'Turma indisponível para matrícula.' }
  // bloqueio por inadimplência
  const bloq = await statusBloqueio(alunoId)
  if (bloq.bloqueado) return { ok: false, erro: `Matrícula bloqueada: ${bloq.motivo}.` }
  // duplicidade
  const dup = await prisma.acaMatricula.findUnique({ where: { alunoId_turmaId: { alunoId, turmaId } }, select: { id: true } })
  if (dup) return { ok: false, erro: 'Você já está matriculado nesta turma.' }
  const plano = await planoDaOferta(turma.courseOfferingId)
  if (!plano) return { ok: false, erro: 'Turma sem plano de pagamento ativo.' }
  // vaga
  const ocupadas = await prisma.acaMatricula.count({ where: { turmaId, status: 'MATRICULADO', listaEspera: false } })
  const lista = !!(turma.capacidade && ocupadas >= turma.capacidade)

  const mat = await prisma.acaMatricula.create({ data: { alunoId, turmaId, status: 'MATRICULADO', listaEspera: lista, origem: 'portal', courseOfferingId: turma.courseOfferingId } })
  const fin = await gerarContratoEParcelas(mat.id)
  let contratoId: number | undefined
  if ('contratoId' in fin) {
    contratoId = fin.contratoId
    await registrarAceite(fin.contratoId, nome, ip)
  }
  return { ok: true, matriculaId: mat.id, contratoId }
}
