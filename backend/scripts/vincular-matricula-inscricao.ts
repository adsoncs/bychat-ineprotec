// scripts/vincular-matricula-inscricao.ts
//
// Preenche `AcaMatricula.enrollmentRegistrationId` nas matrículas que vieram do
// portal antes da migration 0156 e ficaram sem o vínculo.
//
// Por que importa: é por esse campo que o financeiro do ERP descobre o que a
// pessoa já pagou no checkout (meio, parcelas, valor) — e, desde a Fase 6, por
// qual conta do Asaas cobrar as mensalidades. Sem ele, o plano padrão da oferta
// é aplicado a quem já pagou de outro jeito.
//
// Só liga o que é **inequívoco**: um lead com exatamente uma inscrição. Lead com
// duas inscrições é listado e não tocado — adivinhar qual delas pagou o curso é
// pior do que deixar em branco.
//
//   npx tsx scripts/vincular-matricula-inscricao.ts          (só relata)
//   npx tsx scripts/vincular-matricula-inscricao.ts --aplicar

import { prisma } from '../src/lib/prisma.js'

const aplicar = process.argv.includes('--aplicar')

const matriculas = await prisma.acaMatricula.findMany({
  where: { enrollmentRegistrationId: null },
  select: { id: true, origem: true, alunoId: true, aluno: { select: { leadId: true } } },
  orderBy: { id: 'asc' },
})

console.log(`\n═══ VÍNCULO MATRÍCULA → INSCRIÇÃO ═══\n`)
console.log(`${matriculas.length} matrícula(s) sem vínculo.\n`)

let ligadas = 0
const ambiguas: string[] = []
const semInscricao: number[] = []

for (const m of matriculas) {
  const inscricoes = await prisma.enrollmentRegistration.findMany({
    where: { leadId: m.aluno.leadId },
    select: { id: true, candidateCode: true, paymentStatus: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  if (inscricoes.length === 0) {
    semInscricao.push(m.id)
    continue
  }
  if (inscricoes.length > 1) {
    ambiguas.push(`matrícula ${m.id} (lead ${m.aluno.leadId}): ${inscricoes.map((i) => i.candidateCode).join(', ')}`)
    continue
  }

  const insc = inscricoes[0]
  console.log(`  matrícula ${String(m.id).padEnd(4)} → inscrição ${insc.candidateCode} (pagamento: ${insc.paymentStatus ?? '—'})`)
  if (aplicar) {
    // Condicional: se outra rotina já ligou esta matrícula no meio do caminho,
    // a dela vale — este script é o remendo, não a fonte.
    await prisma.acaMatricula.updateMany({
      where: { id: m.id, enrollmentRegistrationId: null },
      data: { enrollmentRegistrationId: insc.id },
    })
  }
  ligadas++
}

if (ambiguas.length) {
  console.log(`\n── não tocadas: mais de uma inscrição no mesmo lead ──`)
  for (const a of ambiguas) console.log(`  • ${a}`)
  console.log(`  Ligue à mão pela tela da matrícula: adivinhar qual pagou é pior do que deixar em branco.`)
}
if (semInscricao.length) {
  console.log(`\n── sem inscrição no portal (matrícula feita na secretaria): ${semInscricao.join(', ')} ──`)
}

console.log(`\n${aplicar ? 'Ligadas' : 'Ligaria'}: ${ligadas} · ambíguas: ${ambiguas.length} · sem inscrição: ${semInscricao.length}`)
if (!aplicar && ligadas > 0) console.log(`\nNada foi gravado. Rode com --aplicar para gravar.`)

await prisma.$disconnect()
