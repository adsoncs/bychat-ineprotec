// Exercita a ponte portal → ERP numa inscrição real da demo e mostra o antes/depois.
import { prisma } from '../src/lib/prisma.js'
import { efetivarInscricao } from '../src/services/acaEfetivacao.js'

const alvo = await prisma.enrollmentRegistration.findFirst({
  where: { status: { notIn: ['enrolled', 'cancelled'] }, leadId: { not: null } },
  orderBy: { id: 'desc' },
  select: { id: true, candidateCode: true, status: true, lead: { select: { nome: true } } },
})
if (!alvo) { console.log('nenhuma inscrição elegível'); process.exit(0) }

console.log(`inscrição #${alvo.id} ${alvo.candidateCode} — ${alvo.lead?.nome} (status ${alvo.status})`)
console.log(`antes: alunos=${await prisma.aluno.count()} vinculos=${await prisma.acaVinculo.count()} matriculas=${await prisma.acaMatricula.count()}`)

const r = await efetivarInscricao(alvo.id)
console.log('\nresultado:', JSON.stringify(r))

console.log(`depois: alunos=${await prisma.aluno.count()} vinculos=${await prisma.acaVinculo.count()} matriculas=${await prisma.acaMatricula.count()}`)

const m = await prisma.acaMatricula.findUnique({
  where: { id: r.matriculaId },
  select: {
    id: true, status: true, origem: true, listaEspera: true,
    aluno: { select: { id: true, ra: true, cpf: true, lead: { select: { nome: true, whatsapp: true } } } },
    turma: { select: { nome: true, capacidade: true } },
    eventos: { select: { para: true, obs: true } },
  },
})
console.log('\nmatrícula criada:')
console.log(JSON.stringify(m, null, 2))

const reg = await prisma.enrollmentRegistration.findUnique({
  where: { id: alvo.id },
  select: { status: true, processRegistration: { select: { status: true, matriculadoEm: true } } },
})
console.log('\ninscrição no portal agora:', JSON.stringify(reg))

// idempotência: segunda chamada não pode duplicar
const r2 = await efetivarInscricao(alvo.id)
console.log(`\n2ª chamada: matriculaId=${r2.matriculaId} jaExistia=${r2.jaExistia} | total de matrículas=${await prisma.acaMatricula.count()}`)
process.exit(0)
