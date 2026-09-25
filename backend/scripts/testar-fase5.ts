// Fase 5 ponta a ponta: responsável de menor, gatilhos, GED e cobrança de
// contrato parado. Usa dados reais da demo e desfaz o que criou para teste.
import { prisma } from '../src/lib/prisma.js'
import * as assinatura from '../src/services/acaAssinatura.js'
import { varrerContratosParados } from '../src/services/acaContratoLembrete.js'
import { arquivarContratoNoGed } from '../src/services/acaEfetivacao.js'

const linha = (a: string, b: unknown) => console.log(`  ${a.padEnd(46)} ${b}`)

// ── 1. Menor de idade sem responsável: envio precisa parar ──
console.log('\n── 1. contrato de menor de idade ──')
const aluno = await prisma.aluno.findFirst({ orderBy: { id: 'desc' }, select: { id: true, dataNascimento: true, lead: { select: { nome: true } } } })
const nascimentoOriginal = aluno!.dataNascimento
await prisma.aluno.update({ where: { id: aluno!.id }, data: { dataNascimento: new Date('2010-05-20') } })
linha('aluno agora consta com 16 anos', aluno!.lead.nome)

const impedimento = await assinatura.faltaResponsavelDeMenor(aluno!.id)
linha('sistema avisa?', impedimento ? 'sim' : 'NÃO')
if (impedimento) console.log(`     "${impedimento.slice(0, 110)}…"`)

const tpl = await prisma.acaContratoTemplate.findFirst({ where: { ativo: true }, select: { id: true } })
const matricula = await prisma.acaMatricula.findFirst({ where: { alunoId: aluno!.id }, select: { id: true } })
const env1 = await assinatura.criarDeTemplate(tpl!.id, { alunoId: aluno!.id, matriculaId: matricula?.id ?? null, titulo: 'Teste menor sem responsável' })
linha('signatários montados', env1.signatarios?.map((s: any) => `${s.papel}/${s.deliveryMethod}`).join(', '))
try {
  await assinatura.enviar(env1.id)
  linha('envio', 'PASSOU — deveria ter sido barrado')
} catch (e: any) {
  linha('envio barrado com', `"${e.message.slice(0, 60)}…"`)
}

// ── 2. Com responsável cadastrado, o contrato sai com os dois ──
console.log('\n── 2. com responsável cadastrado ──')
const resp = await prisma.acaResponsavel.create({
  data: { alunoId: aluno!.id, nome: 'Marcos Prado Martins', parentesco: 'Pai', tipo: 'LEGAL', telefone: '62991110000', email: null, ativo: true },
  select: { id: true, nome: true },
})
const env2 = await assinatura.criarDeTemplate(tpl!.id, { alunoId: aluno!.id, matriculaId: matricula?.id ?? null, titulo: 'Teste menor com responsável' })
linha('signatários montados', env2.signatarios?.map((s: any) => `${s.nome.split(' ')[0]}(${s.papel}/${s.deliveryMethod})`).join(', '))

// ── 3. GED recebe o PDF ao assinar ──
console.log('\n── 3. contrato assinado vai para o GED ──')
const envelopeAntigo = await prisma.acaAssinatura.findFirst({ where: { status: 'ASSINADO', alunoId: { not: null } }, orderBy: { id: 'desc' }, select: { id: true, alunoId: true } })
if (envelopeAntigo) {
  const gedId = await arquivarContratoNoGed(envelopeAntigo.id)
  const arq = gedId ? await prisma.acaGedArquivo.findUnique({ where: { id: gedId }, select: { tipo: true, nome: true, url: true, status: true } }) : null
  linha('arquivo no GED', arq ? `${arq.tipo} · ${arq.url} · ${arq.status}` : 'não criado')
  const denovo = await arquivarContratoNoGed(envelopeAntigo.id)
  linha('chamar de novo duplica?', denovo === gedId ? 'não (mesmo id)' : 'SIM — problema')
} else {
  linha('nenhum envelope assinado para arquivar', '—')
}

// ── 4. Cobrança de contrato parado ──
console.log('\n── 4. cobrança de contrato parado ──')
const parados = await prisma.acaAssinatura.findMany({ where: { status: { in: ['ENVIADO', 'PARCIAL'] } }, select: { id: true, enviadoEm: true } })
linha('envelopes enviados e não assinados', parados.length)
// Envelhece um deles para cair no primeiro marco (2 dias).
if (parados.length) {
  await prisma.acaAssinatura.update({ where: { id: parados[0].id }, data: { enviadoEm: new Date(Date.now() - 3 * 24 * 3600 * 1000) } })
}
const r = await varrerContratosParados({ simular: true })
linha('analisados / cobranças que sairiam', `${r.analisados} / ${r.enviados}`)
for (const d of r.detalhes) console.log(`     envelope #${d.envelopeId} · ${d.signatario} por ${d.canal} (parado há ${d.diasParado}d)`)

// ── limpeza do que foi criado só para o teste ──
await prisma.acaSignatario.deleteMany({ where: { assinaturaId: { in: [env1.id, env2.id] } } })
await prisma.acaAssinatura.deleteMany({ where: { id: { in: [env1.id, env2.id] } } })
await prisma.acaResponsavel.delete({ where: { id: resp.id } })
await prisma.aluno.update({ where: { id: aluno!.id }, data: { dataNascimento: nascimentoOriginal } })
if (parados.length) await prisma.acaAssinatura.update({ where: { id: parados[0].id }, data: { enviadoEm: parados[0].enviadoEm } })
console.log('\n(estado de teste desfeito)')
process.exit(0)
