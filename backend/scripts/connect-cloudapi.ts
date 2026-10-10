// scripts/connect-cloudapi.ts
// Conecta um número WhatsApp Cloud API usando um System User Token permanente
// (número já existente na BM da Meta — não passa pelo Embedded Signup).
//
// Uso (na pasta backend do tenant):
//   WABA_ID=... PHONE_NUMBER_ID=... SU_TOKEN=... npx tsx scripts/connect-cloudapi.ts
//
// PHONE_NUMBER_ID é opcional quando a WABA tem um único número. O token vem do
// ambiente (nunca do código) e é gravado cifrado com a CLOUD_API_TOKEN_KEY do
// tenant. O webhook aponta para o APP_URL do próprio tenant.

import { randomBytes } from 'crypto'
import { prisma } from '../src/lib/prisma.js'
import { encryptToken, cloudApiFetch, subscribeWebhook } from '../src/services/cloudApi.js'
import { appUrlObrigatoria } from '../src/lib/appUrl.js'

const WABA_ID = process.env.WABA_ID || ''
const SU_TOKEN = process.env.SU_TOKEN || ''
let PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || ''

async function main() {
  if (!WABA_ID || !SU_TOKEN) throw new Error('Defina WABA_ID e SU_TOKEN no ambiente')

  // 1. Diagnóstico do token e da conta
  const waba = await cloudApiFetch(
    `/${WABA_ID}?fields=name,account_review_status,business_verification_status,ownership_type,owner_business_info`,
    SU_TOKEN
  )
  console.log('WABA:', JSON.stringify(waba))

  const phones = await cloudApiFetch(
    `/${WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name,status,quality_rating,platform_type,code_verification_status`,
    SU_TOKEN
  )
  console.log('Números:', JSON.stringify(phones.data, null, 1))

  if (!PHONE_NUMBER_ID) {
    if (phones.data?.length === 1) PHONE_NUMBER_ID = phones.data[0].id
    else throw new Error('Informe PHONE_NUMBER_ID — a WABA tem mais de um número')
  }
  const phone = (phones.data || []).find((p: any) => p.id === PHONE_NUMBER_ID)
  if (!phone) throw new Error(`PHONE_NUMBER_ID ${PHONE_NUMBER_ID} não pertence à WABA ${WABA_ID}`)

  // 2. Salvar conexão (token criptografado em repouso)
  const verifyToken = randomBytes(16).toString('hex')
  const encrypted = encryptToken(SU_TOKEN)
  const conn = await prisma.cloudApiConnection.upsert({
    where: { wabaId: WABA_ID },
    update: {
      phoneNumberId: PHONE_NUMBER_ID,
      displayPhone: phone.display_phone_number || null,
      systemUserToken: encrypted,
      verifyToken,
      displayName: waba.name || phone.verified_name || null,
      qualityRating: phone.quality_rating || null,
      active: true,
      metadata: {
        tokenType: 'system_user',
        wabaStatus: waba.account_review_status,
        businessVerification: waba.business_verification_status,
        platformType: phone.platform_type,
        reconnectedAt: new Date().toISOString(),
        connectedVia: 'system_user_token_script',
      },
    },
    create: {
      wabaId: WABA_ID,
      phoneNumberId: PHONE_NUMBER_ID,
      displayPhone: phone.display_phone_number || null,
      systemUserToken: encrypted,
      verifyToken,
      displayName: waba.name || phone.verified_name || null,
      qualityRating: phone.quality_rating || null,
      active: true,
      metadata: {
        tokenType: 'system_user',
        wabaStatus: waba.account_review_status,
        businessVerification: waba.business_verification_status,
        platformType: phone.platform_type,
        connectedAt: new Date().toISOString(),
        connectedVia: 'system_user_token_script',
      },
    },
  })
  console.log('Conexão salva: id=', conn.id)

  // 3. Assinar webhook com Alternate Callback URL deste tenant
  const webhookUrl = `${appUrlObrigatoria()}/api/cloud-api/webhook`
  const subscribed = await subscribeWebhook(WABA_ID, SU_TOKEN, webhookUrl, verifyToken)
  console.log('Webhook:', webhookUrl, subscribed ? 'OK' : 'FALHOU')

  // 4. Templates: sincronizar depois pelo painel (Cloud API → Sincronizar templates),
  // que roda no processo do servidor e dispara os eventos de realtime.
}

main()
  .catch((e) => { console.error('ERRO:', e.message); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode || 0) })
