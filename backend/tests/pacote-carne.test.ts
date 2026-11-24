// tests/pacote-carne.test.ts
//
// Pacote (combo) = UM carnê, na inscrição principal (24/11/2026). Caso real:
// Samara (ineprotec, GEM5 + T3T3) ficou com carnê nos dois cursos e a principal
// só cobrava o curso dela; o certo é o do Weslley (12x R$ 274,80 numa só).
// Só a função pura: não toca banco nem gateway.
//
//   cd backend && node --import tsx --test tests/pacote-carne.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { carneDaPrincipal } from '../src/services/pacoteMatricula.js'

describe('carnê da principal no pacote', () => {
  test('boleto parcelado passa a cobrar o total, com pontualidade proporcional', () => {
    const r = carneDaPrincipal({ meio: 'boleto', parcelas: 12, valorParcela: 144.9, valorTotal: 1738.8, descontoPontualidade: 29 }, 329760)!
    assert.equal(r.novo.valorParcela, 274.8)
    assert.equal(r.novo.valorTotal, 3297.6)
    assert.equal(r.novo.descontoPontualidade, 55)
    assert.equal(r.antes.valorParcela, 144.9)
  })
  test('já no total: nada a recalcular', () => {
    assert.equal(carneDaPrincipal({ meio: 'boleto', parcelas: 12, valorParcela: 274.8, valorTotal: 3297.6 }, 329760), null)
  })
  test('combinado, parcelamento no gateway, à vista e sem plano: não mexe', () => {
    assert.equal(carneDaPrincipal({ meio: 'combinado', parcelas: 11, combinado: true }, 329760), null)
    assert.equal(carneDaPrincipal({ meio: 'boleto', parcelas: 12, installmentId: 'ins_1', valorParcela: 100 }, 329760), null)
    assert.equal(carneDaPrincipal({ meio: 'pix', parcelas: 1 }, 329760), null)
    assert.equal(carneDaPrincipal({}, 329760), null)
  })
})
