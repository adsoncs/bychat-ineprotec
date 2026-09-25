// tests/identidade-unica.test.ts
//
// Fase 2 da consolidação ERP × Portal: a conta que a pessoa criou para se
// inscrever passa a abrir também o painel do aluno.
//
// ⚠️ TOCA O BANCO REAL — não existe banco de teste aqui. Tudo o que a suíte cria
// leva o prefixo `test:` e é apagado no fim, inclusive em caso de falha.
//
//   cd backend && npm run test:identidade

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma.js'
import { login } from '../src/services/acaPortalAuth.js'

const SENHA_NOVA = 'PortalNova2026'
const SENHA_ANTIGA = 'ErpAntiga2026'
// CPFs únicos por execução: a busca por identificador varre todos os alunos e
// devolve o primeiro com os mesmos dígitos, então um CPF fixo colide com o que
// já existe na base e o teste acaba autenticando outra pessoa.
const carimbo = String(Date.now()).slice(-9)
const CPF_A = `10${carimbo}`
const CPF_B = `20${carimbo}`
const CPF_INEXISTENTE = `99${carimbo}`

let leadA = 0, leadB = 0, alunoA = 0, alunoB = 0, contaA = 0

async function criarPessoa(nome: string, cpf: string, opts: { senhaPortal?: string; senhaErp?: string }) {
  const lead = await prisma.lead.create({ data: {
      nome: `test:${nome}`,
      empresa: 'test:identidade',
      email: `test.${nome}.${Date.now()}@local.invalid`,
      whatsapp: `55629${Date.now() % 100000000}`,
      formData: {},
      scores: {},
    } })
  const aluno = await prisma.aluno.create({
    // O nome do aluno vem do lead — Aluno só exige leadId.
    data: {
      leadId: lead.id,
      cpf,
      ra: `test${Date.now() % 1000000}`,
      ativo: true,
      ...(opts.senhaErp ? { portalSenhaHash: await bcrypt.hash(opts.senhaErp, 10) } : {}),
    },
  })
  let contaId = 0
  if (opts.senhaPortal) {
    const c = await prisma.portalAccount.create({
      data: { leadId: lead.id, cpf, senhaHash: await bcrypt.hash(opts.senhaPortal, 10), senhaDefinidaEm: new Date() },
    })
    contaId = c.id
  }
  return { leadId: lead.id, alunoId: aluno.id, contaId }
}

before(async () => {
  // A: só tem conta do portal (o caso novo — candidato que virou aluno).
  const a = await criarPessoa('conta-portal', CPF_A, { senhaPortal: SENHA_NOVA })
  leadA = a.leadId; alunoA = a.alunoId; contaA = a.contaId
  // B: só tem a senha antiga do ERP (o caso legado).
  const b = await criarPessoa('senha-antiga', CPF_B, { senhaErp: SENHA_ANTIGA })
  leadB = b.leadId; alunoB = b.alunoId
})

after(async () => {
  await prisma.portalAccount.deleteMany({ where: { leadId: { in: [leadA, leadB] } } })
  await prisma.aluno.deleteMany({ where: { id: { in: [alunoA, alunoB] } } })
  await prisma.lead.deleteMany({ where: { id: { in: [leadA, leadB] } } })
  await prisma.$disconnect()
})

describe('a conta do portal abre o painel do aluno', () => {
  test('entra com a senha que criou para se inscrever', async () => {
    const r = await login(CPF_A, SENHA_NOVA)
    assert.equal(r.ok, true, r.erro)
    assert.equal(r.alunoId, alunoA)
    assert.ok(r.token, 'precisa devolver o token do painel')
  })

  test('senha errada continua sendo recusada', async () => {
    const r = await login(CPF_A, 'ErradaTotal1')
    assert.equal(r.ok, false)
    assert.match(r.erro ?? '', /incorretos/)
  })

  test('a recusa não revela se a pessoa existe', async () => {
    const inexistente = await login(CPF_INEXISTENTE, 'QualquerCoisa1')
    const existente = await login(CPF_A, 'SenhaErrada1')
    assert.equal(inexistente.erro, existente.erro)
  })
})

describe('quem tinha senha antiga entra e é migrado', () => {
  test('a senha antiga do ERP continua entrando', async () => {
    const r = await login(CPF_B, SENHA_ANTIGA)
    assert.equal(r.ok, true, r.erro)
    assert.equal(r.alunoId, alunoB)
  })

  test('e ganha conta única, sem ter pedido nada', async () => {
    // O login acima já deve ter criado a conta.
    const conta = await prisma.portalAccount.findUnique({ where: { leadId: leadB } })
    assert.ok(conta, 'a conta única deveria ter sido criada no primeiro login')
    assert.ok(conta!.senhaHash, 'com a senha da pessoa')
    assert.ok(await bcrypt.compare(SENHA_ANTIGA, conta!.senhaHash!), 'a mesma senha de antes')
  })

  test('e a partir daí entra pela conta única, com a mesma senha', async () => {
    // Tira a senha antiga: se ainda entrar, veio da conta única.
    await prisma.aluno.update({ where: { id: alunoB }, data: { portalSenhaHash: null } })
    const r = await login(CPF_B, SENHA_ANTIGA)
    assert.equal(r.ok, true, 'sem a senha antiga, a conta única tem de sustentar o login')
    assert.equal(r.alunoId, alunoB)
  })
})

describe('sem senha em lugar nenhum', () => {
  test('orienta a criar em vez de dizer que errou', async () => {
    await prisma.portalAccount.deleteMany({ where: { leadId: leadB } })
    await prisma.aluno.update({ where: { id: alunoB }, data: { portalSenhaHash: null } })
    const r = await login(CPF_B, 'QualquerUma1')
    assert.equal(r.ok, false)
    assert.equal(r.precisaDefinirSenha, true)
  })
})
