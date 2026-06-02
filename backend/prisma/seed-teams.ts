// prisma/seed-teams.ts
// Seed inicial de equipes (setores) para atendimento humano.
// Cria 3 setores default e vincula todos os SUPERADMINs como líderes.
// Idempotente: pode ser executado múltiplas vezes sem duplicar.
//
// Executar: npx tsx prisma/seed-teams.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DEFAULT_TEAMS = [
  { slug: 'comercial',  name: 'Comercial',  color: '#10B981', icon: 'briefcase',     description: 'Vendas, propostas e fechamento de negócios', position: 0 },
  { slug: 'financeiro', name: 'Financeiro', color: '#F59E0B', icon: 'currency-dollar', description: 'Cobranças, pagamentos e questões financeiras', position: 1 },
  { slug: 'suporte',    name: 'Suporte',    color: '#3B82F6', icon: 'lifebuoy',      description: 'Atendimento técnico e dúvidas pós-venda', position: 2 },
]

async function main() {
  console.log('🌱 Seed: equipes default...')

  for (const team of DEFAULT_TEAMS) {
    const existing = await prisma.team.findUnique({ where: { slug: team.slug } })
    if (existing) {
      console.log(`  ✓ ${team.slug} já existe (id=${existing.id})`)
      continue
    }
    const created = await prisma.team.create({ data: team })
    console.log(`  + criado: ${team.slug} (id=${created.id})`)
  }

  // Vincular todos SUPERADMINs como líderes de todas as equipes (acesso pleno).
  const superadmins = await prisma.user.findMany({ where: { role: 'SUPERADMIN' }, select: { id: true, email: true } })
  const allTeams = await prisma.team.findMany({ select: { id: true, slug: true } })

  for (const sa of superadmins) {
    for (const team of allTeams) {
      const exists = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: team.id, userId: sa.id } },
      })
      if (exists) continue
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: sa.id, isLeader: true },
      })
      console.log(`  + ${sa.email} vinculado como líder de ${team.slug}`)
    }
  }

  console.log('✅ Seed de equipes concluído.')
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
