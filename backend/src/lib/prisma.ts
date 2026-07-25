import { PrismaClient } from '@prisma/client'
import { phoneKey } from './phone.js'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'warn', 'error']
      : ['warn', 'error']
  })

// ─── Identidade canônica do contato (fix definitivo de duplicação) ───
// Toda escrita de Lead que toca `whatsapp` recompõe `Lead.phoneKey` (chave
// canônica BR — ver lib/phone.ts). Centralizar aqui garante que QUALQUER caminho
// de criação/edição (webhooks, agendamento, formulários, manual, import, Make,
// API pública…) mantenha a chave de match consistente, sem precisar instrumentar
// cada call site. Respeita um phoneKey explicitamente fornecido pelo caller.
//
// Além da chave de match, o PRÓPRIO `whatsapp` é gravado já canônico (com o DDI
// 55). O CRM guardava o que o canal mandou — o Lead Ads da Meta entrega
// "18988059971", sem DDI — e o disparo automático ia com esse valor para as APIs
// de WhatsApp, que respondiam `exists:false` (Evolution) ou 131009 (Meta). Como
// a normalização é idempotente e roda na escrita, todo canal (Lead Ads, webhook
// de entrada, formulário, chat, manual, importação, API) grava no mesmo formato.
//
// Valores que NÃO são telefone (LID, número sem DDD, ruído) são preservados como
// vieram: aqui não se apaga dado de contato — quem envia é que aborta com erro
// explicativo (ver lib/phone.ts → toWaNumber).
function applyPhoneKey(data: any): void {
  if (!data || typeof data !== 'object') return
  if (!('whatsapp' in data)) return
  const w = data.whatsapp
  const isSet = w && typeof w === 'object' && 'set' in w
  const raw = isSet ? w.set : w
  if (typeof raw !== 'string') return

  const key = phoneKey(raw)
  if (!('phoneKey' in data)) data.phoneKey = key

  // JID completo (@lid, @g.us) é identificador de sessão, não telefone — intacto.
  if (key && !raw.includes('@') && raw.replace(/\D/g, '') !== key) {
    if (isSet) w.set = key
    else data.whatsapp = key
  }
}

prisma.$use(async (params, next) => {
  if (params.model === 'Lead') {
    const a = params.action
    if (a === 'create' || a === 'update') {
      applyPhoneKey(params.args?.data)
    } else if (a === 'upsert') {
      applyPhoneKey(params.args?.create)
      applyPhoneKey(params.args?.update)
    } else if (a === 'createMany' || a === 'updateMany') {
      const d = params.args?.data
      if (Array.isArray(d)) d.forEach(applyPhoneKey)
      else applyPhoneKey(d)
    }
  }
  return next(params)
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
