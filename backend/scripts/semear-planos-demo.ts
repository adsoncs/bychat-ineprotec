// Plano de pagamento por oferta, a partir dos valores da própria oferta.
// Sem plano ativo o ERP não gera contrato nem parcelas.
import { prisma } from '../src/lib/prisma.js'

const ofertas = await prisma.courseOffering.findMany({
  where: { active: true },
  select: { id: true, nome: true, valorMensalidade: true, valorMatricula: true },
})

let criados = 0
for (const o of ofertas) {
  const existe = await prisma.acaPlanoPagamento.findFirst({
    where: { courseOfferingId: o.id, ativo: true }, select: { id: true },
  })
  if (existe) continue

  const mensalidade = Math.round(Number(o.valorMensalidade ?? 0) * 100)
  if (mensalidade <= 0) { console.log(`  ${o.nome}: sem mensalidade cadastrada — pulado`); continue }

  await prisma.acaPlanoPagamento.create({
    data: {
      courseOfferingId: o.id,
      nome: 'Semestral — 6 mensalidades',
      numParcelas: 6,
      valorParcelaCentavos: mensalidade,
      taxaMatriculaCentavos: Math.round(Number(o.valorMatricula ?? 0) * 100),
      diaVencimento: 10,
      ativo: true,
    },
  })
  criados++
}

console.log(`ofertas: ${ofertas.length} | planos criados: ${criados} | total: ${await prisma.acaPlanoPagamento.count()}`)
process.exit(0)
