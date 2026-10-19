// tests/status-integracoes.test.ts
//
// Barra de status das integrações (services/statusIntegracoes.ts e
// routes/statusIntegracoes.ts).
//
// O que não pode regredir:
//   - a recusa que deixou terram/ineprotec sem IA três semanas ("usage limits")
//     tem de ser reconhecida — na barra e no alerta do sino;
//   - item não configurado ou desligado não aparece na barra;
//   - quem só vê a barra não recebe detalhe técnico nem botão de resolver.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { motivoDaRecusaIa, SENSORES, type Instantaneo, type ConfigBarra } from '../src/services/statusIntegracoes.js'
import { classifyLlmFailure } from '../src/services/aiProviderHealth.js'
import { paraABarra } from '../src/routes/statusIntegracoes.js'
import { MODULE_REGISTRY } from '../src/lib/moduleRegistry.js'

const LIMITE = 'HTTP 400: {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."}}'

test('limite de gasto da Anthropic é recusa definitiva (barra e sino)', () => {
  assert.deepEqual(motivoDaRecusaIa(LIMITE), { motivo: 'limite de gasto atingido', definitiva: true })
  assert.equal(classifyLlmFailure(new Error(LIMITE)), 'credential')
})

test('OpenAI sem crédito e chave inválida são definitivas; sobrecarga não', () => {
  assert.equal(motivoDaRecusaIa('HTTP 429: You have no credits remaining').motivo, 'sem crédito')
  assert.equal(motivoDaRecusaIa('HTTP 429: insufficient_quota').definitiva, true)
  assert.equal(motivoDaRecusaIa('HTTP 401: invalid x-api-key').motivo, 'chave inválida')
  assert.equal(motivoDaRecusaIa('HTTP 529: Overloaded').definitiva, false)
  assert.equal(motivoDaRecusaIa('fetch failed').motivo, 'instável')
})

const snap: Instantaneo = {
  verificadoEm: '2026-10-19T15:00:00.000Z',
  itens: [
    { id: 'ia', rotulo: 'IA', acao: { rotulo: 'Abrir', href: '/app/integrations/ai' }, configurado: true, mostrar: true, avisoFixo: true,
      leitura: { estado: 'atencao', motivo: 'reserva (OpenAI): sem crédito', detalhe: 'HTTP 429', desde: '2026-10-19T14:00:00.000Z' } },
    { id: 'google', rotulo: 'Google', acao: { rotulo: 'Reconectar', href: '/app/google' }, configurado: true, mostrar: true, avisoFixo: true,
      leitura: { estado: 'fora', motivo: 'conexão expirou', detalhe: 'invalid_grant', desde: '2026-10-19T07:09:00.000Z' } },
    { id: 'sms', rotulo: 'SMS', acao: { rotulo: 'Abrir', href: '/app/integrations/sms' }, configurado: false, mostrar: true, avisoFixo: true, leitura: null },
    { id: 'email', rotulo: 'E-mail', acao: { rotulo: 'Abrir', href: '/app/integrations/email' }, configurado: true, mostrar: false, avisoFixo: true, leitura: null },
  ],
}
const config: ConfigBarra = { ativo: true, faixaPara: 'todos', itens: {} }

test('só aparece o que está configurado e ligado', () => {
  const r = paraABarra(snap, config, true)
  assert.deepEqual(r.itens.map((i) => i.id), ['ia', 'google'])
})

test('quem só vê não recebe detalhe técnico nem botão de resolver', () => {
  const agente = paraABarra(snap, config, false)
  assert.equal(agente.podeConfigurar, false)
  for (const i of agente.itens) {
    assert.equal(i.detalhe, null)
    assert.equal(i.acao, null)
  }
  assert.equal(agente.itens[1]!.motivo, 'conexão expirou')
  const gestao = paraABarra(snap, config, true)
  assert.equal(gestao.itens[1]!.detalhe, 'invalid_grant')
  assert.equal(gestao.itens[1]!.acao?.href, '/app/google')
})

test('faixa só para a gestão quando configurado assim; barra desligada = vazia', () => {
  assert.equal(paraABarra(snap, { ...config, faixaPara: 'gestao' }, false).faixa, false)
  assert.equal(paraABarra(snap, { ...config, faixaPara: 'gestao' }, true).faixa, true)
  assert.deepEqual(paraABarra(snap, { ...config, ativo: false }, true).itens, [])
})

test('módulo registrado como core com ver/editar', () => {
  const m = MODULE_REGISTRY.find((x) => x.id === 'status_integracoes')
  assert.ok(m)
  assert.equal(m!.core, true)
  assert.deepEqual(m!.actions, ['view', 'edit'])
  assert.ok(m!.routePrefixes.includes('/api/status-integracoes'))
})

test('cada sensor tem id único e botão para uma tela do sistema', () => {
  const ids = SENSORES.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const s of SENSORES) assert.match(s.acao.href, /^\/app\//)
})
