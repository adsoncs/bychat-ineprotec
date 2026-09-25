// Continua o fluxo depois da efetivação: contrato financeiro + parcelas, e o
// envelope de assinatura em modo SIMULADO (sem token da Autentique).
import { prisma } from '../src/lib/prisma.js'
import { gerarContratoEParcelas } from '../src/services/acaFinanceiro.js'
import * as assinatura from '../src/services/acaAssinatura.js'

const mat = await prisma.acaMatricula.findFirst({
  where: { origem: 'portal' }, orderBy: { id: 'desc' },
  select: { id: true, aluno: { select: { id: true, lead: { select: { nome: true, email: true, whatsapp: true } } } } },
})
if (!mat) { console.log('nenhuma matrícula vinda do portal'); process.exit(0) }
console.log(`matrícula #${mat.id} — ${mat.aluno.lead?.nome}`)

// 1) contrato financeiro + parcelas
const r = await gerarContratoEParcelas(mat.id)
console.log('contrato/parcelas:', JSON.stringify(r))

const contrato = await prisma.acaContrato.findUnique({
  where: { matriculaId: mat.id },
  select: {
    id: true, valorTotalCentavos: true, status: true,
    parcelas: { select: { nroParcela: true, tipo: true, valorBrutoCentavos: true, dataVencimento: true, situacao: true }, orderBy: { nroParcela: 'asc' } },
  },
})
if (contrato) {
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  console.log(`\ncontrato #${contrato.id} — total ${brl(contrato.valorTotalCentavos)} (${contrato.status})`)
  for (const p of contrato.parcelas) {
    console.log(`   ${String(p.nroParcela).padStart(2)} ${p.tipo.padEnd(12)} ${brl(p.valorBrutoCentavos).padStart(12)}  vence ${p.dataVencimento.toISOString().slice(0, 10)}  ${p.situacao}`)
  }
}

// 2) envelope de assinatura (modo simulado)
const template = await prisma.acaContratoTemplate.findFirst({ where: { ativo: true }, select: { id: true, nome: true } })
if (!template) {
  console.log('\nsem modelo de contrato cadastrado — criando um mínimo para o teste')
  const novo = await prisma.acaContratoTemplate.create({
    data: {
      nome: 'Contrato de prestação de serviços educacionais',
      corpoTexto: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS\n\n' +
        'Aluno: {{aluno.nome}}\nCPF: {{aluno.cpf}}\nCurso: {{curso.nome}}\nTurma: {{turma.nome}}\n\n' +
        'Valor total: {{contrato.valorTotal}}\n\n' +
        'O ALUNO declara ciência das condições de pagamento e do calendário acadêmico.',
      ativo: true,
    },
    select: { id: true, nome: true },
  })
  console.log(`modelo criado: #${novo.id} ${novo.nome}`)
}

const tpl = await prisma.acaContratoTemplate.findFirst({ where: { ativo: true }, select: { id: true } })
const env = await assinatura.criarDeTemplate(tpl!.id, { alunoId: mat.aluno.id, matriculaId: mat.id, contratoId: contrato?.id ?? null })
console.log('\nenvelope criado:', JSON.stringify(env).slice(0, 300))
process.exit(0)
