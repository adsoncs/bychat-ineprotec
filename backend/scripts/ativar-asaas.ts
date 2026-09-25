// Troca o pagamento do modo simulado para o Asaas de verdade.
//
// É o único passo que faltava quando a chave chegar — todo o resto do fluxo
// (cobrança, PIX na tela, acompanhamento, webhook, baixa, efeitos) já está
// construído e testado em modo simulado.
//
//   npx tsx --env-file=.env scripts/ativar-asaas.ts <api-key> [producao]
//
// Sem argumento, apenas mostra o estado atual e o que falta.
import crypto from 'node:crypto'
import { prisma } from '../src/lib/prisma.js'
import { encryptToken } from '../src/services/cloudApi.js'

const chave = process.argv[2]
const ambiente = process.argv[3] === 'producao' ? 'production' : 'sandbox'

const portal = await prisma.enrollmentPortal.findFirst({
  where: { slug: 'inscricao' },
  select: { id: true, nome: true, requirePayment: true, paymentMode: true, paymentProvider: true, paymentConnectionId: true },
})
const conexoes = await prisma.paymentProviderConnection.findMany({
  select: { id: true, name: true, provider: true, environment: true, active: true, webhookToken: true },
})

if (!chave) {
  console.log('ESTADO ATUAL\n')
  console.log('portal:', JSON.stringify(portal))
  console.log('\nconexões de pagamento:')
  for (const c of conexoes) console.log(`  #${c.id} ${c.name} · ${c.provider} · ${c.environment} · ${c.active ? 'ativa' : 'inativa'}`)
  console.log('\nPara ativar o Asaas:')
  console.log('  npx tsx --env-file=.env scripts/ativar-asaas.ts <api-key>            (sandbox)')
  console.log('  npx tsx --env-file=.env scripts/ativar-asaas.ts <api-key> producao   (produção)')
  console.log('\nDepois de ativar, registre no painel do Asaas o webhook:')
  const t = conexoes.find((c) => c.provider === 'asaas')?.webhookToken
  console.log(`  ${process.env.APP_URL ?? '<APP_URL>'}/api/public/payment-webhook/asaas/${t ?? '<token da conexão>'}`)
  process.exit(0)
}

const existente = conexoes.find((c) => c.provider === 'asaas')
const conn = existente
  ? await prisma.paymentProviderConnection.update({
      where: { id: existente.id },
      data: { apiKey: encryptToken(chave), environment: ambiente, active: true },
      select: { id: true, name: true, webhookToken: true },
    })
  : await prisma.paymentProviderConnection.create({
      data: {
        name: `Asaas (${ambiente === 'production' ? 'produção' : 'sandbox'})`,
        provider: 'asaas',
        apiKey: encryptToken(chave),
        environment: ambiente,
        active: true,
        webhookToken: crypto.randomBytes(16).toString('hex'),
      },
      select: { id: true, name: true, webhookToken: true },
    })

await prisma.enrollmentPortal.update({
  where: { id: portal!.id },
  data: { paymentConnectionId: conn.id, paymentProvider: 'asaas', requirePayment: true, paymentMode: 'transparent' },
})

// A conexão simulada sai de cena, mas fica no banco: voltar para o modo de
// teste é só reativá-la, sem recriar nada.
await prisma.paymentProviderConnection.updateMany({ where: { provider: 'simulado' }, data: { active: false } })

console.log(`Asaas ativado em ${ambiente} (conexão #${conn.id}) e ligado ao portal "${portal!.nome}".`)
console.log('\nFalta um passo, no painel do Asaas — cadastrar o webhook:')
console.log(`  ${process.env.APP_URL ?? '<APP_URL>'}/api/public/payment-webhook/asaas/${conn.webhookToken}`)
console.log('\nDepois, refaça o teste de ponta a ponta: inscrição → PIX → pagamento → matrícula.')
console.log('(a confirmação manual de pagamento deixa de funcionar: em conexão real ela responde 403)')
process.exit(0)
