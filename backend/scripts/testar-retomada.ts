// Cria um rascunho abandonado e confere se a varredura o encontraria.
import { prisma } from '../src/lib/prisma.js'
import { varrerRascunhosAbandonados } from '../src/services/enrollmentRetomada.js'

const portal = await prisma.enrollmentPortal.findFirst({ where: { active: true }, select: { id: true, slug: true } })
const d = await prisma.enrollmentDraft.create({
  data: {
    portalId: portal!.id,
    sessionId: `teste-retomada-${Date.now()}`,
    formData: { nome: 'Paulo Henrique Braga', whatsapp: '62996665544', cpf: '' },
    currentStep: 1,
    whatsapp: '62996665544',
    updatedAt: new Date(Date.now() - 10 * 3600 * 1000), // parado há 10h
    expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
  },
  select: { id: true },
})
console.log(`rascunho de teste #${d.id} (parado há 10h, com WhatsApp)`)

const r = await varrerRascunhosAbandonados({ simular: true })
console.log(`analisados ${r.analisados} · convidaria ${r.convidados} · sem contato ${r.semContato}`)
for (const x of r.detalhes.slice(0, 5)) console.log(`   rascunho #${x.draftId} por ${x.canal} (parado ${x.horasParado}h)`)

// rascunho recente não deve ser incomodado
await prisma.enrollmentDraft.update({ where: { id: d.id }, data: { updatedAt: new Date() } })
const r2 = await varrerRascunhosAbandonados({ simular: true })
console.log(`depois de "voltar a mexer": convidaria ${r2.detalhes.filter((x) => x.draftId === d.id).length} (esperado 0)`)

await prisma.enrollmentDraft.delete({ where: { id: d.id } })
console.log('(rascunho de teste removido)')
process.exit(0)
