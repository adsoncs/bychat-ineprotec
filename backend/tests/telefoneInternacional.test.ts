// tests/telefoneInternacional.test.ts
//
// Guarda o reconhecimento de telefone de OUTRO PAÍS.
//
// O caso de origem é a Marcia, mãe de aluna do severiano (lead 335): número
// +1 (689) 206-4057, da Flórida. Sem DDI declarado são 11 dígitos — o mesmo
// tamanho de um celular brasileiro sem o 55 —, e a normalização o adotava como
// BR: DDD "16", chave `5516892064057`. Em 10/09/2026 o operador tomou onze
// recusas seguidas de "O número 5516892064057 não tem WhatsApp. Confira o
// telefone no cadastro do contato." numa conversa que estava acontecendo.
//
// O que este teste protege, em ordem de importância:
//   1. nenhum telefone brasileiro muda de chave (o acervo dos 12 tenants);
//   2. todo país da tabela sobrevive a uma ida e volta pelo phoneKey;
//   3. LID continua sendo descartado, mesmo agora que 14-15 dígitos podem ser
//      telefone de verdade.
//
//   cd backend && npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  phoneKey,
  toWaNumber,
  isLikelyLid,
  paisDoTelefone,
  ehEstrangeiro,
  formatarTelefone,
  variantesDeDiscagem,
  samePhone,
} from '../src/lib/phone.js'
import { PAISES, separarE164, ehNacionalBr, ehE164Br, DDD_BR } from '../src/lib/countryCodes.js'

// Número nacional sintético do comprimento pedido. Nunca começa em 0 (o E.164
// não admite) e evita o dígito 9 na frente, que é o que faz um bloco de 11
// dígitos parecer celular brasileiro.
function nsnSintetico(tamanho: number): string {
  const base = '234567812345'
  return base.slice(0, tamanho)
}

describe('o caso da Marcia (+1 689 206-4057)', () => {
  test('não vira mais um número de Ribeirão Preto', () => {
    assert.equal(phoneKey('+1 (689) 206-4057'), '16892064057')
    assert.equal(phoneKey('16892064057'), '16892064057')
    assert.equal(phoneKey('001 689 206 4057'), '16892064057')
    assert.notEqual(phoneKey('16892064057'), '5516892064057')
  })

  test('o painel sabe dizer de onde é', () => {
    const p = paisDoTelefone('16892064057')
    assert.ok(p)
    assert.equal(p.ddi, '1')
    assert.equal(p.iso, 'US')
    assert.equal(p.brasileiro, false)
    assert.equal(p.bandeira, '🇺🇸')
    assert.equal(formatarTelefone('16892064057'), '+1 (689) 206-4057')
  })

  test('é discável como está, sem inventar o 55', () => {
    assert.equal(toWaNumber('16892064057'), '16892064057')
  })

  test('não recebe variante brasileira de discagem', () => {
    // Chutar o nono dígito num número americano consultaria número de terceiro.
    assert.deepEqual(variantesDeDiscagem('16892064057'), [])
  })
})

describe('o Brasil continua igual — nenhuma chave do acervo se mexe', () => {
  const casos: Array<[string, string]> = [
    ['44991323882', '5544991323882'],       // celular sem DDI
    ['554491323882', '5544991323882'],      // sem o nono dígito
    ['5544991323882', '5544991323882'],     // já canônico
    ['(18) 99692-9494', '5518996929494'],   // como o operador digita
    ['+55 18 99692-9494', '5518996929494'], // com DDI declarado
    ['551836234401', '5518936234401'],      // fixo (o 9 indevido é de propósito)
    ['018998128130', '5518998128130'],      // zero de discagem
    ['5501899812813 0', '5518998128130'],   // 55 + zero de discagem
    ['555518981233917', '5518981233917'],   // 55 repetido
    ['1188123456', '5511988123456'],        // celular de 8 dígitos, DDD 11
  ]
  for (const [entrada, esperado] of casos) {
    test(`${entrada} → ${esperado}`, () => {
      assert.equal(phoneKey(entrada), esperado)
      assert.equal(ehEstrangeiro(entrada), false)
    })
  }

  test('bloco com DDD inexistente pode ser de fora', () => {
    // "20" não é DDD brasileiro nenhum — não há contato daqui para proteger —,
    // e é o DDI do Egito com o comprimento certo.
    assert.equal(phoneKey('20987654321'), '20987654321')
    assert.equal(paisDoTelefone('20987654321')?.iso, 'EG')
  })

  test('cadastro brasileiro truncado NÃO vira estrangeiro', () => {
    // Casos reais do acervo: números incompletos que casam com algum DDI por
    // coincidência de comprimento. Como começam por DDD brasileiro de verdade,
    // só prova estrutural do outro país os tiraria daqui — e nenhum tem.
    assert.equal(phoneKey('5513301130005'), '5513301130005') // "US" com central 113
    assert.equal(phoneKey('5511689781784'), '5511689781784') // "US" com área 168
    assert.equal(phoneKey('5594648464946'), '5594648464946') // "Sri Lanka" no DDD 94
    assert.equal(ehEstrangeiro('5594648464946'), false)
  })
})

describe('todo país da tabela sobrevive à ida e volta', () => {
  test('com DDI declarado ("+"), o número volta intacto', () => {
    const quebrados: string[] = []
    for (const pais of PAISES) {
      if (pais.ddi === '55') continue
      for (const tam of [pais.nsnMin, pais.nsnMax]) {
        const e164 = pais.ddi + nsnSintetico(tam)
        const saida = phoneKey('+' + e164)
        if (saida !== e164) quebrados.push(`${pais.nome} (+${pais.ddi}): ${e164} → ${saida}`)
      }
    }
    assert.deepEqual(quebrados, [])
  })

  test('sem "+", só colide com o Brasil quando o formato é mesmo o de um celular BR', () => {
    const inesperados: string[] = []
    for (const pais of PAISES) {
      if (pais.ddi === '55') continue
      for (const tam of [pais.nsnMin, pais.nsnMax]) {
        const e164 = pais.ddi + nsnSintetico(tam)
        const saida = phoneKey(e164)
        if (saida === e164) continue
        // Perdas aceitáveis, ambas por decisão de projeto:
        //   · o bloco também é um telefone brasileiro válido;
        //   · tem 10-11 dígitos e começa por DDD brasileiro de verdade — o
        //     terreno disputado, onde só prova estrutural do outro país vale
        //     (hoje, o NANP).
        if (ehNacionalBr(e164) || ehE164Br(e164)) continue
        const disputado = (e164.length === 10 || e164.length === 11) && DDD_BR.has(e164.slice(0, 2))
        if (disputado) continue
        inesperados.push(`${pais.nome} (+${pais.ddi}): ${e164} → ${saida}`)
      }
    }
    assert.deepEqual(inesperados, [])
  })

  test('cada país da tabela é reconhecível pelo separador de DDI', () => {
    const semPais: string[] = []
    for (const pais of PAISES) {
      const sep = separarE164(pais.ddi + nsnSintetico(pais.nsnMin))
      if (!sep || sep.ddi !== pais.ddi) semPais.push(`${pais.nome} (+${pais.ddi})`)
    }
    assert.deepEqual(semPais, [])
  })

  test('a tabela não tem DDI repetido', () => {
    const vistos = new Set<string>()
    const repetidos: string[] = []
    for (const p of PAISES) {
      if (vistos.has(p.ddi)) repetidos.push(p.ddi)
      vistos.add(p.ddi)
    }
    assert.deepEqual(repetidos, [])
  })

  test('a lista de DDDs brasileiros está completa (67 em uso)', () => {
    assert.equal(DDD_BR.size, 67)
  })
})

describe('números reais de fora, do jeito que chegam', () => {
  const casos: Array<[string, string, string]> = [
    ['+351 912 345 678', '351912345678', 'Portugal'],
    ['+1 305 555 0142', '13055550142', 'Estados Unidos/Canadá'],
    ['+1 809 555 0142', '18095550142', 'República Dominicana'],
    ['+44 7700 900123', '447700900123', 'Reino Unido'],
    ['+34 612 345 678', '34612345678', 'Espanha'],
    ['+39 320 123 4567', '393201234567', 'Itália'],
    ['+81 90 1234 5678', '819012345678', 'Japão'],
    ['+61 412 345 678', '61412345678', 'Austrália'],
    ['+27 82 123 4567', '27821234567', 'África do Sul'],
    ['+595 981 123 456', '595981123456', 'Paraguai'],
    ['+598 94 123 456', '59894123456', 'Uruguai'],
    ['+591 71234567', '59171234567', 'Bolívia'],
    ['+57 300 123 4567', '573001234567', 'Colômbia'],
    ['+52 55 1234 5678', '525512345678', 'México'],
    ['+54 9 11 2345 6789', '5491123456789', 'Argentina'],
    ['+56 9 8765 4321', '56987654321', 'Chile'],
    ['+86 138 0013 8000', '8613800138000', 'China'],
    ['+91 98765 43210', '919876543210', 'Índia'],
    ['+972 50 123 4567', '972501234567', 'Israel'],
    ['+298 123456', '298123456', 'Ilhas Faroé'],
  ]
  for (const [digitado, chave, pais] of casos) {
    test(`${digitado} → ${pais}`, () => {
      assert.equal(phoneKey(digitado), chave)
      assert.equal(paisDoTelefone(digitado)?.nome, pais)
      assert.equal(ehEstrangeiro(digitado), true)
      assert.equal(toWaNumber(digitado), chave)
    })
  }

  test('a mesma pessoa escrita de três jeitos é um contato só', () => {
    assert.ok(samePhone('+1 689 206 4057', '001-689-206-4057'))
    assert.ok(samePhone('16892064057', '+1 (689) 206-4057'))
  })
})

describe('ambiguidade que só o "+" resolve', () => {
  test('sem DDI declarado, o Brasil ganha', () => {
    // +51 9 8765 4321 (Peru) é indistinguível de (51) 98765-4321 (Porto Alegre).
    assert.equal(phoneKey('51987654321'), '5551987654321')
    assert.equal(ehEstrangeiro('51987654321'), false)
  })

  test('com DDI declarado, o Peru é o Peru', () => {
    assert.equal(phoneKey('+51 987 654 321'), '51987654321')
    assert.equal(paisDoTelefone('+51 987 654 321')?.iso, 'PE')
  })
})

describe('LID continua não sendo telefone', () => {
  const lids = ['74607944044732', '273228723392569@lid', '199384756293847', '86523456789012345']
  for (const lid of lids) {
    test(`${lid} é descartado`, () => {
      assert.equal(phoneKey(lid), null)
      assert.equal(toWaNumber(lid), null)
      assert.equal(isLikelyLid(lid), true)
    })
  }

  test('telefone comum não é confundido com LID', () => {
    assert.equal(isLikelyLid('5518996929494'), false)
    assert.equal(isLikelyLid('16892064057'), false)
    assert.equal(isLikelyLid('351912345678'), false)
  })

  test('grupo e lixo seguem fora', () => {
    assert.equal(phoneKey('120363123456789012@g.us'), null)
    assert.equal(phoneKey(''), null)
    assert.equal(phoneKey(null), null)
    assert.equal(phoneKey('abc'), null)
    assert.equal(phoneKey('12345'), null)
  })

  test('dois números colados no mesmo campo ainda são separados', () => {
    assert.equal(phoneKey('1898123391718920016015'), '5518981233917')
  })
})
