// Migra EnrollmentPortal.paymentConfig (JSON inline) para PaymentProviderConnection.
// Executar: node backend/scripts/migrate-payment-configs.mjs
//
// Para cada portal com paymentProvider='asaas' e apiKey preenchida:
//   1) cria uma PaymentProviderConnection com apiKey criptografada
//   2) copia environment, billingType e webhookToken existente
//   3) seta portal.paymentConnectionId = <id da nova conexão>

import { PrismaClient } from '@prisma/client'
import { createCipheriv, randomBytes } from 'crypto'

const prisma = new PrismaClient()

function encryptToken(plaintext) {
  const key = process.env.CLOUD_API_TOKEN_KEY
  if (!key || key.length < 32) {
    throw new Error('CLOUD_API_TOKEN_KEY deve ter pelo menos 32 chars hex')
  }
  const keyBuf = Buffer.from(key.slice(0, 64), 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBuf, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

async function run() {
  const portals = await prisma.enrollmentPortal.findMany({
    where: {
      paymentProvider: 'asaas',
      paymentConnectionId: null,
    },
    select: { id: true, nome: true, paymentConfig: true },
  })

  console.log(`Encontrados ${portals.length} portais para migrar`)

  let migrated = 0
  let skipped = 0

  for (const p of portals) {
    const cfg = p.paymentConfig || {}
    if (!cfg.apiKey) {
      console.log(`- pulado portal ${p.id} "${p.nome}" (sem apiKey)`)
      skipped++
      continue
    }
    const webhookToken = cfg.webhookToken || randomBytes(24).toString('hex')
    try {
      const conn = await prisma.paymentProviderConnection.create({
        data: {
          name: `${p.nome} (migrado)`,
          provider: 'asaas',
          environment: cfg.environment === 'production' ? 'production' : 'sandbox',
          apiKey: encryptToken(String(cfg.apiKey)),
          defaultBillingType: cfg.billingType || 'UNDEFINED',
          webhookToken,
          active: true,
        },
      })
      await prisma.enrollmentPortal.update({
        where: { id: p.id },
        data: { paymentConnectionId: conn.id },
      })
      console.log(`✓ portal ${p.id} "${p.nome}" → conexão ${conn.id}`)
      migrated++
    } catch (e) {
      console.warn(`✗ portal ${p.id} "${p.nome}": ${e.message}`)
    }
  }

  console.log(`\nMigração concluída: ${migrated} criadas, ${skipped} puladas.`)
  await prisma.$disconnect()
}

run().catch(e => { console.error(e); process.exit(1) })
