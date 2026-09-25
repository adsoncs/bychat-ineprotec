// O funil da secretaria diz quem está parado e no quê?
import { funilDeMatriculas } from '../src/services/acaFunilMatriculas.js'
import { prisma } from '../src/lib/prisma.js'

const f = await funilDeMatriculas({ limite: 50 })

console.log('etapas:')
for (const e of f.etapas) console.log(`  ${e.rotulo.padEnd(14)} ${e.total}`)

console.log('\ninscrições (as 12 mais recentes):')
for (const i of f.itens.slice(0, 12)) {
  console.log(`  ${i.codigo.padEnd(22)} ${i.etapa.padEnd(12)} ${i.candidato.slice(0, 24).padEnd(26)} ${i.motivo}`)
}

console.log('\nfiltrando só "documentos":')
const d = await funilDeMatriculas({ etapa: 'documentos', limite: 50 })
console.log(`  ${d.itens.length} inscrição(ões)`)
for (const i of d.itens.slice(0, 5)) console.log(`     ${i.codigo} · ${i.motivo}`)

// A linha do tempo do lead recebeu os marcos?
console.log('\neventos de matrícula na linha do tempo do lead:')
const ev = await prisma.leadEvent.findMany({
  where: { type: { startsWith: 'enrollment_' } },
  orderBy: { id: 'desc' }, take: 6,
  select: { type: true, title: true, description: true, lead: { select: { nome: true } } },
})
for (const e of ev) console.log(`  ${e.lead?.nome?.slice(0, 22).padEnd(24)} ${e.title} — ${(e.description ?? '').slice(0, 60)}`)
process.exit(0)
