import type { LeadEducacional } from '@/hooks/useLeads'
import type { EduColumnKey } from '@/stores/leadsColumns'
import { useMyPermissions } from '@/hooks/usePermissions'
import { formatDateTime } from '@/lib/format'

/** O grupo "Educacional" das colunas só existe com o módulo ligado. */
export function useEducacionalAtivo(): boolean {
  const { data } = useMyPermissions()
  return !!data?.modules.some((m) => m.id === 'educacional' && m.active !== false)
}

const STATUS_INSCRICAO: Record<string, string> = {
  draft: 'Rascunho',
  pending: 'Aguardando pagamento',
  submitted: 'Enviada',
  paid: 'Paga',
  docs_uploaded: 'Docs enviados',
  docs_reviewing: 'Docs em análise',
  docs_approved: 'Docs aprovados',
  docs_rejected: 'Docs rejeitados',
  reviewing: 'Em análise',
  approved: 'Aprovada',
  enrolled: 'Matriculada',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
}

const PAGAMENTO: Record<string, string> = {
  paid: 'Paga',
  pending: 'Pendente',
  overdue: 'Vencida',
  expired: 'Expirada',
  cancelled: 'Cancelada',
  refunded: 'Estornada',
}

const SITUACAO_MATRICULA: Record<string, string> = {
  PRE_MATRICULADO: 'Pré-matriculado',
  ATIVO: 'Ativo',
  INTEGRALIZANDO: 'Integralizando',
  TRANCADO: 'Trancado',
  EVADIDO: 'Evadido',
  TRANSFERIDO: 'Transferido',
  TRANSFERIDO_INTERNO: 'Transferido (interno)',
  CANCELADO: 'Cancelado',
  FORMADO: 'Formado',
  DIPLOMADO: 'Diplomado',
  FALECIDO: 'Falecido',
}

const TURNO: Record<string, string> = {
  MATUTINO: 'Matutino', VESPERTINO: 'Vespertino', NOTURNO: 'Noturno', INTEGRAL: 'Integral', EAD: 'EAD',
}

/** Valores distintos, na ordem em que aparecem (a mais recente primeiro). */
function distintos(vs: (string | null | undefined)[]): string[] {
  return [...new Set(vs.filter((v): v is string => !!v))]
}

/**
 * Texto da célula de uma coluna educacional. Um lead pode ter várias
 * inscrições/matrículas: a célula mostra a mais recente e "+N", e o `title`
 * (dica ao passar o mouse) lista todas.
 */
export function eduCellText(lead: { educacional?: LeadEducacional | undefined }, col: EduColumnKey): { text: string; title: string } {
  const insc = lead.educacional?.inscricoes ?? []
  const mats = lead.educacional?.matriculas ?? []
  let vs: string[]
  switch (col) {
    case 'eduCursoInscricao': vs = distintos(insc.map((i) => i.curso)); break
    case 'eduStatusInscricao': vs = insc.map((i) => STATUS_INSCRICAO[i.status] ?? i.status); break
    case 'eduPagamento': vs = insc.map((i) => (i.pagamento ? PAGAMENTO[i.pagamento] ?? i.pagamento : 'Não gerada')); break
    case 'eduFormaIngresso': vs = distintos(insc.map((i) => i.formaIngresso)); break
    case 'eduPolo': vs = distintos(insc.map((i) => i.polo)); break
    case 'eduPortal': vs = distintos(insc.map((i) => i.portal)); break
    case 'eduProcesso': vs = distintos(insc.map((i) => i.processo)); break
    case 'eduDataInscricao': vs = insc.map((i) => formatDateTime(i.criadaEm)); break
    case 'eduCodigo': vs = insc.map((i) => i.codigo); break
    case 'eduCursoMatricula': vs = distintos(mats.map((m) => m.curso)); break
    case 'eduSituacaoMatricula': vs = mats.map((m) => SITUACAO_MATRICULA[m.situacao] ?? m.situacao); break
    case 'eduRa': vs = distintos(mats.map((m) => m.ra)); break
    case 'eduPeriodo':
      vs = mats.map((m) => [m.periodo ? `${m.periodo}º período` : null, m.turno ? TURNO[m.turno] ?? m.turno : null]
        .filter(Boolean).join(' · ')).filter(Boolean)
      break
  }
  if (vs.length === 0) return { text: '—', title: '' }
  const text = vs.length > 1 ? `${vs[0]} +${vs.length - 1}` : vs[0]!
  return { text, title: vs.join('\n') }
}
