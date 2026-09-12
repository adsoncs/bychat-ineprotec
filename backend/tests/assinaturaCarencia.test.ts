// tests/assinaturaCarencia.test.ts
//
// Teste grátis, carência e baixa manual — as regras que decidem quando o
// cliente perde acesso, e quando não perde.
//
// Regras do produto (11/09/2026): 7 dias de teste, 15 de carência, e o dono
// podendo esticar ou dar baixa à mão, porque parte do dinheiro entra por fora
// (PIX, transferência) e nunca passa pelo provedor.
//
// O que se guarda aqui é dinheiro e acesso: errar para menos corta um cliente
// que pagou; errar para mais entrega meses de graça. Os dois custam.
//
// ⚠️ TOCA O BANCO REAL. Tudo leva `referencia` ou `feitoPor` de teste e é
// apagado no fim — por MARCA, nunca por origem: limpar `origem: 'pacote'`
// numa instalação de cliente apagaria compras de verdade.
//
//   cd backend && npx tsx --test tests/assinaturaCarencia.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import {
  carenciaDias, testeDias, estadoDoPacote, iniciarTeste, marcarComoPago,
  estenderCarencia, modulosComDireito, invalidarCacheDeDireitos, concederPacote,
} from '../src/services/moduleEntitlements.js'
import { MODULE_REGISTRY } from '../src/lib/moduleRegistry.js'

const MARCA = 'teste-automatizado'
const QUEM = 'teste@local.invalid'
const PACOTE = 'marketing_canais' as const
const UM_MODULO = MODULE_REGISTRY.find((m) => !m.core && m.umbrella === PACOTE)!.id

let carenciaOriginal = 15

// Trava de segurança. `concederPacote` faz upsert em UNIQUE(moduleId, origem):
// num banco com compra real de um pacote, este teste EMPURRARIA o vencimento
// verdadeiro e depois apagaria a linha. A trava olha o conteúdo do banco, não
// o nome da pasta, porque é o conteúdo que determina o estrago.
const comprasReais = await prisma.moduleEntitlement.count({
  where: { origem: { in: ['pacote', 'avulso'] }, NOT: { referencia: { contains: MARCA } } },
})
const trava = comprasReais > 0
  ? `banco com ${comprasReais} direito(s) comprado(s) de verdade — este teste escreve em origem 'pacote' e não roda aqui`
  : false

async function limpar() {
  await prisma.moduleEntitlement.deleteMany({
    where: { OR: [{ referencia: { contains: MARCA } }, { concedidoPor: QUEM }] },
  })
  await prisma.assinaturaEvento.deleteMany({ where: { feitoPor: QUEM } })
  invalidarCacheDeDireitos()
}

before(async () => {
  if (trava) return
  carenciaOriginal = await carenciaDias()
  await limpar()
})
after(async () => {
  // Restaurar a carência é escrita: num banco travado nem isso acontece.
  if (!trava) {
    await limpar()
    await estenderCarencia({ dias: carenciaOriginal, feitoPor: QUEM })
    await prisma.assinaturaEvento.deleteMany({ where: { feitoPor: QUEM } })
  }
  await prisma.$disconnect()
})

describe('os padrões combinados', { skip: trava }, () => {
  test('teste grátis de 7 dias', async () => {
    assert.equal(await testeDias(), 7)
  })
  test('carência de 15 dias', async () => {
    assert.equal(await carenciaDias(), 15)
  })
})

describe('teste grátis', { skip: trava }, () => {
  test('vence sozinho — não vira assinatura por engano', async () => {
    const r = await iniciarTeste({ pacote: PACOTE, feitoPor: QUEM })
    const dias = Math.round((r.expiraEm.getTime() - Date.now()) / 864e5)
    assert.equal(dias, 7, 'o teste precisa ter data de fim')
    assert.ok(r.concedidos.length > 0, 'e precisa liberar os módulos do pacote')
  })

  test('fica registrado quem começou e quando', async () => {
    const ev = await prisma.assinaturaEvento.findFirst({ where: { tipo: 'teste', feitoPor: QUEM } })
    assert.ok(ev, 'teste sem registro vira discussão depois')
    assert.equal(ev!.pacote, PACOTE)
  })
})

describe('carência', { skip: trava }, () => {
  test('vencido ontem continua funcionando', async () => {
    // É o ponto inteiro da carência: cortar no dia do vencimento transforma um
    // boleto atrasado em cliente sem sistema.
    await concederPacote({
      pacote: PACOTE, expiraEm: new Date(Date.now() - 864e5), // ontem
      referencia: MARCA, concedidoPor: QUEM,
    })
    const st = await estadoDoPacote(PACOTE)
    assert.equal(st.estado, 'em_carencia')
    assert.ok((st.diasRestantes ?? 0) > 0 && (st.diasRestantes ?? 0) <= 15)
    assert.ok((await modulosComDireito()).has(UM_MODULO), 'em carência o módulo ainda abre')
  })

  test('passada a carência, o acesso cai', async () => {
    await concederPacote({
      pacote: PACOTE, expiraEm: new Date(Date.now() - 20 * 864e5), // 20 dias > 15
      referencia: MARCA, concedidoPor: QUEM,
    })
    const st = await estadoDoPacote(PACOTE)
    assert.equal(st.estado, 'sem_direito')
  })

  test('o dono estica a carência e o acesso volta', async () => {
    await estenderCarencia({ dias: 30, motivo: 'cliente avisou que paga na sexta', feitoPor: QUEM })
    assert.equal(await carenciaDias(), 30)
    const st = await estadoDoPacote(PACOTE)
    assert.equal(st.estado, 'em_carencia', 'com 30 dias de carência, vencido há 20 volta a valer')
    const ev = await prisma.assinaturaEvento.findFirst({ where: { tipo: 'carencia_estendida', feitoPor: QUEM } })
    assert.ok(ev, 'esticar prazo sem registro é favor invisível')
    await estenderCarencia({ dias: 15, feitoPor: QUEM })
  })
})

describe('baixa manual — dinheiro que entra por fora', { skip: trava }, () => {
  test('empurra o vencimento e registra competência, valor e meio', async () => {
    await concederPacote({
      pacote: PACOTE, expiraEm: new Date(Date.now() + 5 * 864e5),
      referencia: MARCA, concedidoPor: QUEM,
    })
    const r = await marcarComoPago({
      pacote: PACOTE, competencia: '2026-09', valorCentavos: 49900,
      meio: 'pix', observacao: 'PIX recebido', feitoPor: QUEM,
    })
    assert.ok(r.vencimentoNovo > (r.vencimentoAnterior ?? new Date(0)),
      'a data precisa andar para frente')

    const ev = await prisma.assinaturaEvento.findFirst({
      where: { tipo: 'pago_manual', feitoPor: QUEM }, orderBy: { id: 'desc' },
    })
    assert.ok(ev)
    assert.equal(ev!.competencia, '2026-09', '"setembro foi pago?" precisa ter resposta no banco')
    assert.equal(ev!.valorCentavos, 49900)
    assert.equal(ev!.meio, 'pix')
  })

  test('conta a partir do vencimento que valia, não de hoje', async () => {
    // Dar baixa com atraso não pode custar dias ao cliente — nem presenteá-lo
    // com um mês inteiro a mais.
    const daquiA10 = new Date(Date.now() + 10 * 864e5)
    await concederPacote({ pacote: PACOTE, expiraEm: daquiA10, referencia: MARCA, concedidoPor: QUEM })
    const r = await marcarComoPago({ pacote: PACOTE, competencia: '2026-10', feitoPor: QUEM })
    const esperado = new Date(daquiA10); esperado.setMonth(esperado.getMonth() + 1)
    const difDias = Math.abs(r.vencimentoNovo.getTime() - esperado.getTime()) / 864e5
    assert.ok(difDias < 1, 'o mês novo soma ao vencimento anterior, não à data de hoje')
  })

  test('competência mal formada é recusada', async () => {
    // Sem isso, "setembro" e "09/2026" entrariam no banco e o relatório de
    // caixa viraria adivinhação.
    await assert.rejects(
      () => marcarComoPago({ pacote: PACOTE, competencia: 'setembro', feitoPor: QUEM }),
      /AAAA-MM/,
    )
  })

  test('carência absurda é recusada', async () => {
    await assert.rejects(() => estenderCarencia({ dias: -5, feitoPor: QUEM }), /entre 0 e 365/)
    await assert.rejects(() => estenderCarencia({ dias: 9999, feitoPor: QUEM }), /entre 0 e 365/)
  })
})
