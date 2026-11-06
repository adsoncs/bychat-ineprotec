// Reenvio do CAPI: usa a mesma linha, tem limite e não reenvia evento velho.
// Na beyond a versão antiga mandou 64 mil Purchase falsos (05/11/2026).
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { retryFailedEvents } from '../src/services/metaCapi.js'

const fetchOriginal = globalThis.fetch
let respostas: Array<{ ok: boolean; body: any }> = []
const chamadas: any[] = []
let leadId = 0
const ids: number[] = []
const settings = ['capi.pixel_id', 'capi.access_token']
const antes = new Map<string, any>()

async function falha(dias: number, retries = 1) {
  const quando = new Date(Date.now() - dias * 86_400_000)
  const e = await prisma.conversionEvent.create({ data: { leadId, platform: 'meta_capi', eventName: 'Purchase', eventTime: quando, createdAt: quando, currency: 'BRL', pixelId: '1', eventId: `teste_${Date.now()}_${Math.random()}`, status: 'failed', retries } })
  ids.push(e.id)
  return e
}

before(async () => {
  for (const key of settings) antes.set(key, await prisma.setting.findUnique({ where: { key } }))
  for (const key of settings) await prisma.setting.upsert({ where: { key }, create: { key, label: key, grp: 'teste', value: '"teste"' as any } as any, update: { value: '"teste"' as any } })
  const l = await prisma.lead.create({ data: { nome: 'Teste Reenvio CAPI', empresa: '', whatsapp: '', email: 'capi-reenvio@local.invalid', formData: {}, scores: {}, lastStep: 0, completed: false } as any })
  leadId = l.id
  globalThis.fetch = (async (_u: any, init: any) => {
    chamadas.push(JSON.parse(init.body))
    const r = respostas.shift() ?? { ok: true, body: { events_received: 1 } }
    return { ok: r.ok, status: r.ok ? 200 : 400, json: async () => r.body } as any
  }) as any
})

after(async () => {
  globalThis.fetch = fetchOriginal
  await prisma.conversionEvent.deleteMany({ where: { leadId } })
  await prisma.lead.delete({ where: { id: leadId } })
  for (const key of settings) {
    const a = antes.get(key)
    if (a) await prisma.setting.update({ where: { key }, data: { value: a.value } })
    else await prisma.setting.delete({ where: { key } }).catch(() => {})
  }
  await prisma.$disconnect()
})


test('sucesso: mesma linha, mesmo event_id, data original e não volta mais', async () => {
  const e = await falha(1)
  const total = await prisma.conversionEvent.count({ where: { leadId } })
  await retryFailedEvents()
  assert.equal(await prisma.conversionEvent.count({ where: { leadId } }), total, 'não cria linha nova')
  const d = await prisma.conversionEvent.findUniqueOrThrow({ where: { id: e.id } })
  assert.equal(d.status, 'sent')
  const env = chamadas.at(-1).data[0]
  assert.equal(env.event_id, e.eventId)
  assert.equal(env.event_time, Math.floor(e.eventTime.getTime() / 1000))
  const n = chamadas.length
  await retryFailedEvents()
  assert.equal(chamadas.length, n, 'evento enviado não volta')
})

test('falha repetida: para na 3ª tentativa, sem criar linhas', async () => {
  const e = await falha(1)
  const total = await prisma.conversionEvent.count({ where: { leadId } })
  respostas = [{ ok: false, body: { error: { message: 'Invalid parameter' } } }, { ok: false, body: { error: { message: 'Invalid parameter' } } }, { ok: false, body: { error: { message: 'x' } } }]
  await retryFailedEvents(); await retryFailedEvents(); await retryFailedEvents()
  assert.equal(await prisma.conversionEvent.count({ where: { leadId } }), total)
  const d = await prisma.conversionEvent.findUniqueOrThrow({ where: { id: e.id } })
  assert.equal(d.status, 'failed'); assert.equal(d.retries, 3)
  const n = chamadas.length
  await retryFailedEvents()
  assert.equal(chamadas.length, n, 'não tenta de novo')
})

test('evento com mais de 6 dias não é reenviado', async () => {
  const e = await falha(8)
  const n = chamadas.length
  await retryFailedEvents()
  assert.equal(chamadas.length, n)
  const d = await prisma.conversionEvent.findUniqueOrThrow({ where: { id: e.id } })
  assert.equal(d.status, 'failed'); assert.equal(d.retries, 1)
})
