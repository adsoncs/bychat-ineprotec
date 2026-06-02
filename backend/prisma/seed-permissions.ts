// prisma/seed-permissions.ts
// Seed das permissões default por role — replica comportamento atual do sistema
// Executar: npx tsx prisma/seed-permissions.ts

import { PrismaClient } from '@prisma/client'
import { MODULE_REGISTRY } from '../src/lib/moduleRegistry.js'

const prisma = new PrismaClient()

// Single source of truth: usa o registry oficial de módulos do backend em vez
// de manter uma lista duplicada que vira stale a cada novo módulo
// (sales_engagement, enrollment_portals, tools etc.).
const ALL_MODULES = MODULE_REGISTRY.map(m => m.id)

// Módulos "opt-in" — verticais específicas (educacional) ou painéis sensíveis
// (installations). Só SUPERADMIN tem por default. Admins do tenant ativam via
// toggle no painel de módulos.
const OPT_IN_MODULES = ['installations', 'educacional', 'enrollment_portals']

// Permissões default por role:
// SUPERADMIN: tudo (scope=all)
// ADMIN: tudo exceto opt-in (scope=all)
// MANAGER: maioria, sem users/security/apikeys e sem opt-in, sem delete (scope=team)
// AGENT: atendente operacional (scope='own') — vê só seus próprios leads/atividades
// VIEWER: apenas visualização de módulos básicos (scope=team)
type Scope = 'all' | 'team' | 'own'
const ROLE_DEFAULTS: Record<string, { modules: string[]; canCreate: boolean; canEdit: boolean; canDelete: boolean; scope: Scope }> = {
  SUPERADMIN: {
    modules: ALL_MODULES,
    canCreate: true, canEdit: true, canDelete: true, scope: 'all',
  },
  ADMIN: {
    modules: ALL_MODULES.filter(m => !OPT_IN_MODULES.includes(m)),
    canCreate: true, canEdit: true, canDelete: true, scope: 'all',
  },
  MANAGER: {
    modules: ALL_MODULES.filter(m => !OPT_IN_MODULES.includes(m) && !['users', 'security', 'apikeys'].includes(m)),
    canCreate: true, canEdit: true, canDelete: false, scope: 'team',
  },
  AGENT: {
    modules: ['dashboard', 'atendimento', 'leads', 'kanban', 'activities', 'intelligence', 'whatsapp', 'tags', 'tools'],
    canCreate: true, canEdit: true, canDelete: false, scope: 'own',
  },
  VIEWER: {
    modules: ['dashboard', 'leads', 'kanban', 'activities', 'atendimento', 'tools'],
    canCreate: false, canEdit: false, canDelete: false, scope: 'team',
  },
}

// Overrides por (moduleId, role) que sobrepõem o default do role.
// Útil quando um módulo precisa de granularidade diferente.
type Perm = { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }
const MODULE_OVERRIDES: Record<string, Partial<Record<string, Perm>>> = {
  // MANAGER vê todos os setores e gerencia membros nos setores onde é líder
  // (controle granular feito no backend via guard requireTeamLeaderOrAdmin).
  // CRUD de setor em si continua admin-only.
  teams: {
    MANAGER: { canView: true, canCreate: false, canEdit: false, canDelete: false },
  },
}

async function main() {
  let created = 0
  let updated = 0
  let scopeAligned = 0

  for (const [role, config] of Object.entries(ROLE_DEFAULTS)) {
    for (const moduleId of ALL_MODULES) {
      const hasAccess = config.modules.includes(moduleId)

      const override = MODULE_OVERRIDES[moduleId]?.[role]
      const data: Perm = override ?? {
        canView: hasAccess,
        canCreate: hasAccess ? config.canCreate : false,
        canEdit: hasAccess ? config.canEdit : false,
        canDelete: hasAccess ? config.canDelete : false,
      }

      const existing = await prisma.modulePermission.findUnique({
        where: { moduleId_role: { moduleId, role: role as any } }
      })

      if (existing) {
        // CRUD: preserva customizações do admin (só atualiza se houver override explícito).
        if (override) {
          await prisma.modulePermission.update({
            where: { moduleId_role: { moduleId, role: role as any } },
            data,
          })
          updated++
        }
        // Scope: sempre alinha com o default da role. Scope vem só do role
        // (não há override por usuário) — corrigir aqui é seguro e impede que
        // o default antigo da coluna ('team') sobreviva para roles como AGENT.
        if ((existing as any).scope !== config.scope) {
          await prisma.modulePermission.update({
            where: { moduleId_role: { moduleId, role: role as any } },
            data: { scope: config.scope as any },
          })
          scopeAligned++
        }
        continue
      }

      await prisma.modulePermission.create({
        data: {
          moduleId,
          role: role as any,
          ...data,
          scope: config.scope as any,
        },
      })
      created++
    }
  }

  const roleCount = Object.keys(ROLE_DEFAULTS).length
  console.log(`[Seed] Permissões criadas: ${created}, atualizadas (overrides): ${updated}, scope alinhado: ${scopeAligned}`)
  console.log(`[Seed] Total: ${ALL_MODULES.length} módulos x ${roleCount} roles = ${ALL_MODULES.length * roleCount} registros`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
