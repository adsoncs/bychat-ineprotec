// src/lib/moodleClient.ts
//
// Cliente dos Web Services REST do Moodle (Integrações › Moodle). Só fala com
// o Moodle; a regra de QUANDO liberar mora em services/moodleAcessos.ts.
//
// Configuração (Settings, grupo "moodle"):
//   moodle.base_url          https://ava.exemplo.com.br
//   moodle.token             token do serviço externo (cifrado pelo nome)
//   moodle.default_password  senha inicial do aluno novo (cifrada pelo nome)
//   moodle.enabled           liga a liberação automática
//   moodle.sso               usa o plugin auth_userkey (entrar já logado)
//   moodle.papel_id          papel da inscrição (5 = estudante)
//   moodle.portais           [ids de portal] cujas inscrições liberam acesso
//   moodle.depara            { "<portalId>:<offeringId>": <courseId> }
//   moodle.desde             ISO — automático só para o que ficou apto depois
//
// O Moodle responde 200 mesmo com erro: o erro vem no corpo como
// { exception, errorcode, message }. Aqui ele vira MoodleError.
//
// VÁRIOS MOODLES NO MESMO TENANT (17/11/2026 — Ineprotec + Matrícula EAD): o
// Moodle "principal" usa as chaves acima; cada Moodle a mais tem um id (ex.:
// "m2") e as MESMAS chaves com o id no meio: moodle.m2.base_url, moodle.m2.token…
// A lista dos extras fica em moodle.instancias = [{ id, nome }].
// Cada portal pertence a UM Moodle (o que tem o portal em .portais); sem
// nenhum, é o principal. O Moodle da vez vem do contexto (comInstancia), que
// os serviços abrem a partir do portal da inscrição — assim todas as chamadas
// daquela operação vão para o mesmo Moodle.

import { AsyncLocalStorage } from 'node:async_hooks'
import { prisma } from './prisma.js'
import { isEncrypted, decryptSettingValue } from './secretSettings.js'

export const MOODLE_KEYS = {
  baseUrl: 'moodle.base_url',
  token: 'moodle.token',
  senha: 'moodle.default_password',
  enabled: 'moodle.enabled',
  sso: 'moodle.sso',
  papelId: 'moodle.papel_id',
  portais: 'moodle.portais',
  depara: 'moodle.depara',
  desde: 'moodle.desde',
} as const

export const MOODLE_INSTANCIAS_KEY = 'moodle.instancias'
export const MOODLE_NOME_KEY = 'moodle.nome'
export const PRINCIPAL = ''

const contexto = new AsyncLocalStorage<string>()

/** Moodle da operação em andamento ('' = principal). */
export function instanciaAtual(): string {
  return contexto.getStore() ?? PRINCIPAL
}

/** Roda `fn` falando com o Moodle `inst` (todas as chamadas dentro dela). */
export function comInstancia<T>(inst: string, fn: () => Promise<T>): Promise<T> {
  return contexto.run(inst || PRINCIPAL, fn)
}

export function instanciaValida(inst: string): boolean {
  return inst === PRINCIPAL || /^m\d{1,3}$/.test(inst)
}

/** Chave da setting no Moodle `inst` (principal = a chave original). */
export function chaveDa(base: string, inst: string = instanciaAtual()): string {
  return inst ? base.replace(/^moodle\./, `moodle.${inst}.`) : base
}

export interface MoodleInstancia { id: string; nome: string }

/** Principal primeiro, depois os extras (moodle.instancias). */
export async function listarInstancias(): Promise<MoodleInstancia[]> {
  const rows = await prisma.setting.findMany({ where: { key: { in: [MOODLE_INSTANCIAS_KEY, MOODLE_NOME_KEY] } }, select: { key: true, value: true } })
  const m = new Map(rows.map((r) => [r.key, r.value as unknown]))
  const extras = json<unknown[]>(m.get(MOODLE_INSTANCIAS_KEY), [])
    .map((x: any) => ({ id: String(x?.id ?? ''), nome: String(x?.nome ?? '').trim() }))
    .filter((x) => x.id && x.id !== PRINCIPAL && instanciaValida(x.id))
  return [{ id: PRINCIPAL, nome: texto(m.get(MOODLE_NOME_KEY)) || 'Moodle principal' }, ...extras.map((x) => ({ id: x.id, nome: x.nome || `Moodle ${x.id}` }))]
}

/** De qual Moodle é o portal: o extra que o tem em .portais; senão, o principal. */
export async function instanciaDoPortal(portalId: number | null | undefined): Promise<string> {
  if (!portalId) return PRINCIPAL
  for (const i of await listarInstancias()) {
    if (i.id === PRINCIPAL) continue
    if ((await getMoodleConfig(false, i.id)).portais.includes(portalId)) return i.id
  }
  return PRINCIPAL
}

export interface MoodleConfig {
  baseUrl: string
  token: string
  senha: string
  enabled: boolean
  sso: boolean
  papelId: number
  portais: number[]
  depara: Record<string, number>
  desde: string | null
}

const TIMEOUT_MS = 30_000
const CACHE_MS = 30_000
const cache = new Map<string, { em: number; cfg: MoodleConfig }>()

function bruto(v: unknown): unknown {
  return isEncrypted(v) ? decryptSettingValue(v) : v
}
function texto(v: unknown): string {
  let x = bruto(v)
  if (x == null) return ''
  if (typeof x !== 'string') x = JSON.stringify(x)
  return String(x).replace(/^"|"$/g, '').trim()
}
function json<T>(v: unknown, padrao: T): T {
  let x = bruto(v)
  if (typeof x === 'string') { try { x = JSON.parse(x) } catch { return padrao } }
  return (x ?? padrao) as T
}

export async function getMoodleConfig(semCache = false, inst: string = instanciaAtual()): Promise<MoodleConfig> {
  const c = cache.get(inst)
  if (!semCache && c && Date.now() - c.em < CACHE_MS) return c.cfg
  const k = (base: string) => chaveDa(base, inst)
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(MOODLE_KEYS).map(k) } }, select: { key: true, value: true } })
  const m = new Map(rows.map((r) => [r.key, r.value as unknown]))
  const depara = json<Record<string, unknown>>(m.get(k(MOODLE_KEYS.depara)), {})
  const cfg: MoodleConfig = {
    baseUrl: texto(m.get(k(MOODLE_KEYS.baseUrl))).replace(/\/+$/, ''),
    token: texto(m.get(k(MOODLE_KEYS.token))),
    senha: texto(m.get(k(MOODLE_KEYS.senha))),
    enabled: texto(m.get(k(MOODLE_KEYS.enabled))) === 'true',
    sso: texto(m.get(k(MOODLE_KEYS.sso))) === 'true',
    papelId: Number(texto(m.get(k(MOODLE_KEYS.papelId)))) || 5,
    portais: json<unknown[]>(m.get(k(MOODLE_KEYS.portais)), []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
    depara: Object.fromEntries(Object.entries(depara && typeof depara === 'object' ? depara : {})
      .map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isInteger(v) && (v as number) > 0)) as Record<string, number>,
    desde: texto(m.get(k(MOODLE_KEYS.desde))) || null,
  }
  cache.set(inst, { em: Date.now(), cfg })
  return cfg
}

export function resetMoodleCache() {
  cache.clear()
  cursosCache.clear()
}

export class MoodleError extends Error {
  constructor(message: string, public codigo: string | null, public funcao: string) {
    super(message)
    this.name = 'MoodleError'
  }
}

/** users[0][username]=x — o formato que o REST do Moodle espera. */
export function achatar(obj: unknown, prefixo = '', saida: [string, string][] = []): [string, string][] {
  if (obj == null) return saida
  if (Array.isArray(obj)) obj.forEach((v, i) => achatar(v, `${prefixo}[${i}]`, saida))
  else if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) achatar(v, prefixo ? `${prefixo}[${k}]` : k, saida)
  } else saida.push([prefixo, typeof obj === 'boolean' ? (obj ? '1' : '0') : String(obj)])
  return saida
}

const TRADUCAO: Record<string, string> = {
  invalidtoken: 'Token do Moodle inválido ou apagado (Integrações › Moodle).',
  accessexception: 'O Moodle recusou o acesso: confira se a função está no serviço externo, se o usuário do token está autorizado e se a restrição de IP do token permite este servidor.',
  invalidrecord: 'Registro não encontrado no Moodle.',
  invalidrecordunknown: 'Registro não encontrado no Moodle.',
  wsusercannotassign: 'O usuário do token não tem permissão para inscrever alunos neste curso (papel/permissões no Moodle).',
  wsnoinstance: 'O curso não tem a "Inscrição manual" ativa no Moodle.',
}

export async function chamar<T = any>(funcao: string, params: Record<string, unknown> = {}, cfgDada?: MoodleConfig): Promise<T> {
  const cfg = cfgDada ?? (await getMoodleConfig())
  if (!cfg.baseUrl || !cfg.token) throw new MoodleError('Moodle não configurado (Integrações › Moodle).', 'config', funcao)
  const corpo = new URLSearchParams([['wstoken', cfg.token], ['wsfunction', funcao], ['moodlewsrestformat', 'json'], ...achatar(params)])
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(`${cfg.baseUrl}/webservice/rest/server.php`, {
      method: 'POST', body: corpo, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    })
  } catch (e: any) {
    throw new MoodleError(e?.name === 'AbortError' ? 'O Moodle não respondeu em 30 s.' : `Moodle fora do ar: ${e?.message || e}`, 'rede', funcao)
  } finally { clearTimeout(t) }
  const txt = await resp.text()
  if (!resp.ok) throw new MoodleError(`Moodle respondeu HTTP ${resp.status}.`, `http_${resp.status}`, funcao)
  if (!txt.trim()) return null as T // funções "void" (ex.: enrol) respondem vazio ou null
  let dados: any
  try { dados = JSON.parse(txt) } catch { throw new MoodleError('Resposta do Moodle não é JSON (confira a URL).', 'formato', funcao) }
  if (dados && typeof dados === 'object' && !Array.isArray(dados) && dados.exception) {
    const cod = String(dados.errorcode || '')
    throw new MoodleError(TRADUCAO[cod] || String(dados.message || cod || 'Erro do Moodle'), cod || null, funcao)
  }
  return dados as T
}

// ── Funções ─────────────────────────────────────────────────────────────────

export interface MoodleCurso { id: number; nome: string; categoria: string; visivel: boolean }
const cursosCache = new Map<string, { em: number; lista: MoodleCurso[] }>()

export async function listarCursos(semCache = false): Promise<MoodleCurso[]> {
  const inst = instanciaAtual()
  const c = cursosCache.get(inst)
  if (!semCache && c && Date.now() - c.em < 10 * 60_000) return c.lista
  const [cursos, cats] = await Promise.all([
    chamar<any[]>('core_course_get_courses'),
    chamar<any[]>('core_course_get_categories'),
  ])
  const porId = new Map((cats || []).map((c: any) => [Number(c.id), c]))
  const caminho = (id: number, n = 0): string => {
    const c: any = porId.get(id)
    if (!c || n > 10) return ''
    const pai = Number(c.parent) ? caminho(Number(c.parent), n + 1) : ''
    return (pai ? pai + ' › ' : '') + String(c.name || '').trim()
  }
  const lista = (cursos || [])
    .filter((c: any) => Number(c.id) !== 1) // o "curso" 1 é a página inicial do site
    .map((c: any) => ({ id: Number(c.id), nome: String(c.fullname || '').trim(), categoria: caminho(Number(c.categoryid)), visivel: !!c.visible }))
    .sort((a, b) => (a.categoria + a.nome).localeCompare(b.categoria + b.nome, 'pt-BR'))
  cursosCache.set(inst, { em: Date.now(), lista })
  return lista
}

export interface MoodleUsuario { id: number; username: string; email: string; fullname: string; suspended: boolean; auth: string; firstaccess: number }

/** Busca por username/email/id. Ausente = [] (o Moodle lança dml_missing_record). */
export async function usuariosPorCampo(campo: 'username' | 'email' | 'id', valor: string): Promise<MoodleUsuario[]> {
  try {
    const r = await chamar<any[]>('core_user_get_users_by_field', { field: campo, values: [valor] })
    return (r || []).map((u: any) => ({ id: Number(u.id), username: String(u.username || ''), email: String(u.email || ''), fullname: String(u.fullname || ''), suspended: !!u.suspended, auth: String(u.auth || ''), firstaccess: Number(u.firstaccess || 0) }))
  } catch (e) {
    if (e instanceof MoodleError && (e.codigo === 'invalidrecordunknown' || e.codigo === 'invalidrecord')) return []
    throw e
  }
}

export async function criarUsuario(u: { username: string; password: string; firstname: string; lastname: string; email: string; trocarSenha: boolean }): Promise<number> {
  const r = await chamar<any[]>('core_user_create_users', {
    users: [{
      username: u.username, password: u.password, firstname: u.firstname, lastname: u.lastname, email: u.email,
      auth: 'manual', lang: 'pt_br', country: 'BR',
      ...(u.trocarSenha ? { preferences: [{ type: 'auth_forcepasswordchange', value: '1' }] } : {}),
    }],
  })
  const id = Number(r?.[0]?.id)
  if (!id) throw new MoodleError('O Moodle não devolveu o id do usuário criado.', 'formato', 'core_user_create_users')
  return id
}

/** Inscreve (ou atualiza a inscrição). suspend=1 suspende sem tirar do curso. */
export async function inscrever(userId: number, courseId: number, opts: { papelId?: number; suspenso?: boolean } = {}): Promise<void> {
  const cfg = await getMoodleConfig()
  await chamar('enrol_manual_enrol_users', {
    enrolments: [{ roleid: opts.papelId ?? cfg.papelId, userid: userId, courseid: courseId, suspend: opts.suspenso ? 1 : 0 }],
  })
}

export async function cursosDoUsuario(userId: number): Promise<{ id: number; nome: string }[]> {
  const r = await chamar<any[]>('core_enrol_get_users_courses', { userid: userId })
  return (r || []).map((c: any) => ({ id: Number(c.id), nome: String(c.fullname || '') }))
}

/** Link de entrada de uso único (plugin auth_userkey). */
export async function urlDeEntrada(username: string): Promise<string> {
  const r = await chamar<any>('auth_userkey_request_login_url', { user: { username } })
  const url = String(r?.loginurl || '')
  if (!url) throw new MoodleError('O plugin auth_userkey não devolveu o link de entrada.', 'formato', 'auth_userkey_request_login_url')
  return url
}

export function urlDoCurso(cfg: MoodleConfig, courseId: number): string {
  return `${cfg.baseUrl}/course/view.php?id=${courseId}`
}

/** Teste de conexão: get_site_info quando liberada; senão, lê as categorias. */
export async function testarConexao(): Promise<{ ok: true; site: string | null; versao: string | null; usuario: string | null; funcoes: string[] | null; cursos: number }> {
  const cfg = await getMoodleConfig(true)
  let site: string | null = null, versao: string | null = null, usuario: string | null = null, funcoes: string[] | null = null
  try {
    const s = await chamar<any>('core_webservice_get_site_info', {}, cfg)
    site = s?.sitename ?? null; versao = s?.release ?? null; usuario = s?.username ?? null
    funcoes = Array.isArray(s?.functions) ? s.functions.map((f: any) => String(f.name)).sort() : null
  } catch (e) {
    if (!(e instanceof MoodleError) || e.codigo !== 'accessexception') throw e
  }
  const cursos = await listarCursos(true)
  return { ok: true, site, versao, usuario, funcoes, cursos: cursos.length }
}
