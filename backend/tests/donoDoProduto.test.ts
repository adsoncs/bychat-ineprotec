// tests/donoDoProduto.test.ts
//
// O dono do produto — um nível acima do SUPERADMIN, que é do cliente.
//
// A loja de apps não pode ser configurável por quem compra: se o superadmin
// alcança os direitos de uso, ele se dá os módulos que não pagou. O dono existe
// para essa separação.
//
// A solução óbvia — um papel novo no enum — era armadilha: existem 47
// comparações estritas `role === 'SUPERADMIN'` no código e nenhuma hierarquia,
// então um valor novo daria ao dono MENOS acesso que ao superadmin. Por isso é
// um ATRIBUTO de um superadmin, e o teste abaixo guarda justamente isso.
//
// ⚠️ TOCA O BANCO REAL. Cria usuários com prefixo `test:` e apaga no fim.
//
//   cd backend && npx tsx --test tests/donoDoProduto.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { ehDono } from '../src/lib/dono.js'

const carimbo = String(Date.now()).slice(-8)
const emailDono = `test.dono.${carimbo}@local.invalid`
const emailSuper = `test.super.${carimbo}@local.invalid`
let idDono = 0, idSuper = 0

before(async () => {
  const d = await prisma.user.create({
    data: { email: emailDono, name: 'test:Dono', passwordHash: 'x', role: 'SUPERADMIN', active: true, isOwner: true },
  })
  idDono = d.id
  const s = await prisma.user.create({
    data: { email: emailSuper, name: 'test:Super', passwordHash: 'x', role: 'SUPERADMIN', active: true },
  })
  idSuper = s.id
})

after(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [emailDono, emailSuper] } } }).catch(() => {})
  await prisma.$disconnect()
})

describe('quem é dono', () => {
  test('o dono é reconhecido', async () => {
    assert.equal(await ehDono(idDono), true)
  })

  test('um SUPERADMIN comum NÃO é dono', async () => {
    // É o ponto inteiro: o topo da hierarquia do cliente não alcança a loja.
    assert.equal(await ehDono(idSuper), false)
  })

  test('usuário inexistente ou sem sessão não é dono', async () => {
    assert.equal(await ehDono(999_999_999), false)
    assert.equal(await ehDono(null), false)
    assert.equal(await ehDono(undefined), false)
  })

  test('dono desativado deixa de valer na hora', async () => {
    // O JWT vive horas. Se a checagem confiasse nele, tirar o acesso de alguém
    // só valeria no próximo login — tempo demais para uma conta que alcança a
    // loja. Por isso `ehDono` lê do banco a cada pedido.
    await prisma.user.update({ where: { id: idDono }, data: { active: false } })
    assert.equal(await ehDono(idDono), false, 'dono inativo não pode continuar passando')
    await prisma.user.update({ where: { id: idDono }, data: { active: true } })
    assert.equal(await ehDono(idDono), true)
  })
})

describe('o dono continua sendo superadmin', () => {
  test('o papel não foi trocado', async () => {
    // Se o dono tivesse um papel próprio, falharia nas 47 comparações estritas
    // com 'SUPERADMIN' espalhadas pelo código — e ficaria de fora de metade do
    // sistema. Ele é superadmin E dono, não uma coisa no lugar da outra.
    const u = await prisma.user.findUnique({ where: { id: idDono }, select: { role: true, isOwner: true } })
    assert.equal(u?.role, 'SUPERADMIN')
    assert.equal(u?.isOwner, true)
  })
})

describe('a API não escreve isOwner', () => {
  test('a rota de usuários aceita uma lista fechada de campos', async () => {
    // A proteção não é uma checagem que alguém pode esquecer: o handler
    // desestrutura os campos aceitos um a um, então `isOwner` não entra nem
    // por acidente nem por payload malicioso.
    const { readFileSync } = await import('fs')
    const fonte = readFileSync(new URL('../src/routes/users.ts', import.meta.url), 'utf8')
    const aceitos = fonte.match(/const \{ email, name, role, active, password[^}]*\} = req\.body/)
    assert.ok(aceitos, 'o handler mudou de forma — reconfira se isOwner continua fora dos campos aceitos')
    assert.ok(!aceitos[0].includes('isOwner'),
      'isOwner virou campo aceito pela API: qualquer admin poderia se tornar dono')
  })

  test('nenhuma rota escreve isOwner', async () => {
    const { readdirSync, readFileSync } = await import('fs')
    const { join } = await import('path')
    const dir = new URL('../src/routes/', import.meta.url).pathname
    const culpados: string[] = []
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue
      const txt = readFileSync(join(dir, f), 'utf8')
      // Escrita seria `isOwner:` dentro de um data/update. Leitura (`.isOwner`,
      // `isOwner === true`) é legítima e não conta.
      if (/isOwner\s*:/.test(txt)) culpados.push(f)
    }
    assert.deepEqual(culpados, [],
      'rota escrevendo isOwner: quem define dono é scripts/definir-dono.ts, no servidor')
  })
})
