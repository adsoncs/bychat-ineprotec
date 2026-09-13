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
  decidirEstado,
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

describe('carência — a regra, sem depender do banco', () => {
  // Testada pela função pura porque em instalação real TODO pacote tem direito
  // perpétuo da migração 0157, e com ele nada entra em carência. Provar a regra
  // pelo banco exigiria apagar direito de cliente. Aqui simula-se o cliente
  // novo, que terá só a compra — que é para quem a carência existe.
  const dia = 864e5
  const agora = Date.parse('2026-09-15T12:00:00Z')
  const emDias = (n: number) => new Date(agora + n * dia)

  test('sem direito nenhum é sem direito', () => {
    assert.equal(decidirEstado([], 15, agora).estado, 'sem_direito')
  })

  test('direito sem prazo não expira', () => {
    assert.equal(decidirEstado([null], 15, agora).estado, 'sem_prazo')
    assert.equal(decidirEstado([null, emDias(-999)], 15, agora).estado, 'sem_prazo',
      'um perpétuo ao lado de um vencido ainda mantém o acesso')
  })

  test('vencimento no futuro é vigente, com os dias certos', () => {
    const r = decidirEstado([emDias(10)], 15, agora)
    assert.equal(r.estado, 'vigente')
    assert.equal(r.diasRestantes, 10)
  })

  test('vencido ontem continua funcionando, na carência', () => {
    // O ponto inteiro da carência: cortar no dia do vencimento transforma um
    // boleto atrasado em cliente sem sistema.
    const r = decidirEstado([emDias(-1)], 15, agora)
    assert.equal(r.estado, 'em_carencia')
    assert.equal(r.diasRestantes, 14, 'restam 14 dos 15')
  })

  test('no último dia da carência ainda funciona', () => {
    const r = decidirEstado([emDias(-14.9)], 15, agora)
    assert.equal(r.estado, 'em_carencia')
  })

  test('passada a carência, o acesso cai', () => {
    assert.equal(decidirEstado([emDias(-16)], 15, agora).estado, 'sem_direito')
  })

  test('carência zero corta no vencimento', () => {
    // Configuração válida: quem não quer carência põe 0 e o corte é seco.
    assert.equal(decidirEstado([emDias(-0.1)], 0, agora).estado, 'sem_direito')
  })

  test('entre vários vencimentos, o que dura mais é o que manda', () => {
    const r = decidirEstado([emDias(-30), emDias(5), emDias(-2)], 15, agora)
    assert.equal(r.estado, 'vigente')
    assert.equal(r.diasRestantes, 5)
  })
})

describe('carência — a instalação real', { skip: trava }, () => {
  test('a configuração em vigor é a que a regra recebe', async () => {
    // A ponte entre a regra pura e o banco: se `estadoDoPacote` parasse de
    // passar a carência configurada, os testes acima continuariam verdes.
    await estenderCarencia({ dias: 40, feitoPor: QUEM })
    assert.equal(await carenciaDias(), 40)
    await estenderCarencia({ dias: 15, feitoPor: QUEM })
    assert.equal(await carenciaDias(), 15)
  })

  test('com direito perpétuo, o pacote não expira', async () => {
    // É o estado de quem já era cliente antes da loja — e a razão de a tela
    // dizer "Liberado" em vez de "Sem direito".
    const st = await estadoDoPacote(PACOTE)
    assert.ok(['sem_prazo', 'vigente'].includes(st.estado),
      `instalação com direito de migração não pode aparecer como ${st.estado}`)
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

describe('a loja fica FORA das configurações do sistema', { skip: trava }, () => {
  // Regra do produto: o superadmin do cliente não pode alcançar nada da loja.
  // A 0159 falhou nisso — gravou a carência como Setting, e `GET
  // /api/admin/settings` devolve todas as chaves enquanto o `PUT` faz upsert de
  // qualquer uma. Dava para gravar 3650 e ganhar dez anos de graça. Lista negra
  // por prefixo não resolveria: mais de doze rotas escrevem Setting.

  test('nenhuma configuração da loja sobrou em Setting', async () => {
    const vazadas = await prisma.setting.findMany({
      where: { OR: [{ key: { startsWith: 'loja.' } }, { grp: 'loja' }] },
    })
    assert.deepEqual(vazadas.map((s) => s.key), [],
      'configuração da loja visível e editável na tela de configurações')
  })

  test('a carência vive na tabela própria', async () => {
    const row = await prisma.lojaConfig.findUnique({ where: { chave: 'carencia_dias' } })
    assert.ok(row, 'sem linha, a carência cai no default e o ajuste do dono some')
    assert.equal(Number(row!.valor), await carenciaDias())
  })

  test('esticar a carência não recria a chave em Setting', async () => {
    await estenderCarencia({ dias: 20, feitoPor: QUEM })
    const vazou = await prisma.setting.count({ where: { key: { startsWith: 'loja.' } } })
    assert.equal(vazou, 0, 'a escrita do dono não pode reabrir a porta')
    assert.equal(await carenciaDias(), 20)
    await estenderCarencia({ dias: 15, feitoPor: QUEM })
  })
})
