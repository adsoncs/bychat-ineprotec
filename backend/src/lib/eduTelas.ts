// src/lib/eduTelas.ts
//
// Permissão por TELA do Educacional.
//
// O Educacional tem 17 telas e dependia de duas permissões ("Educacional" e
// "Portal de Matrículas") — não havia como liberar Cursos sem liberar
// Contratos. E a maioria das rotas nem olhava a tela de Permissões: trazia o
// papel cravado no código (adminOnly, requireAdmin), então o agente com "Ver"
// abria a Revisão de documentos e o modal do documento ficava eternamente em
// "Carregando…" (a rota do arquivo era só de admin).
//
// Aqui cada tela vira uma permissão com Ver/Criar/Editar/Excluir, por papel e
// por pessoa, nas MESMAS tabelas das permissões de módulo (moduleId = id da
// tela). Não são módulos: não aparecem na loja nem em Módulos, e só valem
// enquanto o módulo-pai estiver ligado — desligado o pai, a rota volta para a
// regra antiga, byte a byte.
//
// Sem linha própria, a tela herda do módulo-pai (papel e exceção por pessoa).
// Instalar isto não muda o acesso de ninguém; quem quer fechar, fecha na tela.

import type { JwtPayload } from './auth.js'

export type AcaoTela = 'view' | 'create' | 'edit' | 'delete'

export interface TelaDef {
  /** moduleId gravado em ModulePermission/UserModuleOverride. */
  id: string
  name: string
  /** Módulo que liga/desliga a tela e de quem ela herda sem linha própria. */
  parent: 'educacional' | 'enrollment_portals'
  /** Item do menu (sidebar.config.ts) governado por esta tela. */
  menuId: string
  actions: AcaoTela[]
  /** Rotas da tela: prefixo literal, ou com `:id` (número) no meio. */
  rotas: string[]
  /** Leitura (GET) liberada a quem enxerga qualquer tela do Educacional ou
   *  do ERP: é cadastro que as outras telas usam em seletores. Sem isto a
   *  tela de Ofertas abriria com o seletor de cursos vazio. */
  catalogo?: boolean
  /** Outra porta para a mesma rota: quem tem a ação neste módulo também
   *  passa (os cupons são administrados também em Pagamentos). */
  alternativos?: string[]
  /** Só LEITURA também por estas telas: a página da inscrição (Portal de
   *  Matrículas) mostra documentos, parecer, redação e ENEM do candidato —
   *  quem tem o Portal vê, mas aprovar continua sendo desta tela. */
  leituraTambem?: string[]
  /**
   * O que a rota deixava passar ANTES desta permissão existir, para quem não é
   * admin. Sem linha própria, a tela herda do pai — mas só até aqui, senão a
   * instalação daria a gerente e agente o que o código lhes negava (escrita em
   * cadastros, financeiro, configurações). Admin herda tudo.
   *   'admin'   — leitura e escrita eram só de admin: não herda nada.
   *   'leitura' — escrita era só de admin: herda só o Ver.
   *   omitido   — a rota já seguia a permissão do pai: herda tudo.
   */
  legado?: 'admin' | 'leitura'
}

export const EDU_TELAS: TelaDef[] = [
  { id: 'edu_visao_geral', name: 'Visão geral', parent: 'educacional', menuId: 'educational', actions: ['view'],
    rotas: ['/api/admin/educacional/stats', '/api/admin/educacional/health'] },
  { id: 'edu_unidades', legado: 'leitura', name: 'Unidades', parent: 'educacional', menuId: 'edu-units', actions: ['view', 'create', 'edit', 'delete'],
    rotas: ['/api/admin/educacional/units'], catalogo: true },
  { id: 'edu_campus', legado: 'leitura', name: 'Campus', parent: 'educacional', menuId: 'edu-campuses', actions: ['view', 'create', 'edit', 'delete'],
    rotas: ['/api/admin/educacional/campuses'], catalogo: true },
  { id: 'edu_niveis', legado: 'leitura', name: 'Níveis', parent: 'educacional', menuId: 'edu-levels', actions: ['view', 'create', 'edit', 'delete'],
    rotas: ['/api/admin/educacional/levels'], catalogo: true },
  { id: 'edu_modalidades', legado: 'leitura', name: 'Modalidades', parent: 'educacional', menuId: 'edu-modalities', actions: ['view', 'create', 'edit', 'delete'],
    rotas: ['/api/admin/educacional/modalities'], catalogo: true },
  { id: 'edu_cursos', legado: 'leitura', name: 'Cursos', parent: 'educacional', menuId: 'edu-courses', actions: ['view', 'create', 'edit', 'delete'],
    rotas: ['/api/admin/educacional/courses'], catalogo: true },
  { id: 'edu_ofertas', legado: 'leitura', name: 'Ofertas', parent: 'educacional', menuId: 'edu-offerings', actions: ['view', 'create', 'edit', 'delete'],
    rotas: ['/api/admin/educacional/offerings', '/api/admin/educacional/planos-pagamento'], catalogo: true },
  { id: 'edu_modos_ingresso', legado: 'leitura', name: 'Modos de ingresso', parent: 'educacional', menuId: 'edu-entry-modes', actions: ['view', 'create', 'edit', 'delete'],
    rotas: ['/api/admin/educacional/entry-modes', '/api/admin/educacional/document-types'], catalogo: true },
  { id: 'edu_dados_etapas', legado: 'leitura', name: 'Dados por etapa', parent: 'educacional', menuId: 'edu-dados-etapas', actions: ['view', 'edit'],
    rotas: ['/api/admin/educacional/dados-etapas'], catalogo: true },
  { id: 'edu_processos', legado: 'leitura', name: 'Processos seletivos', parent: 'educacional', menuId: 'edu-selection-processes', actions: ['view', 'create', 'edit', 'delete'],
    rotas: ['/api/admin/educacional/selection-processes', '/api/admin/educacional/essay-topics'], catalogo: true },
  { id: 'edu_revisao_documentos', legado: 'leitura', name: 'Revisão de documentos', parent: 'educacional', menuId: 'edu-doc-review', actions: ['view', 'edit'],
    rotas: [
      '/api/admin/enrollment-documents', '/api/admin/enrollment-document-reviews', '/api/admin/analises-academicas',
      '/api/admin/enrollment-registrations/:id/document-review', '/api/admin/enrollment-registrations/:id/bulk-approve-ai',
      '/api/admin/enrollment-registrations/:id/analise',
    ], leituraTambem: ['enrollment_portals'] },
  { id: 'edu_avaliacoes', legado: 'leitura', name: 'Avaliações', parent: 'educacional', menuId: 'edu-evaluations', actions: ['view', 'edit'],
    rotas: ['/api/admin/essay-submissions', '/api/admin/enem-imports', '/api/admin/presencial-exams', '/api/admin/registrations/:id/presencial-exam'],
    leituraTambem: ['enrollment_portals'] },
  // Mesmo id do módulo: o Portal de Matrículas já tinha permissão própria.
  { id: 'enrollment_portals', name: 'Portal de Matrículas', parent: 'enrollment_portals', menuId: 'enrollment-portals', actions: ['view', 'create', 'edit', 'delete'],
    // portal-accounts: gera o login do candidato — antes só exigia estar logado.
    rotas: ['/api/admin/enrollment-portals', '/api/admin/enrollment-registrations', '/api/admin/portal-accounts'] },
  { id: 'edu_financeiro_portal', legado: 'admin', name: 'Financeiro do portal', parent: 'enrollment_portals', menuId: 'edu-portal-financeiro', actions: ['view', 'edit'],
    rotas: ['/api/admin/educational/portal-financeiro'] },
  { id: 'edu_cupons', legado: 'leitura', name: 'Cupons', parent: 'enrollment_portals', menuId: 'edu-cupons', actions: ['view', 'create', 'edit', 'delete'],
    rotas: ['/api/admin/coupons'], alternativos: ['payments'] },
  { id: 'edu_contratos', name: 'Contratos', parent: 'enrollment_portals', menuId: 'edu-contratos', actions: ['view', 'create', 'edit', 'delete'],
    rotas: ['/api/admin/enrollment-portals/contratos'] },
  { id: 'edu_configuracoes', legado: 'admin', name: 'Configurações Gerais', parent: 'enrollment_portals', menuId: 'edu-geral', actions: ['view', 'edit'],
    rotas: ['/api/admin/edu/geral'] },
  // Quem vê cada portal (polos e parceiros) — lib/portalAccess.ts.
  { id: 'edu_acesso_portais', legado: 'admin', name: 'Acesso por portal', parent: 'enrollment_portals', menuId: 'edu-acesso-portais', actions: ['view', 'edit'],
    rotas: ['/api/admin/portal-acesso'] },
]

/** GETs que qualquer usuário logado faz fora do Educacional: a lista de
 *  portais rotula a origem dos leads no menu e alimenta Pagamentos. */
const LEITURA_LIVRE = new Set<string>([
  '/api/admin/enrollment-portals',
  '/api/admin/enrollment-portals/source-labels',
])

export const TELA_IDS = new Set(EDU_TELAS.map((t) => t.id))

interface Padrao { tela: TelaDef; re: RegExp; peso: number }
const PADROES: Padrao[] = EDU_TELAS.flatMap((tela) => tela.rotas.map((r) => {
  const esc = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:id/g, '\\d+')
  // Prefixo de SEGMENTO: /courses não pode capturar /courses-algo.
  return { tela, re: new RegExp(`^${esc}(?:/|$|\\.)`), peso: r.replace(/:id/g, '').length }
}))

/** A tela dona da rota — a de padrão mais específico, como no registry. */
export function telaDaRota(path: string): TelaDef | null {
  let melhor: Padrao | null = null
  for (const p of PADROES) if (p.re.test(path) && (!melhor || p.peso > melhor.peso)) melhor = p
  return melhor?.tela ?? null
}

// Ações sobre um registro que JÁ existe, disparadas por POST (aprovar,
// reenviar, classificar, estornar…), são edição — não criação. Exceções:
// duplicar cria; prévia e simulação só leem.
const POST_CRIA = /\/(duplicate|duplicar|lote)$/
const POST_LE = /\/(previa|simular)$/

export function acaoNaTela(method: string, path: string, tela: TelaDef): AcaoTela {
  const m = method.toUpperCase()
  let acao: AcaoTela =
    m === 'GET' || m === 'HEAD' ? 'view'
      : m === 'DELETE' ? 'delete'
        : m === 'PUT' || m === 'PATCH' ? 'edit'
          : 'create'
  if (m === 'POST') {
    if (POST_LE.test(path)) acao = 'view'
    else if (POST_CRIA.test(path)) acao = 'create'
    else if (/\/\d+\/[a-z]/i.test(path) || /\/(testar[\w-]*|upload|reorder|classify|convoke)$/.test(path)) acao = 'edit'
  }
  // Tela sem a ação na lista (ex.: Configurações só tem Ver/Editar): tudo o
  // que não é leitura conta como editar a tela.
  if (!tela.actions.includes(acao)) acao = acao === 'view' ? 'view' : 'edit'
  return acao
}

const CAMPO: Record<AcaoTela, 'canView' | 'canCreate' | 'canEdit' | 'canDelete'> = {
  view: 'canView', create: 'canCreate', edit: 'canEdit', delete: 'canDelete',
}

const NOME_ACAO: Record<AcaoTela, string> = { view: 'Ver', create: 'Criar', edit: 'Editar', delete: 'Excluir' }

export interface DecisaoTela {
  tela: TelaDef
  acao: AcaoTela
  permitido: boolean
  mensagem?: string
}

/**
 * A rota é de uma tela do Educacional? Então a decisão é desta tela.
 * `null` = não é rota de tela, ou o módulo-pai está desligado: o chamador
 * segue pela regra antiga.
 */
export async function avaliarTela(user: Pick<JwtPayload, 'userId' | 'role'>, method: string, url: string): Promise<DecisaoTela | null> {
  const path = url.split('?')[0]!
  const tela = telaDaRota(path)
  if (!tela) return null
  const { getActiveModuleIds, resolvePermissions } = await import('./permissions.js')
  const ativos = await getActiveModuleIds()
  if (!ativos.has(tela.parent)) return null

  const acao = acaoNaTela(method, path, tela)
  if (user.role === 'SUPERADMIN') return { tela, acao, permitido: true }
  if (acao === 'view' && LEITURA_LIVRE.has(path)) return { tela, acao, permitido: true }

  const perms = await resolvePermissions(user.userId, user.role)
  const pode = (id: string) => !!perms[id]?.[CAMPO[acao]]
  if (pode(tela.id) || (tela.alternativos ?? []).some(pode)) return { tela, acao, permitido: true }
  if (acao === 'view' && (tela.leituraTambem ?? []).some((id) => perms[id]?.canView)) return { tela, acao, permitido: true }

  if (acao === 'view' && tela.catalogo) {
    const { MODULE_REGISTRY } = await import('./moduleRegistry.js')
    const veAlgumaTela = EDU_TELAS.some((t) => perms[t.id]?.canView)
    const veErp = MODULE_REGISTRY.some((m) => m.umbrella === 'erp_academico' && perms[m.id]?.canView)
    if (veAlgumaTela || veErp) return { tela, acao, permitido: true }
  }

  return {
    tela, acao, permitido: false,
    mensagem: `Seu perfil não tem a permissão "${NOME_ACAO[acao]}" na tela Educacional › ${tela.name}. Peça a um administrador para liberar em Configurações → Permissões.`,
  }
}

/**
 * preHandler das rotas de tela. Substitui o papel cravado (adminOnly,
 * requireAdmin): com o módulo-pai ligado manda a permissão da tela; desligado,
 * vale a regra antiga (`fallback`) — que é exatamente o que a rota fazia.
 */
export function guardTela(fallback: 'admin' | 'gestao' | 'login' = 'admin') {
  return async (req: any, reply: any) => {
    const { authMiddleware } = await import('./auth.js')
    await authMiddleware(req, reply)
    if (reply.sent) return
    const user = req.user as JwtPayload
    const r = await verificarTela(user, req.method, req.url, fallback)
    if (r) return reply.code(r.status).send(r.body)
  }
}

/** Mesma decisão do guardTela para quem já tem o usuário em mãos (rotas que
 *  autenticam por conta própria). `null` = pode seguir. */
export async function verificarTela(
  user: Pick<JwtPayload, 'userId' | 'role'>, method: string, url: string,
  fallback: 'admin' | 'gestao' | 'login',
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const d = await avaliarTela(user, method, url)
  if (d) {
    if (d.permitido) return null
    return { status: 403, body: { error: d.mensagem, module: d.tela.id, action: d.acao } }
  }
  const papeis = fallback === 'admin' ? ['SUPERADMIN', 'ADMIN'] : fallback === 'gestao' ? ['SUPERADMIN', 'ADMIN', 'MANAGER'] : null
  if (papeis && !papeis.includes(user.role)) return { status: 403, body: { error: 'Acesso restrito a administradores' } }
  return null
}

/** O pai, recortado pelo que o código deixava fazer antes (ver `legado`). */
export function herdarDoPai(tela: TelaDef, role: string, v: boolean | null | undefined, acao: AcaoTela): boolean | null | undefined {
  if (v == null || role === 'SUPERADMIN' || role === 'ADMIN') return v
  if (tela.legado === 'admin') return false
  if (tela.legado === 'leitura' && acao !== 'view') return false
  return v
}

/** Linhas de permissão das telas, para resolvePermissions. Herança: exceção
 *  da pessoa na tela › papel na tela › exceção da pessoa no pai › papel no pai
 *  (os dois últimos recortados por `legado`). */
export function permissoesDasTelas(
  role: string,
  ativos: Set<string>,
  papel: Map<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }>,
  pessoa: Map<string, { canView: boolean | null; canCreate: boolean | null; canEdit: boolean | null; canDelete: boolean | null }>,
): Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> {
  const out: Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> = {}
  for (const t of EDU_TELAS) {
    if (!ativos.has(t.parent)) continue
    const val = (campo: 'canView' | 'canCreate' | 'canEdit' | 'canDelete', acao: AcaoTela) => {
      if (!t.actions.includes(acao)) return false
      return pessoa.get(t.id)?.[campo] ?? papel.get(t.id)?.[campo]
        ?? herdarDoPai(t, role, pessoa.get(t.parent)?.[campo], acao)
        ?? herdarDoPai(t, role, papel.get(t.parent)?.[campo], acao) ?? false
    }
    out[t.id] = { canView: val('canView', 'view'), canCreate: val('canCreate', 'create'), canEdit: val('canEdit', 'edit'), canDelete: val('canDelete', 'delete') }
  }
  return out
}

/** Para a tela de Permissões. */
export function telasParaUi() {
  return EDU_TELAS.map((t) => ({ id: t.id, name: t.name, parent: t.parent, menuId: t.menuId, actions: t.actions, def: t }))
}

