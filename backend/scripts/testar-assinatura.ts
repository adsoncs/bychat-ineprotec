// Fecha o ciclo do contrato: signatário → envio → assinatura, em modo SIMULADO.
import { prisma } from '../src/lib/prisma.js'
import * as assinatura from '../src/services/acaAssinatura.js'

const env = await prisma.acaAssinatura.findFirst({
  orderBy: { id: 'desc' },
  select: {
    id: true, titulo: true, status: true, corpoTexto: true, alunoId: true, matriculaId: true,
    signatarios: { select: { id: true, nome: true, status: true } },
  },
})
if (!env) { console.log('nenhum envelope'); process.exit(0) }
console.log(`envelope #${env.id} "${env.titulo}" status=${env.status} signatarios=${env.signatarios.length}`)

const aluno = env.alunoId
  ? await prisma.aluno.findUnique({ where: { id: env.alunoId }, select: { cpf: true, lead: { select: { nome: true, email: true, whatsapp: true } } } })
  : null

if (!env.signatarios.length) {
  const s = await prisma.acaSignatario.create({
    data: {
      assinaturaId: env.id,
      nome: aluno?.lead?.nome || 'Aluno',
      email: aluno?.lead?.email || null,
      telefone: aluno?.lead?.whatsapp || null,
      cpf: aluno?.cpf || null,
      papel: 'ALUNO',
      acao: 'SIGN',
      deliveryMethod: 'WHATSAPP',
      ordem: 0,
    },
    select: { id: true, nome: true, deliveryMethod: true },
  })
  console.log(`signatário adicionado: ${s.nome} (por ${s.deliveryMethod})`)
}

const enviado = await assinatura.enviar(env.id)
console.log(`\nenviado: provider=${enviado?.provider} status=${enviado?.status}`)
for (const s of enviado?.signatarios ?? []) {
  console.log(`   ${s.nome} → ${s.status} · link ${s.linkAssinatura}`)
}

const sigId = enviado!.signatarios[0].id
await assinatura.simularAssinatura(enviado!.id, sigId)

const final = await prisma.acaAssinatura.findUnique({
  where: { id: env.id },
  select: {
    status: true, finalizadoEm: true, corpoTexto: true, matriculaId: true,
    signatarios: { select: { nome: true, status: true, assinadoEm: true } },
  },
})
console.log(`\nDEPOIS DE ASSINAR: envelope=${final?.status} finalizadoEm=${final?.finalizadoEm?.toISOString() ?? '—'}`)
for (const s of final?.signatarios ?? []) console.log(`   ${s.nome}: ${s.status} em ${s.assinadoEm?.toISOString() ?? '—'}`)
const mat = final?.matriculaId ? await prisma.acaMatricula.findUnique({ where: { id: final.matriculaId }, select: { id: true, status: true } }) : null
console.log(`matrícula vinculada: #${mat?.id} status=${mat?.status}`)
console.log('\n--- contrato interpolado (início) ---')
console.log((final?.corpoTexto || '(vazio)').slice(0, 400))
process.exit(0)
