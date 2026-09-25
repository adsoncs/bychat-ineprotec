// Efetiva uma inscrição nova e confere se o marco entrou na linha do tempo do lead.
import { prisma } from '../src/lib/prisma.js'
import { efetivarInscricao } from '../src/services/acaEfetivacao.js'

const reg = await prisma.enrollmentRegistration.findFirst({
  where: { status: { notIn: ['enrolled', 'cancelled'] }, leadId: { not: null } },
  orderBy: { id: 'desc' },
  select: { id: true, candidateCode: true, leadId: true, lead: { select: { nome: true } } },
})
if (!reg) { console.log('sem inscrição elegível'); process.exit(0) }
console.log(`inscrição ${reg.candidateCode} · ${reg.lead?.nome}`)

const antes = await prisma.leadEvent.count({ where: { leadId: reg.leadId! } })
const r = await efetivarInscricao(reg.id)
await new Promise((res) => setTimeout(res, 1500)) // logEvent é fire-and-forget
const depois = await prisma.leadEvent.count({ where: { leadId: reg.leadId! } })
console.log(`eventos do lead: ${antes} → ${depois} · matrícula #${r.matriculaId}`)

const ev = await prisma.leadEvent.findMany({
  where: { leadId: reg.leadId!, type: { startsWith: 'enrollment_' } },
  orderBy: { id: 'desc' }, take: 3,
  select: { type: true, title: true, description: true, category: true },
})
for (const e of ev) console.log(`  [${e.category}] ${e.type} — ${e.title}: ${e.description ?? ''}`)
process.exit(0)
