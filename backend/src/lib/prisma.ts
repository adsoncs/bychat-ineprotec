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
function applyPhoneKey(data: any): void {
  if (!data || typeof data !== 'object') return
  if (!('whatsapp' in data) || 'phoneKey' in data) return
  const w = data.whatsapp
  const raw = (w && typeof w === 'object' && 'set' in w) ? w.set : w
  data.phoneKey = phoneKey(raw)
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
