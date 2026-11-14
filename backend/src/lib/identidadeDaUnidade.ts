// src/lib/identidadeDaUnidade.ts
//
// Identidade de uma EMPRESA dentro do ambiente. Um tenant pode atender duas
// marcas (ex.: a escola e uma segunda empresa que divide a mesma equipe e o
// mesmo sistema). Cada uma é uma Unidade (Educacional › Unidades), e cada
// portal pertence a uma unidade. O que o candidato vê fora da tela do portal —
// o remetente do e-mail, o nome nos modelos ({{marca}}), a razão social e o
// CNPJ do contrato, o número de WhatsApp — vem daqui.
//
// Tudo é opcional: campo vazio cai no cadastro geral do ambiente (Configurações),
// que é o comportamento de antes. Unidade sem identidade = nada muda.

import { prisma } from './prisma.js'

export interface IdentidadeDaUnidade {
  /** Nome da marca para o candidato ({{marca}}, remetente, app no celular). */
  marca?: string
  /** Razão social ({{instituicao}} no contrato). */
  razaoSocial?: string
  cnpj?: string
  /** Endereço da sede, uma linha ({{endereco_instituicao}}). */
  endereco?: string
  /** Site ({{site_instituicao}}). */
  site?: string
  /** Nome exibido no remetente dos e-mails. Vazio = marca. */
  emailNome?: string
  /** Caixa do remetente no domínio do ambiente ("matriculaead" → matriculaead@dominio). */
  emailCaixa?: string
  /** Conexão da API oficial (Cloud API) que fala com os candidatos desta unidade. */
  whatsappConexaoId?: number | null
  /** true = não envia venda ganha desta unidade ao pixel do ambiente (Meta CAPI). */
  capiDesligado?: boolean
  /** Pixel (conjunto de dados) da Meta desta empresa: as conversões das pessoas dela vão para ele. */
  capiPixelId?: string
  /** Token da API de Conversões desse pixel, CIFRADO (services/cloudApi encryptToken). Nunca sai na API. */
  capiTokenCifrado?: string
  /** Funis desta empresa: lead sem inscrição e sem número de conversa é dela se estiver num destes. */
  funis?: number[]
}

const texto = (v: unknown, max = 191) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Normaliza o JSON vindo da tela (ou do banco). Chaves vazias somem. */
export function normalizarIdentidade(raw: unknown): IdentidadeDaUnidade | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: IdentidadeDaUnidade = {}
  for (const k of ['marca', 'razaoSocial', 'cnpj', 'endereco', 'site', 'emailNome'] as const) {
    const v = texto(r[k], k === 'endereco' ? 300 : 191)
    if (v) out[k] = v
  }
  const caixa = texto(r.emailCaixa, 64).toLowerCase().replace(/[^a-z0-9._-]/g, '')
  if (caixa) out.emailCaixa = caixa
  const conexao = Number(r.whatsappConexaoId)
  if (Number.isInteger(conexao) && conexao > 0) out.whatsappConexaoId = conexao
  if (r.capiDesligado === true) out.capiDesligado = true
  const pixel = String(r.capiPixelId ?? '').replace(/\D/g, '')
  if (pixel.length >= 10) out.capiPixelId = pixel
  if (typeof r.capiTokenCifrado === 'string' && r.capiTokenCifrado.length > 20) out.capiTokenCifrado = r.capiTokenCifrado
  const funis = (Array.isArray(r.funis) ? r.funis : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  if (funis.length) out.funis = [...new Set(funis)]
  return Object.keys(out).length ? out : null
}

const cache = new Map<number, { em: number; v: IdentidadeDaUnidade | null }>()
const VALIDADE_MS = 60_000

/** Esquece o que foi lido (a tela chama ao salvar a unidade). */
export function esquecerIdentidade(unitId?: number) {
  if (unitId) cache.delete(unitId)
  else cache.clear()
}

export async function identidadeDaUnidade(unitId: number | null | undefined): Promise<IdentidadeDaUnidade | null> {
  if (!unitId) return null
  const c = cache.get(unitId)
  if (c && Date.now() - c.em < VALIDADE_MS) return c.v
  const u = await prisma.educationalUnit.findUnique({ where: { id: unitId }, select: { identidade: true } }).catch(() => null)
  const v = normalizarIdentidade(u?.identidade)
  cache.set(unitId, { em: Date.now(), v })
  return v
}

export async function unidadeDoPortal(portalId: number | null | undefined): Promise<number | null> {
  if (!portalId) return null
  const p = await prisma.enrollmentPortal.findUnique({ where: { id: portalId }, select: { unitId: true } })
  return p?.unitId ?? null
}

export async function identidadeDoPortal(portalId: number | null | undefined) {
  return identidadeDaUnidade(await unidadeDoPortal(portalId))
}

/**
 * A unidade de uma pessoa: a do portal da inscrição mais recente; sem inscrição,
 * a unidade cujo número de WhatsApp é o da conversa. null = ambiente geral.
 */
export async function unidadeDoLead(leadId: number | null | undefined): Promise<number | null> {
  if (!leadId) return null
  const reg = await prisma.enrollmentRegistration.findFirst({
    where: { leadId }, orderBy: { id: 'desc' }, select: { portal: { select: { unitId: true } } },
  })
  if (reg?.portal?.unitId) return reg.portal.unitId
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { cloudApiConnectionId: true, funnelId: true } })
  if (!lead) return null
  const porConexao = lead.cloudApiConnectionId ? await unidadeDaConexao(lead.cloudApiConnectionId) : null
  if (porConexao) return porConexao
  // Lead do site/formulário, ainda sem conversa nem inscrição: o funil diz a empresa.
  return lead.funnelId ? unidadeDoFunil(lead.funnelId) : null
}

/** A unidade que declarou este funil como seu (identidade.funis). */
export async function unidadeDoFunil(funnelId: number): Promise<number | null> {
  const unidades = await prisma.educationalUnit.findMany({ where: { identidade: { not: null as any } }, select: { id: true, identidade: true }, orderBy: { id: 'asc' } })
  return unidades.find((u) => normalizarIdentidade(u.identidade)?.funis?.includes(funnelId))?.id ?? null
}

/** A unidade que declarou esta conexão de WhatsApp como sua (só uma vale). */
export async function unidadeDaConexao(conexaoId: number): Promise<number | null> {
  const unidades = await prisma.educationalUnit.findMany({ where: { identidade: { not: null as any } }, select: { id: true, identidade: true }, orderBy: { id: 'asc' } })
  const achou = unidades.find((u) => normalizarIdentidade(u.identidade)?.whatsappConexaoId === conexaoId)
  return achou?.id ?? null
}

export async function identidadeDoLead(leadId: number | null | undefined) {
  return identidadeDaUnidade(await unidadeDoLead(leadId))
}

/**
 * A configuração de e-mail (getEmailConfig) com a identidade por cima — é o que
 * `getFromAddress` lê. Sem identidade, devolve a mesma configuração.
 */
export function cfgComIdentidade(cfg: Record<string, string>, id: IdentidadeDaUnidade | null): Record<string, string> {
  if (!id) return cfg
  const out = { ...cfg }
  if (id.marca) out['appearance.admin_brand_name'] = id.marca
  if (id.emailNome || id.marca) {
    out['notification.sender_name'] = id.emailNome || id.marca!
    out['smtp.from_name'] = id.emailNome || id.marca!
  }
  if (id.emailCaixa) out['notification.email_local'] = id.emailCaixa
  return out
}

/** Variáveis dos modelos do sistema: `{{marca}}` da unidade, quando ela tem. */
export function varsDaIdentidade(id: IdentidadeDaUnidade | null): Record<string, string> {
  return id?.marca ? { marca: id.marca } : {}
}

/** Campos do lead novo criado por um portal desta unidade (o número da conversa). */
export async function canalDaUnidade(unitId: number | null | undefined): Promise<{ cloudApiConnectionId?: number }> {
  const id = await identidadeDaUnidade(unitId)
  if (!id?.whatsappConexaoId) return {}
  const c = await prisma.cloudApiConnection.findFirst({ where: { id: id.whatsappConexaoId, active: true }, select: { id: true } })
  return c ? { cloudApiConnectionId: c.id } : {}
}

/** Pixel e token da API de Conversões da empresa da pessoa; null = usar o do ambiente. */
export async function capiDoLead(leadId: number | null | undefined): Promise<{ pixelId: string; accessToken: string; desligado: boolean } | null> {
  const id = await identidadeDoLead(leadId)
  if (!id) return null
  if (id.capiPixelId && id.capiTokenCifrado) {
    const { decryptToken } = await import('../services/cloudApi.js')
    try { return { pixelId: id.capiPixelId, accessToken: decryptToken(id.capiTokenCifrado), desligado: false } } catch { /* token ilegível: cai na regra abaixo */ }
  }
  return id.capiDesligado ? { pixelId: '', accessToken: '', desligado: true } : null
}

/**
 * A identidade como a tela recebe: sem o token (nem cifrado) — só a indicação
 * de que existe um salvo.
 */
export function identidadeParaTela(raw: unknown): (Omit<IdentidadeDaUnidade, 'capiTokenCifrado'> & { capiTokenSalvo?: boolean }) | null {
  const id = normalizarIdentidade(raw)
  if (!id) return null
  const { capiTokenCifrado, ...resto } = id
  return capiTokenCifrado ? { ...resto, capiTokenSalvo: true } : resto
}

/**
 * Identidade vinda da tela para gravar: o token chega em texto (`capiToken`) só
 * quando foi digitado; vazio mantém o que já estava salvo; `capiTokenLimpar`
 * apaga.
 */
export async function identidadeParaGravar(body: unknown, atual: unknown): Promise<IdentidadeDaUnidade | null> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const antes = normalizarIdentidade(atual)
  let cifrado = antes?.capiTokenCifrado
  const novo = typeof b.capiToken === 'string' ? b.capiToken.trim() : ''
  if (novo) {
    const { encryptToken } = await import('../services/cloudApi.js')
    cifrado = encryptToken(novo)
  } else if (b.capiTokenLimpar === true) cifrado = undefined
  const { capiToken: _t, capiTokenLimpar: _l, capiTokenSalvo: _s, capiTokenCifrado: _c, ...resto } = b
  return normalizarIdentidade({ ...resto, ...(cifrado ? { capiTokenCifrado: cifrado } : {}) })
}
