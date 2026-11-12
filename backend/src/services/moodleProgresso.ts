// src/services/moodleProgresso.ts
//
// O andamento do aluno no Moodle, para a aba AVA do Meu Portal e para a ficha
// da inscrição (equipe). Só LEITURA no Moodle:
//   core_enrol_get_users_courses                 → % de progresso, último acesso
//   core_completion_get_course_completion_status → requisitos para concluir
//   core_completion_get_activities_completion_status → cada atividade (feita,
//                                                  aprovado/reprovado, visível)
//   core_course_get_contents                     → seções (disciplinas) e regras
//   mod_quiz_get_quizzes_by_courses              → avaliações: tentativas, prazo
//   mod_quiz_get_user_quiz_attempts              → tentativas usadas
//   gradereport_user_get_grade_items             → notas
//
// "Curso concluído" (o Moodle diz que os critérios de conclusão foram
// cumpridos) vira evento na ficha (moodle_curso_concluido) e o gatilho
// `enrollment.curso_concluido` dos fluxos — uma vez por inscrição. Nada é
// enviado ao aluno daqui: quem decide é o fluxo que a escola ligar.
//
// Vincular pelo CPF: alunos que já estudavam no Moodle antes da integração
// ganham o vínculo (e a aba AVA) sem nenhuma inscrição nova no Moodle.

import { prisma } from '../lib/prisma.js'
import * as moodle from '../lib/moodleClient.js'
import { eventBus } from '../lib/eventBus.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'
import { aptidao, soDigitos } from './moodleAcessos.js'

const CACHE_CURSO_MS = 3 * 60 * 60_000
const CACHE_ALUNO_MS = 10 * 60_000

const limpar = (h: unknown) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const quando = (seg: unknown) => (Number(seg) > 0 ? new Date(Number(seg) * 1000).toISOString() : null)
const semCopia = (s: string) => s.replace(/\s*\((copiado|inserir)\)/gi, '').replace(/\s+/g, ' ').trim()
/** "Avaliação de Aprendizagem - Ergonomia" → "Ergonomia" (o tipo vai à parte). */
const tituloDaAvaliacao = (s: string) => semCopia(s.replace(/^(simulado|avalia[cç][aã]o(\s+de\s+aprendizagem)?)\s*[-–:]\s*/i, ''))

// ── Estrutura do curso (igual para todos os alunos) ─────────────────────────

interface Estrutura {
  em: number
  secoes: any[]
  quizzes: Map<number, any> // por coursemodule (cmid)
  /** Nota mínima de aprovação por cmid (é do questionário, igual para todos). */
  notaMinima: Map<number, number | null>
}
const estruturas = new Map<number, Estrutura>()

async function estruturaDoCurso(courseId: number, forcar = false): Promise<Estrutura> {
  const c = estruturas.get(courseId)
  if (c && !forcar && Date.now() - c.em < CACHE_CURSO_MS) return c
  const [secoes, qz] = await Promise.all([
    moodle.chamar<any[]>('core_course_get_contents', { courseid: courseId }),
    moodle.chamar<any>('mod_quiz_get_quizzes_by_courses', { courseids: [courseId] }).catch(() => ({ quizzes: [] })),
  ])
  const quizzes = new Map<number, any>((qz?.quizzes ?? []).map((q: any) => [Number(q.coursemodule), q]))
  const e = { em: Date.now(), secoes: Array.isArray(secoes) ? secoes : [], quizzes, notaMinima: new Map<number, number | null>() }
  estruturas.set(courseId, e)
  return e
}

// ── O que as telas recebem ──────────────────────────────────────────────────

export type SituacaoAvaliacao = 'aprovado' | 'reprovado' | 'feita' | 'pendente' | 'bloqueada'

export interface Avaliacao {
  cmid: number
  nome: string
  /** final do curso (requisito de conclusão) | final de módulo | de disciplina | simulado (treino, sem peso) */
  tipo: 'final' | 'modulo' | 'disciplina' | 'simulado'
  /** É um dos requisitos para concluir o curso. */
  requisito: boolean
  situacao: SituacaoAvaliacao
  nota: number | null
  notaMax: number | null
  /** Nota mínima para aprovar (mod_quiz_get_user_best_grade). */
  notaMinima: number | null
  enviadaEm: string | null
  tentativasUsadas: number | null
  /** 0 = sem limite */
  tentativasMax: number | null
  abre: string | null
  fecha: string | null
  /** Regra do Moodle quando ainda não está liberada (ex.: "1 mês após a inscrição"). */
  regra: string | null
}

export interface Requisito { titulo: string; detalhe: string; cumprido: boolean; em: string | null }
export interface Disciplina { nome: string; feitas: number; total: number }

export interface ProgressoAva {
  curso: { id: number; nome: string; url: string }
  progresso: number | null
  atividades: { feitas: number; total: number }
  ultimoAcesso: string | null
  concluido: boolean
  concluidoEm: string | null
  /** 'todos' = precisa cumprir todos os requisitos; 'qualquer' = basta um. */
  regraConclusao: 'todos' | 'qualquer' | null
  requisitos: Requisito[]
  avaliacoes: Avaliacao[]
  disciplinas: Disciplina[]
  atualizadoEm: string
}

const progressos = new Map<string, { em: number; p: ProgressoAva }>()

function tipoDaAvaliacao(nome: string, requisito: boolean): Avaliacao['tipo'] {
  if (/final\s+do\s+curso/i.test(nome)) return 'final'
  if (/^simulado\b/i.test(nome) && !requisito) return 'simulado'
  if (/final\s+(do\s+)?m[oó]dulo/i.test(nome)) return 'modulo'
  return requisito ? 'final' : 'disciplina'
}

/** Regra de liberação legível. O Moodle só escreve o texto de algumas regras
 *  (data, tempo após a inscrição); grupo e conclusão vêm só no JSON. */
function regraDeLiberacao(m: any): string | null {
  const texto = limpar(m.availabilityinfo).replace(/^Disponível se:\s*/i, '').replace(/^\((.*)\)$/, '$1')
  if (texto) return texto.charAt(0).toUpperCase() + texto.slice(1)
  let a: any = null
  try { a = typeof m.availability === 'string' ? JSON.parse(m.availability) : m.availability } catch { /* sem regra legível */ }
  const tipos = new Set<string>()
  const andar = (n: any) => { if (!n) return; if (n.type) tipos.add(String(n.type)); for (const c of n.c ?? []) andar(c) }
  andar(a)
  if (tipos.has('group') || tipos.has('grouping')) return 'Liberada pela coordenação do curso'
  if (tipos.has('completion')) return 'Liberada ao concluir a etapa anterior'
  if (tipos.has('date')) return 'Liberada a partir da data definida pelo curso'
  if (tipos.has('grade')) return 'Liberada ao atingir a nota exigida na etapa anterior'
  return tipos.size ? 'Liberada pelo curso quando as etapas anteriores forem cumpridas' : null
}

/** cmid do link do critério ("…/mod/quiz/view.php?id=17081"). */
function cmidDoCriterio(html: unknown): number | null {
  const m = /[?&]id=(\d+)/.exec(String(html ?? ''))
  return m ? Number(m[1]) : null
}

export async function progressoDoAluno(moodleUserId: number, courseId: number, opts: { forcar?: boolean } = {}): Promise<ProgressoAva> {
  const chave = `${moodleUserId}:${courseId}`
  const c = progressos.get(chave)
  if (c && !opts.forcar && Date.now() - c.em < CACHE_ALUNO_MS) return c.p

  const cfg = await moodle.getMoodleConfig()
  const est = await estruturaDoCurso(courseId)
  const [cursosDoAluno, conclusao, atividades, notas] = await Promise.all([
    moodle.chamar<any[]>('core_enrol_get_users_courses', { userid: moodleUserId }),
    moodle.chamar<any>('core_completion_get_course_completion_status', { courseid: courseId, userid: moodleUserId }).catch(() => null),
    moodle.chamar<any>('core_completion_get_activities_completion_status', { courseid: courseId, userid: moodleUserId }).catch(() => ({ statuses: [] })),
    moodle.chamar<any>('gradereport_user_get_grade_items', { courseid: courseId, userid: moodleUserId }).catch(() => null),
  ])
  const curso = (cursosDoAluno ?? []).find((x: any) => Number(x.id) === courseId)
  const status = new Map<number, any>((atividades?.statuses ?? []).map((s: any) => [Number(s.cmid), s]))
  const itensDeNota = new Map<number, any>(((notas?.usergrades?.[0]?.gradeitems) ?? []).filter((i: any) => i.cmid).map((i: any) => [Number(i.cmid), i]))

  // Requisitos de conclusão (página completion.php do curso).
  const cs = conclusao?.completionstatus
  const requisitos: Requisito[] = (cs?.completions ?? []).map((k: any) => ({
    titulo: limpar(k.details?.criteria) || limpar(k.title),
    detalhe: limpar(k.details?.requirement) || limpar(k.title),
    cumprido: !!k.complete,
    em: quando(k.timecompleted),
  }))
  const cmidsRequisito = new Set<number>((cs?.completions ?? []).map((k: any) => cmidDoCriterio(k.details?.criteria)).filter(Boolean) as number[])

  // Avaliações = questionários do curso, na ordem do curso.
  const avaliacoes: Avaliacao[] = []
  const disciplinas: Disciplina[] = []
  for (const s of est.secoes) {
    if (!Number(s.visible)) continue
    const mods: any[] = (s.modules ?? []).filter((m: any) => Number(m.visible) !== 0)
    let feitas = 0, total = 0
    let nomeDaAvaliacao = ''
    for (const m of mods) {
      const st = status.get(Number(m.id))
      if (m.modname === 'quiz') {
        const q = est.quizzes.get(Number(m.id))
        const nome = limpar(m.name)
        const requisito = cmidsRequisito.has(Number(m.id))
        const item = itensDeNota.get(Number(m.id))
        const nota = item && item.graderaw != null ? Number(item.graderaw) : null
        const estado = Number(st?.state ?? 0) // 0 pendente · 1 feita · 2 aprovado · 3 reprovado
        const visivel = st ? st.uservisible !== false : true
        let situacao: SituacaoAvaliacao = estado === 2 ? 'aprovado' : estado === 3 ? 'reprovado' : estado === 1 ? 'feita' : 'pendente'
        if (situacao === 'pendente' && nota != null) situacao = 'feita'
        if (situacao === 'pendente' && !visivel) situacao = 'bloqueada'
        const tipo = tipoDaAvaliacao(nome, requisito)
        avaliacoes.push({
          cmid: Number(m.id), nome: tipo === 'modulo' || tipo === 'final' ? semCopia(nome) : tituloDaAvaliacao(nome), tipo, requisito, situacao,
          nota, notaMax: item?.grademax != null ? Number(item.grademax) : q?.grade != null ? Number(q.grade) : null, notaMinima: null,
          enviadaEm: quando(item?.gradedatesubmitted),
          tentativasUsadas: null, tentativasMax: q ? Number(q.attempts ?? 0) : null,
          abre: quando(q?.timeopen), fecha: quando(q?.timeclose),
          regra: situacao === 'bloqueada' || situacao === 'pendente' ? regraDeLiberacao(m) : null,
        })
        if (!nomeDaAvaliacao && tipo !== 'modulo' && tipo !== 'final') nomeDaAvaliacao = tituloDaAvaliacao(nome)
      } else if (st) {
        total++
        if (Number(st.state) > 0) feitas++
      }
    }
    if (total > 0) {
      const nome = limpar(s.name)
        || nomeDaAvaliacao
        || semCopia(limpar(mods.find((m) => m.modname !== 'label')?.name))
        || `Parte ${s.section}`
      disciplinas.push({ nome, feitas, total })
    }
  }

  // Tentativas: só onde importa (reprovado, feita sem aprovação, ou requisito).
  const consultar = avaliacoes.filter((a) => a.requisito || a.situacao === 'reprovado' || a.situacao === 'feita')
  await Promise.all(consultar.map(async (a) => {
    const q = est.quizzes.get(a.cmid)
    if (!q) return
    try {
      const r = await moodle.chamar<any>('mod_quiz_get_user_quiz_attempts', { quizid: Number(q.id), userid: moodleUserId, status: 'all' })
      a.tentativasUsadas = (r?.attempts ?? []).filter((t: any) => t.state === 'finished' && !Number(t.preview)).length
    } catch { /* sem a função: fica sem o número */ }
  }))

  // Nota mínima: uma consulta por questionário, guardada com a estrutura do curso.
  const faltam = avaliacoes.filter((a) => est.quizzes.has(a.cmid) && !est.notaMinima.has(a.cmid))
  for (let i = 0; i < faltam.length; i += 6) {
    await Promise.all(faltam.slice(i, i + 6).map(async (a) => {
      try {
        const r = await moodle.chamar<any>('mod_quiz_get_user_best_grade', { quizid: Number(est.quizzes.get(a.cmid).id), userid: moodleUserId })
        est.notaMinima.set(a.cmid, Number(r?.gradetopass) > 0 ? Number(r.gradetopass) : null)
      } catch { est.notaMinima.set(a.cmid, null) }
    }))
  }
  for (const a of avaliacoes) a.notaMinima = est.notaMinima.get(a.cmid) ?? null

  const statusLista = [...status.values()]
  const p: ProgressoAva = {
    curso: { id: courseId, nome: String(curso?.fullname ?? '').trim() || 'Curso', url: moodle.urlDoCurso(cfg, courseId) },
    progresso: curso?.progress != null ? Math.round(Number(curso.progress)) : null,
    atividades: { feitas: statusLista.filter((s) => Number(s.state) > 0).length, total: statusLista.length },
    ultimoAcesso: quando(curso?.lastaccess),
    concluido: !!cs?.completed || !!curso?.completed,
    concluidoEm: cs?.completed ? (requisitos.map((r) => r.em).filter(Boolean).sort().pop() ?? null) : null,
    regraConclusao: cs ? (Number(cs.aggregation) === 2 ? 'qualquer' : 'todos') : null,
    requisitos,
    avaliacoes,
    disciplinas,
    atualizadoEm: new Date().toISOString(),
  }
  progressos.set(chave, { em: Date.now(), p })
  return p
}

// ── Por inscrição (Meu Portal e ficha) ──────────────────────────────────────

export async function progressoDaInscricao(registrationId: number, opts: { forcar?: boolean } = {}): Promise<ProgressoAva | null> {
  const a = await prisma.moodleAcesso.findUnique({ where: { registrationId } })
  if (!a?.moodleUserId || !a.moodleCourseId || (a.status !== 'LIBERADO' && a.status !== 'SUSPENSO')) return null
  const p = await progressoDoAluno(a.moodleUserId, a.moodleCourseId, opts)
  if (p.concluido) await registrarConclusao(registrationId, a.leadId, p.curso.nome, p.concluidoEm).catch(() => {})
  return p
}

// ── Curso concluído → evento (uma vez) ──────────────────────────────────────

const jaRegistradas = new Set<number>()

async function registrarConclusao(registrationId: number, leadId: number | null, curso: string, em: string | null) {
  if (jaRegistradas.has(registrationId)) return
  const existe = await prisma.enrollmentRegistrationEvent.findFirst({ where: { registrationId, acao: 'moodle_curso_concluido' }, select: { id: true } })
  jaRegistradas.add(registrationId)
  if (existe) return
  await registrarEventoDaInscricao({ registrationId, etapa: 'acesso', acao: 'moodle_curso_concluido', ator: 'sistema', dados: { curso, concluidoEm: em } })
  if (leadId) {
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { candidateCode: true, portalId: true } })
    eventBus.emitDomain({
      type: 'enrollment.curso_concluido',
      leadId,
      payload: { registrationId, candidateCode: reg?.candidateCode ?? null, portalId: reg?.portalId ?? null, curso, concluidoEm: em },
      timestamp: new Date(),
    })
  }
}

/** Varre os acessos liberados ainda sem conclusão registrada (1 chamada por aluno). */
export async function varrerConclusoes(): Promise<{ conferidos: number; concluidos: number }> {
  const cfg = await moodle.getMoodleConfig(true)
  if (!cfg.baseUrl || !cfg.token) return { conferidos: 0, concluidos: 0 }
  const acessos = await prisma.moodleAcesso.findMany({ where: { status: 'LIBERADO', moodleUserId: { not: null }, moodleCourseId: { not: null } } })
  const feitos = new Set((await prisma.enrollmentRegistrationEvent.findMany({
    where: { acao: 'moodle_curso_concluido', registrationId: { in: acessos.map((a) => a.registrationId) } }, select: { registrationId: true },
  })).map((e) => e.registrationId))
  let conferidos = 0, concluidos = 0
  for (const a of acessos) {
    if (feitos.has(a.registrationId)) continue
    conferidos++
    try {
      const r = await moodle.chamar<any>('core_completion_get_course_completion_status', { courseid: a.moodleCourseId, userid: a.moodleUserId })
      const cs = r?.completionstatus
      if (cs?.completed) {
        const em = (cs.completions ?? []).map((k: any) => quando(k.timecompleted)).filter(Boolean).sort().pop() ?? null
        await registrarConclusao(a.registrationId, a.leadId, a.cursoNome ?? 'Curso', em)
        concluidos++
      }
    } catch { /* aluno sem acompanhamento de conclusão: tenta na próxima volta */ }
  }
  return { conferidos, concluidos }
}

let timer: NodeJS.Timeout | null = null
export function iniciarVarreduraDeConclusoes() {
  if (timer) return
  timer = setInterval(() => { varrerConclusoes().catch((e) => console.warn('[moodle] conclusões:', e?.message || e)) }, 6 * 60 * 60_000)
  setTimeout(() => { varrerConclusoes().catch(() => {}) }, 5 * 60_000)
}

// ── Vincular pelo CPF (alunos que já estudavam no Moodle) ───────────────────

export type SituacaoVinculo = 'vinculavel' | 'sem_usuario' | 'sem_cpf' | 'fora_do_curso' | 'sem_curso_no_depara' | 'erro'

export interface CandidatoVinculo {
  registrationId: number
  codigo: string
  aluno: string | null
  portal: string | null
  portalId: number | null
  situacao: SituacaoVinculo
  usuario: string | null
  moodleUserId: number | null
  courseId: number | null
  curso: string | null
  /** Cursos em que o usuário está no Moodle (quando não é o do de-para). */
  cursosNoMoodle: string[]
  erro?: string
}

const INATIVAS = ['cancelled', 'transferred', 'expired', 'rejected', 'merged']

/** Inscrições dos portais ligados que ainda não têm acesso liberado no CRM. */
export async function candidatosAoVinculo(): Promise<CandidatoVinculo[]> {
  const cfg = await moodle.getMoodleConfig(true)
  if (!cfg.baseUrl || !cfg.token || !cfg.portais.length) return []
  const regs = await prisma.enrollmentRegistration.findMany({
    where: { portalId: { in: cfg.portais }, mergedIntoId: null, status: { notIn: INATIVAS } },
    select: { id: true, candidateCode: true, portalId: true, formData: true, lead: { select: { nome: true, email: true } }, portal: { select: { nome: true } } },
    orderBy: { id: 'desc' },
  })
  const acessos = new Map((await prisma.moodleAcesso.findMany({ where: { registrationId: { in: regs.map((r) => r.id) } } })).map((a) => [a.registrationId, a]))
  const lista: CandidatoVinculo[] = []
  const pendentes = regs.filter((r) => { const a = acessos.get(r.id); return !(a && (a.status === 'LIBERADO' || a.status === 'SUSPENSO')) })
  // 4 por vez: cada uma são 2–3 chamadas ao Moodle.
  for (let i = 0; i < pendentes.length; i += 4) {
    lista.push(...await Promise.all(pendentes.slice(i, i + 4).map((r) => avaliarVinculo(r, acessos.get(r.id), cfg))))
  }
  return lista
}

async function avaliarVinculo(r: any, a: any, cfg: moodle.MoodleConfig): Promise<CandidatoVinculo> {
  {
    const base = {
      registrationId: r.id, codigo: r.candidateCode, aluno: r.lead?.nome ?? (r.formData as any)?.nome ?? null,
      portal: r.portal?.nome ?? null, portalId: r.portalId, usuario: null, moodleUserId: null, courseId: null, curso: null, cursosNoMoodle: [] as string[],
    }
    const cpf = soDigitos((r.formData as any)?.cpf)
    if (cpf.length !== 11) return { ...base, situacao: 'sem_cpf' }
    try {
      const apt = await aptidao(r.id, cfg)
      const courseId = a?.cursoEscolhido && a.moodleCourseId ? a.moodleCourseId : apt.courseId
      // Usuário = CPF (padrão da casa); os antigos às vezes entram pelo e-mail.
      let [u] = await moodle.usuariosPorCampo('username', cpf)
      const email = String((r.formData as any)?.email || r.lead?.email || '').trim().toLowerCase()
      if (!u && email) {
        const porEmail = await moodle.usuariosPorCampo('email', email)
        if (porEmail.length === 1) u = porEmail[0]
      }
      if (!u) return { ...base, courseId, curso: apt.cursoNome, situacao: 'sem_usuario' }
      const cursos = await moodle.cursosDoUsuario(u.id)
      const no = courseId ? cursos.find((c) => c.id === courseId) : null
      return {
        ...base, usuario: u.username, moodleUserId: u.id, courseId, curso: no?.nome ?? apt.cursoNome,
        cursosNoMoodle: no ? [] : cursos.map((c) => c.nome),
        situacao: !courseId ? 'sem_curso_no_depara' : no ? 'vinculavel' : 'fora_do_curso',
      }
    } catch (e: any) {
      return { ...base, situacao: 'erro', erro: e?.message || String(e) }
    }
  }
}

/** Grava o vínculo das escolhidas (só as que continuam vinculáveis). Não inscreve ninguém no Moodle. */
export async function vincular(ids: number[], ator: { userId?: number | null; userName?: string | null }): Promise<{ vinculadas: number; ignoradas: number }> {
  const alvo = new Set(ids)
  const lista = (await candidatosAoVinculo()).filter((c) => alvo.has(c.registrationId))
  let vinculadas = 0
  for (const c of lista) {
    if (c.situacao !== 'vinculavel' || !c.moodleUserId || !c.courseId) continue
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: c.registrationId }, select: { leadId: true } })
    const agora = new Date()
    await prisma.moodleAcesso.upsert({
      where: { registrationId: c.registrationId },
      create: {
        registrationId: c.registrationId, leadId: reg?.leadId ?? null, status: 'LIBERADO', origem: 'vinculado',
        moodleUserId: c.moodleUserId, username: c.usuario, moodleCourseId: c.courseId, cursoNome: c.curso,
        liberadoEm: agora, liberadoPorId: ator.userId ?? null,
      },
      update: {
        status: 'LIBERADO', origem: 'vinculado', moodleUserId: c.moodleUserId, username: c.usuario, moodleCourseId: c.courseId,
        cursoNome: c.curso, ultimoErro: null, proximaTentativaEm: null, liberadoEm: agora, liberadoPorId: ator.userId ?? null,
      },
    })
    await registrarEventoDaInscricao({
      registrationId: c.registrationId, etapa: 'acesso', acao: 'moodle_vinculado', ator: 'atendente',
      userId: ator.userId ?? null, userName: ator.userName ?? null, dados: { curso: c.curso, usuario: c.usuario },
    })
    vinculadas++
  }
  return { vinculadas, ignoradas: ids.length - vinculadas }
}

