// tests/comissao-competencia.test.ts
//
// Mês da comissão e da meta no horário de Brasília (Fase 0 da integração
// Negociações × Educacional, 22/10/2026). Antes o mês era o do UTC: a venda
// fechada depois das 21h do último dia caía no mês seguinte.
//
// NÃO toca o banco: só as funções puras de services/commissions.
//
//   cd backend && node --import tsx --test tests/comissao-competencia.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { competenciaOf, monthRange, janelaDeFechamento, parseCompetencia } from '../src/services/commissions.js'

const mes = (d: Date) => competenciaOf(d).toISOString().slice(0, 7)

describe('competenciaOf — horário de Brasília', () => {
  test('31/10 às 22h em Brasília (01:00 UTC de 01/11) ainda é outubro', () => {
    assert.equal(mes(new Date('2026-11-01T01:00:00Z')), '2026-10')
  })
  test('31/10 às 23:59:59 em Brasília é outubro', () => {
    assert.equal(mes(new Date('2026-11-01T02:59:59Z')), '2026-10')
  })
  test('01/11 à 00:00 em Brasília (03:00 UTC) já é novembro', () => {
    assert.equal(mes(new Date('2026-11-01T03:00:00Z')), '2026-11')
  })
  test('virada de ano: 31/12 às 23h em Brasília é dezembro', () => {
    assert.equal(mes(new Date('2027-01-01T02:00:00Z')), '2026-12')
  })
  test('a competência continua sendo o rótulo "dia 1, 00:00 UTC"', () => {
    assert.equal(competenciaOf(new Date('2026-10-15T12:00:00Z')).toISOString(), '2026-10-01T00:00:00.000Z')
  })
})

describe('janelaDeFechamento — instantes do mês em Brasília', () => {
  const { start, end } = monthRange(parseCompetencia('2026-10')!)
  const j = janelaDeFechamento(start, end)
  test('começa 01/10 00:00 em Brasília (03:00 UTC)', () => assert.equal(j.gte.toISOString(), '2026-10-01T03:00:00.000Z'))
  test('termina 31/10 23:59:59.999 em Brasília (02:59:59.999 UTC de 01/11)', () => assert.equal(j.lte.toISOString(), '2026-11-01T02:59:59.999Z'))
  test('a janela e a competência concordam nas bordas', () => {
    assert.equal(mes(j.gte), '2026-10')
    assert.equal(mes(j.lte), '2026-10')
    assert.equal(mes(new Date(j.lte.getTime() + 1)), '2026-11')
  })
})
