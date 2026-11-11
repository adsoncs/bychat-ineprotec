// src/services/enrollmentExpireJob.ts
// Cron que gerencia o ciclo de vida de inscrições com pagamento pendente:
//   1) Envia lembrete quando faltam 24h pro vencimento
//   2) Marca como expired quando o prazo passa

import { prisma } from '../lib/prisma.js'

const TICK_MS = 30 * 60 * 1000   // 30 min

let _timer: NodeJS.Timeout | null = null

const diaBr = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
/**
 * Fim do dia (Brasília) da data que o Asaas tem como vencimento. Prazo antigo
 * ("agora + 48 h", com hora): o Asaas recebeu a data UTC dele. Prazo já no
 * fim do dia (23:59 de Brasília): a data é a de Brasília — sem isto, cada
 * rodada empurraria o prazo mais um dia.
 */
export function fimDoDiaAsaas(d: Date): Date {
  const fimBr = new Date(`${diaBr(d)}T23:59:00-03:00`)
  if (fimBr.getTime() === d.getTime()) return fimBr
  return new Date(`${d.toISOString().slice(0, 10)}T23:59:00-03:00`)
}

async function runExpireSweep(): Promise<number> {
  const now = new Date()
  const onde = { status: 'pending', paymentExpiresAt: { lt: now, not: null }, paymentStatus: { not: 'paid' } }
  const candidatas = await prisma.enrollmentRegistration.findMany({ where: onde, select: { id: true, paymentId: true, paymentExpiresAt: true }, take: 1000 })
  const expirar: number[] = []
  for (const r of candidatas) {
    // Boleto/Pix do Asaas: o Asaas só tem a DATA, e a cobrança vale o dia todo.
    // Prazo gravado com hora (cobranças antigas) não pode encerrar a inscrição
    // antes do fim do dia: corrige o prazo e espera (INE-26-000004-Y3VP, 11/11).
    const m = r.paymentId ? await prisma.enrollmentPaymentMethod.findFirst({ where: { registrationId: r.id, externalId: r.paymentId }, orderBy: { id: 'desc' }, select: { id: true, provider: true, method: true, status: true } }) : null
    if (m && m.provider === 'asaas' && (m.method === 'boleto' || m.method === 'pix') && m.status === 'pending' && r.paymentExpiresAt) {
      const limite = fimDoDiaAsaas(r.paymentExpiresAt)
      if (limite > now) {
        if (limite.getTime() === r.paymentExpiresAt.getTime()) continue
        await prisma.enrollmentRegistration.update({ where: { id: r.id }, data: { paymentExpiresAt: limite } })
        await prisma.enrollmentPaymentMethod.update({ where: { id: m.id }, data: { expiresAt: limite } })
        continue
      }
    }
    expirar.push(r.id)
  }
  if (!expirar.length) return 0
  const expired = await prisma.enrollmentRegistration.updateMany({
    where: { ...onde, id: { in: expirar } },
    data: {
      status: 'expired',
      paymentStatus: 'overdue',
    },
  })
  return expired.count
}

async function runReminderSweep(): Promise<number> {
  // Busca inscrições com prazo entre 23h e 25h no futuro ainda não notificadas
  const now = Date.now()
  const from = new Date(now + 23 * 3600 * 1000)
  const to = new Date(now + 25 * 3600 * 1000)

  const pending = await prisma.enrollmentRegistration.findMany({
    where: {
      status: 'pending',
      paymentStatus: { not: 'paid' },
      paymentExpiresAt: { gte: from, lte: to },
    },
    select: { id: true, formData: true },
    take: 200,
  })

  let sent = 0
  for (const r of pending) {
    const fd = (r.formData || {}) as any
    if (fd._reminderSentAt) continue  // já enviado

    try {
      const { sendPaymentReminder } = await import('./enrollmentNotify.js')
      if (typeof sendPaymentReminder === 'function') {
        await sendPaymentReminder({ enrollmentId: r.id })
      }
      // Marca flag no formData (merge)
      await prisma.enrollmentRegistration.update({
        where: { id: r.id },
        data: { formData: { ...fd, _reminderSentAt: new Date().toISOString() } },
      })
      sent++
    } catch (e: any) {
      console.warn(`[enrollment-reminder] falhou id=${r.id}: ${e.message}`)
    }
  }
  return sent
}

async function runDraftCleanup(): Promise<number> {
  const deleted = await prisma.enrollmentDraft.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return deleted.count
}

export function startEnrollmentExpireJob(): void {
  if (_timer) return
  const tick = async () => {
    try {
      const expired = await runExpireSweep()
      if (expired > 0) console.log(`[enrollment-expire] ${expired} inscrições marcadas como expiradas`)
    } catch {}
    try {
      const reminded = await runReminderSweep()
      if (reminded > 0) console.log(`[enrollment-reminder] ${reminded} lembretes enviados`)
    } catch {}
    try {
      const purged = await runDraftCleanup()
      if (purged > 0) console.log(`[enrollment-draft] ${purged} rascunhos expirados removidos`)
    } catch {}
  }
  setTimeout(() => {
    tick()
    _timer = setInterval(tick, TICK_MS)
  }, 2 * 60 * 1000)
}

export function stopEnrollmentExpireJob(): void {
  if (_timer) { clearInterval(_timer); _timer = null }
}
