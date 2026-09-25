// O contrato nasce sozinho quando a matrícula é criada pelo portal?
// Cria um gatilho, efetiva uma inscrição e confere se o envelope apareceu.
import { prisma } from '../src/lib/prisma.js'
import { efetivarInscricao } from '../src/services/acaEfetivacao.js'
import { gerarContratoEParcelas } from '../src/services/acaFinanceiro.js'

const linha = (a: string, b: unknown) => console.log(`  ${a.padEnd(46)} ${b}`)

const tpl = await prisma.acaContratoTemplate.findFirst({ where: { ativo: true }, select: { id: true } })
const gatilho = await prisma.acaContratoGatilho.create({
  data: { nome: 'Contrato ao criar matrícula (teste)', evento: 'MATRICULA_CRIADA', templateId: tpl!.id, autoEnviar: false, ativo: true },
  select: { id: true },
})
linha('gatilho criado para', 'MATRICULA_CRIADA')

const reg = await prisma.enrollmentRegistration.findFirst({
  where: { status: { notIn: ['enrolled', 'cancelled'] }, leadId: { not: null } },
  orderBy: { id: 'desc' },
  select: { id: true, candidateCode: true },
})
if (!reg) { console.log('  sem inscrição elegível'); await prisma.acaContratoGatilho.delete({ where: { id: gatilho.id } }); process.exit(0) }
linha('inscrição usada', reg.candidateCode)

const antes = await prisma.acaAssinatura.count()
const ef = await efetivarInscricao(reg.id)
linha('matrícula criada', `#${ef.matriculaId} · aluno #${ef.alunoId}`)

// O gatilho roda solto (não bloqueia a efetivação): espera a poeira baixar.
await new Promise((r) => setTimeout(r, 2500))
const depois = await prisma.acaAssinatura.count()
linha('envelopes antes / depois', `${antes} / ${depois}`)

const novo = await prisma.acaAssinatura.findFirst({
  where: { matriculaId: ef.matriculaId },
  select: { id: true, titulo: true, status: true, signatarios: { select: { nome: true, papel: true, deliveryMethod: true } } },
})
linha('contrato gerado sozinho?', novo ? `sim — envelope #${novo.id} (${novo.status})` : 'NÃO')
if (novo) linha('  signatários', novo.signatarios.map((s) => `${s.papel}/${s.deliveryMethod}`).join(', '))

// E o segundo gatilho: contrato financeiro criado
const gat2 = await prisma.acaContratoGatilho.create({
  data: { nome: 'Contrato ao gerar financeiro (teste)', evento: 'CONTRATO_FINANCEIRO_CRIADO', templateId: tpl!.id, autoEnviar: false, ativo: true },
  select: { id: true },
})
const antes2 = await prisma.acaAssinatura.count()
const fin = await gerarContratoEParcelas(ef.matriculaId)
await new Promise((r) => setTimeout(r, 2500))
linha('financeiro gerado', JSON.stringify(fin))
linha('envelopes antes / depois do financeiro', `${antes2} / ${await prisma.acaAssinatura.count()}`)

await prisma.acaContratoGatilho.deleteMany({ where: { id: { in: [gatilho.id, gat2.id] } } })
console.log('\n(gatilhos de teste removidos)')
process.exit(0)
