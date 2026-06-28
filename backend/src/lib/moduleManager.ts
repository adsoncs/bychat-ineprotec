// src/lib/moduleManager.ts
// Gerenciamento genérico de ativação/desativação de módulos.
// Cada módulo tem um setting `module.<id>.enabled` e permissões sincronizadas em ModulePermission.
// Side effects específicos (ex.: seed do educacional) ficam registrados em SIDE_EFFECTS abaixo.

import { prisma } from './prisma.js'
import { MODULE_REGISTRY, ModuleDefinition, getModuleDependencies } from './moduleRegistry.js'
import { invalidatePermCache, invalidateModulesCache } from './permissions.js'

const SETTING_PREFIX = 'module.'
const SETTING_SUFFIX = '.enabled'

// Permissões padrão por role quando um módulo é ativado.
const DEFAULT_ROLE_PRESETS: Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> = {
  SUPERADMIN: { canView: true,  canCreate: true,  canEdit: true,  canDelete: true  },
  ADMIN:      { canView: true,  canCreate: true,  canEdit: true,  canDelete: true  },
  MANAGER:    { canView: true,  canCreate: true,  canEdit: true,  canDelete: false },
  VIEWER:     { canView: false, canCreate: false, canEdit: false, canDelete: false },
}

// Side effects opcionais ao ligar/desligar um módulo (ex.: seed inicial).
type SideEffect = (enabled: boolean) => Promise<void>
const SIDE_EFFECTS: Record<string, SideEffect> = {}

export function registerModuleSideEffect(moduleId: string, fn: SideEffect) {
  SIDE_EFFECTS[moduleId] = fn
}

function settingKey(moduleId: string): string {
  return `${SETTING_PREFIX}${moduleId}${SETTING_SUFFIX}`
}

export function getModuleDefinition(moduleId: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY.find(m => m.id === moduleId)
}

// Lê o estado de ativação de um módulo. Reforma F6 (2026-05-21): fonte primária
// é bychat_modules.active (introduzido na F1). Setting legado (`module.X.enabled`)
// continua sendo sincronizado em setModuleEnabled para retrocompatibilidade.
export async function isModuleEnabled(moduleId: string): Promise<boolean> {
  const def = getModuleDefinition(moduleId)
  if (!def) return false
  if (def.core) return true
  try {
    const row = await prisma.module.findUnique({ where: { id: moduleId }, select: { active: true } })
    if (row) return row.active
    // Fallback compat: tenant antigo sem migration ainda — usa Setting.
    const s = await prisma.setting.findUnique({ where: { key: settingKey(moduleId) } })
    if (!s) return def.defaultEnabled === true
    const v = s.value as any
    return v === true || v === 'true' || v === '"true"'
  } catch {
    return def.defaultEnabled === true
  }
}

// Sincroniza ModulePermission para um módulo em todas as roles.
// enabled=true → presets padrão; enabled=false → tudo zerado.
async function syncModulePermissions(moduleId: string, enabled: boolean) {
  for (const [role, preset] of Object.entries(DEFAULT_ROLE_PRESETS)) {
    const data = enabled
      ? preset
      : { canView: false, canCreate: false, canEdit: false, canDelete: false }
    await prisma.modulePermission.upsert({
      where: { moduleId_role: { moduleId, role: role as any } },
      create: { moduleId, role: role as any, ...data },
      update: data,
    })
  }
  invalidatePermCache()
}

// Ativa/desativa um módulo: salva o setting, sincroniza permissões e dispara side effects.
// Lança erro se o módulo não existir ou for core (não pode ser desativado).
export async function setModuleEnabled(moduleId: string, enabled: boolean): Promise<void> {
  const def = getModuleDefinition(moduleId)
  if (!def) throw new Error(`Módulo desconhecido: ${moduleId}`)
  if (def.core) throw new Error(`Módulo "${def.name}" é essencial e não pode ser desativado`)

  // Cascata: ligar um módulo liga antes as dependências que estiverem desligadas
  // (ex.: ligar aca_financeiro liga aca_matriculas → aca_estrutura → educacional).
  // A guarda de não-desligar-com-dependentes fica no endpoint /modules/:id/toggle.
  if (enabled) {
    for (const dep of getModuleDependencies(moduleId)) {
      const depDef = getModuleDefinition(dep)
      if (!depDef || depDef.core) continue
      if (!(await isModuleEnabled(dep))) await setModuleEnabled(dep, true)
    }
  }

  // Reforma F6: fonte primária agora é bychat_modules.active. Setting legado
  // continua sendo escrito para retrocompatibilidade (algumas telas/services
  // antigos ainda leem direto do Setting).
  // upsert (não update): módulos adicionados ao MODULE_REGISTRY depois da
  // migration 0065 não têm row em bychat_modules; sem o create o toggle não
  // persistia o active e o módulo nunca aparecia (getActiveModuleIds lê só a tabela).
  await prisma.module.upsert({
    where: { id: moduleId },
    create: {
      id: moduleId,
      name: def.name,
      category: def.category,
      active: enabled,
      isCore: false, // core lança erro acima (def.core já é falsy aqui)
      disabledAt: enabled ? null : new Date(),
    },
    update: {
      active: enabled,
      disabledAt: enabled ? null : new Date(),
    },
  }).catch(() => {
    // se nem assim conseguir (instalação muito antiga), ignora — Setting cuida
  })

  await prisma.setting.upsert({
    where: { key: settingKey(moduleId) },
    create: {
      key: settingKey(moduleId),
      value: enabled,
      label: `Módulo ${def.name} ativo`,
      grp: 'modules',
      fieldType: 'boolean',
    },
    update: { value: enabled },
  })

  // Reforma F6: invalida cache de módulos ativos (resolvePermissions filtra
  // por isso) + cache de permissões. Broadcast notifica clientes.
  const { invalidateModulesCache } = await import('./permissions.js')
  invalidateModulesCache()

  await syncModulePermissions(moduleId, enabled)

  // Notifica clientes conectados pra invalidar ['my-permissions'] na hora.
  try {
    const { broadcastRealtimeEvent } = await import('../routes/realtime.js')
    void broadcastRealtimeEvent({
      type: 'permissions:invalidated',
      payload: { reason: 'module_toggled', moduleId, active: enabled },
    })
  } catch {
    // realtime indisponível → cache reativa em 60s mesmo assim
  }

  const sideEffect = SIDE_EFFECTS[moduleId]
  if (sideEffect) {
    try {
      await sideEffect(enabled)
    } catch (err) {
      console.error(`[moduleManager] side effect failed for ${moduleId}:`, err)
    }
  }
}

// Garante que TODO módulo do MODULE_REGISTRY tenha uma row em bychat_modules.
// Roda no boot (idempotente). Sem isso, módulos adicionados ao registry depois da
// migration 0065 (que populou a tabela com uma lista estática) ficavam invisíveis:
// getActiveModuleIds() lê só bychat_modules, então um módulo sem row nunca entra
// em activeIds e some da sidebar — mesmo "ativado" via Setting legado.
// NÃO altera o `active` de rows existentes (preserva toggles do admin).
export async function ensureModulesSeeded(): Promise<void> {
  try {
    const existing = await prisma.module.findMany({ select: { id: true } })
    const existingIds = new Set(existing.map(m => m.id))
    let created = 0
    for (const def of MODULE_REGISTRY) {
      if (existingIds.has(def.id)) continue
      // Estado inicial: core sempre ativo; senão honra o Setting legado se existir
      // (admin pode ter "ligado" antes do row existir), senão o defaultEnabled.
      let active = def.core === true ? true : def.defaultEnabled === true
      const legacy = await prisma.setting.findUnique({ where: { key: settingKey(def.id) } })
      if (legacy) {
        const v = legacy.value as any
        active = v === true || v === 'true' || v === '"true"'
      }
      await prisma.module.create({
        data: { id: def.id, name: def.name, category: def.category, active, isCore: def.core === true },
      }).catch(() => {})
      // Garante presets de permissão coerentes com o estado recém-semeado
      await syncModulePermissions(def.id, active)
      created++
    }
    if (created > 0) {
      invalidateModulesCache()
      console.log(`[moduleManager] ${created} módulo(s) novo(s) semeado(s) em bychat_modules`)
    }
  } catch (err) {
    console.error('[moduleManager] ensureModulesSeeded falhou:', (err as Error).message)
  }
}

// Lista todos os módulos com seu estado de ativação atual.
export async function listModulesWithStatus(): Promise<Array<ModuleDefinition & { enabled: boolean }>> {
  const result: Array<ModuleDefinition & { enabled: boolean }> = []
  for (const def of MODULE_REGISTRY) {
    const enabled = await isModuleEnabled(def.id)
    result.push({ ...def, enabled })
  }
  return result
}
