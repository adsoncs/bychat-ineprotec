// src/services/moodleAcessos.ts
//
// QUANDO o aluno ganha acesso ao Moodle — o "como" falar com o Moodle está em
// lib/moodleClient.ts.
//
// Regra (definida pelo cliente): GANHO = PAGAMENTO CONFIRMADO + CONTRATO
// ACEITO/ASSINADO → libera o curso no Moodle. Vale para qualquer caminho que
// deixe a inscrição assim (aviso do gateway, pagamento manual, cupom 100%,
// aceite no portal, Autentique): uma VARREDURA a cada 2 min procura as aptas,
// em vez de depender de um gancho em cada caminho.
//
// Nunca suspende sozinho (inadimplência não tira o acesso): suspender e
// reativar são ações do agente na inscrição.
//
// Aluno no Moodle: usuário = CPF só com números (o padrão da casa); quem já
// existe (pelo CPF ou pelo e-mail) é reaproveitado. O aluno novo nasce com a
// senha padrão da configuração (sem troca obrigatória no 1º acesso desde 12/11).

import { prisma } from '../lib/prisma.js'
import * as moodle from '../lib/moodleClient.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'

const INATIVAS = new Set(['cancelled', 'expired', 'rejected', 'merged'])
const ESPERAS_MIN = [5, 15, 60, 180, 360] // nova tentativa após erro

const SELECT_REG = {
  id: true, leadId: true, portalId: true, status: true, mergedIntoId: true, candidateCode: true,
  paymentStatus: true, paymentPaidAt: true, contratoAceite: true, formData: true,
  processRegistration: { select: { offeringId: true, offering: { select: { id: true, nome: true } } } },
  lead: { select: { nome: true, email: true } },
  portal: { select: { id: true, nome: true } },
} as const

type Reg = NonNullable<Awaited<ReturnType<typeof lerInscricao>>>

async function lerInscricao(registrationId: number) {
  return prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: SELECT_REG })
}

const so = (v: unknown) => String(v ?? '').trim()
export const soDigitos = (v: unknown) => so(v).replace(/\D/g, '')

export function cpfValido(cpf: unknown): boolean {
  const c = soDigitos(cpf)
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
  const dv = (n: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10])
}

function ofertaDa(reg: Reg): { id: number | null; nome: string | null } {
  const fd = (reg.formData ?? {}) as Record<string, any>
  const id = reg.processRegistration?.offeringId ?? (Number(fd.offeringId) || null)
  return { id, nome: reg.processRegistration?.offering?.nome ?? null }
}

export function chaveDepara(portalId: number, offeringId: number) {
  return `${portalId}:${offeringId}`
}

function aceiteEm(reg: Reg): Date | null {
  const em = (reg.contratoAceite as any)?.em
  if (!em) return null
  const d = new Date(em)
  return Number.isNaN(d.getTime()) ? new Date(0) : d
}

/** Nome em primeiro + resto (o Moodle exige os dois). */
function partesDoNome(nome: string): { firstname: string; lastname: string } {
  const p = nome.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  if (p.length === 0) return { firstname: 'Aluno', lastname: '-' }
  if (p.length === 1) return { firstname: p[0], lastname: '-' }
  return { firstname: p[0], lastname: p.slice(1).join(' ') }
}

function dadosDoAluno(reg: Reg) {
  const fd = (reg.formData ?? {}) as Record<string, any>
  const nome = so(fd.nome) || so(reg.lead?.nome)
  const email = (so(fd.email) || so(reg.lead?.email)).toLowerCase()
  const cpf = soDigitos(fd.cpf)
  return { nome, email, cpf }
}

// ── Aptidão ─────────────────────────────────────────────────────────────────

/** regra = faz parte do "Ganho" (o agente pode liberar sem ela); fixo = nunca dispensável. */
export interface ItemAptidao { ok: boolean; texto: string; regra: boolean; curso?: boolean }
export interface Aptidao {
  apta: boolean            // tudo ok: o automático libera
  liberavel: boolean       // dá para liberar à mão (dados do aluno + curso ok)
  itens: ItemAptidao[]
  courseId: number | null
  cursoNome: string | null
  oferta: { id: number | null; nome: string | null }
}

export async function aptidao(registrationId: number, cfgDada?: moodle.MoodleConfig): Promise<Aptidao> {
  const cfg = cfgDada ?? (await moodle.getMoodleConfig())
  const reg = await lerInscricao(registrationId)
  if (!reg) throw new Error('Inscrição não encontrada')
  const acesso = await prisma.moodleAcesso.findUnique({ where: { registrationId } })
  const oferta = ofertaDa(reg)
  const aluno = dadosDoAluno(reg)
  const doDepara = oferta.id ? cfg.depara[chaveDepara(reg.portalId, oferta.id)] ?? null : null
  const courseId = acesso?.cursoEscolhido && acesso.moodleCourseId ? acesso.moodleCourseId : doDepara
  let cursoNome: string | null = acesso?.cursoEscolhido ? acesso.cursoNome ?? null : null
  if (courseId && !cursoNome) {
    try { cursoNome = (await moodle.listarCursos()).find((c) => c.id === courseId)?.nome ?? null } catch { /* Moodle fora: segue sem o nome */ }
  }
  const ativa = !reg.mergedIntoId && !INATIVAS.has(reg.status)
  const itens: ItemAptidao[] = [
    { regra: true, ok: cfg.portais.includes(reg.portalId), texto: `Portal "${reg.portal?.nome ?? reg.portalId}" ligado à integração` },
    { regra: false, ok: ativa, texto: 'Inscrição ativa (não cancelada nem juntada a outra)' },
    { regra: true, ok: reg.paymentStatus === 'paid', texto: 'Pagamento confirmado' },
    { regra: true, ok: !!aceiteEm(reg), texto: 'Contrato aceito ou assinado' },
    { regra: false, ok: cpfValido(aluno.cpf), texto: aluno.cpf ? 'CPF válido (vira o usuário no Moodle)' : 'CPF na inscrição (vira o usuário no Moodle)' },
    { regra: false, ok: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(aluno.email), texto: 'E-mail do aluno (o Moodle exige)' },
    { regra: false, ok: aluno.nome.length >= 2, texto: 'Nome do aluno' },
    { regra: false, curso: true, ok: !!courseId, texto: courseId ? `Curso no Moodle: ${cursoNome ?? `#${courseId}`}` : `Curso no Moodle definido para a oferta "${oferta.nome ?? '—'}" (de-para)` },
  ]
  const liberavel = itens.filter((i) => !i.regra).every((i) => i.ok)
  return { apta: itens.every((i) => i.ok), liberavel, itens, courseId, cursoNome, oferta }
}

// ── Liberação ───────────────────────────────────────────────────────────────

export interface Ator { origem: 'automatico' | 'manual'; userId?: number | null; userName?: string | null }

/** Acha o aluno pelo CPF; senão pelo e-mail; senão cria. */
async function garantirUsuario(aluno: { cpf: string; email: string; nome: string }, cfg: moodle.MoodleConfig): Promise<{ id: number; username: string; criado: boolean }> {
  const porCpf = await moodle.usuariosPorCampo('username', aluno.cpf)
  if (porCpf[0]) return { id: porCpf[0].id, username: porCpf[0].username, criado: false }
  const porEmail = await moodle.usuariosPorCampo('email', aluno.email)
  if (porEmail.length === 1) return { id: porEmail[0].id, username: porEmail[0].username, criado: false }
  if (porEmail.length > 1) throw new Error(`Há ${porEmail.length} usuários no Moodle com o e-mail ${aluno.email}: escolha à mão qual é o aluno.`)
  if (!cfg.senha) throw new Error('Defina a senha inicial do aluno em Integrações › Moodle.')
  const { firstname, lastname } = partesDoNome(aluno.nome)
  // Sem troca obrigatória no 1º acesso (pedido do cliente, 12/11/2026): com o
  // login automático pelo Meu Portal, a tela de "mudar a senha" atrapalhava.
  const id = await moodle.criarUsuario({ username: aluno.cpf, password: cfg.senha, firstname, lastname, email: aluno.email, trocarSenha: false })
  return { id, username: aluno.cpf, criado: true }
}

async function falhou(registrationId: number, erro: string, tentativas: number) {
  const espera = ESPERAS_MIN[Math.min(tentativas, ESPERAS_MIN.length - 1)]
  await prisma.moodleAcesso.update({
    where: { registrationId },
    data: { status: 'ERRO', ultimoErro: erro.slice(0, 2000), tentativas: { increment: 1 }, proximaTentativaEm: new Date(Date.now() + espera * 60_000) },
  })
}

/**
 * Libera (ou confirma) o acesso da inscrição no Moodle.
 * `forcar`: o agente libera sem a regra pagamento + contrato (fica no histórico).
 */
export async function liberar(registrationId: number, ator: Ator, opts: { forcar?: boolean } = {}): Promise<{ ok: boolean; erro?: string }> {
  const cfg = await moodle.getMoodleConfig()
  const reg = await lerInscricao(registrationId)
  if (!reg) return { ok: false, erro: 'Inscrição não encontrada' }
  const apt = await aptidao(registrationId, cfg)
  const atual = await prisma.moodleAcesso.upsert({
    where: { registrationId },
    create: { registrationId, leadId: reg.leadId, origem: ator.origem, status: 'PENDENTE' },
    update: { leadId: reg.leadId },
  })
  if (atual.status === 'SUSPENSO' && ator.origem === 'automatico') return { ok: false, erro: 'Suspenso pelo agente' }
  if (!apt.courseId) {
    await prisma.moodleAcesso.update({ where: { registrationId }, data: { status: 'SEM_CURSO', ultimoErro: `A oferta "${apt.oferta.nome ?? '—'}" não tem curso do Moodle no de-para.`, proximaTentativaEm: null } })
    return { ok: false, erro: 'Oferta sem curso no de-para do Moodle' }
  }
  const forcado = !!opts.forcar && ator.origem === 'manual'
  const bloqueio = apt.itens.find((i) => !i.ok && !i.curso && (!i.regra || !forcado))
  if (bloqueio) {
    await prisma.moodleAcesso.update({ where: { registrationId }, data: { status: atual.status === 'LIBERADO' ? 'LIBERADO' : 'PENDENTE', ultimoErro: `Falta: ${bloqueio.texto}` } })
    return { ok: false, erro: `Falta: ${bloqueio.texto}` }
  }
  const aluno = dadosDoAluno(reg)
  try {
    const u = await garantirUsuario(aluno, cfg)
    await moodle.inscrever(u.id, apt.courseId)
    const cursos = await moodle.cursosDoUsuario(u.id)
    if (!cursos.some((c) => c.id === apt.courseId)) throw new Error('O Moodle aceitou o pedido, mas o curso não aparece na lista do aluno.')
    const agora = new Date()
    await prisma.moodleAcesso.update({
      where: { registrationId },
      data: {
        status: 'LIBERADO', origem: ator.origem, moodleUserId: u.id, username: u.username, moodleCourseId: apt.courseId,
        cursoNome: apt.cursoNome ?? cursos.find((c) => c.id === apt.courseId)?.nome ?? null,
        usuarioCriado: atual.usuarioCriado || u.criado, ultimoErro: null, proximaTentativaEm: null,
        liberadoEm: atual.liberadoEm ?? agora, liberadoPorId: ator.userId ?? null, suspensoEm: null, suspensoPorId: null,
      },
    })
    await registrarEventoDaInscricao({
      registrationId, etapa: 'acesso', acao: 'moodle_liberado', ator: ator.origem === 'manual' ? 'atendente' : 'sistema',
      userId: ator.userId ?? null, userName: ator.userName ?? null,
      dados: { curso: apt.cursoNome, courseId: apt.courseId, usuario: u.username, usuarioCriado: u.criado, forcado: !!(opts.forcar && !apt.apta) },
    })
    return { ok: true }
  } catch (e: any) {
    const msg = e?.message || String(e)
    await falhou(registrationId, msg, atual.tentativas)
    return { ok: false, erro: msg }
  }
}

// ── Ações do agente ─────────────────────────────────────────────────────────

async function acessoLiberado(registrationId: number) {
  const a = await prisma.moodleAcesso.findUnique({ where: { registrationId } })
  if (!a?.moodleUserId || !a.moodleCourseId) throw new Error('Este aluno ainda não tem acesso liberado no Moodle.')
  return a
}

export async function suspender(registrationId: number, ator: Ator) {
  const a = await acessoLiberado(registrationId)
  await moodle.inscrever(a.moodleUserId!, a.moodleCourseId!, { suspenso: true })
  await prisma.moodleAcesso.update({ where: { registrationId }, data: { status: 'SUSPENSO', suspensoEm: new Date(), suspensoPorId: ator.userId ?? null } })
  await registrarEventoDaInscricao({ registrationId, etapa: 'acesso', acao: 'moodle_suspenso', ator: 'atendente', userId: ator.userId, userName: ator.userName, dados: { curso: a.cursoNome } })
}

export async function reativar(registrationId: number, ator: Ator) {
  const a = await acessoLiberado(registrationId)
  await moodle.inscrever(a.moodleUserId!, a.moodleCourseId!, { suspenso: false })
  await prisma.moodleAcesso.update({ where: { registrationId }, data: { status: 'LIBERADO', suspensoEm: null, suspensoPorId: null, ultimoErro: null } })
  await registrarEventoDaInscricao({ registrationId, etapa: 'acesso', acao: 'moodle_reativado', ator: 'atendente', userId: ator.userId, userName: ator.userName, dados: { curso: a.cursoNome } })
}

/**
 * Troca o curso (ex.: Técnico EAD → Por Competência). Já liberado: inscreve no
 * novo e SUSPENDE o antigo (o token não tem unenrol; suspenso some para o aluno).
 */
export async function trocarCurso(registrationId: number, courseId: number, ator: Ator) {
  const curso = (await moodle.listarCursos()).find((c) => c.id === courseId)
  if (!curso) throw new Error('Curso não encontrado no Moodle.')
  const reg = await lerInscricao(registrationId)
  if (!reg) throw new Error('Inscrição não encontrada')
  const a = await prisma.moodleAcesso.upsert({
    where: { registrationId },
    create: { registrationId, leadId: reg.leadId, origem: 'manual', status: 'PENDENTE' },
    update: {},
  })
  if (a.moodleCourseId === courseId && a.cursoEscolhido) return
  const anteriores = Array.isArray(a.cursosAnteriores) ? (a.cursosAnteriores as any[]) : []
  if (a.status === 'LIBERADO' || a.status === 'SUSPENSO') {
    await moodle.inscrever(a.moodleUserId!, courseId, { suspenso: a.status === 'SUSPENSO' })
    if (a.moodleCourseId && a.moodleCourseId !== courseId) await moodle.inscrever(a.moodleUserId!, a.moodleCourseId, { suspenso: true })
  }
  await prisma.moodleAcesso.update({
    where: { registrationId },
    data: {
      moodleCourseId: courseId, cursoNome: curso.nome, cursoEscolhido: true,
      ...(a.status === 'SEM_CURSO' ? { status: 'PENDENTE', ultimoErro: null } : {}),
      cursosAnteriores: a.moodleCourseId && a.moodleCourseId !== courseId
        ? [...anteriores, { courseId: a.moodleCourseId, nome: a.cursoNome, ate: new Date().toISOString() }] as any
        : (a.cursosAnteriores ?? undefined) as any,
    },
  })
  await registrarEventoDaInscricao({ registrationId, etapa: 'acesso', acao: 'moodle_curso_trocado', ator: 'atendente', userId: ator.userId, userName: ator.userName, dados: { de: a.cursoNome, para: curso.nome } })
}

// ── Varredura (automático) ──────────────────────────────────────────────────

let rodando = false

export async function varrer(limite = 20): Promise<{ avaliadas: number; liberadas: number; erros: number }> {
  if (rodando) return { avaliadas: 0, liberadas: 0, erros: 0 }
  rodando = true
  try {
    const cfg = await moodle.getMoodleConfig(true)
    if (!cfg.enabled || !cfg.baseUrl || !cfg.token || cfg.portais.length === 0) return { avaliadas: 0, liberadas: 0, erros: 0 }
    const desde = cfg.desde ? new Date(cfg.desde) : null
    const regs = await prisma.enrollmentRegistration.findMany({
      where: { portalId: { in: cfg.portais }, paymentStatus: 'paid', mergedIntoId: null, status: { notIn: [...INATIVAS] } },
      select: { id: true, paymentPaidAt: true, contratoAceite: true, createdAt: true },
      orderBy: { id: 'asc' },
    })
    const ids = regs.filter((r) => {
      const em = (r.contratoAceite as any)?.em
      if (!em) return false
      if (!desde) return true
      // Só o que ficou apto depois de ligar: o mais recente entre pagamento e aceite.
      const marco = Math.max(new Date(em).getTime() || 0, r.paymentPaidAt?.getTime() ?? r.createdAt.getTime())
      return marco >= desde.getTime()
    }).map((r) => r.id)
    if (!ids.length) return { avaliadas: 0, liberadas: 0, erros: 0 }
    const acessos = await prisma.moodleAcesso.findMany({ where: { registrationId: { in: ids } } })
    const porReg = new Map(acessos.map((a) => [a.registrationId, a]))
    const agora = Date.now()
    const fila = ids.filter((id) => {
      const a = porReg.get(id)
      if (!a) return true
      if (a.status === 'LIBERADO' || a.status === 'SUSPENSO') return false
      if (a.status === 'ERRO') return !a.proximaTentativaEm || a.proximaTentativaEm.getTime() <= agora
      // SEM_CURSO entra de novo: o de-para pode ter sido preenchido desde a última volta.
      return true
    }).slice(0, limite)
    let liberadas = 0, erros = 0
    for (const id of fila) {
      const r = await liberar(id, { origem: 'automatico' })
      if (r.ok) liberadas++
      else if (porReg.get(id)?.status !== 'SEM_CURSO') erros++
    }
    return { avaliadas: fila.length, liberadas, erros }
  } finally {
    rodando = false
  }
}

let timer: NodeJS.Timeout | null = null
export function iniciarAgendadorMoodle() {
  if (timer) return
  timer = setInterval(() => { varrer().catch((e) => console.warn('[moodle] varredura:', e?.message || e)) }, 120_000)
  setTimeout(() => { varrer().catch(() => {}) }, 30_000)
  // Curso concluído no Moodle → evento na ficha + gatilho dos fluxos (a cada 6 h).
  import('./moodleProgresso.js').then((m) => m.iniciarVarreduraDeConclusoes()).catch(() => {})
}

// ── Leitura para as telas ──────────────────────────────────────────────────

export async function estadoDaInscricao(registrationId: number) {
  const cfg = await moodle.getMoodleConfig()
  const reg = await lerInscricao(registrationId)
  const habilitada = !!(cfg.baseUrl && cfg.token && reg && cfg.portais.includes(reg.portalId))
  const acesso = await prisma.moodleAcesso.findUnique({ where: { registrationId } })
  return { habilitada, automatico: cfg.enabled, acesso, urlCurso: acesso?.moodleCourseId && cfg.baseUrl ? moodle.urlDoCurso(cfg, acesso.moodleCourseId) : null }
}

/** Ofertas de cada portal ligado, com o curso do de-para e uma sugestão por nome. */
export async function quadroDepara() {
  const cfg = await moodle.getMoodleConfig()
  const portais = await prisma.enrollmentPortal.findMany({
    where: { id: { in: cfg.portais.length ? cfg.portais : [-1] } },
    select: { id: true, nome: true, allowedLevelIds: true, allowedCourseIds: true },
    orderBy: { id: 'asc' },
  })
  let cursos: moodle.MoodleCurso[] = []
  try { cursos = await moodle.listarCursos() } catch { /* sem Moodle: sem sugestão */ }
  const linhas: any[] = []
  for (const p of portais) {
    const niveis = Array.isArray(p.allowedLevelIds) ? (p.allowedLevelIds as any[]).map(Number) : []
    const cursosPermitidos = Array.isArray(p.allowedCourseIds) ? (p.allowedCourseIds as any[]).map(Number) : []
    const usadas = await prisma.enrollmentRegistration.findMany({ where: { portalId: p.id }, select: { processRegistration: { select: { offeringId: true } }, formData: true } })
    const idsUsados = usadas.map((u) => u.processRegistration?.offeringId ?? Number((u.formData as any)?.offeringId)).filter((n) => Number.isInteger(n) && n > 0)
    const ofertas = await prisma.courseOffering.findMany({
      where: {
        OR: [
          { active: true, ...(niveis.length ? { levelId: { in: niveis } } : {}), ...(cursosPermitidos.length ? { courseId: { in: cursosPermitidos } } : {}) },
          { id: { in: idsUsados.length ? idsUsados : [-1] } },
        ],
      },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    })
    for (const o of ofertas) {
      const chave = chaveDepara(p.id, o.id)
      const courseId = cfg.depara[chave] ?? null
      linhas.push({
        chave, portalId: p.id, portalNome: p.nome, offeringId: o.id, ofertaNome: o.nome,
        courseId, cursoNome: courseId ? cursos.find((c) => c.id === courseId)?.nome ?? `#${courseId}` : null,
        sugestao: courseId ? null : sugerir(p.nome, o.nome, cursos),
      })
    }
  }
  return linhas
}

// Sugestão por nome: mesmo curso + categoria que combina com o tipo do portal.
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
const PALAVRAS_VAZIAS = /\b(tecnico|tecnica|em|de|da|do|e|curso|especializacao|tec|aplicada|ao|pos|graduacao|ineprotec|consultoria|competencia|20\d\d|itecc|ensa|dlt|nobre|niobre|emhur)\b/g
const nucleo = (s: string) => norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(PALAVRAS_VAZIAS, ' ').replace(/\s+/g, ' ').trim()

export function sugerir(portalNome: string, ofertaNome: string, cursos: moodle.MoodleCurso[]): { courseId: number; nome: string; categoria: string } | null {
  const alvo = nucleo(ofertaNome)
  if (!alvo) return null
  const pn = norm(portalNome)
  const quer = pn.includes('eja') || pn.includes('supletivo') ? 'educacao de jovens'
    : pn.includes('consultoria') && pn.includes('especializ') ? 'especializac'
    : pn.includes('consultoria') ? 'curso - tecnico ead'
    : pn.includes('especializ') ? 'especializac'
    : pn.includes('pos') ? 'pos-graduac'
    : pn.includes('profissionalizante') ? 'profissionalizante'
    : pn.includes('treinamento') ? 'treinamento'
    : pn.includes('tecnico') ? 'tecnicos ineprotec › curso regular'
    : ''
  let melhor: { c: moodle.MoodleCurso; pontos: number } | null = null
  for (const c of cursos) {
    if (nucleo(c.nome) !== alvo) continue
    const cat = norm(c.categoria)
    // Portal de um tipo só aceita curso da categoria desse tipo (regular ≠ consultoria).
    if (quer && !cat.includes(norm(quer))) continue
    let pontos = 1
    if (cat.includes('2026')) pontos += 2
    if (c.visivel) pontos += 1
    if (/arquivad|demostra|demonstra|outros anos/.test(cat)) pontos -= 6
    if (/emhur/.test(norm(c.nome + c.categoria))) pontos -= 3
    if (!melhor || pontos > melhor.pontos) melhor = { c, pontos }
  }
  return melhor && melhor.pontos > 2 ? { courseId: melhor.c.id, nome: melhor.c.nome, categoria: melhor.c.categoria } : null
}

/** Meu Portal: o acesso da inscrição, para a aba AVA. */
export async function avaDaInscricao(registrationId: number): Promise<{ disponivel: boolean; url: string | null; usuario: string | null; curso: string | null; suspenso: boolean }> {
  const cfg = await moodle.getMoodleConfig()
  const a = await prisma.moodleAcesso.findUnique({ where: { registrationId } })
  if (!cfg.baseUrl || !a || (a.status !== 'LIBERADO' && a.status !== 'SUSPENSO') || !a.moodleCourseId) {
    return { disponivel: false, url: null, usuario: null, curso: null, suspenso: false }
  }
  return {
    disponivel: a.status === 'LIBERADO', suspenso: a.status === 'SUSPENSO',
    url: `/api/public/portal/area/ava/entrar?registro=${registrationId}`,
    usuario: a.username, curso: a.cursoNome,
  }
}

/** Para onde o "Acessar meu curso" leva: link de uso único (SSO) ou o curso. */
export async function destinoDeEntrada(registrationId: number): Promise<string | null> {
  const cfg = await moodle.getMoodleConfig()
  const a = await prisma.moodleAcesso.findUnique({ where: { registrationId } })
  if (!cfg.baseUrl || !a || a.status !== 'LIBERADO' || !a.moodleCourseId || !a.username) return null
  const curso = moodle.urlDoCurso(cfg, a.moodleCourseId)
  if (!cfg.sso) return curso
  try {
    const login = await moodle.urlDeEntrada(a.username)
    return `${login}${login.includes('?') ? '&' : '?'}wantsurl=${encodeURIComponent(curso)}`
  } catch (e: any) {
    console.warn('[moodle] SSO indisponível, abrindo a tela de login:', e?.message)
    return curso
  }
}
