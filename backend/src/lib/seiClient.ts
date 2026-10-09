// src/lib/seiClient.ts
//
// Cliente do SEI (ERP acadêmico) — webservice "Matrícula Externa" (doc v4.0,
// DEZ/2025). Os nomes dos métodos seguem a numeração da documentação (NE003…).
//
// Onde está salvo (Integrações › SEI):
//   - `sei.base_url`     <URL_ERP_SEI>, sem a barra final
//   - `sei.auth_tipo`    nenhum | basic | bearer | header
//   - `sei.username` / `sei.password`   (basic)
//   - `sei.token`        (bearer ou header)
//   - `sei.header_nome`  nome do header quando auth_tipo = header
//   - `sei.enabled`      "true"/"false"
//
// A documentação NÃO descreve a autenticação: por isso os quatro modos ficam
// configuráveis em vez de amarrados a um palpite. Segredos são cifrados pelo
// próprio Setting (lib/secretSettings) por terminarem em password/token.
//
// Toda chamada vira uma linha em SeiChamada (pedido, resposta, status, tempo)
// — sem senha nem token, e sem o binário dos arquivos.

import { prisma } from './prisma.js'
import { decryptSettingValue, isEncrypted } from './secretSettings.js'

export type SeiAuthTipo = 'nenhum' | 'basic' | 'bearer' | 'header'

export interface SeiConfig {
  baseUrl: string
  authTipo: SeiAuthTipo
  username: string
  password: string
  token: string
  headerNome: string
  enabled: boolean
  autoEnviar: boolean
  enviarContrato: boolean
  camposExtras: boolean
}

export const SEI_KEYS = {
  baseUrl: 'sei.base_url',
  authTipo: 'sei.auth_tipo',
  username: 'sei.username',
  password: 'sei.password',
  token: 'sei.token',
  headerNome: 'sei.header_nome',
  enabled: 'sei.enabled',
  autoEnviar: 'sei.auto_enviar',
  enviarContrato: 'sei.enviar_contrato',
  camposExtras: 'sei.campos_extras',
} as const

const TIMEOUT_MS = 30_000
const CACHE_MS = 30_000
let cache: { em: number; cfg: SeiConfig } | null = null

function texto(v: unknown): string {
  let x = isEncrypted(v) ? decryptSettingValue(v) : v
  if (x == null) return ''
  if (typeof x !== 'string') x = JSON.stringify(x)
  return String(x).replace(/^"|"$/g, '').trim()
}

export async function getSeiConfig(semCache = false): Promise<SeiConfig> {
  if (!semCache && cache && Date.now() - cache.em < CACHE_MS) return cache.cfg
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(SEI_KEYS) } },
    select: { key: true, value: true },
  })
  const m = new Map(rows.map((r) => [r.key, texto(r.value)]))
  const bool = (k: string, padrao: boolean) => (m.has(k) ? m.get(k) === 'true' : padrao)
  const tipo = (m.get(SEI_KEYS.authTipo) || 'nenhum') as SeiAuthTipo
  const cfg: SeiConfig = {
    baseUrl: (m.get(SEI_KEYS.baseUrl) || '').replace(/\/+$/, ''),
    authTipo: ['nenhum', 'basic', 'bearer', 'header'].includes(tipo) ? tipo : 'nenhum',
    username: m.get(SEI_KEYS.username) || '',
    password: m.get(SEI_KEYS.password) || '',
    token: m.get(SEI_KEYS.token) || '',
    headerNome: m.get(SEI_KEYS.headerNome) || 'Authorization',
    enabled: bool(SEI_KEYS.enabled, false),
    autoEnviar: bool(SEI_KEYS.autoEnviar, false),
    enviarContrato: bool(SEI_KEYS.enviarContrato, true),
    camposExtras: bool(SEI_KEYS.camposExtras, false),
  }
  cache = { em: Date.now(), cfg }
  return cfg
}

export function resetSeiCache() {
  cache = null
}

/** Erro do SEI já traduzido: `mensagem` vem do corpo {campo, codigo, mensagem}. */
export class SeiError extends Error {
  constructor(
    message: string,
    public httpStatus: number | null,
    public servico: string,
    public corpo?: unknown,
    /** Falha de rede/timeout/5xx: vale tentar de novo. 4xx de regra: não adianta. */
    public transitorio = false,
  ) {
    super(message)
  }
}

function cabecalhosDeAuth(cfg: SeiConfig): Record<string, string> {
  if (cfg.authTipo === 'basic' && cfg.username) {
    return { Authorization: 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64') }
  }
  if (cfg.authTipo === 'bearer' && cfg.token) return { Authorization: `Bearer ${cfg.token}` }
  if (cfg.authTipo === 'header' && cfg.token) return { [cfg.headerNome || 'Authorization']: cfg.token }
  return {}
}

/** Mensagem legível de um corpo de erro do SEI (JSON ou texto puro). */
function mensagemDoErro(corpo: unknown, status: number): string {
  if (corpo && typeof corpo === 'object') {
    const c = corpo as any
    const m = c.mensagemErro || c.mensagem || c.message || c.erro
    if (m) return c.campo ? `${m} (campo: ${c.campo})` : String(m)
  }
  if (typeof corpo === 'string' && corpo.trim()) return corpo.trim().slice(0, 500)
  return `SEI respondeu HTTP ${status}`
}

/** Encolhe o que vai para o log: textos longos e listas grandes cortados. */
function paraLog(v: unknown, prof = 0): unknown {
  if (v == null || prof > 6) return v
  if (typeof v === 'string') return v.length > 2000 ? v.slice(0, 2000) + '…' : v
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => paraLog(x, prof + 1))
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as any)) out[k] = /^(senha|password|token)$/i.test(k) ? '***' : paraLog(x, prof + 1)
    return out
  }
  return v
}

interface Pedido {
  servico: string
  metodo: 'GET' | 'POST'
  caminho: string
  json?: unknown
  form?: FormData
  envioId?: number | null
  /** O que registrar no log no lugar do corpo (ex.: upload sem o binário). */
  logRequest?: unknown
}

async function chamar<T = any>(p: Pedido): Promise<T> {
  const cfg = await getSeiConfig()
  if (!cfg.baseUrl) throw new SeiError('URL do SEI não configurada (Integrações › SEI).', null, p.servico)
  const url = cfg.baseUrl + p.caminho
  const headers: Record<string, string> = { Accept: 'application/json', ...cabecalhosDeAuth(cfg) }
  let body: any
  if (p.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(p.json)
  } else if (p.form) {
    body = p.form
  }
  const inicio = Date.now()
  let status: number | null = null
  let corpo: unknown = null
  let erro: SeiError | null = null
  try {
    const r = await fetch(url, { method: p.metodo, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
    status = r.status
    const bruto = await r.text()
    try { corpo = bruto ? JSON.parse(bruto) : null } catch { corpo = bruto }
    if (!r.ok) erro = new SeiError(mensagemDoErro(corpo, r.status), r.status, p.servico, corpo, r.status >= 500 || r.status === 429)
  } catch (e: any) {
    const tempo = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    erro = new SeiError(tempo ? `SEI não respondeu em ${TIMEOUT_MS / 1000}s` : `Falha de conexão com o SEI: ${e?.message || e}`, null, p.servico, undefined, true)
  }
  await prisma.seiChamada.create({
    data: {
      envioId: p.envioId ?? null,
      servico: p.servico,
      metodo: p.metodo,
      caminho: p.caminho.slice(0, 500),
      httpStatus: status,
      duracaoMs: Date.now() - inicio,
      ok: !erro,
      request: (paraLog(p.logRequest ?? p.json ?? null) as any) ?? undefined,
      response: (paraLog(corpo) as any) ?? undefined,
      erro: erro?.message ?? null,
    },
  }).catch((e) => console.warn('[sei] log de chamada falhou:', e?.message))
  if (erro) throw erro
  return corpo as T
}

const RS = '/webservice/matriculaOnlineExternaRS'
const seg = (v: unknown) => encodeURIComponent(String(v ?? ''))

export interface SeiCtx { envioId?: number | null }

// ── Catálogo ────────────────────────────────────────────────────────────────
/** NE003 — cursos com política de divulgação de matrícula online ativa. */
export const listarBanners = (c: SeiCtx = {}) =>
  chamar<{ banner?: any[] }>({ servico: 'NE003 banners', metodo: 'GET', caminho: `${RS}/banners`, envioId: c.envioId })
/** NE004 — curso e disciplinas da matriz ativa. */
export const consultarCurso = (codigoCurso: string | number, c: SeiCtx = {}) =>
  chamar({ servico: 'NE004 consultarCurso', metodo: 'GET', caminho: `${RS}/consultarCurso/${seg(codigoCurso)}`, envioId: c.envioId })
/** NE007 — estados. */
export const consultarEstados = (c: SeiCtx = {}) =>
  chamar({ servico: 'NE007 consultarEstado', metodo: 'GET', caminho: `/webservice/aplicativoSEISV/consultarEstado`, envioId: c.envioId })
/** NE008 — cidades por UF e nome. */
export const consultarCidade = (uf: string, nome: string, c: SeiCtx = {}) =>
  chamar({ servico: 'NE008 consultarCidade', metodo: 'GET', caminho: `/webservice/aplicativoSEISV/consultarCidade/${seg(uf)}/${seg(nome)}`, envioId: c.envioId })

// ── Pessoa e matrícula ──────────────────────────────────────────────────────
/** NE005 — cria/encontra a pessoa (prospect) no SEI; devolve `codigo`. */
export const cadastrarPreInscricao = (prospect: Record<string, unknown>, c: SeiCtx = {}) =>
  chamar({ servico: 'NE005 cadastrarPreInscricao', metodo: 'POST', caminho: `${RS}/cadastrarPreInscricao`, json: prospect, envioId: c.envioId })
/** NE009 (V2) — abre a matrícula on-line com as opções que o SEI oferece. */
export const iniciarMatricula = (codigoCurso: string, codigoBanner: string, codigoPessoa: string, c: SeiCtx = {}) =>
  chamar({ servico: 'NE009 iniciarMatricula', metodo: 'GET', caminho: `${RS}/V2/consultarDadosParaRealizarMatriculaOnlineExterna/${seg(codigoCurso)}/${seg(codigoBanner)}/${seg(codigoPessoa)}`, envioId: c.envioId })
/** NE010 — recarrega a matrícula para a unidade escolhida. */
export const escolherUnidade = (curso: string, banner: string, pessoa: string, unidade: string, c: SeiCtx = {}) =>
  chamar({ servico: 'NE010 unidade', metodo: 'GET', caminho: `${RS}/atualizarDadosQuandoUnidadeEnsinoAlterado/${seg(curso)}/${seg(banner)}/${seg(pessoa)}/${seg(unidade)}`, envioId: c.envioId })
/** NE011 — recarrega para o turno escolhido. */
export const escolherTurno = (p: { unidade: string; curso: string; turno: string; grade: string; banner: string; pessoa: string }, c: SeiCtx = {}) =>
  chamar({ servico: 'NE011 turno', metodo: 'GET', caminho: `${RS}/atualizarDadosQuandoTurnoAlterado/${seg(p.unidade)}/${seg(p.curso)}/${seg(p.turno)}/${seg(p.grade)}/${seg(p.banner)}/${seg(p.pessoa)}`, envioId: c.envioId })
/** NE012 (V2) — recarrega para a turma e o período letivo escolhidos. */
export const escolherTurma = (p: { unidade: string; curso: string; turno: string; grade: string; banner: string; pessoa: string; turma: string; periodo: string }, c: SeiCtx = {}) =>
  chamar({ servico: 'NE012 turma', metodo: 'GET', caminho: `${RS}/V2/atualizarDadosQuandoTurmaAlterado/${seg(p.unidade)}/${seg(p.curso)}/${seg(p.turno)}/${seg(p.grade)}/${seg(p.banner)}/${seg(p.pessoa)}/${seg(p.turma)}/${seg(p.periodo)}`, envioId: c.envioId })
/** NE013 — simula o plano financeiro da condição de pagamento escolhida. */
export const simularPlano = (p: { unidade: string; curso: string; turma: string; processo: string; condicao: string; cupom: string; turno: string }, c: SeiCtx = {}) =>
  chamar<any[]>({ servico: 'NE013 simularPlano', metodo: 'GET', caminho: `${RS}/realizarMontagemPlanoFinanceiroAluno/${seg(p.unidade)}/${seg(p.curso)}/${seg(p.turma)}/${seg(p.processo)}/${seg(p.condicao)}/${seg(p.cupom || ' ')}/${seg(p.turno)}`, envioId: c.envioId })
/** NE014 — grava a matrícula; com `matricula` preenchida, ALTERA a existente. */
export const matricularAluno = (dados: Record<string, unknown>, c: SeiCtx = {}) =>
  chamar({ servico: 'NE014 matricularAluno', metodo: 'POST', caminho: `${RS}/matricularAluno`, json: dados, envioId: c.envioId })

// ── Documentos ──────────────────────────────────────────────────────────────
/** NE021 — documentação exigida pela matrícula. */
export const listarDocumentacao = (matricula: string, c: SeiCtx = {}) =>
  chamar<any[]>({ servico: 'NE021 consultarEntregaDocumentos', metodo: 'GET', caminho: `${RS}/consultarEntregaDocumentos/${seg(matricula)}`, envioId: c.envioId })
/** NE022 — upload do arquivo de uma documentação (multipart: file + objeto). */
export async function enviarArquivoDocumentacao(codigoDocumentacao: string, arquivo: { nome: string; mime: string; bytes: Buffer }, c: SeiCtx = {}) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(arquivo.bytes)], { type: arquivo.mime }), arquivo.nome)
  form.append('objeto', String(codigoDocumentacao))
  return chamar({
    servico: 'NE022 uploadDocumentacao', metodo: 'POST', caminho: `${RS}/realizarUploadArquivoDocumentoMatricula`, form, envioId: c.envioId,
    logRequest: { objeto: codigoDocumentacao, arquivo: arquivo.nome, mime: arquivo.mime, bytes: arquivo.bytes.length },
  })
}
/** NE023 — registra a entrega da documentação já com o arquivo. */
export const gravarDocumentacao = (doc: Record<string, unknown>, c: SeiCtx = {}) =>
  chamar({ servico: 'NE023 gravarDocumentacao', metodo: 'POST', caminho: `${RS}/gravarDocumentacaoMatricula`, json: doc, envioId: c.envioId })
