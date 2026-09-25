// Leva a inscrição da Joana até matrícula com contrato, para o painel do aluno
// ter o que mostrar: percorre a ponte, o financeiro e a assinatura.
import { prisma } from '../src/lib/prisma.js'
import { efetivarInscricao } from '../src/services/acaEfetivacao.js'
import { gerarContratoEParcelas } from '../src/services/acaFinanceiro.js'
import * as assinatura from '../src/services/acaAssinatura.js'

const reg = await prisma.enrollmentRegistration.findFirst({
  where: { lead: { portalAccount: { cpf: '52998224725' } } },
  orderBy: { id: 'desc' },
  select: { id: true, candidateCode: true },
})
if (!reg) { console.log('inscrição não encontrada'); process.exit(1) }

const ef = await efetivarInscricao(reg.id)
console.log(`matrícula #${ef.matriculaId} · aluno #${ef.alunoId} RA ${ef.ra}`)

const fin = await gerarContratoEParcelas(ef.matriculaId)
console.log('financeiro:', JSON.stringify(fin))

const contrato = await prisma.acaContrato.findUnique({ where: { matriculaId: ef.matriculaId }, select: { id: true } })
const tpl = await prisma.acaContratoTemplate.findFirst({ where: { ativo: true }, select: { id: true } })
if (tpl && !(await prisma.acaAssinatura.findFirst({ where: { matriculaId: ef.matriculaId } }))) {
  const env = await assinatura.criarDeTemplate(tpl.id, {
    alunoId: ef.alunoId, matriculaId: ef.matriculaId, contratoId: contrato?.id ?? null,
  })
  if (!env.signatarios?.length) {
    const a = await prisma.aluno.findUnique({ where: { id: ef.alunoId }, select: { cpf: true, lead: { select: { nome: true, email: true, whatsapp: true } } } })
    await prisma.acaSignatario.create({
      data: {
        assinaturaId: env.id, nome: a?.lead?.nome || 'Aluno', email: a?.lead?.email || null,
        telefone: a?.lead?.whatsapp || null, cpf: a?.cpf || null,
        papel: 'ALUNO', acao: 'SIGN', deliveryMethod: 'WHATSAPP', ordem: 0,
      },
    })
  }
  // Enviado, mas NÃO assinado: é assim que o painel mostra "falta a sua assinatura".
  await assinatura.enviar(env.id)
  console.log(`envelope #${env.id} enviado, aguardando assinatura`)
}
process.exit(0)
