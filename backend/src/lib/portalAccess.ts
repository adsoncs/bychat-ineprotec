// src/lib/portalAccess.ts
//
// Acesso por portal — quem enxerga as inscrições de cada portal do Educacional
// (e tudo que pende delas: documentos, avaliações, financeiro, contratos,
// matrícula e aluno no ERP). Pedido de 21/10/2026: separar polos e parceiros.
//
// ── As regras ─────────────────────────────────────────────────────────────
//
// 1. SUPERADMIN e ADMIN veem todos os portais.
// 2. Quem integra uma equipe com `veTodosOsPortais` (Secretaria, Financeiro,
//    Coordenação) também vê todos.
// 3. Portal SEM nenhuma equipe configurada é aberto: vale o que valia antes —
//    a permissão da tela decide, sem recorte. Instalar isto não muda nada.
// 4. Portal COM equipes (restrito) só aparece para membros dessas equipes:
//      • o LÍDER de uma equipe com acesso vê todas as inscrições do portal;
//      • o MEMBRO vê só as inscrições cujo lead é dele (`lead.assignedUserId`).
// 5. Nível da equipe no portal: VER (acompanha) ou OPERAR (age). Em portal
//    restrito, ação de escrita exige OPERAR; em portal aberto, segue a tela.
// 6. Registro do ERP que não veio de inscrição nenhuma (matrícula manual ou
//    importada, aluno sem inscrição) só aparece para quem vê todos.
//
// Fora do alcance, detalhe responde 404 — como se o registro não existisse —
// e escrita em portal só com VER responde 403. Toda rota que expõe dado de
// portal passa por aqui; a bateria de acesso enumera as rotas e cobra isso.

import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

export type AcaoPortal = 'ver' | 'operar'

export interface AlcancePortais {
  /** Vê todos os portais (regras 1 e 2): nenhum recorte se aplica. */
  todos: boolean
  userId: number
  /** Portais restritos (têm ao menos uma equipe configurada). */
  restritos: number[]
  /** Restritos em que é líder de uma equipe com acesso: vê o portal inteiro. */
  lider: number[]
  /** Restritos em que é só membro: vê as inscrições dos próprios leads. */
  membro: number[]
  /** Restritos em que alguma equipe sua tem OPERAR. */
  operar: number[]
}

const CACHE_TTL = 30_000
const cache = new Map<string, { alc: AlcancePortais; ts: number }>()

/** Chamar ao salvar a matriz, mudar membros/líder de equipe ou o "vê todos". */
export function invalidarAcessoPortais(): void {
  cache.clear()
}

export async function alcanceDePortais(userId: number, role: string): Promise<AlcancePortais> {
  const vazio = { userId, restritos: [], lider: [], membro: [], operar: [] }
  if (role === 'SUPERADMIN' || role === 'ADMIN') return { todos: true, ...vazio }

  const chave = `${userId}:${role}`
  const hit = cache.get(chave)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.alc

  // Motor de Papéis: alcance de inscrições "Tudo" no papel = vê todos os portais.
  const { motorDePapeisLigado } = await import('./permissions.js')
  if (await motorDePapeisLigado()) {
    const pa = await prisma.papelAlcance.findFirst({ where: { tipo: 'INSCRICOES', papel: { usuarios: { some: { id: userId } } } }, select: { alcance: true } })
    if (pa?.alcance === 'TUDO') {
      const alc = { todos: true, ...vazio }
      cache.set(chave, { alc, ts: Date.now() })
      return alc
    }
  }

  const [membros, linhas] = await Promise.all([
    prisma.teamMember.findMany({
      where: { userId, team: { active: true } },
      select: { teamId: true, isLeader: true, team: { select: { veTodosOsPortais: true } } },
    }),
    prisma.portalAcessoEquipe.findMany({
      // Equipe inativa não dá acesso, mas o portal continua restrito.
      select: { portalId: true, teamId: true, nivel: true, team: { select: { active: true } } },
    }),
  ])

  let alc: AlcancePortais
  if (membros.some((m) => m.team.veTodosOsPortais)) {
    alc = { todos: true, ...vazio }
  } else {
    const minhas = new Map(membros.map((m) => [m.teamId, m.isLeader]))
    const restritos = new Set<number>()
    const lider = new Set<number>()
    const membro = new Set<number>()
    const operar = new Set<number>()
    for (const l of linhas) {
      restritos.add(l.portalId)
      if (!l.team.active || !minhas.has(l.teamId)) continue
      if (minhas.get(l.teamId)) lider.add(l.portalId)
      else membro.add(l.portalId)
      if (l.nivel === 'OPERAR') operar.add(l.portalId)
    }
    // Líder numa equipe e membro noutra do mesmo portal: vale o mais amplo.
    for (const p of lider) membro.delete(p)
    alc = { todos: false, userId, restritos: [...restritos], lider: [...lider], membro: [...membro], operar: [...operar] }
  }
  cache.set(chave, { alc, ts: Date.now() })
  return alc
}

/** Pode ver o portal em si (lista de portais, detalhe, analytics). */
export function podeVerPortal(alc: AlcancePortais, portalId: number): boolean {
  if (alc.todos || !alc.restritos.includes(portalId)) return true
  return alc.lider.includes(portalId) || alc.membro.includes(portalId)
}

/** Pode agir no portal (escrita). Portal aberto: decide a tela, como antes. */
export function podeOperarPortal(alc: AlcancePortais, portalId: number): boolean {
  if (alc.todos || !alc.restritos.includes(portalId)) return true
  return alc.operar.includes(portalId)
}

/** Recorte de portais visíveis: `null` = sem recorte. */
export function wherePortais(alc: AlcancePortais): Prisma.EnrollmentPortalWhereInput | null {
  if (alc.todos || !alc.restritos.length) return null
  const meus = [...alc.lider, ...alc.membro]
  return { OR: [{ id: { notIn: alc.restritos } }, ...(meus.length ? [{ id: { in: meus } }] : [])] }
}

/**
 * Recorte de inscrições visíveis, para juntar num `AND` do Prisma.
 * `null` = sem recorte (vê todos, ou nenhum portal restrito existe).
 */
export function whereInscricoes(alc: AlcancePortais): Prisma.EnrollmentRegistrationWhereInput | null {
  if (alc.todos || !alc.restritos.length) return null
  const ramos: Prisma.EnrollmentRegistrationWhereInput[] = [{ portalId: { notIn: alc.restritos } }]
  if (alc.lider.length) ramos.push({ portalId: { in: alc.lider } })
  if (alc.membro.length) ramos.push({ portalId: { in: alc.membro }, lead: { assignedUserId: alc.userId } })
  return { OR: ramos }
}

/**
 * O mesmo recorte para SQL cru. `alias` é a tabela/alias de
 * bychat_enrollment_registrations na consulta; `aliasLead`, a de bychat_leads
 * (o fragmento faz a própria subconsulta quando não há join com leads).
 * Devolve `1=1` sem recorte, para entrar direto num WHERE.
 */
export function sqlInscricoes(alc: AlcancePortais, alias: string): Prisma.Sql {
  if (alc.todos || !alc.restritos.length) return Prisma.sql`1=1`
  const col = Prisma.raw(`${alias}.portalId`)
  const lead = Prisma.raw(`${alias}.leadId`)
  const ramos: Prisma.Sql[] = [Prisma.sql`${col} NOT IN (${Prisma.join(alc.restritos)})`]
  if (alc.lider.length) ramos.push(Prisma.sql`${col} IN (${Prisma.join(alc.lider)})`)
  if (alc.membro.length) {
    ramos.push(Prisma.sql`(${col} IN (${Prisma.join(alc.membro)}) AND ${lead} IN (SELECT id FROM bychat_leads WHERE assignedUserId = ${alc.userId}))`)
  }
  return Prisma.sql`(${Prisma.join(ramos, ' OR ')})`
}

/** Decide uma inscrição já carregada (portalId + dono do lead). */
export function podeVerInscricao(alc: AlcancePortais, reg: { portalId: number; donoDoLead: number | null }): boolean {
  if (alc.todos || !alc.restritos.includes(reg.portalId)) return true
  if (alc.lider.includes(reg.portalId)) return true
  return alc.membro.includes(reg.portalId) && reg.donoDoLead === alc.userId
}

export type Veredito = 'ok' | 'nao_encontrada' | 'sem_permissao'

/**
 * Checagem de uma inscrição por id — para rotas de detalhe e de ação.
 * 'nao_encontrada' também quando existe mas está fora do alcance (404).
 * 'sem_permissao' quando vê, mas o pedido é escrita e o nível é VER (403).
 */
export async function vereditoDaInscricao(alc: AlcancePortais, registrationId: number, acao: AcaoPortal): Promise<Veredito> {
  if (!Number.isFinite(registrationId)) return 'nao_encontrada'
  if (alc.todos) return 'ok'
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { portalId: true, lead: { select: { assignedUserId: true } } },
  })
  if (!reg) return 'nao_encontrada'
  if (!podeVerInscricao(alc, { portalId: reg.portalId, donoDoLead: reg.lead?.assignedUserId ?? null })) return 'nao_encontrada'
  if (acao === 'operar' && !podeOperarPortal(alc, reg.portalId)) return 'sem_permissao'
  return 'ok'
}

/** Responde 404/403 e devolve false quando o veredito barra. */
export function responderVeredito(reply: any, v: Veredito): boolean {
  if (v === 'ok') return true
  if (v === 'nao_encontrada') reply.code(404).send({ error: 'Inscrição não encontrada' })
  else reply.code(403).send({ error: 'Sua equipe só acompanha este portal — a ação não é permitida.' })
  return false
}

/**
 * IDs das inscrições visíveis — para tabelas que só guardam `registrationId`
 * sem relação Prisma (AcaMatricula, envios do SEI, webhooks). `null` = todas.
 */
export async function idsDeInscricoesVisiveis(alc: AlcancePortais): Promise<number[] | null> {
  const w = whereInscricoes(alc)
  if (!w) return null
  const regs = await prisma.enrollmentRegistration.findMany({ where: w, select: { id: true } })
  return regs.map((r) => r.id)
}

/** Atalho para rotas: o alcance do usuário da requisição. */
export async function alcanceDaRequisicao(req: any): Promise<AlcancePortais> {
  const u = req.user as { userId: number; role: string } | undefined
  if (!u) return { todos: false, userId: 0, restritos: [], lider: [], membro: [], operar: [] }
  return alcanceDePortais(u.userId, u.role)
}

/**
 * ERP — alunos visíveis: o lead tem ao menos uma inscrição que a pessoa vê.
 * Aluno sem inscrição nenhuma (cadastro manual ou importado) fica de fora:
 * não há portal para dizer de quem ele é (regra 6).
 */
export function whereAlunos(alc: AlcancePortais): Prisma.AlunoWhereInput | null {
  const w = whereInscricoes(alc)
  return w ? { lead: { enrollmentRegistrations: { some: w } } } : null
}

/** ERP — matrículas visíveis: vieram de uma inscrição que a pessoa vê. */
export async function whereMatriculas(alc: AlcancePortais): Promise<Prisma.AcaMatriculaWhereInput | null> {
  const ids = await idsDeInscricoesVisiveis(alc)
  return ids ? { enrollmentRegistrationId: { in: ids.length ? ids : [-1] } } : null
}
