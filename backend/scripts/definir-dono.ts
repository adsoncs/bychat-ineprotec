// scripts/definir-dono.ts
//
// Define o dono do produto nesta instalação — o único caminho que existe.
//
// O dono é um nível acima do SUPERADMIN, que é do cliente. Ele alcança o que o
// cliente não pode alcançar de jeito nenhum: a loja de apps e os direitos de
// uso. Se o superadmin chegasse lá, se daria os módulos que não pagou.
//
// Por que um comando, e não uma tela: qualquer tela que conceda "dono" é uma
// tela que alguém pode alcançar. Aqui a capacidade não existe na aplicação —
// nenhuma rota lê ou escreve `isOwner`. Para virar dono é preciso ter acesso ao
// servidor, e quem tem acesso ao servidor já podia tudo de qualquer forma.
//
// O dono continua sendo SUPERADMIN: há 47 comparações estritas com esse papel
// no código, e nenhuma hierarquia. Tirar o papel dele o deixaria de fora de
// metade do sistema.
//
//   npx tsx scripts/definir-dono.ts                          (lista quem é dono)
//   npx tsx scripts/definir-dono.ts --email=a@b.com          (confere, sem gravar)
//   npx tsx scripts/definir-dono.ts --email=a@b.com --aplicar
//   npx tsx scripts/definir-dono.ts --email=a@b.com --remover --aplicar
//
// Para criar o usuário junto, quando ele ainda não existe:
//   npx tsx scripts/definir-dono.ts --email=a@b.com --nome="Dono" --senha=... --aplicar

import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma.js'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const tem = (n: string): boolean => process.argv.includes(`--${n}`)

const email = arg('email')?.trim().toLowerCase()
const nome = arg('nome')
const senha = arg('senha')
const aplicar = tem('aplicar')
const remover = tem('remover')

const donos = await prisma.user.findMany({
  where: { isOwner: true },
  select: { id: true, email: true, name: true, active: true },
  orderBy: { id: 'asc' },
})

console.log(`\n═══ DONO DO PRODUTO ═══\n`)
if (donos.length === 0) {
  console.log('  Nenhum dono definido nesta instalação.')
} else {
  for (const d of donos) {
    console.log(`  #${d.id} ${d.email}${d.name ? `  (${d.name})` : ''}${d.active ? '' : '  [INATIVO]'}`)
  }
}

if (!email) {
  console.log('\n  Passe --email=... para definir ou remover.\n')
  await prisma.$disconnect()
  process.exit(0)
}

let user = await prisma.user.findUnique({ where: { email } })

if (!user) {
  if (remover) {
    console.log(`\n  ✗ ${email} não existe — nada a remover.\n`)
    await prisma.$disconnect()
    process.exit(1)
  }
  if (!senha || !nome) {
    console.log(`\n  ✗ ${email} não existe. Para criar junto, passe --nome="..." e --senha=...\n`)
    await prisma.$disconnect()
    process.exit(1)
  }
  // Senha fraca num usuário que alcança a loja é o pior lugar para economizar.
  if (senha.length < 12) {
    console.log('\n  ✗ Senha curta demais (mínimo 12 caracteres) para a conta de dono.\n')
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log(`\n  criar usuário ${email} como SUPERADMIN + dono`)
  if (aplicar) {
    user = await prisma.user.create({
      data: {
        email, name: nome, passwordHash: await bcrypt.hash(senha, 12),
        role: 'SUPERADMIN', active: true, isOwner: true,
      },
    })
    console.log(`  ✔ criado: #${user.id}`)
  }
} else if (remover) {
  console.log(`\n  remover dono de ${email} (#${user.id}) — o papel SUPERADMIN permanece`)
  if (aplicar) {
    await prisma.user.update({ where: { id: user.id }, data: { isOwner: false } })
    console.log('  ✔ removido')
  }
} else {
  const virarSuper = user.role !== 'SUPERADMIN'
  console.log(`\n  marcar ${email} (#${user.id}) como dono`
    + (virarSuper ? `  · também promove ${user.role} → SUPERADMIN` : ''))
  if (!user.active) console.log('  ⚠ o usuário está INATIVO: marque como dono, mas reative pela tela.')
  if (aplicar) {
    await prisma.user.update({
      where: { id: user.id },
      // O papel vai junto: sem SUPERADMIN ele falharia nas 47 comparações
      // estritas do código e ficaria de fora de metade do sistema.
      data: { isOwner: true, ...(virarSuper ? { role: 'SUPERADMIN' as const } : {}) },
    })
    console.log('  ✔ marcado')
  }
}

console.log(aplicar ? '\nGravado.\n' : '\nNada foi gravado. Rode com --aplicar.\n')
await prisma.$disconnect()
