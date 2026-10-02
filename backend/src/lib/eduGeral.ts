// src/lib/eduGeral.ts
//
// Configurações Gerais do Educacional (menu Educacional › Configurações Gerais).
//
// O que é da instituição toda e não de um portal: identidade, aparência base,
// a tela de entrar (/portal/login é uma só) e o app instalável do celular.
// Guardado na tabela de configurações (Setting), uma chave por seção:
// edu.geral.identidade, edu.geral.aparencia, edu.geral.login.
//
// Regra de precedência (o portal manda no que é dele):
//   valor do portal › Configurações Gerais › padrão do sistema
// Os padrões abaixo são exatamente o que as telas mostravam antes desta
// funcionalidade — sem nada salvo, nada muda.

import { prisma } from './prisma.js'
import { limparTextos } from './eduTextos.js'

export interface GeralIdentidade {
  nome: string | null
  logoUrl: string | null
  faviconUrl: string | null
  logoLink: string | null
  rodape: string | null
}

export interface GeralAparencia {
  corPrincipal: string | null
  corApoio: string | null
  fonte: string | null // inter | roboto | poppins | system
  raio: string | null // sharp | medium | rounded
  botao: string | null // reta | pill
  caixaAlta: boolean | null
  escala: string | null // compacta | padrao | ampla
  largura: string | null // estreita | padrao | ampla
  // Só daqui (os portais não têm estes campos): valem em todas as telas.
  espacamento: string | null // compacto | padrao | arejado
  corTexto: string | null
  corTextoSuave: string | null
  corFundo: string | null
  corCartao: string | null
  corLinha: string | null
  corSucesso: string | null
  corPendente: string | null
  corErro: string | null
}

export interface GeralLogin {
  painelTitulo: string | null
  painelSubtitulo: string | null
  painelItens: string[] | null
  painelImagemUrl: string | null
  painelVeu: number | null // 0–100: força da cor sobre a imagem
  painelLado: string | null // esquerda | direita
  painelCorDe: string | null
  painelCorPara: string | null
  formTitulo: string | null
  formSubtitulo: string | null
  modoEmail: boolean | null
  modoCodigo: boolean | null
  esqueciTexto: string | null
  recuperarTitulo: string | null
  recuperarTexto: string | null
}

/** SEO e medição padrão (portais sem valor próprio, ou que seguem as Gerais em SEO). */
export interface GeralSeo {
  ogImageUrl: string | null
  pixels: { ga4Id: string | null; gtmId: string | null; metaPixelId: string | null; tiktokPixelId: string | null; linkedinPartnerId: string | null }
}

/** O que cada portal segue das Gerais. Portal fora do mapa = segue nada (personalizado). */
export interface Heranca { marca: boolean; textos: boolean; seo: boolean }

export interface EduGeral {
  identidade: GeralIdentidade
  aparencia: GeralAparencia
  login: GeralLogin
  seo: GeralSeo
  /** portalId → o que segue. Editado no Branding do portal ou na aba Portais. */
  heranca: Record<string, Heranca>
  /** Textos do portal editados (só os diferentes do padrão). Ver lib/eduTextos.ts. */
  textos: Record<string, string>
}

/** Os textos que as telas usam quando nada foi configurado. */
export const PADROES_LOGIN = {
  painelTitulo: 'Portal do candidato e do aluno',
  painelSubtitulo: 'Sua inscrição, seus documentos e sua vida acadêmica em um só lugar.',
  painelItens: ['Acompanhe as etapas da sua inscrição', 'Envie seus documentos', 'Assine o contrato e pague online'],
  formTitulo: 'Acesse sua inscrição',
  formSubtitulo: 'Entre para acompanhar sua inscrição e sua vida acadêmica.',
  esqueciTexto: 'Esqueceu a senha?',
  recuperarTitulo: 'Recuperar acesso',
  recuperarTexto: 'Informe o e-mail do cadastro. Mandamos um link pelo WhatsApp ou e-mail — ele vale {horas} horas e serve uma vez.',
}

const VAZIO: EduGeral = {
  identidade: { nome: null, logoUrl: null, faviconUrl: null, logoLink: null, rodape: null },
  aparencia: {
    corPrincipal: null, corApoio: null, fonte: null, raio: null, botao: null, caixaAlta: null, escala: null, largura: null,
    espacamento: null, corTexto: null, corTextoSuave: null, corFundo: null, corCartao: null, corLinha: null,
    corSucesso: null, corPendente: null, corErro: null,
  },
  login: {
    painelTitulo: null, painelSubtitulo: null, painelItens: null, painelImagemUrl: null, painelVeu: null, painelLado: null,
    painelCorDe: null, painelCorPara: null, formTitulo: null, formSubtitulo: null, modoEmail: null, modoCodigo: null,
    esqueciTexto: null, recuperarTitulo: null, recuperarTexto: null,
  },
  textos: {},
  seo: { ogImageUrl: null, pixels: { ga4Id: null, gtmId: null, metaPixelId: null, tiktokPixelId: null, linkedinPartnerId: null } },
  heranca: {},
}

const SECOES = ['identidade', 'aparencia', 'login', 'textos', 'seo', 'heranca'] as const
type Secao = typeof SECOES[number]
const chave = (s: Secao) => `edu.geral.${s}`

// ── Validação: só campos conhecidos, com tipo e limite. Valor fora da lista
//    vira null (= usa o padrão) em vez de quebrar a tela pública. ──
const txt = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, max) : null
}
const cor = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null
}
const umDe = (v: unknown, ok: string[]): string | null => (typeof v === 'string' && ok.includes(v) ? v : null)
const sn = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
// URL interna (/uploads/…) ou https — nada de javascript: num atributo de imagem/link.
const url = (v: unknown): string | null => {
  const s = txt(v, 500)
  // Sem aspas, parênteses, espaços ou < >: a URL vai parar em atributo HTML e
  // em url("…") de CSS (fundo do painel do login).
  if (!s || /["'()\s<>\\]/.test(s)) return null
  return /^https:\/\//i.test(s) || /^\/[^/]/.test(s) ? s : null
}

function limpar(secao: Secao, v: any): any {
  if (secao === 'textos') return limparTextos(v)
  const o = v && typeof v === 'object' ? v : {}
  if (secao === 'heranca') {
    const out: Record<string, Heranca> = {}
    for (const [id, h] of Object.entries(o)) {
      if (!/^\d{1,9}$/.test(id) || !h || typeof h !== 'object') continue
      const x = h as any
      out[id] = { marca: x.marca === true, textos: x.textos === true, seo: x.seo === true }
    }
    return out
  }
  if (secao === 'seo') {
    const px = o.pixels && typeof o.pixels === 'object' ? o.pixels : {}
    const id = (v: unknown, re: RegExp) => { const t = txt(v, 40); return t && re.test(t) ? t : null }
    return {
      ogImageUrl: url(o.ogImageUrl),
      pixels: {
        ga4Id: id(px.ga4Id, /^G-[A-Z0-9]{4,20}$/i),
        gtmId: id(px.gtmId, /^GTM-[A-Z0-9]{4,12}$/i),
        metaPixelId: id(px.metaPixelId, /^\d{5,20}$/),
        tiktokPixelId: id(px.tiktokPixelId, /^[A-Z0-9]{8,30}$/i),
        linkedinPartnerId: id(px.linkedinPartnerId, /^\d{3,12}$/),
      },
    } satisfies GeralSeo
  }
  if (secao === 'identidade') {
    return {
      nome: txt(o.nome, 120), logoUrl: url(o.logoUrl), faviconUrl: url(o.faviconUrl),
      logoLink: url(o.logoLink), rodape: txt(o.rodape, 300),
    } satisfies GeralIdentidade
  }
  if (secao === 'aparencia') {
    return {
      corPrincipal: cor(o.corPrincipal), corApoio: cor(o.corApoio),
      fonte: umDe(o.fonte, ['inter', 'roboto', 'poppins', 'system']),
      raio: umDe(o.raio, ['sharp', 'medium', 'rounded']),
      botao: umDe(o.botao, ['reta', 'pill']), caixaAlta: sn(o.caixaAlta),
      escala: umDe(o.escala, ['compacta', 'padrao', 'ampla']),
      largura: umDe(o.largura, ['estreita', 'padrao', 'ampla']),
      espacamento: umDe(o.espacamento, ['compacto', 'padrao', 'arejado']),
      corTexto: cor(o.corTexto), corTextoSuave: cor(o.corTextoSuave), corFundo: cor(o.corFundo),
      corCartao: cor(o.corCartao), corLinha: cor(o.corLinha),
      corSucesso: cor(o.corSucesso), corPendente: cor(o.corPendente), corErro: cor(o.corErro),
    } satisfies GeralAparencia
  }
  const itens = Array.isArray(o.painelItens)
    ? o.painelItens.map((i: unknown) => txt(i, 120)).filter(Boolean).slice(0, 6) as string[]
    : null
  const veu = Number(o.painelVeu)
  return {
    painelTitulo: txt(o.painelTitulo, 120), painelSubtitulo: txt(o.painelSubtitulo, 300),
    // Lista vazia salva = "sem itens" (diferente de null = itens padrão).
    painelItens: itens,
    painelImagemUrl: url(o.painelImagemUrl),
    painelVeu: Number.isFinite(veu) && o.painelVeu !== null && o.painelVeu !== '' ? Math.max(0, Math.min(100, Math.round(veu))) : null,
    painelLado: umDe(o.painelLado, ['esquerda', 'direita']),
    painelCorDe: cor(o.painelCorDe), painelCorPara: cor(o.painelCorPara),
    formTitulo: txt(o.formTitulo, 120), formSubtitulo: txt(o.formSubtitulo, 300),
    modoEmail: sn(o.modoEmail), modoCodigo: sn(o.modoCodigo),
    esqueciTexto: txt(o.esqueciTexto, 80), recuperarTitulo: txt(o.recuperarTitulo, 120), recuperarTexto: txt(o.recuperarTexto, 400),
  } satisfies GeralLogin
}

// Cache curto: a tela pública lê isto a cada acesso.
let cache: { em: number; valor: EduGeral } | null = null

export async function lerEduGeral(): Promise<EduGeral> {
  if (cache && Date.now() - cache.em < 30_000) return cache.valor
  const linhas = await prisma.setting.findMany({ where: { key: { in: SECOES.map(chave) } }, select: { key: true, value: true } })
  const valor: EduGeral = JSON.parse(JSON.stringify(VAZIO))
  for (const s of SECOES) {
    const l = linhas.find((x) => x.key === chave(s))
    if (l?.value) (valor as any)[s] = s === 'textos' || s === 'heranca' ? limpar(s, l.value) : { ...(VAZIO as any)[s], ...limpar(s, l.value) }
  }
  cache = { em: Date.now(), valor }
  return valor
}

const ROTULO: Record<Secao, string> = {
  identidade: 'Configurações Gerais › Identidade',
  aparencia: 'Configurações Gerais › Aparência',
  login: 'Configurações Gerais › Tela de login',
  textos: 'Configurações Gerais › Textos do portal',
  seo: 'Configurações Gerais › SEO e medição',
  heranca: 'Configurações Gerais › Portais que seguem as Gerais',
}

/** Grava só as seções enviadas; as outras ficam como estão. */
export async function salvarEduGeral(parcial: Partial<Record<Secao, unknown>>): Promise<EduGeral> {
  for (const s of SECOES) {
    if (parcial[s] === undefined) continue
    const value = limpar(s, parcial[s])
    await prisma.setting.upsert({
      where: { key: chave(s) },
      create: { key: chave(s), value, label: ROTULO[s], grp: 'edu.geral', fieldType: 'json' },
      update: { value },
    })
  }
  cache = null
  return lerEduGeral()
}

export function esquecerCacheEduGeral() { cache = null }

// ── Marca pública: o portal manda no que tem; as Gerais completam o vazio ──
const DO_PORTAL: Array<[string, (g: EduGeral) => unknown]> = [
  ['brandLogoUrl', (g) => g.identidade.logoUrl],
  ['brandFaviconUrl', (g) => g.identidade.faviconUrl],
  ['brandLogoLink', (g) => g.identidade.logoLink],
  ['brandFooterText', (g) => g.identidade.rodape],
  ['brandPrimaryColor', (g) => g.aparencia.corPrincipal],
  ['brandSecondaryColor', (g) => g.aparencia.corApoio],
  ['brandFontFamily', (g) => g.aparencia.fonte],
  ['brandRadiusScale', (g) => g.aparencia.raio],
  ['brandButtonShape', (g) => g.aparencia.botao],
  ['brandButtonUppercase', (g) => g.aparencia.caixaAlta],
  ['brandTypeScale', (g) => g.aparencia.escala],
  ['brandContentWidth', (g) => g.aparencia.largura],
]

/** O que só existe nas Gerais e vale em todas as telas (cores neutras, espaçamento). */
export function temaGeral(g: EduGeral) {
  const a = g.aparencia
  return {
    espacamento: a.espacamento, corTexto: a.corTexto, corTextoSuave: a.corTextoSuave, corFundo: a.corFundo,
    corCartao: a.corCartao, corLinha: a.corLinha, corSucesso: a.corSucesso, corPendente: a.corPendente, corErro: a.corErro,
  }
}

export function herancaDoPortal(g: EduGeral, portalId: unknown): Heranca {
  const h = portalId !== null && portalId !== undefined ? g.heranca[String(portalId)] : undefined
  return h ?? { marca: false, textos: false, seo: false }
}

// O mapa de herança é lido, alterado e gravado inteiro: duas chaves clicadas
// em seguida (portais diferentes) não podem gravar ao mesmo tempo, ou a
// segunda apagaria a primeira. Fila simples neste processo.
let filaHeranca: Promise<unknown> = Promise.resolve()
function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const r = filaHeranca.then(fn, fn)
  filaHeranca = r.catch(() => {})
  return r
}

/** Grava o que um portal segue (o resto do mapa fica como está). */
export function salvarHeranca(portalId: number, h: Partial<Heranca>): Promise<Heranca> {
  return naFila(() => gravarHeranca(portalId, h))
}
async function gravarHeranca(portalId: number, h: Partial<Heranca>): Promise<Heranca> {
  cache = null // lê o mapa do banco, não do cache
  const g = await lerEduGeral()
  const atual = herancaDoPortal(g, portalId)
  const novo: Heranca = {
    marca: h.marca ?? atual.marca, textos: h.textos ?? atual.textos, seo: h.seo ?? atual.seo,
  }
  await salvarEduGeral({ heranca: { ...g.heranca, [String(portalId)]: novo } })
  return novo
}

/** Portal excluído: tira do mapa de herança. */
export function esquecerHeranca(portalId: number): Promise<void> {
  return naFila(async () => {
  cache = null
  const g = await lerEduGeral()
  if (!g.heranca[String(portalId)]) return
  const { [String(portalId)]: _fora, ...resto } = g.heranca
  await salvarEduGeral({ heranca: resto })
  })
}

/** Pixels: os do portal, ou os das Gerais quando o portal segue as Gerais em SEO ou não tem nenhum. */
function pixelsVazios(px: unknown): boolean {
  return !px || typeof px !== 'object' || !Object.values(px as Record<string, unknown>).some((v) => typeof v === 'string' && v.trim())
}
export function pixelsComGeral(pixelConfig: unknown, g: EduGeral, h: Heranca): unknown {
  const temGeral = !pixelsVazios(g.seo.pixels)
  if (temGeral && (h.seo || pixelsVazios(pixelConfig))) return g.seo.pixels
  return pixelConfig
}
export function ogImageComGeral(og: string | null | undefined, g: EduGeral, h: Heranca): string | null {
  if (g.seo.ogImageUrl && (h.seo || !og)) return g.seo.ogImageUrl
  return og ?? null
}

/**
 * Marca de um portal com as Gerais:
 * - portal que SEGUE as Gerais (Branding › Configurações Gerais): o que está
 *   preenchido nas Gerais vale por cima do portal;
 * - portal personalizado: as Gerais só completam o que ficou vazio.
 * Anexa o tema geral e os textos. Sem portal, a marca é a das Gerais.
 */
export function vestirMarca<T extends Record<string, any>>(marca: T | null, g: EduGeral): T & { geral: ReturnType<typeof temaGeral>; textos: Record<string, string> } {
  const base: Record<string, any> = marca ? { ...marca } : { nome: g.identidade.nome }
  const h = herancaDoPortal(g, base.id)
  for (const [campo, daGeral] of DO_PORTAL) {
    const v = daGeral(g)
    if (v === null || v === undefined) continue
    if (h.marca || base[campo] === null || base[campo] === undefined) base[campo] = v
  }
  // Segue os textos das Gerais: os rótulos próprios do portal deixam de valer.
  if (h.textos && 'brandLabels' in base) base.brandLabels = null
  if ('ogImageUrl' in base) base.ogImageUrl = ogImageComGeral(base.ogImageUrl, g, h)
  if ('pixelConfig' in base) base.pixelConfig = pixelsComGeral(base.pixelConfig, g, h)
  // Textos editados nas Gerais: o portal-app usa com t('chave', 'padrão').
  return { ...(base as T), geral: temaGeral(g), textos: g.textos }
}

/** Textos e opções da tela de entrar, já com os padrões resolvidos. */
export function loginResolvido(g: EduGeral, extras: { linkHoras: number; prefixoCodigo: string | null }) {
  const l = g.login
  const horas = String(extras.linkHoras)
  return {
    painelTitulo: l.painelTitulo ?? PADROES_LOGIN.painelTitulo,
    painelSubtitulo: l.painelSubtitulo ?? PADROES_LOGIN.painelSubtitulo,
    painelItens: l.painelItens ?? PADROES_LOGIN.painelItens,
    painelImagemUrl: l.painelImagemUrl,
    painelVeu: l.painelVeu,
    painelLado: l.painelLado ?? 'esquerda',
    painelCorDe: l.painelCorDe,
    painelCorPara: l.painelCorPara,
    formTitulo: l.formTitulo ?? PADROES_LOGIN.formTitulo,
    formSubtitulo: l.formSubtitulo ?? PADROES_LOGIN.formSubtitulo,
    // Nunca as duas desligadas: sem forma de entrar a tela ficaria inútil.
    modoEmail: l.modoEmail === false && l.modoCodigo === false ? true : l.modoEmail !== false,
    modoCodigo: l.modoCodigo !== false,
    esqueciTexto: l.esqueciTexto ?? PADROES_LOGIN.esqueciTexto,
    recuperarTitulo: l.recuperarTitulo ?? PADROES_LOGIN.recuperarTitulo,
    recuperarTexto: (l.recuperarTexto ?? PADROES_LOGIN.recuperarTexto).replace(/\{horas\}/g, horas),
    linkHoras: extras.linkHoras,
    prefixoCodigo: extras.prefixoCodigo || 'MAT',
  }
}
