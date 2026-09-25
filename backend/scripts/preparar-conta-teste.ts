// Cria a conta do portal para o aluno vindo do portal e imprime o link de
// primeiro acesso, para o teste seguir pelo caminho do navegador.
import { prisma } from '../src/lib/prisma.js'
import { criarLinkDeAcesso, garantirConta } from '../src/services/portalAccount.js'

const aluno = await prisma.aluno.findFirst({
  orderBy: { id: 'desc' },
  select: { id: true, ra: true, cpf: true, leadId: true, lead: { select: { nome: true, email: true } } },
})
if (!aluno) { console.log('sem aluno'); process.exit(1) }

const conta = await garantirConta(aluno.leadId)
const link = await criarLinkDeAcesso(conta.id, 'primeiro_acesso')
console.log(JSON.stringify({
  nome: aluno.lead?.nome, cpf: aluno.cpf, ra: aluno.ra,
  accountId: conta.id, temSenha: !!conta.senhaHash,
  token: link.raw, url: link.url,
}))
process.exit(0)
