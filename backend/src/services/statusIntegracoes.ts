// src/services/statusIntegracoes.ts
//
// Barra de status das integrações — o que está funcionando, o que está por um
// fio e o que parou, num lugar que ninguém deixa de ver (topbar + faixa fixa).
//
// Existe por causa de 29/09→19/10/2026: a IA de terram e ineprotec ficou três
// semanas recusando todas as chamadas ("reached your specified API usage
// limits", OpenAI sem crédito) e ninguém percebeu. O sino tinha alerta para
// isso — e passava despercebido no meio dos outros. Estado de integração não é
// notificação: é condição permanente, e merece um lugar fixo na tela.
//
// Cada integração é um SENSOR com duas perguntas:
//
//   configurado? — o cliente tem isto? Sem configurar, o item não aparece na
//                  barra. Cliente que só usa WhatsApp não pode ver "Google
//                  fora do ar" o dia inteiro.
//   ler()        — como está agora: ok | atencao | fora, com o motivo em
//                  linguagem de gente ("conexão expirou") e o detalhe técnico
//                  separado (só quem configura vê).
//
// Leitura que custa chamada externa (IA, Meta, SMTP, SMS) tem cache próprio
// por sensor: a volta do relógio é de 2 minutos, mas a IA só é sondada de hora
// em hora (≈5 tokens) — o resto do tempo vale a última sonda ou a falha real
// que o próprio sistema registrou (alerta integration.ai_provider).
//
// Nada aqui envia mensagem a ninguém: só lê.

import { prisma } from '../lib/prisma.js'
import { ERROS_DE_CONTA } from '../lib/cloudApiErrosDeConta.js'

export type EstadoItem = 'ok' | 'atencao' | 'fora'

export interface Leitura {
  estado: EstadoItem
  /** Curto, para a barra e para quem não é técnico: "conexão expirou". */
  motivo: string
  /** Texto do provedor/erro — só para quem configura. */
  detalhe?: string | null
}

export interface ItemDef {
  id: string
  rotulo: string
  /** Para onde o botão de resolver leva (tela do próprio sistema). */
  acao: { rotulo: string; href: string }
}

export interface ItemStatus extends ItemDef, Leitura {
  /** Desde quando está NESTE estado (ISO). */
  desde: string
  verificadoEm: string
}

export interface ConfigItem { mostrar: boolean; avisoFixo: boolean }
export interface ConfigBarra {
  /** Liga/desliga a barra inteira nesta instalação. */
  ativo: boolean
  /** Quem vê a faixa vermelha fixa: todos que veem a barra, ou só quem configura. */
  faixaPara: 'todos' | 'gestao'
  itens: Record<string, ConfigItem>
}

const CONFIG_KEY = 'status_integracoes.config'
const ESTADO_KEY = 'status_integracoes.estado'

const PADRAO_ITEM: ConfigItem = { mostrar: true, avisoFixo: true }

const GRAPH = 'https://graph.facebook.com/v23.0'

// ── utilidades ──────────────────────────────────────────────────────────────

function txt(v: unknown): string {
  if (v === null || v === undefined) return ''
  return (typeof v === 'string' ? v : String(v)).replace(/^"|"$/g, '').trim()
}

async function setting(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  return txt(row?.value)
}

async function settingJson<T>(key: string): Promise<T | null> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  if (!row || row.value === null || row.value === undefined) return null
  try {
    return (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as T
  } catch {
    return null
  }
}

async function gravarJson(key: string, valor: unknown, label: string): Promise<void> {
  const value = JSON.stringify(valor)
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value, label, grp: 'sistema', fieldType: 'json' },
  })
}

function curto(s: unknown, n = 300): string {
  return String((s as any)?.message ?? s ?? '').replace(/\s+/g, ' ').slice(0, n)
}

/**
 * Sonda com cache: chamada externa só quando o resultado anterior venceu.
 * Falha vence mais cedo (10 min): quem acabou de recarregar o crédito não
 * pode esperar uma hora para a barra ficar verde.
 */
const sondas = new Map<string, { em: number; valor: any }>()
const TTL_FALHA = 10 * 60_000
async function comCache<T>(chave: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const c = sondas.get(chave)
  const ttl = (c?.valor as any)?.ok === false ? Math.min(ttlMs, TTL_FALHA) : ttlMs
  if (c && Date.now() - c.em < ttl) return c.valor as T
  const valor = await fn()
  sondas.set(chave, { em: Date.now(), valor })
  return valor
}

/** Esquece as sondas — "Verificar agora" e testes. */
export function esquecerSondas(): void {
  sondas.clear()
}

const MIN = 60_000

// ── IA ──────────────────────────────────────────────────────────────────────

type Provedor = 'anthropic' | 'openai'
const NOME: Record<Provedor, string> = { anthropic: 'Anthropic', openai: 'OpenAI' }

/** Classifica a recusa do provedor em motivo de gente. */
export function motivoDaRecusaIa(texto: string): { motivo: string; definitiva: boolean } {
  const m = texto.toLowerCase()
  if (/usage limits|spend limit|regain access/.test(m)) return { motivo: 'limite de gasto atingido', definitiva: true }
  if (/credit balance|no credits|insufficient[_ ]quota|exceeded your current quota|billing|credit_balance/.test(m)) {
    return { motivo: 'sem crédito', definitiva: true }
  }
  if (/invalid[_ ]api[_ ]key|invalid x-api-key|authentication|unauthorized|incorrect api key|\b401\b/.test(m)) {
    return { motivo: 'chave inválida', definitiva: true }
  }
  if (/permission|\b403\b/.test(m)) return { motivo: 'chave sem permissão', definitiva: true }
  if (/rate limit|\b429\b|overloaded|\b529\b/.test(m)) return { motivo: 'sobrecarregado', definitiva: false }
  return { motivo: 'instável', definitiva: false }
}

async function sondarIa(p: Provedor, chave: string): Promise<{ ok: boolean; texto?: string }> {
  try {
    const resp = p === 'anthropic'
      ? await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }),
        signal: AbortSignal.timeout(15_000),
      })
      : await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }),
        signal: AbortSignal.timeout(15_000),
      })
    if (resp.ok) return { ok: true }
    return { ok: false, texto: `HTTP ${resp.status}: ${curto(await resp.text().catch(() => ''), 400)}` }
  } catch (e) {
    return { ok: false, texto: curto(e) }
  }
}

async function chavesDeIa(): Promise<Partial<Record<Provedor, string>>> {
  const { getAnthropicKey, getOpenAiKey } = await import('../lib/aiKeys.js')
  const out: Partial<Record<Provedor, string>> = {}
  const a = await getAnthropicKey().catch(() => null)
  const o = await getOpenAiKey().catch(() => null)
  if (a) out.anthropic = a
  if (o) out.openai = o
  return out
}

async function lerIa(): Promise<Leitura> {
  const chaves = await chavesDeIa()
  const { getPrimaryProvider } = await import('../lib/aiKeys.js')
  const preferido = await getPrimaryProvider().catch(() => 'anthropic' as Provedor)
  const disponiveis = (Object.keys(chaves) as Provedor[])
  // Principal é o preferido se tiver chave; senão o único que houver.
  const principal: Provedor = chaves[preferido] ? preferido : disponiveis[0]!
  const reserva = disponiveis.find((p) => p !== principal)

  const res: Partial<Record<Provedor, { ok: boolean; texto?: string }>> = {}
  for (const p of disponiveis) {
    res[p] = await comCache(`ia:${p}`, 60 * MIN, () => sondarIa(p, chaves[p]!))
  }

  // A falha REAL que o sistema registrou vale mais que a sonda de uma hora atrás.
  const alerta = await prisma.alert.findFirst({
    where: { dedupeKey: 'integration.ai_provider', status: 'open' },
    select: { body: true, metadata: true },
  }).catch(() => null)

  const rp = res[principal]!
  const rr = reserva ? res[reserva] : undefined
  const falhaP = !rp.ok ? motivoDaRecusaIa(rp.texto ?? '') : null
  const falhaR = rr && !rr.ok ? motivoDaRecusaIa(rr.texto ?? '') : null

  if (alerta && rp.ok && (!rr || rr.ok)) {
    // A sonda passou, mas o sistema viu recusa depois dela: confiar na recusa
    // até a próxima chamada bem-sucedida fechar o alerta.
    return { estado: 'fora', motivo: 'recusando chamadas', detalhe: curto((alerta.metadata as any)?.detalhe ?? alerta.body, 400) }
  }
  if (falhaP && (!rr || falhaR)) {
    // Sem nenhum provedor respondendo: o atendimento por IA parou.
    const ambos = reserva ? ` · reserva (${NOME[reserva]}): ${falhaR!.motivo}` : ''
    return {
      estado: falhaP.definitiva ? 'fora' : 'atencao',
      motivo: `${NOME[principal]}: ${falhaP.motivo}${reserva ? ' e reserva também' : ''}`,
      detalhe: `${rp.texto ?? ''}${ambos}`,
    }
  }
  if (falhaP) {
    return {
      estado: 'atencao',
      motivo: `${NOME[principal]}: ${falhaP.motivo}, usando a reserva`,
      detalhe: rp.texto ?? null,
    }
  }
  if (falhaR) {
    return {
      estado: 'atencao',
      motivo: `reserva (${NOME[reserva!]}): ${falhaR.motivo}`,
      detalhe: rr!.texto ?? null,
    }
  }
  return { estado: 'ok', motivo: reserva ? `${NOME[principal]} + reserva` : NOME[principal] }
}

// ── WhatsApp API (Cloud API oficial) ─────────────────────────────────────────


async function lerCloudApi(): Promise<Leitura> {
  const conexoes = await prisma.cloudApiConnection.findMany({
    where: { active: true },
    select: { id: true, displayPhone: true, phoneNumberId: true, systemUserToken: true, tokenExpiresAt: true, qualityRating: true },
    orderBy: { id: 'asc' },
  })
  const ERROS = ERROS_DE_CONTA
  const desde = new Date(Date.now() - 2 * 3600_000)
  const fora: string[] = []
  const atencao: string[] = []
  const detalhes: string[] = []

  for (const c of conexoes) {
    const nome = c.displayPhone || `número ${c.id}`
    if (c.tokenExpiresAt && c.tokenExpiresAt.getTime() < Date.now()) {
      fora.push(`${nome}: token vencido`)
      continue
    }
    // Sonda leve: a Meta aceita o token e devolve status/qualidade do número.
    const sonda = await comCache(`cloud:${c.id}`, 30 * MIN, async () => {
      // Token que não decifra não é rede fora: o número não envia até alguém
      // conectar de novo (chave de cifra trocada, cópia de outro servidor).
      let token: string
      try {
        const { decryptToken } = await import('./cloudApi.js')
        token = decryptToken(c.systemUserToken)
      } catch (e) {
        return { ok: false, ilegivel: true, texto: curto(e) }
      }
      try {
        const r = await fetch(`${GRAPH}/${c.phoneNumberId}?fields=status,quality_rating`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        })
        const corpo = await r.json().catch(() => ({})) as any
        if (r.ok) return { ok: true, status: corpo.status as string | undefined, quality: corpo.quality_rating as string | undefined }
        return { ok: false, code: corpo?.error?.code as number | undefined, texto: curto(corpo?.error?.message ?? `HTTP ${r.status}`) }
      } catch (e) {
        return { ok: false, rede: true, texto: curto(e) }
      }
    })
    if (!sonda.ok) {
      if ((sonda as any).rede) { atencao.push(`${nome}: Meta não respondeu`); detalhes.push(`${nome}: ${sonda.texto}`); continue }
      const code = (sonda as any).code
      fora.push((sonda as any).ilegivel ? `${nome}: credencial ilegível, conecte de novo`
        : code === 190 ? `${nome}: conexão expirou` : `${nome}: Meta recusou o acesso`)
      detalhes.push(`${nome}: ${sonda.texto}`)
      continue
    }
    const status = String((sonda as any).status || '').toUpperCase()
    if (status && !['CONNECTED', 'PENDING', ''].includes(status)) {
      fora.push(`${nome}: número ${status.toLowerCase()}`)
      continue
    }
    // Erro de conta nas últimas 2h (pagamento, bloqueio...) — a Meta aceita o
    // token, mas não entrega nada.
    const erro = await prisma.cloudApiMessageLog.findFirst({
      where: { cloudApiConnectionId: c.id, errorCode: { in: Object.keys(ERROS) }, createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
      select: { errorCode: true },
    }).catch(() => null)
    if (erro?.errorCode) {
      fora.push(`${nome}: ${ERROS[erro.errorCode]!.split(' —')[0]!.replace(/\.$/, '').toLowerCase()}`)
      continue
    }
    const q = String((sonda as any).quality || c.qualityRating || '').toUpperCase()
    if (q === 'RED') atencao.push(`${nome}: qualidade baixa`)
    else if (q === 'YELLOW') atencao.push(`${nome}: qualidade média`)
  }

  const varios = conexoes.length > 1
  if (fora.length) {
    return { estado: 'fora', motivo: varios || fora.length > 1 ? fora.join(' · ') : fora[0]!.split(': ').slice(1).join(': '), detalhe: detalhes.join(' | ') || null }
  }
  if (atencao.length) {
    return { estado: 'atencao', motivo: varios ? atencao.join(' · ') : atencao[0]!.split(': ').slice(1).join(': '), detalhe: detalhes.join(' | ') || null }
  }
  return { estado: 'ok', motivo: varios ? `${conexoes.length} números` : (conexoes[0]?.displayPhone || 'conectado') }
}

// ── WhatsApp (Evolution, não-oficial) ────────────────────────────────────────

async function lerEvolution(): Promise<Leitura> {
  const { getLastHealth } = await import('./evolutionMonitor.js')
  const h = getLastHealth()
  if (!h) return { estado: 'ok', motivo: 'verificando…' }
  if (h.api.status !== 'online') {
    return { estado: 'fora', motivo: 'servidor do WhatsApp fora do ar', detalhe: h.api.error }
  }
  const ativas = h.instances.filter((i) => i.dbActive)
  const caidas = ativas.filter((i) => i.connectionState !== 'open')
  if (caidas.length) {
    const nomes = caidas.map((i) => i.name || i.instanceName)
    return {
      estado: 'fora',
      motivo: caidas.length === 1 ? `${nomes[0]} desconectada` : `${caidas.length} linhas desconectadas`,
      detalhe: caidas.map((i) => `${i.name || i.instanceName}: ${i.connectionState}${i.error ? ` (${i.error})` : ''}`).join(' | '),
    }
  }
  if (h.webhook.status !== 'ok') {
    return { estado: 'atencao', motivo: 'mensagens podem não chegar ao painel', detalhe: `webhook ${h.webhook.status}: esperado ${h.webhook.expected}, atual ${h.webhook.current || '(vazio)'}` }
  }
  return { estado: 'ok', motivo: ativas.length > 1 ? `${ativas.length} linhas` : 'conectado' }
}

// ── Instagram / Messenger ────────────────────────────────────────────────────

interface IgConexao { ativo: boolean; token: string; expira: number; via: 'instagram' | 'facebook'; nome: string }

async function conexaoInstagram(): Promise<IgConexao | null> {
  const v2 = await settingJson<any>('instagram.connection_v2')
  if (v2?.accessToken && v2.active !== false) {
    return { ativo: true, token: v2.accessToken, expira: Number(v2.tokenExpiresAt) || 0, via: 'instagram', nome: v2.username ? `@${v2.username}` : 'Instagram' }
  }
  const v1 = await settingJson<any>('instagram.connection')
  if (v1?.pageAccessToken && v1.active !== false) {
    return { ativo: true, token: v1.pageAccessToken, expira: Number(v1.tokenExpiresAt) || 0, via: 'facebook', nome: v1.igUsername ? `@${v1.igUsername}` : (v1.pageName || 'Instagram') }
  }
  return null
}

async function lerInstagram(): Promise<Leitura> {
  const c = await conexaoInstagram()
  if (!c) return { estado: 'fora', motivo: 'desconectado' }
  if (c.expira && c.expira < Date.now()) return { estado: 'fora', motivo: 'conexão expirou' }
  const sonda = await comCache('instagram', 30 * MIN, async () => {
    const url = c.via === 'instagram'
      ? `https://graph.instagram.com/me?fields=id&access_token=${encodeURIComponent(c.token)}`
      : `${GRAPH}/me?fields=id&access_token=${encodeURIComponent(c.token)}`
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      const corpo = await r.json().catch(() => ({})) as any
      return r.ok ? { ok: true } : { ok: false, code: corpo?.error?.code, texto: curto(corpo?.error?.message ?? `HTTP ${r.status}`) }
    } catch (e) {
      return { ok: false, rede: true, texto: curto(e) }
    }
  })
  if (!sonda.ok) {
    if ((sonda as any).rede) return { estado: 'atencao', motivo: 'Meta não respondeu', detalhe: sonda.texto }
    return { estado: 'fora', motivo: (sonda as any).code === 190 ? 'conexão expirou' : 'Meta recusou o acesso', detalhe: sonda.texto }
  }
  const dias = c.expira ? Math.floor((c.expira - Date.now()) / 86400_000) : null
  if (dias !== null && dias <= 7) return { estado: 'atencao', motivo: `conexão vence em ${Math.max(dias, 0)} dia(s)` }
  return { estado: 'ok', motivo: c.nome }
}

// ── Meta (página: leads de formulário e anúncios) ───────────────────────────

async function lerMeta(): Promise<Leitura> {
  const paginas = await prisma.metaIntegration.findMany({
    where: { active: true },
    select: { id: true, pageName: true, pageAccessToken: true, userAccessToken: true },
    orderBy: { id: 'asc' },
  })
  const fora: string[] = []
  const atencao: string[] = []
  const detalhes: string[] = []
  for (const p of paginas) {
    const token = p.userAccessToken || p.pageAccessToken
    const sonda = await comCache(`meta:${p.id}`, 30 * MIN, async () => {
      try {
        const r = await fetch(`${GRAPH}/me?fields=id&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15_000) })
        const corpo = await r.json().catch(() => ({})) as any
        return r.ok ? { ok: true } : { ok: false, code: corpo?.error?.code, texto: curto(corpo?.error?.message ?? `HTTP ${r.status}`) }
      } catch (e) {
        return { ok: false, rede: true, texto: curto(e) }
      }
    })
    if (sonda.ok) continue
    if ((sonda as any).rede) { atencao.push(`${p.pageName}: Meta não respondeu`); detalhes.push(sonda.texto ?? ''); continue }
    fora.push(`${p.pageName}: ${(sonda as any).code === 190 ? 'conexão expirou' : 'Meta recusou o acesso'}`)
    detalhes.push(`${p.pageName}: ${sonda.texto}`)
  }
  const um = paginas.length === 1
  if (fora.length) return { estado: 'fora', motivo: um ? fora[0]!.split(': ').slice(1).join(': ') : fora.join(' · '), detalhe: detalhes.join(' | ') }
  if (atencao.length) return { estado: 'atencao', motivo: um ? 'Meta não respondeu' : atencao.join(' · '), detalhe: detalhes.join(' | ') }
  return { estado: 'ok', motivo: um ? paginas[0]!.pageName : `${paginas.length} páginas` }
}

// ── Google ──────────────────────────────────────────────────────────────────

async function lerGoogle(): Promise<Leitura> {
  const contas = await prisma.googleConnection.findMany({
    where: { active: true },
    select: { id: true, email: true, refreshToken: true, tokenExpiresAt: true },
  })
  const fora: string[] = []
  const detalhes: string[] = []
  for (const g of contas) {
    // Falha real (invalid_grant) registrada por quem tentou usar a conta.
    const falha = await prisma.alert.findFirst({
      where: { dedupeKey: `integration:error:google:${g.id}`, status: 'open' },
      select: { body: true, firstSeenAt: true },
    }).catch(() => null)
    if (falha) { fora.push(`${g.email}: conexão expirou`); detalhes.push(`${g.email}: ${curto(falha.body)}`); continue }
    if (!g.refreshToken?.trim()) { fora.push(`${g.email}: sem permissão de renovação`); continue }
    if (g.tokenExpiresAt && g.tokenExpiresAt.getTime() < Date.now() - 86400_000) {
      fora.push(`${g.email}: não renova desde ${g.tokenExpiresAt.toLocaleDateString('pt-BR')}`)
    }
  }
  if (fora.length) {
    return { estado: 'fora', motivo: contas.length === 1 ? fora[0]!.split(': ').slice(1).join(': ') : fora.join(' · '), detalhe: detalhes.join(' | ') || null }
  }

  // Integrações que funcionam com a conta mas acusam erro próprio.
  const [cal, sheets, gmail] = await Promise.all([
    prisma.googleCalendarIntegration.count({ where: { active: true, lastError: { not: null } } }).catch(() => 0),
    prisma.googleSheetIntegration.count({ where: { active: true, lastError: { not: null } } }).catch(() => 0),
    prisma.gmailConfig.count({ where: { active: true, watchExpiration: { lt: new Date() } } }).catch(() => 0),
  ])
  const avisos: string[] = []
  if (gmail) avisos.push('Gmail parou de receber')
  if (cal) avisos.push(cal === 1 ? 'agenda com erro' : `${cal} agendas com erro`)
  if (sheets) avisos.push(sheets === 1 ? 'planilha com erro' : `${sheets} planilhas com erro`)
  if (avisos.length) return { estado: 'atencao', motivo: avisos.join(' · ') }
  return { estado: 'ok', motivo: contas.length === 1 ? contas[0]!.email : `${contas.length} contas` }
}

// ── E-mail ──────────────────────────────────────────────────────────────────

async function lerEmail(): Promise<Leitura> {
  const { getEmailConfig } = await import('./notify.js')
  const cfg = await getEmailConfig()
  const provedor = txt(cfg['email.provider']) || (txt(cfg['smtp.host']) ? 'smtp' : 'resend')
  if (provedor !== 'smtp') {
    // Resend: a chave costuma ser só de envio (não lista domínio) — não há
    // sonda barata que não mande e-mail. Configurado conta como funcionando.
    return { estado: 'ok', motivo: 'Resend' }
  }
  const host = txt(cfg['smtp.host'])
  const sonda = await comCache('smtp', 30 * MIN, async () => {
    try {
      const nodemailer = (await import('nodemailer')).default
      const t = nodemailer.createTransport({
        host, port: parseInt(txt(cfg['smtp.port']) || '587', 10), secure: txt(cfg['smtp.secure']) === 'true',
        auth: { user: txt(cfg['smtp.user']), pass: txt(cfg['smtp.pass']) }, connectionTimeout: 10_000,
      })
      await t.verify()
      return { ok: true }
    } catch (e) {
      return { ok: false, texto: curto(e) }
    }
  })
  if (sonda.ok) return { estado: 'ok', motivo: host }
  const m = String(sonda.texto ?? '').toLowerCase()
  const motivo = /auth|535|534|credentials|password|login/.test(m) ? 'usuário ou senha recusados' : 'servidor de e-mail não responde'
  return { estado: 'fora', motivo, detalhe: sonda.texto }
}

// ── SMS ─────────────────────────────────────────────────────────────────────

async function lerSms(): Promise<Leitura> {
  const chave = await setting('sms.comtele.api_key')
  const sonda = await comCache('sms', 30 * MIN, async () => {
    try {
      // /credits só consulta saldo: não envia nada.
      const r = await fetch('https://sms.comtele.com.br/api/v2/credits', {
        headers: { 'auth-key': chave }, signal: AbortSignal.timeout(15_000),
      })
      const corpo = await r.json().catch(() => ({})) as any
      return r.ok ? { ok: true, saldo: Number(corpo?.Object ?? corpo?.object ?? NaN) } : { ok: false, status: r.status, texto: curto(corpo?.Message ?? corpo?.message ?? `HTTP ${r.status}`) }
    } catch (e) {
      return { ok: false, rede: true, texto: curto(e) }
    }
  })
  if (!sonda.ok) {
    if ((sonda as any).rede) return { estado: 'atencao', motivo: 'provedor não respondeu', detalhe: sonda.texto }
    return { estado: 'fora', motivo: (sonda as any).status === 401 ? 'chave recusada' : 'provedor recusou', detalhe: sonda.texto }
  }
  const saldo = (sonda as any).saldo
  if (Number.isFinite(saldo) && saldo <= 0) return { estado: 'fora', motivo: 'sem crédito' }
  if (Number.isFinite(saldo) && saldo < 100) return { estado: 'atencao', motivo: `${saldo} créditos restantes` }
  return { estado: 'ok', motivo: Number.isFinite(saldo) ? `${saldo} créditos` : 'Comtele' }
}

// ── Catálogo ────────────────────────────────────────────────────────────────

interface Sensor extends ItemDef {
  configurado: () => Promise<boolean>
  ler: () => Promise<Leitura>
}

export const SENSORES: Sensor[] = [
  {
    id: 'ia', rotulo: 'IA',
    acao: { rotulo: 'Abrir IA / Tokens', href: '/app/integrations/ai' },
    configurado: async () => Object.keys(await chavesDeIa()).length > 0,
    ler: lerIa,
  },
  {
    id: 'whatsapp_api', rotulo: 'WhatsApp API',
    acao: { rotulo: 'Abrir WhatsApp API', href: '/app/cloud-api' },
    configurado: async () => (await prisma.cloudApiConnection.count({ where: { active: true } })) > 0,
    ler: lerCloudApi,
  },
  {
    id: 'whatsapp', rotulo: 'WhatsApp',
    acao: { rotulo: 'Abrir WhatsApp', href: '/app/whatsapp' },
    configurado: async () => !!process.env.EVOLUTION_API_URL && (await prisma.whatsAppInstance.count()) > 0,
    ler: lerEvolution,
  },
  {
    id: 'instagram', rotulo: 'Instagram',
    acao: { rotulo: 'Reconectar Instagram', href: '/app/instagram' },
    configurado: async () => (await conexaoInstagram()) !== null,
    ler: lerInstagram,
  },
  {
    id: 'meta', rotulo: 'Meta Ads',
    acao: { rotulo: 'Abrir Meta Ads', href: '/app/meta-ads' },
    configurado: async () => (await prisma.metaIntegration.count({ where: { active: true } })) > 0,
    ler: lerMeta,
  },
  {
    id: 'google', rotulo: 'Google',
    acao: { rotulo: 'Reconectar conta', href: '/app/google' },
    configurado: async () => (await prisma.googleConnection.count({ where: { active: true } })) > 0,
    ler: lerGoogle,
  },
  {
    id: 'email', rotulo: 'E-mail',
    acao: { rotulo: 'Abrir E-mail', href: '/app/integrations/email' },
    configurado: async () => {
      const { getEmailConfig } = await import('./notify.js')
      const c = await getEmailConfig()
      const smtp = !!(txt(c['smtp.host']) && txt(c['smtp.user']) && txt(c['smtp.pass']))
      const resend = !!txt(c['notification.resend_api_key'])
      const prov = txt(c['email.provider'])
      return prov === 'smtp' ? smtp : prov === 'resend' ? resend : (smtp || resend)
    },
    ler: lerEmail,
  },
  {
    id: 'sms', rotulo: 'SMS',
    acao: { rotulo: 'Abrir SMS', href: '/app/integrations/sms' },
    configurado: async () => !!(await setting('sms.comtele.api_key')),
    ler: lerSms,
  },
]

// ── Configuração ────────────────────────────────────────────────────────────

export async function lerConfig(): Promise<ConfigBarra> {
  const raw = await settingJson<Partial<ConfigBarra>>(CONFIG_KEY)
  const itens: Record<string, ConfigItem> = {}
  for (const s of SENSORES) {
    const c = raw?.itens?.[s.id]
    itens[s.id] = {
      mostrar: typeof c?.mostrar === 'boolean' ? c.mostrar : PADRAO_ITEM.mostrar,
      avisoFixo: typeof c?.avisoFixo === 'boolean' ? c.avisoFixo : PADRAO_ITEM.avisoFixo,
    }
  }
  return {
    ativo: typeof raw?.ativo === 'boolean' ? raw.ativo : true,
    faixaPara: raw?.faixaPara === 'gestao' ? 'gestao' : 'todos',
    itens,
  }
}

export async function salvarConfig(entrada: Partial<ConfigBarra>): Promise<ConfigBarra> {
  const atual = await lerConfig()
  const itens = { ...atual.itens }
  for (const [id, c] of Object.entries(entrada.itens ?? {})) {
    if (!itens[id]) continue // id desconhecido não entra
    itens[id] = {
      mostrar: typeof c?.mostrar === 'boolean' ? c.mostrar : itens[id]!.mostrar,
      avisoFixo: typeof c?.avisoFixo === 'boolean' ? c.avisoFixo : itens[id]!.avisoFixo,
    }
  }
  const nova: ConfigBarra = {
    ativo: typeof entrada.ativo === 'boolean' ? entrada.ativo : atual.ativo,
    faixaPara: entrada.faixaPara === 'gestao' || entrada.faixaPara === 'todos' ? entrada.faixaPara : atual.faixaPara,
    itens,
  }
  await gravarJson(CONFIG_KEY, nova, 'Barra de status das integrações — configuração')
  ultimo = null // próxima leitura já respeita a configuração nova
  return nova
}

// ── Leitura completa ────────────────────────────────────────────────────────

export interface Instantaneo {
  verificadoEm: string
  /** Todos os sensores — inclusive os desligados e os não configurados. */
  itens: Array<ItemDef & { configurado: boolean; mostrar: boolean; avisoFixo: boolean; leitura: (Leitura & { desde: string }) | null }>
}

let ultimo: Instantaneo | null = null
let emAndamento: Promise<Instantaneo> | null = null

/** "Desde quando" sobrevive a restart: guardado junto do estado. */
type Memoria = Record<string, { estado: EstadoItem; desde: string }>

async function rodar(): Promise<Instantaneo> {
  const config = await lerConfig()
  const memoria = (await settingJson<Memoria>(ESTADO_KEY)) ?? {}
  const agora = new Date().toISOString()
  const itens: Instantaneo['itens'] = []
  let mudou = false

  for (const s of SENSORES) {
    const cfg = config.itens[s.id] ?? PADRAO_ITEM
    const configurado = await s.configurado().catch(() => false)
    let leitura: (Leitura & { desde: string }) | null = null
    // Desligado ou não configurado não é sondado: sem chamada externa à toa.
    if (configurado && cfg.mostrar && config.ativo) {
      const l = await Promise.race([
        s.ler(),
        new Promise<Leitura>((res) => setTimeout(() => res({ estado: 'atencao', motivo: 'verificação demorou demais' }), 30_000)),
      ]).catch((e): Leitura => ({ estado: 'atencao', motivo: 'não foi possível verificar', detalhe: curto(e) }))
      const anterior = memoria[s.id]
      const desde = anterior && anterior.estado === l.estado ? anterior.desde : agora
      if (!anterior || anterior.estado !== l.estado) { memoria[s.id] = { estado: l.estado, desde }; mudou = true }
      leitura = { ...l, desde }
    }
    itens.push({ id: s.id, rotulo: s.rotulo, acao: s.acao, configurado, mostrar: cfg.mostrar, avisoFixo: cfg.avisoFixo, leitura })
  }
  if (mudou) await gravarJson(ESTADO_KEY, memoria, 'Barra de status das integrações — desde quando').catch(() => {})
  ultimo = { verificadoEm: agora, itens }
  return ultimo
}

/** Leitura atual; refaz se tiver mais que `maxIdadeMs` (padrão: 3 min). */
export async function instantaneo(maxIdadeMs = 3 * MIN): Promise<Instantaneo> {
  if (ultimo && Date.now() - new Date(ultimo.verificadoEm).getTime() < maxIdadeMs) return ultimo
  if (!emAndamento) emAndamento = rodar().finally(() => { emAndamento = null })
  return emAndamento
}

/** "Verificar agora": ignora os caches de sonda e lê tudo de novo. */
export async function verificarAgora(): Promise<Instantaneo> {
  esquecerSondas()
  ultimo = null
  return instantaneo(0)
}

// ── Vigia ───────────────────────────────────────────────────────────────────

export const INTERVALO_MIN = 2
let handle: ReturnType<typeof setInterval> | null = null

export function startStatusIntegracoes(): void {
  // Depois do monitor da Evolution (15s) ter a primeira leitura.
  setTimeout(() => {
    instantaneo(0).catch((e) => console.error('[status] verificação falhou:', e?.message))
    handle = setInterval(() => {
      instantaneo(0).catch((e) => console.error('[status] verificação falhou:', e?.message))
    }, INTERVALO_MIN * MIN)
    console.log(`[status] barra de status das integrações — a cada ${INTERVALO_MIN}min`)
  }, 45_000)
}

export function stopStatusIntegracoes(): void {
  if (handle) { clearInterval(handle); handle = null }
}
