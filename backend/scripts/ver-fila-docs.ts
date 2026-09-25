// O que a secretaria vê na fila de conferência.
import { prisma } from '../src/lib/prisma.js'

const docs = await prisma.enrollmentDocument.findMany({
  orderBy: { id: 'desc' }, take: 10,
  select: {
    id: true, typeCode: true, label: true, fileName: true, sizeBytes: true,
    status: true, aiStatus: true, aiSuggestion: true, aiConfidence: true, uploadedAt: true,
    registration: { select: { candidateCode: true, lead: { select: { nome: true } } } },
  },
})
console.log(`documentos na fila: ${docs.length}`)
for (const d of docs) {
  console.log(`  #${d.id} ${d.registration.candidateCode} · ${d.registration.lead?.nome}`)
  console.log(`     ${d.label} (${d.typeCode}) · ${d.fileName} · ${Math.round(d.sizeBytes / 1024)} kB · ${d.status}`)
  console.log(`     IA: ${d.aiStatus}${d.aiSuggestion ? ` → ${d.aiSuggestion} (${Math.round((d.aiConfidence ?? 0) * 100)}%)` : ''}`)
}
process.exit(0)
