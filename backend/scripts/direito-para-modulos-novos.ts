// scripts/direito-para-modulos-novos.ts
//
// Dá direito de uso aos módulos que entraram no registro DEPOIS da migration
// 0157 — que concedeu tudo a quem já era cliente, mas só o que existia na época.
//
// Sem isto, um módulo acrescentado ao registro nasce sem direito e NÃO ABRE,
// mesmo numa instalação onde tudo o mais está liberado: o cliente vê o item no
// menu e a tela recusa. O teste "quem já era cliente não perde nada" é
// exatamente o que cobra isso.
//
// Idempotente de propósito: rodar duas vezes não concede em dobro, e rodar numa
// instalação já em dia não faz nada. É para ser executado depois de toda onda
// que acrescente módulos.
//
//   npx tsx scripts/direito-para-modulos-novos.ts           # confere
//   npx tsx scripts/direito-para-modulos-novos.ts --aplicar # concede

import { prisma } from '../src/lib/prisma.js'
import { MODULE_REGISTRY } from '../src/lib/moduleRegistry.js'

const aplicar = process.argv.includes('--aplicar')

const jaTem = new Set(
  (await prisma.moduleEntitlement.findMany({ select: { moduleId: true } })).map((l) => l.moduleId),
)
// `core` não se concede: é da base e existe sempre.
const faltando = MODULE_REGISTRY.filter((m) => !m.core && !jaTem.has(m.id))

console.log(`registro: ${MODULE_REGISTRY.length} módulos · com direito: ${jaTem.size} · sem: ${faltando.length}`)
if (!faltando.length) {
  console.log('nada a fazer')
  await prisma.$disconnect()
  process.exit(0)
}
for (const m of faltando) console.log(`  ${m.id.padEnd(28)} ${m.umbrella}`)

if (!aplicar) {
  console.log('\nconferência apenas. Use --aplicar para conceder.')
  await prisma.$disconnect()
  process.exit(0)
}

let n = 0
for (const m of faltando) {
  // `migracao` e sem prazo: é o mesmo direito que a 0157 deu ao acervo, e
  // significa "já era do cliente". Um módulo novo no parque existente não
  // chega como venda nova.
  await prisma.moduleEntitlement.create({
    data: {
      moduleId: m.id, origem: 'migracao', pacote: m.umbrella,
      expiraEm: null, referencia: 'modulo acrescentado ao registro',
    },
  })
  n++
}
console.log(`\n${n} direito(s) concedido(s).`)
await prisma.$disconnect()
process.exit(0)
