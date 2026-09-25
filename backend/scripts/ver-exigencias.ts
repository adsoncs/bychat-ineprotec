// Por que a inscrição não lista documentos exigidos? Mostra processo seletivo,
// forma de ingresso e os requisitos cadastrados.
import { prisma } from '../src/lib/prisma.js'

const sps = await prisma.selectionProcess.findMany({
  select: {
    id: true, nome: true, status: true, useCustomDocuments: true, entryModeId: true,
    entryMode: { select: { id: true, name: true, _count: { select: { documentRequirements: true } } } },
    _count: { select: { documentRequirements: true } },
  },
})
console.log('processos seletivos:')
for (const s of sps) {
  console.log(`  #${s.id} ${s.nome} (${s.status})`)
  console.log(`     forma de ingresso: ${s.entryMode ? `${s.entryMode.name} · ${s.entryMode._count.documentRequirements} requisitos` : 'nenhuma'}`)
  console.log(`     documentos próprios: ${s.useCustomDocuments ? 'sim' : 'não'} · ${s._count.documentRequirements} cadastrados`)
}

const modos = await prisma.entryMode.findMany({
  select: { id: true, name: true, _count: { select: { documentRequirements: true } } },
  orderBy: { id: 'asc' },
})
console.log('\nformas de ingresso e requisitos:')
for (const m of modos) console.log(`  #${m.id} ${m.name.padEnd(38)} ${m._count.documentRequirements} documento(s)`)

console.log('\ntipos de documento:', await prisma.documentType.count())
process.exit(0)
