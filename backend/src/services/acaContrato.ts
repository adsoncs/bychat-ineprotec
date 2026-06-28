// src/services/acaContrato.ts
// Módulo Acadêmico · O2.3 — Aceite digital de contrato.
// Termo configurável (Settings), renderização com os dados do contrato e
// registro do aceite (data/hora/IP/nome).

import { prisma } from '../lib/prisma.js'

const KEY = 'aca.contrato.termo'
const DEFAULT_TERMO = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS

Pelo presente instrumento particular, {nome} (RA {ra}), doravante CONTRATANTE, e a INSTITUIÇÃO DE ENSINO, doravante CONTRATADA, ajustam a prestação de serviços educacionais referentes ao curso {curso}, turma {turma}.

VALOR: O valor total ajustado é de {valorTotal}, parcelado em {numParcelas}x de {valorParcela}, acrescido da taxa de matrícula quando aplicável, com vencimentos mensais.

CONDIÇÕES: O não pagamento nas datas pactuadas sujeita o CONTRATANTE a multa e juros conforme política financeira da CONTRATADA, podendo acarretar bloqueio acadêmico. O CONTRATANTE declara estar ciente do regimento interno e do calendário acadêmico.

Ao aceitar eletronicamente este termo, o CONTRATANTE manifesta concordância integral com as condições acima.`

const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export async function getTermoTemplate(): Promise<string> {
  const r = await prisma.setting.findUnique({ where: { key: KEY } })
  const v = r?.value as any
  return typeof v === 'string' && v.trim() ? v : DEFAULT_TERMO
}
export async function setTermoTemplate(texto: string): Promise<string> {
  const val = String(texto || '').slice(0, 20000) || DEFAULT_TERMO
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: val as any }, create: { key: KEY, label: 'Termo do contrato', grp: 'academico', fieldType: 'textarea', value: val as any } })
  return getTermoTemplate()
}

/** Dados + termo renderizado de um contrato. Retorna null se não existir. */
export async function dadosContrato(contratoId: number) {
  const c = await prisma.acaContrato.findUnique({
    where: { id: contratoId },
    select: {
      id: true, valorTotalCentavos: true, aceiteEm: true, aceiteNome: true,
      matricula: { select: { aluno: { select: { ra: true, lead: { select: { nome: true } } } }, turma: { select: { nome: true, courseOfferingId: true } } } },
      parcelas: { where: { tipo: 'MENSALIDADE' }, select: { valorBrutoCentavos: true } },
    },
  })
  if (!c) return null
  let curso = '—'
  if (c.matricula.turma.courseOfferingId) { const off = await prisma.courseOffering.findUnique({ where: { id: c.matricula.turma.courseOfferingId }, select: { courseId: true } }); if (off) { const cs = await prisma.course.findUnique({ where: { id: off.courseId }, select: { nome: true } }); if (cs) curso = cs.nome } }
  const numParcelas = c.parcelas.length
  const valorParcela = numParcelas ? c.parcelas[0].valorBrutoCentavos : 0
  const tpl = await getTermoTemplate()
  const vars: Record<string, string> = {
    nome: c.matricula.aluno.lead.nome, ra: c.matricula.aluno.ra || '—', curso, turma: c.matricula.turma.nome,
    valorTotal: money(c.valorTotalCentavos), numParcelas: String(numParcelas), valorParcela: money(valorParcela),
  }
  const termo = tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`))
  return { id: c.id, curso, turma: c.matricula.turma.nome, aluno: vars.nome, ra: vars.ra, valorTotal: c.valorTotalCentavos, numParcelas, valorParcela, termo, aceiteEm: c.aceiteEm, aceiteNome: c.aceiteNome }
}

/** Registra o aceite do contrato (idempotente — não sobrescreve aceite anterior). */
export async function registrarAceite(contratoId: number, nome: string, ip: string): Promise<{ ok: boolean; jaAceito?: boolean }> {
  const c = await prisma.acaContrato.findUnique({ where: { id: contratoId }, select: { aceiteEm: true } })
  if (!c) return { ok: false }
  if (c.aceiteEm) return { ok: true, jaAceito: true }
  const dados = await dadosContrato(contratoId)
  await prisma.acaContrato.update({ where: { id: contratoId }, data: { aceiteEm: new Date(), aceiteIp: ip.slice(0, 60), aceiteNome: nome.slice(0, 191), aceiteTermo: dados?.termo ?? null } })
  return { ok: true }
}

/** Contrato "ativo" do aluno (da matrícula MATRICULADO mais recente). */
export async function contratoAtivoDoAluno(alunoId: number): Promise<number | null> {
  const mat = await prisma.acaMatricula.findFirst({ where: { alunoId, status: 'MATRICULADO' }, orderBy: { dataMatricula: 'desc' }, select: { id: true } })
  if (!mat) return null
  const c = await prisma.acaContrato.findUnique({ where: { matriculaId: mat.id }, select: { id: true } })
  return c?.id ?? null
}
