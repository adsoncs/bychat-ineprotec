import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100)
}

const all = await prisma.selectionProcess.findMany({ where: { slug: null }, select: { id: true, nome: true, codigo: true } })
console.log(`Processos sem slug: ${all.length}`)

for (const p of all) {
  let base = slugify(p.nome)
  if (p.codigo) base = base ? `${base}-${slugify(p.codigo)}` : slugify(p.codigo)
  if (!base) base = `processo-${p.id}`

  let slug = base
  let n = 0
  while (await prisma.selectionProcess.findFirst({ where: { slug, NOT: { id: p.id } } })) {
    n++
    slug = `${base}-${n}`
  }

  await prisma.selectionProcess.update({ where: { id: p.id }, data: { slug } })
  console.log(`  #${p.id} "${p.nome}" → ${slug}`)
}
console.log('OK')
await prisma.$disconnect()
