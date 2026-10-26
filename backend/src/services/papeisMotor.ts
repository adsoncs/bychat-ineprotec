// src/services/papeisMotor.ts
//
// Papéis e Permissões — o motor novo, os papéis-espelho e o modo sombra.
// Plano: /root/planos/papeis-permissoes.md (fases 1 e 2).
//
// • resolverAntigo(role, overrides): a regra de HOJE (lib/permissions.ts ›
//   resolvePermissions), isolada e com todos os módulos considerados ativos,
//   para o espelho guardar o acesso completo — o módulo desligado é filtrado
//   na hora de resolver, como sempre.
// • criarEspelhos(): um papel por role legado + exceção por pessoa (pacote
//   quando a exceção só soma; papel próprio quando ela retira algo). Grava
//   users.papelId, que fica INERTE até a fase 3.
// • resolverNovo(userId): o mesmo formato de ResolvedPerms, mas a partir do
//   papel + pacotes. É o que resolvePermissions passará a usar na fase 3.
// • compararSombra(): para TODO usuário ativo, mapa antigo × novo. Meta: zero.

import { prisma } from '../lib/prisma.js'
import { MODULE_REGISTRY } from '../lib/moduleRegistry.js'
import { EDU_TELAS, permissoesDasTelas } from '../lib/eduTelas.js'
import { resolverRegraAntiga, invalidatePermCache, defaultScopeForRole, getActiveModuleIds, type ResolvedPerms, type PermScope } from '../lib/permissions.js'

type Flags = { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }
type FlagsN = { canView: boolean | null; canCreate: boolean | null; canEdit: boolean | null; canDelete: boolean | null }
const ACOES: Array<[keyof Flags, string]> = [['canView', 'view'], ['canCreate', 'create'], ['canEdit', 'edit'], ['canDelete', 'delete']]
const ROLES = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const
const NOME_ROLE: Record<string, string> = { SUPERADMIN: 'Superadmin', ADMIN: 'Administrador', MANAGER: 'Gestor', AGENT: 'Agente', VIEWER: 'Visualizador' }

/** Recursos com permissão: os módulos do registro e as telas do Educacional. */
function recursos(): Array<{ id: string; actions: string[] }> {
  const m = new Map<string, string[]>()
  for (const mod of MODULE_REGISTRY) m.set(mod.id, [...mod.actions])
  for (const t of EDU_TELAS) m.set(t.id, [...t.actions])
  return [...m].map(([id, actions]) => ({ id, actions }))
}

/** A regra de hoje para um role (+ exceções da pessoa), todos os módulos ativos. Devolve o conjunto de capacidades. */
export async function resolverAntigo(role: string, overrides: Array<{ moduleId: string } & FlagsN> = []): Promise<Set<string>> {
  const rolePerms = await prisma.modulePermission.findMany({ where: { role: role as any } })
  const roleMap = new Map(rolePerms.map((p) => [p.moduleId, p as unknown as Flags]))
  const overMap = new Map(overrides.map((o) => [o.moduleId, o]))
  const todos = new Set(MODULE_REGISTRY.map((m) => m.id))
  const caps = new Set<string>()
  for (const mod of MODULE_REGISTRY) {
    const rp = roleMap.get(mod.id), uo = overMap.get(mod.id)
    for (const [k, a] of ACOES) if (uo?.[k] ?? rp?.[k] ?? false) caps.add(`${mod.id}.${a}`)
  }
  const telas = permissoesDasTelas(role, todos, roleMap, overMap as any)
  for (const [id, p] of Object.entries(telas)) {
    // A tela substitui o módulo de mesmo id (enrollment_portals), como em resolvePermissions.
    for (const [, a] of ACOES) caps.delete(`${id}.${a}`)
    for (const [k, a] of ACOES) if (p[k]) caps.add(`${id}.${a}`)
  }
  return caps
}

const ALCANCE_LEADS: Record<PermScope, 'LIDERADAS' | 'EQUIPE' | 'TUDO'> = { own: 'LIDERADAS', team: 'EQUIPE', all: 'TUDO' }
const ALCANCE_AGENDA: Record<PermScope, 'MEUS' | 'EQUIPE' | 'TUDO'> = { own: 'MEUS', team: 'EQUIPE', all: 'TUDO' }
const SCOPE_DE: Record<string, PermScope> = { MEUS: 'own', LIDERADAS: 'own', EQUIPE: 'team', RECORTES: 'team', TUDO: 'all' }

async function alcancesDoRole(role: string) {
  const perms = await prisma.modulePermission.findMany({ where: { role: role as any, moduleId: { in: ['leads', 'meetings'] } } })
  const sc = (m: string) => (perms.find((p) => p.moduleId === m)?.scope as PermScope | undefined) ?? defaultScopeForRole(role)
  const admin = role === 'SUPERADMIN' || role === 'ADMIN'
  return [
    { tipo: 'LEADS' as const, alcance: ALCANCE_LEADS[sc('leads')] },
    { tipo: 'AGENDA' as const, alcance: ALCANCE_AGENDA[sc('meetings')] },
    // Inscrições/financeiro/visões: a regra do acesso por portal (RECORTES) — admin vê tudo.
    { tipo: 'INSCRICOES' as const, alcance: admin ? 'TUDO' as const : 'RECORTES' as const },
    { tipo: 'FINANCEIRO' as const, alcance: admin ? 'TUDO' as const : 'RECORTES' as const },
    { tipo: 'VISOES' as const, alcance: admin ? 'TUDO' as const : 'RECORTES' as const },
  ]
}

export interface RelatorioEspelho {
  papeis: Array<{ id: number; nome: string; capacidades: number; pessoas: number }>
  pacotes: Array<{ id: number; nome: string; capacidades: number }>
  pessoasComPapelProprio: number
}

/**
 * Cria (ou recria) os papéis-espelho. Idempotente: apaga só o que tem
 * `origem` começando com 'espelho:' e refaz. Não toca em papel manual.
 */
export async function criarEspelhos(): Promise<RelatorioEspelho> {
  await prisma.user.updateMany({ where: { papel: { origem: { startsWith: 'espelho:' } } }, data: { papelId: null } })
  await prisma.pacote.deleteMany({ where: { origem: { startsWith: 'espelho:' } } })
  await prisma.papel.deleteMany({ where: { origem: { startsWith: 'espelho:' } } })

  const base = new Map<string, { id: number; caps: Set<string> }>()
  for (const role of ROLES) {
    const caps = await resolverAntigo(role)
    const p = await prisma.papel.create({
      data: {
        nome: NOME_ROLE[role]!, papelBase: role, sistema: role === 'SUPERADMIN' || role === 'ADMIN', origem: `espelho:${role}`,
        descricao: 'Espelho do papel antigo, com o acesso exato que ele tinha.',
        capacidades: { create: [...caps].map((capacidade) => ({ capacidade })) },
        alcances: { create: await alcancesDoRole(role) },
      },
    })
    base.set(role, { id: p.id, caps })
  }

  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true } })
  const overrides = await prisma.userModuleOverride.findMany()
  let proprios = 0
  for (const u of users) {
    const b = base.get(u.role)
    if (!b) continue
    const ov = overrides.filter((o) => o.userId === u.id)
    if (!ov.length) { await prisma.user.update({ where: { id: u.id }, data: { papelId: b.id } }); continue }
    const eff = await resolverAntigo(u.role, ov as any)
    const soma = [...eff].filter((c) => !b.caps.has(c))
    const retira = [...b.caps].filter((c) => !eff.has(c))
    if (!retira.length) {
      await prisma.user.update({ where: { id: u.id }, data: { papelId: b.id } })
      if (soma.length) {
        await prisma.pacote.create({
          data: {
            nome: `Exceções de ${u.name} (#${u.id})`.slice(0, 100), origem: `espelho:pessoa:${u.id}`,
            descricao: 'Exceção individual que existia no modelo antigo.',
            capacidades: { create: soma.map((capacidade) => ({ capacidade })) },
            usuarios: { create: [{ userId: u.id }] },
          },
        })
      }
    } else {
      // A exceção RETIRA algo do papel: pacote não retira, então a pessoa ganha papel próprio.
      proprios++
      const p = await prisma.papel.create({
        data: {
          nome: `${NOME_ROLE[u.role]} · ${u.name} (#${u.id})`.slice(0, 100), papelBase: u.role, origem: `espelho:${u.role}+pessoa:${u.id}`,
          descricao: 'Papel do modelo antigo com a exceção individual desta pessoa.',
          capacidades: { create: [...eff].map((capacidade) => ({ capacidade })) },
          alcances: { create: await alcancesDoRole(u.role) },
        },
      })
      await prisma.user.update({ where: { id: u.id }, data: { papelId: p.id } })
    }
  }

  const papeis = await prisma.papel.findMany({ include: { _count: { select: { capacidades: true, usuarios: true } } }, orderBy: { id: 'asc' } })
  const pacotes = await prisma.pacote.findMany({ include: { _count: { select: { capacidades: true } } }, orderBy: { id: 'asc' } })
  return {
    papeis: papeis.map((p) => ({ id: p.id, nome: p.nome, capacidades: p._count.capacidades, pessoas: p._count.usuarios })),
    pacotes: pacotes.map((p) => ({ id: p.id, nome: p.nome, capacidades: p._count.capacidades })),
    pessoasComPapelProprio: proprios,
  }
}

/** Papel de quem nasce ou troca de nível FORA da tela de Papéis (Usuários,
 *  sincronização Kommo/CRM Educacional, lixeira): o espelho daquele nível.
 *  Sem isto, com o motor ligado, a pessoa nova ficaria sem papel — seguiria a
 *  regra antiga em silêncio e travaria o religar do motor (sombra "sem papel").
 *  Só mexe em quem está sem papel ou num papel de outro nível: papel próprio
 *  do mesmo nível (clonado, exceção) fica como está. */
export async function atribuirPapelPadrao(userIds: number[]): Promise<number> {
  if (!userIds.length) return 0
  const espelhos = await prisma.papel.findMany({ where: { origem: { in: ROLES.map((r) => `espelho:${r}`) }, arquivado: false }, select: { id: true, papelBase: true } })
  if (!espelhos.length) return 0 // instalação que ainda não migrou para papéis
  const porNivel = new Map(espelhos.map((p) => [p.papelBase, p.id]))
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true, papel: { select: { papelBase: true } } } })
  let n = 0
  for (const u of users) {
    if (u.papel && u.papel.papelBase === u.role) continue
    const papelId = porNivel.get(u.role)
    if (!papelId) continue
    await prisma.user.update({ where: { id: u.id }, data: { papelId } })
    n++
  }
  if (n) invalidatePermCache()
  return n
}

/** Uma pessoa só, pela mesma regra do criarEspelhos: papel do nível + as
 *  exceções individuais (UserModuleOverride) dela — a que só soma vira pacote,
 *  a que retira vira papel próprio. Idempotente: refaz o que for da pessoa. */
export async function espelharPessoa(userId: number): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true } })
  if (!u) return
  await prisma.user.update({ where: { id: userId }, data: { papelId: null } })
  await prisma.pacote.deleteMany({ where: { origem: `espelho:pessoa:${userId}` } })
  await prisma.papel.deleteMany({ where: { origem: `espelho:${u.role}+pessoa:${userId}` } })
  await atribuirPapelPadrao([userId])
  const b = await prisma.papel.findFirst({ where: { origem: `espelho:${u.role}` }, include: { capacidades: true } })
  const ov = await prisma.userModuleOverride.findMany({ where: { userId } })
  if (!b || !ov.length) return
  const baseCaps = new Set(b.capacidades.map((c) => c.capacidade))
  const eff = await resolverAntigo(u.role, ov as any)
  const soma = [...eff].filter((c) => !baseCaps.has(c))
  if ([...baseCaps].some((c) => !eff.has(c))) {
    const p = await prisma.papel.create({
      data: {
        nome: `${NOME_ROLE[u.role]} · ${u.name} (#${u.id})`.slice(0, 100), papelBase: u.role, origem: `espelho:${u.role}+pessoa:${u.id}`,
        descricao: 'Papel do modelo antigo com a exceção individual desta pessoa.',
        capacidades: { create: [...eff].map((capacidade) => ({ capacidade })) },
        alcances: { create: await alcancesDoRole(u.role) },
      },
    })
    await prisma.user.update({ where: { id: userId }, data: { papelId: p.id } })
  } else if (soma.length) {
    await prisma.pacote.create({
      data: {
        nome: `Exceções de ${u.name} (#${u.id})`.slice(0, 100), origem: `espelho:pessoa:${u.id}`,
        descricao: 'Exceção individual que existia no modelo antigo.',
        capacidades: { create: soma.map((capacidade) => ({ capacidade })) },
        usuarios: { create: [{ userId: u.id }] },
      },
    })
  }
  invalidatePermCache()
}

/** O motor novo: ResolvedPerms a partir do papel + pacotes (mesmo formato de resolvePermissions). */
export async function resolverNovo(userId: number): Promise<{ perms: ResolvedPerms; papelBase: string } | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { papel: { include: { capacidades: true, alcances: true } }, pacotes: { include: { pacote: { include: { capacidades: true } } } } },
  })
  if (!u?.papel) return null
  const caps = new Set(u.papel.capacidades.map((c) => c.capacidade))
  for (const up of u.pacotes) for (const c of up.pacote.capacidades) caps.add(c.capacidade)
  const ativos = await getActiveModuleIds()
  const alc = new Map(u.papel.alcances.map((a) => [a.tipo, a.alcance]))
  const base = u.papel.papelBase
  const scopeDe = (m: string): PermScope => {
    if (m === 'leads') return SCOPE_DE[alc.get('LEADS') ?? ''] ?? defaultScopeForRole(base)
    if (m === 'meetings') return SCOPE_DE[alc.get('AGENDA') ?? ''] ?? defaultScopeForRole(base)
    return defaultScopeForRole(base)
  }
  const telaIds = new Set(EDU_TELAS.map((t) => t.id))
  const out: ResolvedPerms = {}
  for (const r of recursos()) {
    const ativo = telaIds.has(r.id) ? ativos.has(EDU_TELAS.find((t) => t.id === r.id)!.parent) : ativos.has(r.id)
    if (!ativo) continue
    out[r.id] = {
      canView: caps.has(`${r.id}.view`), canCreate: caps.has(`${r.id}.create`),
      canEdit: caps.has(`${r.id}.edit`), canDelete: caps.has(`${r.id}.delete`),
      scope: scopeDe(r.id),
    }
  }
  return { perms: out, papelBase: base }
}

export interface Divergencia { userId: number; nome: string; role: string; recurso: string; campo: string; antigo: unknown; novo: unknown }

/** Modo sombra: para todo usuário ativo, o mapa de hoje × o do papel. Só leads/meetings têm escopo relevante. */
export async function compararSombra(): Promise<{ pessoas: number; semPapel: number; divergencias: Divergencia[] }> {
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true } })
  const div: Divergencia[] = []
  let semPapel = 0
  for (const u of users) {
    const antigo = await resolverRegraAntiga(u.id, u.role)
    const novo = await resolverNovo(u.id)
    if (!novo) { semPapel++; continue }
    if (novo.papelBase !== u.role) div.push({ userId: u.id, nome: u.name, role: u.role, recurso: '(papel)', campo: 'papelBase', antigo: u.role, novo: novo.papelBase })
    const chaves = new Set([...Object.keys(antigo), ...Object.keys(novo.perms)])
    for (const k of chaves) {
      const a = antigo[k], n = novo.perms[k]
      if (!a || !n) { div.push({ userId: u.id, nome: u.name, role: u.role, recurso: k, campo: 'existe', antigo: !!a, novo: !!n }); continue }
      for (const [f] of ACOES) if (a[f] !== n[f]) div.push({ userId: u.id, nome: u.name, role: u.role, recurso: k, campo: f, antigo: a[f], novo: n[f] })
      if ((k === 'leads' || k === 'meetings') && a.scope !== n.scope) div.push({ userId: u.id, nome: u.name, role: u.role, recurso: k, campo: 'scope', antigo: a.scope, novo: n.scope })
    }
  }
  return { pessoas: users.length, semPapel, divergencias: div }
}

/**
 * Capacidades NOMEADAS do usuário (papel + pacotes). As básicas viram
 * `ResolvedPerms` em `resolverNovo`; estas não têm onde caber lá e eram
 * descartadas — por isso nenhuma rota conseguia checá-las.
 *
 * Administrador e Superadministrador têm todas: os papéis deles são de sistema,
 * não editáveis, e ficariam presos sem as opções novas.
 */
export async function capacidadesNomeadas(userId: number, role: string): Promise<string[]> {
  const { NOMEADAS } = await import('../lib/capacidades.js')
  const nomeadas = NOMEADAS.map((n) => n.id)
  if (role === 'ADMIN' || role === 'SUPERADMIN') return nomeadas
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { papel: { select: { capacidades: { select: { capacidade: true } } } }, pacotes: { select: { pacote: { select: { capacidades: { select: { capacidade: true } } } } } } },
  })
  const tem = new Set<string>()
  for (const c of u?.papel?.capacidades ?? []) tem.add(c.capacidade)
  for (const up of u?.pacotes ?? []) for (const c of up.pacote.capacidades) tem.add(c.capacidade)
  return nomeadas.filter((id) => tem.has(id))
}

export async function temCapacidade(userId: number, role: string, id: string): Promise<boolean> {
  return (await capacidadesNomeadas(userId, role)).includes(id)
}
