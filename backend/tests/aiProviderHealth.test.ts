// tests/aiProviderHealth.test.ts
//
// Separa "a IA está fora" de "deu um tropeço". A distinção decide se o CONTATO
// recebe uma frase de desculpa ou se o bot cala e a gestão é avisada — e errar
// para o lado errado tem custo real: no severiano (03→08/09/2026) a conta ficou
// sem crédito e saíram 66 mensagens "Tive uma instabilidade aqui 😕 Pode repetir
// a sua última mensagem" para famílias reais, nenhuma resposta de verdade.
//
// As mensagens abaixo são as que os provedores realmente devolvem.
//
//   cd backend && npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { classifyLlmFailure } from '../src/services/aiProviderHealth.js'

const anthropicSemCredito = new Error('Anthropic 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011Cer7AgfkFXWGiDCZnvwa7"}')

describe('classifyLlmFailure', () => {
  test('crédito acabado (o caso do severiano) é falha nossa', () => {
    assert.equal(classifyLlmFailure(anthropicSemCredito), 'credential')
  })

  test('cota e cobrança da OpenAI também', () => {
    assert.equal(classifyLlmFailure(new Error('OpenAI 429: {"error":{"code":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}')), 'credential')
  })

  test('credencial inválida ou sem permissão', () => {
    for (const m of [
      'Anthropic 401: {"error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      'OpenAI 401: Incorrect API key provided',
      'Anthropic 403: {"error":{"type":"permission_error"}}',
    ]) assert.equal(classifyLlmFailure(new Error(m)), 'credential', m)
  })

  test('tropeço passageiro NÃO cala o bot — a frase de desculpa ainda vale', () => {
    for (const m of [
      'Anthropic 500: {"error":{"type":"overloaded_error","message":"Overloaded"}}',
      'Anthropic 429: {"error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit"}}',
      'fetch failed',
      'The operation was aborted due to timeout',
      'OpenAI 503: service unavailable',
    ]) assert.equal(classifyLlmFailure(new Error(m)), 'transient', m)
  })

  test('erro sem mensagem não cala o bot', () => {
    assert.equal(classifyLlmFailure(null), 'transient')
    assert.equal(classifyLlmFailure(new Error('')), 'transient')
    assert.equal(classifyLlmFailure({}), 'transient')
  })

  test('a classificação não olha maiúsculas', () => {
    assert.equal(classifyLlmFailure(new Error('YOUR CREDIT BALANCE IS TOO LOW')), 'credential')
  })
})
