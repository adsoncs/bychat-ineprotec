// tests/dono-do-lead.test.ts
//
// Lead com responsável não muda de mão sozinho (lib/donoDoLead.ts).
//
// O defeito que motivou (fabad, 20/10): a Jornada IA reencaminhou um lead, tirou
// a responsável e ele ficou sem ninguém. Regra do cliente: só a própria pessoa
// (ou um admin) tira o lead dela. Sem banco — só a decisão e o contexto.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { podeTrocarDono, comoAtor, rotaManualDeDono, atorDaTroca } from '../src/lib/donoDoLead.js'

test('lead sem dono recebe dono de qualquer caminho', () => {
  assert.equal(podeTrocarDono(null, 7), true)
})

test('gravação automática não troca nem apaga o dono', () => {
  assert.equal(podeTrocarDono(5, 7), false)
  assert.equal(podeTrocarDono(5, null), false)
  assert.equal(podeTrocarDono(5, 5), true)
})

test('o próprio dono e o admin trocam; outro agente não', async () => {
  assert.equal(await comoAtor({ userId: 5, role: 'AGENT' }, async () => podeTrocarDono(5, 7)), true)
  assert.equal(await comoAtor({ userId: 9, role: 'ADMIN' }, async () => podeTrocarDono(5, 7)), true)
  assert.equal(await comoAtor({ userId: 8, role: 'AGENT' }, async () => podeTrocarDono(5, 7)), false)
  // Fora do contexto, volta a ser automático.
  assert.equal(podeTrocarDono(5, 7), false)
})

test('o preHandler leva quem age até o handler, e só nas rotas marcadas', async () => {
  const app = Fastify()
  const auth = async (req: any) => { req.user = { userId: 5, role: 'AGENT' } }
  app.post('/manual', { preHandler: [auth, rotaManualDeDono] }, async () => {
    await new Promise((r) => setTimeout(r, 5))
    return { ator: atorDaTroca() }
  })
  app.post('/outra', { preHandler: auth }, async () => ({ ator: atorDaTroca() }))
  assert.deepEqual((await app.inject({ method: 'POST', url: '/manual' })).json().ator, { userId: 5, admin: false })
  assert.equal((await app.inject({ method: 'POST', url: '/outra' })).json().ator, null)
  await app.close()
})
