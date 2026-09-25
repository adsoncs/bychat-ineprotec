// Confere se a inscrição feita pelo navegador criou a conta do portal.
import { prisma } from '../src/lib/prisma.js'

const reg = await prisma.enrollmentRegistration.findFirst({
  orderBy: { id: 'desc' },
  select: {
    candidateCode: true,
    lead: { select: { nome: true, portalAccount: { select: { id: true, cpf: true, senhaHash: true } } } },
  },
})
console.log('última inscrição:', reg?.candidateCode, '·', reg?.lead?.nome)
const c = reg?.lead?.portalAccount
console.log('conta do portal:', c ? `id ${c.id} · cpf ${c.cpf} · senha ${c.senhaHash ? 'definida' : 'ainda não'}` : 'NÃO CRIADA')
process.exit(0)
