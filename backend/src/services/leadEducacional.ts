// Colunas "Educacional" da lista de leads: o que a pessoa fez nos portais de
// matrícula (inscrições) e o que virou matrícula de fato (vínculo do aluno).
//
// Roda por PÁGINA da lista — recebe só os ids exibidos e faz um punhado de
// consultas em lote, nunca uma por lead. Com o módulo Educacional desligado
// não consulta nada e a lista segue como sempre.
import { prisma } from '../lib/prisma.js'
import { isModuleEnabled } from '../lib/moduleManager.js'

export interface LeadInscricaoResumo {
  id: number
  codigo: string
  curso: string | null
  portal: string
  polo: string | null
  formaIngresso: string | null
  processo: string | null
  status: string
  pagamento: string | null
  criadaEm: Date
}

export interface LeadMatriculaResumo {
  curso: string | null
  ra: string | null
  situacao: string
  periodo: number | null
  turno: string | null
  ingresso: Date | null
}

export interface LeadEducacional {
  inscricoes: LeadInscricaoResumo[]
  matriculas: LeadMatriculaResumo[]
}

/** Mapa leadId → dados educacionais. Vazio quando o módulo está desligado. */
export async function educacionalDosLeads(leadIds: number[]): Promise<Map<number, LeadEducacional>> {
  const out = new Map<number, LeadEducacional>()
  if (leadIds.length === 0) return out
  if (!(await isModuleEnabled('educacional').catch(() => false))) return out

  const [regs, alunos] = await Promise.all([
    prisma.enrollmentRegistration.findMany({
      // Mesclada é a cópia que sumiu na junção — a inscrição que vale é a outra.
      where: { leadId: { in: leadIds }, status: { not: 'merged' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, leadId: true, candidateCode: true, status: true, paymentStatus: true,
        createdAt: true, formData: true,
        portal: { select: { nome: true } },
        processRegistration: {
          select: {
            selectionProcess: { select: { nome: true } },
            offering: { select: { nome: true, course: { select: { nome: true } } } },
          },
        },
      },
    }),
    prisma.aluno.findMany({
      where: { leadId: { in: leadIds } },
      select: {
        leadId: true,
        vinculos: {
          orderBy: { createdAt: 'desc' },
          select: { courseId: true, ra: true, situacao: true, periodoAtual: true, turno: true, dataIngresso: true },
        },
      },
    }),
  ])

  // A forma de ingresso fica no formData como código (vestibular_online, enem…);
  // o nome legível vem do cadastro de modos de ingresso.
  const codigos = new Set<string>()
  for (const r of regs) {
    const fi = (r.formData as any)?._formaIngresso
    if (typeof fi === 'string' && fi) codigos.add(fi)
  }
  const courseIds = new Set<number>()
  for (const a of alunos) for (const v of a.vinculos) courseIds.add(v.courseId)

  const [modos, cursos] = await Promise.all([
    codigos.size
      ? prisma.entryMode.findMany({ where: { code: { in: [...codigos] } }, select: { code: true, name: true } })
      : Promise.resolve([]),
    courseIds.size
      ? prisma.course.findMany({ where: { id: { in: [...courseIds] } }, select: { id: true, nome: true } })
      : Promise.resolve([]),
  ])
  const modoNome = new Map(modos.map((m) => [m.code, m.name]))
  const cursoNome = new Map(cursos.map((c) => [c.id, c.nome]))

  const doLead = (id: number) => {
    let e = out.get(id)
    if (!e) { e = { inscricoes: [], matriculas: [] }; out.set(id, e) }
    return e
  }

  for (const r of regs) {
    if (r.leadId == null) continue
    const fd = (r.formData ?? {}) as Record<string, unknown>
    const fi = typeof fd._formaIngresso === 'string' && fd._formaIngresso ? fd._formaIngresso : null
    const off = r.processRegistration?.offering
    doLead(r.leadId).inscricoes.push({
      id: r.id,
      codigo: r.candidateCode,
      curso: off?.course?.nome || off?.nome || null,
      portal: r.portal.nome,
      polo: typeof fd.campusNome === 'string' && fd.campusNome ? fd.campusNome : null,
      formaIngresso: fi ? modoNome.get(fi) ?? fi : null,
      processo: r.processRegistration?.selectionProcess?.nome ?? null,
      status: r.status,
      pagamento: r.paymentStatus,
      criadaEm: r.createdAt,
    })
  }

  for (const a of alunos) {
    for (const v of a.vinculos) {
      doLead(a.leadId).matriculas.push({
        curso: cursoNome.get(v.courseId) ?? null,
        ra: v.ra,
        situacao: v.situacao,
        periodo: v.periodoAtual,
        turno: v.turno,
        ingresso: v.dataIngresso,
      })
    }
  }

  return out
}
