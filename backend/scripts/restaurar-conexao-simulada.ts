// Devolve a conexão de teste ao provedor 'simulado' (o teste da guarda a troca
// para 'asaas' de propósito, para provar que a confirmação manual é recusada).
import { prisma } from '../src/lib/prisma.js'
const c = await prisma.paymentProviderConnection.findFirst({ where: { name: 'Simulado (teste)' }, select: { id: true, provider: true } })
if (!c) { console.log('conexão de teste não encontrada'); process.exit(0) }
if (c.provider !== 'simulado') {
  await prisma.paymentProviderConnection.update({ where: { id: c.id }, data: { provider: 'simulado' } })
  console.log('conexão devolvida para simulado')
} else {
  console.log('conexão já estava simulada')
}
const portal = await prisma.enrollmentPortal.findFirst({ where: { slug: 'inscricao' }, select: { paymentProvider: true, requirePayment: true, paymentMode: true } })
console.log('portal:', JSON.stringify(portal))
process.exit(0)
