// Ciclo completo numa inscrição nova: portal → aluno → contrato → parcelas →
// assinatura → matrícula efetivada. Com o PDF gerado para conferir a interpolação.
import { prisma } from '../src/lib/prisma.js'
import { efetivarInscricao } from '../src/services/acaEfetivacao.js'
import { gerarContratoEParcelas } from '../src/services/acaFinanceiro.js'
import * as assinatura from '../src/services/acaAssinatura.js'
import fs from 'fs'

// modelo com as variáveis que o motor realmente conhece
const tpl = await prisma.acaContratoTemplate.upsert({
  where: { id: 1 },
  update: {
    corpoTexto:
      'Pelo presente instrumento, a {{instituicao}} (CONTRATADA) e {{aluno.nome}}, CPF {{aluno.cpf}}, RA {{aluno.ra}} (CONTRATANTE), ajustam:\n\n' +
      'CLÁUSULA 1ª — Serviços educacionais referentes a {{curso}}.\n\n' +
      'CLÁUSULA 2ª — Valor total de {{valor}}, em {{parcelas}} parcela(s).\n\n' +
      'Assinado eletronicamente em {{data}}.',
  },
  create: { nome: 'Contrato de prestação de serviços educacionais', corpoTexto: 'x', ativo: true },
  select: { id: true },
})

const alvo = await prisma.enrollmentRegistration.findFirst({
  where: { status: { notIn: ['enrolled', 'cancelled'] }, leadId: { not: null } },
  orderBy: { id: 'desc' },
  select: { id: true, candidateCode: true, lead: { select: { nome: true } } },
})
if (!alvo) { console.log('nenhuma inscrição elegível'); process.exit(0) }
console.log(`1) inscrição ${alvo.candidateCode} — ${alvo.lead?.nome}`)

const ef = await efetivarInscricao(alvo.id)
console.log(`2) aluno #${ef.alunoId} RA ${ef.ra} · matrícula #${ef.matriculaId} na turma ${ef.turmaId}`)

const fin = await gerarContratoEParcelas(ef.matriculaId)
console.log(`3) financeiro: ${JSON.stringify(fin)}`)
const contrato = await prisma.acaContrato.findUnique({ where: { matriculaId: ef.matriculaId }, select: { id: true, valorTotalCentavos: true } })

const env = await assinatura.criarDeTemplate(tpl.id, {
  alunoId: ef.alunoId, matriculaId: ef.matriculaId, contratoId: contrato?.id ?? null,
})
console.log(`4) envelope #${env.id} — signatários: ${env.signatarios?.length ?? 0}`)

if (!env.signatarios?.length) {
  const aluno = await prisma.aluno.findUnique({ where: { id: ef.alunoId }, select: { cpf: true, lead: { select: { nome: true, email: true, whatsapp: true } } } })
  await prisma.acaSignatario.create({
    data: {
      assinaturaId: env.id, nome: aluno?.lead?.nome || 'Aluno', email: aluno?.lead?.email || null,
      telefone: aluno?.lead?.whatsapp || null, cpf: aluno?.cpf || null,
      papel: 'ALUNO', acao: 'SIGN', deliveryMethod: 'WHATSAPP', ordem: 0,
    },
  })
  console.log('   signatário do aluno adicionado')
}

const enviado = await assinatura.enviar(env.id)
console.log(`5) enviado por ${enviado?.provider} — status ${enviado?.status}`)

const { buffer } = await assinatura.gerarPdf(env.id)
fs.writeFileSync('/tmp/contrato-demo.pdf', buffer)
console.log(`6) PDF gerado: /tmp/contrato-demo.pdf (${(buffer.length / 1024).toFixed(1)} kB)`)

const antes = await prisma.acaMatricula.findUnique({ where: { id: ef.matriculaId }, select: { status: true } })
await assinatura.simularAssinatura(env.id, enviado!.signatarios[0].id)
const depois = await prisma.acaMatricula.findUnique({
  where: { id: ef.matriculaId },
  select: { status: true, vinculo: { select: { situacao: true } }, eventos: { select: { de: true, para: true, obs: true } } },
})

console.log(`\n7) assinatura → matrícula: ${antes?.status} → ${depois?.status} | vínculo: ${depois?.vinculo?.situacao}`)
console.log('   trilha:')
for (const e of depois?.eventos ?? []) console.log(`      ${e.de ?? '—'} → ${e.para}: ${e.obs}`)
process.exit(0)
