// Prepara a demo para exercitar o pagamento: conexão simulada, portal em modo
// transparente e taxa de inscrição no processo seletivo.
//   npx tsx --env-file=.env scripts/preparar-pagamento-demo.ts [desfazer]
import { prisma } from '../src/lib/prisma.js'
import crypto from 'node:crypto'
import { encryptToken } from '../src/services/cloudApi.js'

const desfazer = process.argv[2] === 'desfazer'
const portal = await prisma.enrollmentPortal.findFirst({ where: { slug: 'inscricao' }, select: { id: true, nome: true, selectionProcessIds: true } })
if (!portal) { console.log('portal "inscricao" não encontrado'); process.exit(1) }

if (desfazer) {
  await prisma.enrollmentPortal.update({
    where: { id: portal.id },
    data: { requirePayment: false, paymentMode: 'link', paymentConnectionId: null, paymentProvider: null },
  })
  await prisma.paymentProviderConnection.deleteMany({ where: { provider: 'simulado' } })
  console.log('desfeito: portal sem cobrança e conexão simulada removida')
  process.exit(0)
}

const existente = await prisma.paymentProviderConnection.findFirst({ where: { provider: 'simulado' }, select: { id: true, name: true } })
const conn = existente
  ? await prisma.paymentProviderConnection.update({ where: { id: existente.id }, data: { active: true }, select: { id: true, name: true } })
  : await prisma.paymentProviderConnection.create({
      data: {
        name: 'Simulado (teste)', provider: 'simulado', apiKey: encryptToken('sem-chave'),
        environment: 'sandbox', active: true,
        webhookToken: crypto.randomBytes(16).toString('hex'),
      },
      select: { id: true, name: true },
    })
console.log(`conexão de pagamento: ${conn.name} (id ${conn.id})`)

await prisma.enrollmentPortal.update({
  where: { id: portal.id },
  data: { requirePayment: true, paymentMode: 'transparent', paymentConnectionId: conn.id, paymentProvider: 'simulado' },
})
console.log(`portal "${portal.nome}": cobrança ligada em modo transparente`)

// Taxa de inscrição nos processos do portal — sem ela o payment-init recusa.
const ids = (portal.selectionProcessIds as number[] | null) ?? []
const processos = await prisma.selectionProcess.findMany({
  where: ids.length ? { id: { in: ids } } : { status: 'aberto' },
  select: { id: true, nome: true, taxaInscricao: true },
})
for (const p of processos) {
  if (p.taxaInscricao && Number(p.taxaInscricao) > 0) { console.log(`  ${p.nome}: taxa já definida (R$ ${p.taxaInscricao})`); continue }
  await prisma.selectionProcess.update({ where: { id: p.id }, data: { taxaInscricao: 60 } })
  console.log(`  ${p.nome}: taxa de inscrição definida em R$ 60,00`)
}
process.exit(0)
