// Estado do que a fase 0 precisa: assinatura, provedor de pagamento e portais.
import { prisma } from '../src/lib/prisma.js'

const cfg = await (prisma as any).acaAssinaturaConfig?.findFirst?.().catch(() => null)
console.log('assinatura config:', cfg ? JSON.stringify({ modo: cfg.modo, temToken: !!cfg.token, sandbox: cfg.sandbox }) : '(sem registro — usa o padrão)')

const provs = await prisma.paymentProviderConnection.findMany({
  select: { id: true, name: true, provider: true, environment: true, active: true },
})
console.log('provedores de pagamento:', provs.length ? JSON.stringify(provs) : 'nenhum')

const portais = await prisma.enrollmentPortal.findMany({
  select: { id: true, nome: true, slug: true, active: true, requirePayment: true, paymentMode: true, paymentProvider: true },
})
console.log('portais:')
for (const p of portais) console.log('  ', JSON.stringify(p))

const tpl = await (prisma as any).acaAssinaturaTemplate?.count?.().catch(() => 0)
console.log('modelos de contrato:', tpl)
process.exit(0)
