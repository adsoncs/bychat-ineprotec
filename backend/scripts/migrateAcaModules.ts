// scripts/migrateAcaModules.ts
// Migração: quebra o módulo monolítico `academico` nos 8 sub-módulos aca_*.
// - Semeia as rows novas (active=false por padrão) via ensureModulesSeeded.
// - Se o ERP estava ATIVO antes (módulo academico active) OU já há dados (alunos/
//   matrículas), liga os 8 sub-módulos para não sumir nada de um tenant em uso
//   (setModuleEnabled já liga as dependências em cascata).
// - Remove o módulo monolítico órfão (row + permissões + setting legado).
// Idempotente: rodar quantas vezes quiser.
//   JWT_SECRET=x npx tsx scripts/migrateAcaModules.ts
import { prisma } from '../src/lib/prisma.js'
import { ensureModulesSeeded, setModuleEnabled } from '../src/lib/moduleManager.js'

const NEW_MODULES = [
  'aca_estrutura', 'aca_matriculas', 'aca_financeiro', 'aca_pedagogico',
  'aca_secretaria', 'aca_comunicacao', 'aca_portais', 'aca_relatorios',
]

async function main() {
  await ensureModulesSeeded()

  const old = await prisma.module.findUnique({ where: { id: 'academico' } }).catch(() => null)
  const oldActive = old?.active === true

  const alunos = await (prisma as any).aluno?.count?.().catch(() => 0) ?? 0
  const matriculas = await (prisma as any).acaMatricula?.count?.().catch(() => 0) ?? 0
  const hasData = (alunos || 0) + (matriculas || 0) > 0

  if (oldActive || hasData) {
    for (const id of NEW_MODULES) await setModuleEnabled(id, true)
    console.log(`[migrate-aca] ERP estava ativo (${oldActive}) / dados (${alunos} alunos, ${matriculas} matrículas) → 8 sub-módulos LIGADOS`)
  } else {
    console.log('[migrate-aca] ERP desligado e sem dados → sub-módulos ficam OFF (default). Ative pelo painel de Módulos.')
  }

  // Remove o monolito órfão (não está mais no MODULE_REGISTRY).
  await prisma.modulePermission.deleteMany({ where: { moduleId: 'academico' } }).catch(() => {})
  await prisma.setting.deleteMany({ where: { key: 'module.academico.enabled' } }).catch(() => {})
  await prisma.module.delete({ where: { id: 'academico' } }).catch(() => {})
  console.log('[migrate-aca] módulo monolítico "academico" removido (row + permissões + setting legado)')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
