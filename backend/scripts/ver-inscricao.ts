// Mostra o formato real de uma inscrição do portal (chaves do formData).
import { prisma } from '../src/lib/prisma.js'

const regs = await prisma.enrollmentRegistration.findMany({
  take: 3, orderBy: { id: 'desc' },
  select: {
    id: true, candidateCode: true, status: true, leadId: true, formData: true,
    processRegistration: { select: { id: true, offeringId: true, status: true } },
  },
})
for (const r of regs) {
  console.log(`#${r.id} ${r.candidateCode} status=${r.status} leadId=${r.leadId} proc=${JSON.stringify(r.processRegistration)}`)
  console.log('   formData:', JSON.stringify(r.formData).slice(0, 700))
}

const turmas = await prisma.acaTurma.count()
const periodos = await (prisma as any).acaPeriodoLetivo.count()
console.log(`\nturmas no ERP: ${turmas} | períodos letivos: ${periodos}`)
console.log('ofertas:', await prisma.courseOffering.count(), '| alunos:', await prisma.aluno.count())
process.exit(0)
