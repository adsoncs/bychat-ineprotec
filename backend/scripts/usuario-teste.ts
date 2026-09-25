// Cria (ou remove) um usuário temporário só para testar telas do painel na demo.
// A senha do CREDENCIAIS.txt está desatualizada e trocar a senha do dono seria
// invasivo — este usuário é descartável.
//   npx tsx --env-file=.env scripts/usuario-teste.ts criar
//   npx tsx --env-file=.env scripts/usuario-teste.ts remover
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma.js'

const EMAIL = 'teste.tela@local.invalid'
const SENHA = 'TesteTela2026'
const acao = process.argv[2] ?? 'criar'

if (acao === 'remover') {
  const r = await prisma.user.deleteMany({ where: { email: EMAIL } })
  console.log(`usuário de teste removido: ${r.count}`)
  process.exit(0)
}

const existente = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } })
if (existente) {
  await prisma.user.update({ where: { id: existente.id }, data: { passwordHash: await bcrypt.hash(SENHA, 10), active: true } })
  console.log(`usuário de teste já existia (id ${existente.id}) — senha redefinida`)
} else {
  const u = await prisma.user.create({
    data: {
      email: EMAIL, name: 'Teste de tela (temporário)',
      passwordHash: await bcrypt.hash(SENHA, 10),
      role: 'SUPERADMIN', active: true,
    },
    select: { id: true },
  })
  console.log(`usuário de teste criado (id ${u.id})`)
}
console.log(JSON.stringify({ email: EMAIL, senha: SENHA }))
process.exit(0)
