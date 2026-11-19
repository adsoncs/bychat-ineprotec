// services/inscricoesDoContato.ts
//
// Inscrições ATIVAS de um contato — da ficha e das fichas ligadas a ela (19/11/2026).
//
// Caso real (ineprotec, lead 42559): a Jéssica atendia o lead; ele se inscreveu
// sozinho pelo portal, que criou uma ficha NOVA (dedup "sempre nova") e marcou
// como possível duplicado. A inscrição nasceu nessa outra ficha, invisível na
// conversa da Jéssica — e ela fez uma segunda matrícula à mão horas depois.
//
// Por isso não basta olhar a própria ficha: entram a principal (se esta é
// duplicada), os possíveis duplicados dela, o mesmo telefone e o mesmo CPF.
// Usado no alerta da conversa/ficha e na trava da matrícula manual.

import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { isModuleEnabled } from '../lib/moduleManager.js'

/** Fora da conta: encerradas e a cópia que sumiu numa junção. */
const ENCERRADAS = ['cancelled', 'merged', 'expired', 'transferred', 'rejected']

export type Ligacao = 'esta_ficha' | 'ficha_principal' | 'possivel_duplicado' | 'mesmo_telefone' | 'mesmo_cpf'

export interface InscricaoAtiva {
  id: number
  portalId: number
  portal: string | null
  codigo: string
  curso: string | null
  status: string
  pagamento: string | null
  origem: string | null
  vendedor: string | null
  criadaEm: Date
  leadId: number | null
  /** Por que esta inscrição aparece para este contato. */
  ligacao: Ligacao
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/**
 * @param recorte where de inscrições visíveis (lib/portalAccess.whereInscricoes); null = vê todas.
 */
export async function inscricoesAtivasDoContato(leadId: number, recorte: Prisma.EnrollmentRegistrationWhereInput | null = null): Promise<InscricaoAtiva[]> {
  if (!(await isModuleEnabled('educacional').catch(() => false))) return []
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, phoneKey: true, possibleDuplicateOfId: true, formData: true },
  })
  if (!lead) return []

  const ligacao = new Map<number, Ligacao>([[lead.id, 'esta_ficha']])
  const marcar = (id: number | null | undefined, l: Ligacao) => { if (id && !ligacao.has(id)) ligacao.set(id, l) }

  marcar(lead.possibleDuplicateOfId, 'ficha_principal')
  const [duplicados, mesmoTelefone] = await Promise.all([
    prisma.lead.findMany({
      where: { OR: [{ possibleDuplicateOfId: lead.id }, ...(lead.possibleDuplicateOfId ? [{ possibleDuplicateOfId: lead.possibleDuplicateOfId }] : [])], id: { not: lead.id } },
      select: { id: true }, take: 20,
    }),
    lead.phoneKey && lead.phoneKey.length >= 8
      ? prisma.lead.findMany({ where: { phoneKey: lead.phoneKey, id: { not: lead.id }, isGroup: false }, select: { id: true }, take: 20 })
      : Promise.resolve([] as { id: number }[]),
  ])
  for (const d of duplicados) marcar(d.id, 'possivel_duplicado')
  for (const d of mesmoTelefone) marcar(d.id, 'mesmo_telefone')

  // CPF: o da ficha e o das inscrições das fichas ligadas (no formulário vem com pontuação).
  const cpfs = new Set<string>()
  const cpfDaFicha = soDigitos((lead.formData as any)?.cpf)
  if (cpfDaFicha.length === 11) cpfs.add(cpfDaFicha)
  const regsDasFichas = await prisma.enrollmentRegistration.findMany({ where: { leadId: { in: [...ligacao.keys()] } }, select: { formData: true }, take: 50 })
  for (const r of regsDasFichas) { const c = soDigitos((r.formData as any)?.cpf); if (c.length === 11) cpfs.add(c) }
  const porCpf = new Map<number, number | null>() // registrationId → leadId
  for (const c of cpfs) {
    const rows = await prisma.$queryRaw<{ id: number; leadId: number | null }[]>`
      SELECT id, leadId FROM bychat_enrollment_registrations
       WHERE REPLACE(REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(formData, '$.cpf')), '.', ''), '-', ''), ' ', '') = ${c}
       LIMIT 30`.catch(() => [])
    for (const r of rows) porCpf.set(Number(r.id), r.leadId == null ? null : Number(r.leadId))
  }

  const where: Prisma.EnrollmentRegistrationWhereInput = {
    status: { notIn: ENCERRADAS },
    mergedIntoId: null,
    OR: [{ leadId: { in: [...ligacao.keys()] } }, ...(porCpf.size ? [{ id: { in: [...porCpf.keys()] } }] : [])],
    ...(recorte ? { AND: [recorte] } : {}),
  }
  const regs = await prisma.enrollmentRegistration.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 20,
    select: {
      id: true, portalId: true, candidateCode: true, status: true, paymentStatus: true, origem: true, createdAt: true, leadId: true, vendedorUserId: true,
      portal: { select: { nome: true } },
      processRegistration: { select: { offering: { select: { nome: true, course: { select: { nome: true } } } } } },
    },
  })
  const vendedores = await prisma.user.findMany({ where: { id: { in: regs.map((r) => r.vendedorUserId).filter((x): x is number => !!x) } }, select: { id: true, name: true, email: true } })
  const nome = new Map(vendedores.map((v) => [v.id, v.name || v.email]))
  return regs.map((r) => ({
    id: r.id, portalId: r.portalId, portal: r.portal?.nome ?? null, codigo: r.candidateCode,
    curso: r.processRegistration?.offering?.nome ?? r.processRegistration?.offering?.course?.nome ?? null,
    status: r.status, pagamento: r.paymentStatus, origem: r.origem,
    vendedor: r.vendedorUserId ? nome.get(r.vendedorUserId) ?? null : null,
    criadaEm: r.createdAt, leadId: r.leadId,
    ligacao: (r.leadId != null ? ligacao.get(r.leadId) : undefined) ?? 'mesmo_cpf',
  }))
}
