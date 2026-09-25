// Auditoria do fluxo inscrição → pagamento → matrícula → financeiro.
//
// Procura estados que não deveriam existir. Nenhum deles aparece em log ou
// quebra tela: são divergências silenciosas, do tipo que só vira problema
// quando alguém cobra a pessoa errada ou deixa de cobrar a certa.
//
// SÓ LEITURA — não altera nada.
//
//   npx tsx --env-file=.env scripts/auditar-fluxo.ts

import { prisma } from '../src/lib/prisma.js'

const achados: { gravidade: 'alta' | 'media' | 'baixa'; titulo: string; detalhe: string }[] = []
const anotar = (gravidade: 'alta' | 'media' | 'baixa', titulo: string, detalhe: string) =>
  achados.push({ gravidade, titulo, detalhe })

const reais = (c: number) => `R$ ${(c / 100).toFixed(2)}`

// ── 1. Pagou e estacionou ───────────────────────────────────────────────────
//
// Pagar a taxa NÃO matricula: depois vêm documentos e contrato. Então "pago sem
// matrícula" é o meio do funil, não anomalia — sinalizar todos daria alarme
// falso em quem pagou ontem. O que merece atenção é quem pagou e não andou
// mais: aí o dinheiro entrou, a vaga está reservada e ninguém foi atrás.
const PARADO_DIAS = 7
const limite = new Date(Date.now() - PARADO_DIAS * 86400000)
const paradas = await prisma.enrollmentRegistration.findMany({
  where: {
    paymentStatus: 'paid',
    status: { notIn: ['enrolled', 'cancelled'] },
    paymentPaidAt: { lt: limite },
  },
  select: {
    id: true, candidateCode: true, paymentPaidAt: true, status: true,
    documents: { select: { id: true } },
  },
})
if (paradas.length) {
  anotar('alta', `Pagaram e não andaram há mais de ${PARADO_DIAS} dias`,
    paradas.map((r) => {
      const dias = Math.floor((Date.now() - r.paymentPaidAt!.getTime()) / 86400000)
      return `${r.candidateCode} (${dias}d, ${r.documents.length} documento(s))`
    }).join('; ') + ' — vaga reservada e ninguém foi atrás.')
}

// ── 2. Pago sem data, ou data sem pago ──────────────────────────────────────
const pagoSemData = await prisma.enrollmentRegistration.count({
  where: { paymentStatus: 'paid', paymentPaidAt: null },
})
if (pagoSemData) {
  anotar('media', 'Inscrições marcadas como pagas sem data de pagamento',
    `${pagoSemData} — a data é o que o relatório de conversão e o prazo de matrícula usam.`)
}
const dataSemPago = await prisma.enrollmentRegistration.count({
  where: { paymentPaidAt: { not: null }, paymentStatus: { not: 'paid' } },
})
if (dataSemPago) {
  anotar('media', 'Inscrições com data de pagamento mas status diferente de pago',
    `${dataSemPago} — provável baixa desfeita sem limpar a data.`)
}

// ── 3. Matrícula sem financeiro ─────────────────────────────────────────────
const matriculadasSemContrato = await prisma.acaMatricula.findMany({
  where: { status: 'MATRICULADO', contrato: null },
  select: { id: true, alunoId: true, dataMatricula: true },
})
if (matriculadasSemContrato.length) {
  anotar('alta', 'Alunos matriculados sem contrato financeiro',
    `${matriculadasSemContrato.length}: matrícula(s) ${matriculadasSemContrato.map((m) => m.id).join(', ')} — ninguém vai cobrar mensalidade deles.`)
}

// ── 4. Contrato cuja soma das parcelas não bate com o total ─────────────────
const contratos = await prisma.acaContrato.findMany({
  select: {
    id: true, valorTotalCentavos: true, status: true,
    parcelas: { select: { valorBrutoCentavos: true, situacao: true, valorPagoCentavos: true } },
  },
})
for (const c of contratos) {
  const soma = c.parcelas.reduce((s, p) => s + p.valorBrutoCentavos, 0)
  if (c.parcelas.length && soma !== c.valorTotalCentavos) {
    anotar('alta', `Contrato #${c.id}: parcelas não somam o total`,
      `total ${reais(c.valorTotalCentavos)} × soma das parcelas ${reais(soma)} (diferença ${reais(Math.abs(soma - c.valorTotalCentavos))})`)
  }
  const pagoAlem = c.parcelas.filter((p) => p.valorPagoCentavos > p.valorBrutoCentavos)
  if (pagoAlem.length) {
    anotar('media', `Contrato #${c.id}: parcela com pago maior que o devido`,
      `${pagoAlem.length} parcela(s) — sinal de baixa duplicada.`)
  }
  const quitadasTodas = c.parcelas.length > 0 && c.parcelas.every((p) => p.situacao === 'PAGA')
  if (quitadasTodas && c.status === 'ATIVO') {
    anotar('media', `Contrato #${c.id}: todas as parcelas pagas mas status ATIVO`,
      'deveria estar QUITADO — fica aparecendo como pendente nos relatórios.')
  }
}

// ── 5. Parcela paga sem valor, ou aberta com valor cheio ────────────────────
const pagaSemValor = await prisma.acaParcela.count({ where: { situacao: 'PAGA', valorPagoCentavos: 0 } })
if (pagaSemValor) {
  anotar('media', 'Parcelas marcadas como pagas com valor pago zerado',
    `${pagaSemValor} — a conciliação não fecha.`)
}

// ── 6. Cobrança viva de inscrição que já morreu ─────────────────────────────
const cobrancaOrfa = await prisma.enrollmentPaymentMethod.findMany({
  where: { status: 'pending', registration: { status: 'cancelled' } },
  select: { id: true, method: true, registration: { select: { candidateCode: true } } },
})
if (cobrancaOrfa.length) {
  anotar('media', 'Cobranças em aberto de inscrições canceladas',
    `${cobrancaOrfa.length} — o candidato ainda consegue pagar algo que foi cancelado.`)
}

// ── 7. Duplicidade de cobrança na mesma inscrição ───────────────────────────
const pendentes = await prisma.enrollmentPaymentMethod.groupBy({
  by: ['registrationId'],
  where: { status: 'pending' },
  _count: { _all: true },
})
const duplicadas = pendentes.filter((p) => p._count._all > 1)
if (duplicadas.length) {
  anotar('media', 'Inscrições com mais de uma cobrança em aberto ao mesmo tempo',
    `${duplicadas.length} inscrição(ões) — quem paga as duas paga duas vezes. Ids: ${duplicadas.slice(0, 6).map((d) => d.registrationId).join(', ')}`)
}

// ── 8. Vínculo da ponte checkout → ERP ──────────────────────────────────────
const semVinculo = await prisma.acaMatricula.count({
  where: { origem: 'portal', enrollmentRegistrationId: null },
})
if (semVinculo) {
  anotar('baixa', 'Matrículas vindas do portal sem vínculo com a inscrição',
    `${semVinculo} — anteriores à migration 0156; o financeiro delas não sabe o que foi pago no checkout.`)
}

// ── 8b. Assinou e continua sem estar matriculado ───────────────────────────
// A pessoa cumpriu a parte dela e o sistema não moveu a matrícula. Aconteceu de
// verdade: um envelope assinado antes de a ponte existir deixou a matrícula #1
// parada em INSCRITO. É invisível nas telas — o candidato vê "assinado" e a
// secretaria vê "não matriculado", cada um convicto.
const assinadoSemEfetivar = await prisma.acaAssinatura.findMany({
  where: { status: 'ASSINADO', matriculaId: { not: null } },
  select: { id: true, matriculaId: true },
})
const presos: number[] = []
for (const e of assinadoSemEfetivar) {
  const m = await prisma.acaMatricula.findUnique({
    where: { id: e.matriculaId! }, select: { status: true },
  })
  if (m && !['MATRICULADO', 'CONCLUIDO', 'TRANSFERIDO', 'CANCELADO', 'EVADIDO'].includes(m.status)) presos.push(e.id)
}
// O mesmo para quem assinou pelo Portal, onde não existe envelope.
const aceitosSemEfetivar = await prisma.acaContrato.findMany({
  where: { aceiteEm: { not: null }, matricula: { status: { in: ['INSCRITO', 'PRE_MATRICULA'] } } },
  select: { id: true },
})
if (presos.length || aceitosSemEfetivar.length) {
  anotar('alta', 'Contrato assinado e matrícula não efetivada',
    `${presos.length + aceitosSemEfetivar.length} — a pessoa assinou e continua fora da matrícula.` +
    (presos.length ? ` Envelopes: ${presos.join(', ')}.` : '') +
    (aceitosSemEfetivar.length ? ` Contratos aceitos no portal: ${aceitosSemEfetivar.map((c) => c.id).join(', ')}.` : ''))
}

// ── 8c. Cadência ativa com passo automático sem mensagem ───────────────────
// O motor faz a coisa certa — pula e avança — mas só num console.warn que
// ninguém lê. Do lado de quem configurou, o passo "existe" e nunca sai: na demo
// são 11 execuções `skipped_empty_body` acumuladas em silêncio.
const passosMudos = await prisma.cadenceStep.findMany({
  where: { templateId: null, isManual: false, cadence: { status: 'active' } },
  select: { id: true, order: true, channel: true, cadence: { select: { id: true, name: true } } },
})
if (passosMudos.length) {
  const porCadencia = new Map<string, number[]>()
  for (const p of passosMudos) {
    const chave = `${p.cadence.name} (#${p.cadence.id})`
    porCadencia.set(chave, [...(porCadencia.get(chave) ?? []), p.order])
  }
  const detalhe = [...porCadencia.entries()]
    .map(([nome, ordens]) => `${nome}: passo(s) ${ordens.sort((a, b) => a - b).join(', ')}`)
    .join(' · ')
  anotar('media', 'Cadência ativa com passo automático sem mensagem',
    `${passosMudos.length} passo(s) — disparam, não enviam nada e seguem em frente. ${detalhe}`)
}

// ── 9. Portal que cobra sem ter como cobrar ─────────────────────────────────
const portaisQuebrados = await prisma.enrollmentPortal.findMany({
  where: { active: true, requirePayment: true, paymentConnectionId: null },
  select: { id: true, nome: true, slug: true },
})
if (portaisQuebrados.length) {
  anotar('alta', 'Portais ativos que exigem pagamento sem conexão configurada',
    portaisQuebrados.map((p) => `${p.nome} (/${p.slug})`).join('; ') + ' — o candidato se inscreve e trava na hora de pagar.')
}

// ── 10. Processo aberto sem taxa, com portal que exige pagamento ────────────
const portaisComTaxa = await prisma.enrollmentPortal.findMany({
  where: { active: true, requirePayment: true },
  select: { id: true, nome: true, selectionProcessIds: true },
})
for (const p of portaisComTaxa) {
  const ids = Array.isArray(p.selectionProcessIds) ? (p.selectionProcessIds as number[]) : []
  if (!ids.length) continue
  const semTaxa = await prisma.selectionProcess.findMany({
    where: { id: { in: ids.map(Number) }, OR: [{ taxaInscricao: null }, { taxaInscricao: 0 }] },
    select: { nome: true },
  })
  if (semTaxa.length) {
    anotar('media', `Portal "${p.nome}" exige pagamento, mas processo sem taxa`,
      semTaxa.map((s) => s.nome).join('; ') + ' — quem escolher esse curso não consegue pagar nada.')
  }
}

// ── Relatório ───────────────────────────────────────────────────────────────
console.log('\n═══ AUDITORIA DO FLUXO ═══\n')
if (!achados.length) {
  console.log('Nenhuma divergência encontrada.')
} else {
  for (const g of ['alta', 'media', 'baixa'] as const) {
    const lista = achados.filter((a) => a.gravidade === g)
    if (!lista.length) continue
    console.log(`── ${g.toUpperCase()} (${lista.length}) ──`)
    for (const a of lista) {
      console.log(`  • ${a.titulo}`)
      console.log(`    ${a.detalhe}`)
    }
    console.log()
  }
}

// Panorama, para dar escala aos achados.
const [insc, pagas, mat, contr, parc] = await Promise.all([
  prisma.enrollmentRegistration.count(),
  prisma.enrollmentRegistration.count({ where: { paymentStatus: 'paid' } }),
  prisma.acaMatricula.count(),
  prisma.acaContrato.count(),
  prisma.acaParcela.count(),
])
console.log(`Base: ${insc} inscrições (${pagas} pagas) · ${mat} matrículas · ${contr} contratos · ${parc} parcelas`)
process.exit(0)
