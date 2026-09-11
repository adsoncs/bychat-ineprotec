// scripts/conferir-fichas-em-dobro-lid.ts
//
// Põe lado a lado as duas fichas da MESMA pessoa criadas pelo bug do LID.
//
// Quando o WhatsApp entrega só o LID, o webhook abria uma ficha com os dígitos
// dele no lugar do telefone. A pessoa depois escreve (ou é escrita) pelo número
// real e ganha uma SEGUNDA ficha — sem nenhum vínculo com a primeira. O
// atendimento fica dividido em duas conversas e ninguém vê o conjunto.
//
// Este script não muda nada. Ele mostra, por dupla, o que cada lado carrega —
// mensagens, histórico, funil, dono — para que a direção da fusão seja uma
// decisão com fatos, e não um palpite do script.
//
//   npx tsx scripts/conferir-fichas-em-dobro-lid.ts

import { prisma } from '../src/lib/prisma.js'
import { isGroupJid, isLikelyLid, onlyDigits, phoneKey } from '../src/lib/phone.js'

const API = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '')
const KEY = process.env.EVOLUTION_API_KEY || ''

async function numeroRealDoLid(instancia: string, lid: string): Promise<string> {
  if (!API || !KEY) return ''
  try {
    const r = await fetch(`${API}/chat/findChats/${encodeURIComponent(instancia)}`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { remoteJid: lid } }),
      signal: AbortSignal.timeout(25_000),
    })
    if (!r.ok) return ''
    const chats = (await r.json()) as any[]
    const alt: string = chats?.[0]?.lastMessage?.key?.remoteJidAlt || ''
    const phone = alt.endsWith('@s.whatsapp.net') ? alt.replace('@s.whatsapp.net', '') : ''
    return phone && !isLikelyLid(phone) && phoneKey(phone) ? phone : ''
  } catch {
    return ''
  }
}

async function retrato(id: number) {
  const l = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true, uid: true, nome: true, nomeOrigem: true, whatsapp: true, waLid: true,
      email: true, status: true, funnelId: true, assignedUserId: true, teamId: true,
      outcome: true, completed: true, createdAt: true, lastMessageAt: true,
      lastActivityAt: true, unreadMessages: true,
    },
  })
  if (!l) return null
  const [msgs, recebidas, eventos, atividades, negocios] = await Promise.all([
    prisma.message.count({ where: { leadId: id } }),
    prisma.message.count({ where: { leadId: id, fromMe: false } }),
    prisma.leadEvent.count({ where: { leadId: id } }),
    prisma.activity.count({ where: { leadId: id } }).catch(() => 0),
    prisma.negotiation.count({ where: { leadId: id } }).catch(() => 0),
  ])
  const funil = l.funnelId
    ? await prisma.funnel.findUnique({ where: { id: l.funnelId }, select: { name: true } })
    : null
  const dono = l.assignedUserId
    ? await prisma.user.findUnique({ where: { id: l.assignedUserId }, select: { name: true } })
    : null
  return { ...l, msgs, recebidas, eventos, atividades, negocios, funil: funil?.name ?? null, dono: dono?.name ?? null }
}

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—')

function linha(rotulo: string, a: string, b: string) {
  console.log(`  ${rotulo.padEnd(16)} ${a.padEnd(34)} ${b}`)
}

const leads = await prisma.lead.findMany({
  select: { id: true, whatsapp: true, waLid: true, instanceName: true, groupJid: true, isGroup: true },
  orderBy: { id: 'asc' },
})
const comLid = leads.filter((l) => isLikelyLid(l.whatsapp) && !isGroupJid(l.whatsapp) && !l.isGroup)

console.log(`\n═══ FICHAS EM DOBRO ABERTAS PELO LID ═══\n`)

const instancias = (await prisma.whatsAppInstance.findMany({ select: { instanceName: true } }))
  .map((i) => i.instanceName)
  .filter(Boolean)

let duplas = 0, sozinhos = 0
for (const l of comLid) {
  const lid = l.waLid || `${onlyDigits(l.whatsapp)}@lid`
  let real = ''
  for (const inst of l.instanceName ? [l.instanceName] : instancias) {
    real = await numeroRealDoLid(inst, lid)
    if (real) break
  }
  if (!real) {
    sozinhos++
    continue
  }
  const gemeo = await prisma.lead.findFirst({
    where: {
      id: { not: l.id },
      OR: [{ whatsapp: real }, { phoneKey: phoneKey(real) ?? '__nenhum__' }],
      ...(l.instanceName ? { instanceName: l.instanceName } : {}),
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!gemeo) {
    sozinhos++
    continue
  }

  const A = await retrato(l.id)
  const B = await retrato(gemeo.id)
  if (!A || !B) continue
  duplas++

  console.log(`\n── ${real}  ·  dupla ${duplas} ──────────────────────────────`)
  linha('', `[LID] #${A.id} ${A.uid}`, `[número] #${B.id} ${B.uid}`)
  linha('nome', `${A.nome} (${A.nomeOrigem ?? '—'})`, `${B.nome} (${B.nomeOrigem ?? '—'})`)
  linha('whatsapp', A.whatsapp || '(vazio)', B.whatsapp || '(vazio)')
  linha('criado', dia(A.createdAt), dia(B.createdAt))
  linha('última msg', dia(A.lastMessageAt), dia(B.lastMessageAt))
  linha('mensagens', `${A.msgs} (${A.recebidas} do contato)`, `${B.msgs} (${B.recebidas} do contato)`)
  linha('histórico', `${A.eventos} evento(s)`, `${B.eventos} evento(s)`)
  linha('atividades', `${A.atividades}`, `${B.atividades}`)
  linha('negociações', `${A.negocios}`, `${B.negocios}`)
  linha('funil/etapa', `${A.funil ?? '—'} / ${A.status ?? '—'}`, `${B.funil ?? '—'} / ${B.status ?? '—'}`)
  linha('dono', A.dono ?? '—', B.dono ?? '—')
  linha('não lidas', String(A.unreadMessages), String(B.unreadMessages))

  // Sugestão, não decisão: fica com quem tem o telefone discável; o outro é
  // absorvido. `mergeLeads` move mensagens, eventos e atividades, e leva o
  // `waLid` junto — sem ele a próxima mensagem abriria a duplicata de novo.
  const pesoA = A.msgs + A.eventos + A.atividades * 3 + A.negocios * 5
  const pesoB = B.msgs + B.eventos + B.atividades * 3 + B.negocios * 5
  console.log(`  → sugestão: manter #${B.id} (tem o número) e absorver #${A.id}` +
    (pesoA > pesoB ? `   ⚠ mas o lado do LID carrega MAIS histórico (${pesoA} × ${pesoB}) — confira antes` : ''))
}

console.log(`\n${'─'.repeat(60)}`)
console.log(`  duplas encontradas .......... ${duplas}`)
console.log(`  fichas de LID sem gêmeo ..... ${sozinhos}`)
console.log(`\nNada foi alterado.\n`)

await prisma.$disconnect()
