// scripts/planos-da-tabela.mts
//
// Converte o preço que cada oferta cobrava ANTES dos planos de pagamento (tabela
// de preços da oferta, ou valor de matrícula/mensalidade) em plano de pagamento
// equivalente — o plano passou a ser a única fonte do preço do curso.
//
//   npx tsx scripts/planos-da-tabela.mts            → só mostra o que faria
//   npx tsx scripts/planos-da-tabela.mts --gravar   → grava
//
// Oferta que já tem plano com regras é pulada. Só ofertas de portal que cobra
// o curso (paymentScope 'curso'). As formas ligadas seguem as do portal.

import { prisma } from '../src/lib/prisma.ts'
import { lerRegras } from '../src/services/portalPagamento.ts'
import { lerTabelaDePrecos } from '../src/services/tabelaDePrecos.ts'
import { planosDaOferta } from '../src/services/planoFinanceiro.ts'

const GRAVAR = process.argv.includes('--gravar')
const cent = (v: number) => Math.round(v * 100)
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function main() {
  const portais = await prisma.enrollmentPortal.findMany({ where: { paymentScope: 'curso', requirePayment: true }, select: { id: true, paymentMethodsConfig: true } })
  if (!portais.length) { console.log('nenhum portal cobra o curso — nada a converter'); process.exit(0) }
  // Forma ligada em qualquer portal que cobra o curso vale no plano.
  const regrasPortais = portais.map((p) => lerRegras(p.paymentMethodsConfig))
  const pixOn = regrasPortais.some((r) => r.pix.ativo)
  const boletoOn = regrasPortais.some((r) => r.boleto.ativo)
  const cartaoOn = regrasPortais.some((r) => r.cartao.ativo)
  const cartaoMaxPortal = Math.max(1, ...regrasPortais.map((r) => (r.cartao.ativo ? r.cartao.parcelasMax : 1)))

  const ofertas = await prisma.courseOffering.findMany({ select: { id: true, nome: true, valorMatricula: true, valorMensalidade: true, tabelaPrecos: true } })
  for (const o of ofertas) {
    if ((await planosDaOferta(o.id)).length) { console.log(`#${o.id} ${o.nome}: já tem plano — pulada`); continue }
    const t = lerTabelaDePrecos(o.tabelaPrecos)
    if (t) {
      // Total do plano = o do cartão (as parcelas anunciadas); à vista e boleto
      // parcelado com preço próprio, exatamente o da tabela.
      const n = t.cartao?.parcelas ?? 1
      const parcela = t.cartao?.valorParcela ?? t.aVista
      const regras = {
        destino: 'attrae', destinoBoletoIntegral: 'attrae',
        entrada: { ativo: false },
        integral: {
          ativo: true,
          pix: { ativo: pixOn, descontoPct: 0, valorBase: t.aVista },
          boleto: { ativo: boletoOn, descontoPct: 0, valorBase: t.aVista },
          cartao: { ativo: cartaoOn && !!t.cartao, parcelasMax: t.cartao?.parcelas ?? 1, faixas: [], valorBase: null },
          boletoParcelado: t.boleto && t.boleto.parcelas > 1
            ? { ativo: boletoOn, parcelasMax: t.boleto.parcelas, faixas: [], valorBase: Math.round(t.boleto.parcelas * t.boleto.valorParcela * 100) / 100 }
            : { ativo: false, parcelasMax: 2, faixas: [] },
        },
        pontualidade: { ativo: false, descontoPct: 0, diaLimite: 5 },
      }
      // Plano antigo do ERP com as mesmas parcelas (criado da tabela): ganha as regras.
      const antigo = (await prisma.acaPlanoPagamento.findMany({
        where: { courseOfferingId: o.id, ativo: true, numParcelas: n, valorParcelaCentavos: cent(parcela), taxaMatriculaCentavos: 0 },
        orderBy: { id: 'asc' },
      })).find((p) => p.regras == null) ?? null
      const nome = antigo?.nome ?? `${n}x de ${brl(parcela)} (tabela do site)`
      console.log(`#${o.id} ${o.nome}: ${antigo ? `plano #${antigo.id} "${antigo.nome}" ganha regras` : `novo plano "${nome}"`} — à vista ${brl(t.aVista)}, cartão ${t.cartao ? `${n}x ${brl(parcela)}` : '—'}, boleto ${t.boleto && t.boleto.parcelas > 1 ? `${t.boleto.parcelas}x ${brl(t.boleto.valorParcela)}` : 'só à vista'}`)
      if (!GRAVAR) continue
      if (antigo) await prisma.acaPlanoPagamento.update({ where: { id: antigo.id }, data: { regras: regras as any } })
      else await prisma.acaPlanoPagamento.create({ data: { courseOfferingId: o.id, nome, numParcelas: n, valorParcelaCentavos: cent(parcela), taxaMatriculaCentavos: 0, diaVencimento: 10, ativo: true, regras: regras as any } })
      continue
    }
    const matricula = Number(o.valorMatricula ?? 0)
    const mensalidade = Number(o.valorMensalidade ?? 0)
    const valor = matricula > 0 ? matricula : mensalidade
    if (!(valor > 0)) { console.log(`#${o.id} ${o.nome}: sem preço — fica sem plano (não cobra)`); continue }
    const ehMatricula = matricula > 0
    const nome = `Provisório — ${ehMatricula ? 'matrícula' : '1ª parcela'} ${brl(valor)}`
    const regras = {
      destino: 'nenhum',
      entrada: {
        ativo: true,
        pix: { ativo: pixOn, descontoPct: 0 },
        boleto: { ativo: boletoOn, descontoPct: 0 },
        cartao: { ativo: cartaoOn, parcelasMax: Math.min(12, cartaoMaxPortal), faixas: [] },
        boletoParcelado: { ativo: false, parcelasMax: 2, faixas: [] },
      },
      integral: { ativo: false },
      pontualidade: { ativo: false, descontoPct: 0, diaLimite: 5 },
    }
    console.log(`#${o.id} ${o.nome}: novo plano "${nome}" (só a entrada)`)
    if (!GRAVAR) continue
    await prisma.acaPlanoPagamento.create({
      data: {
        courseOfferingId: o.id, nome, diaVencimento: 10, ativo: true, regras: regras as any,
        // Matrícula = 1ª e única parcela; 1ª mensalidade = uma parcela.
        taxaMatriculaCentavos: ehMatricula ? cent(valor) : 0, numParcelas: ehMatricula ? 0 : 1, valorParcelaCentavos: cent(valor),
      },
    })
  }
  console.log(GRAVAR ? 'gravado' : '(simulação — rode com --gravar para gravar)')
  process.exit(0)
}
main()
