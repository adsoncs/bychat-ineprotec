import { useState } from 'preact/hooks'
import {
  useLead,
  useDeleteLead,
  useQualifyLead,
  useResendLeadReport,
  getRegistrationConflict,
} from '@/hooks/useLeads'
import { useEnrollmentLinkByLead } from '@/hooks/useEnrollmentPortals'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DuplicateLeadModal } from '@/components/DuplicateLeadModal'
import { MergeLeadsModal } from '@/components/MergeLeadsModal'
import {
  LeadDetailOverviewTab as LeadOverviewTab,
  LeadDetailTrackingTab as LeadTrackingTab,
  LeadDetailIntelTab as LeadIntelTab,
  LeadDetailActivitiesTab as LeadActivitiesTab,
  LeadDetailTimelineTab as LeadTimelineTab,
  LeadDetailFieldsTab as LeadFieldsTab,
  EditLeadModal,
} from '@/routes/pages/LeadsPage'
import { LeadCadencesTab } from '@/components/LeadCadencesTab'
import { LeadAuditTab } from '@/components/LeadAuditTab'
import { LeadJourneyTab } from '@/components/LeadJourneyTab'
import { toast } from '@/lib/toast'

export const LEAD_DETAIL_SECTIONS = [
  { id: 'overview',   label: 'Visão geral' },
  { id: 'activities', label: 'Atividades' },
  { id: 'cadences',   label: 'Cadências' },
  { id: 'jornada',    label: 'Jornada IA' },
  { id: 'intel',      label: 'Inteligência' },
  { id: 'tracking',   label: 'Tracking' },
  { id: 'audit',      label: 'Auditoria de Conversas' },
  { id: 'timeline',   label: 'Timeline' },
  { id: 'fields',     label: 'Campos Personalizados' },
] as const

export type LeadDetailSectionId = typeof LEAD_DETAIL_SECTIONS[number]['id']

export const DEFAULT_SECTION: LeadDetailSectionId = 'overview'

export function isValidSection(s: string | undefined | null): s is LeadDetailSectionId {
  return !!s && LEAD_DETAIL_SECTIONS.some((sec) => sec.id === s)
}

interface Props {
  id: number
  section: LeadDetailSectionId
}

/**
 * Conteúdo da seção atual do lead. URL determina qual seção renderizar
 * (`/leads/:id/:section`). Sem state local → sem bug intermitente.
 */
export function LeadDetailContent({ id, section }: Props) {
  const { data: lead, isLoading } = useLead(id)

  if (isLoading || !lead) {
    return <Skeleton class="h-64 w-full" />
  }

  return (
    <div class="space-y-4">
      {section === 'overview'   && <LeadOverviewTab lead={lead} />}
      {section === 'tracking'   && <LeadTrackingTab lead={lead} />}
      {section === 'jornada'    && <LeadJourneyTab leadId={lead.id} />}
      {section === 'intel'      && <LeadIntelTab leadId={lead.id} />}
      {section === 'audit'      && <LeadAuditTab leadId={lead.id} />}
      {section === 'activities' && <LeadActivitiesTab leadId={lead.id} />}
      {section === 'cadences'   && <LeadCadencesTab leadId={lead.id} />}
      {section === 'timeline'   && <LeadTimelineTab leadId={lead.id} />}
      {section === 'fields'     && <LeadFieldsTab leadId={lead.id} customFields={lead.customFields} />}
    </div>
  )
}

/**
 * Hook que centraliza ações + diálogos do lead (Qualificar/Mesclar/Duplicar/Excluir/etc.)
 * Retorna `dialogs` (JSX) e `actions` (handlers) pra o header/menu chamar.
 */
export function useLeadActions(id: number, lead: ReturnType<typeof useLead>['data'], opts: {
  onLeadDeleted?: () => void
  onLeadDuplicated?: (newId: number) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [forceDeleteReg, setForceDeleteReg] = useState<number | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const delMut = useDeleteLead()
  const qualify = useQualifyLead()
  const resendReport = useResendLeadReport()
  const enrollLink = useEnrollmentLinkByLead()

  const isEnrollmentLead =
    lead?.source === 'enrollment_portal' || lead?.source === 'enrollment_portal_interest'

  function handleQualify() {
    qualify.mutate(id, {
      onSuccess: () => toast('Lead qualificado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleEnrollmentLink() {
    enrollLink.mutate(id, {
      onSuccess: (r) => {
        if (r.url) {
          void navigator.clipboard.writeText(r.url).then(() => toast('Link de matrícula copiado', 'success'))
          window.open(r.url, '_blank')
        } else {
          toast('Lead não tem inscrição ativa', 'warning')
        }
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleResendReport() {
    resendReport.mutate(id, {
      onSuccess: () => toast('Relatório reenviado por e-mail', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => { if (!o) { setConfirmDelete(false); setForceDeleteReg(null) } }}
        title={`Excluir lead "${lead?.empresa ?? id}"`}
        description={forceDeleteReg !== null
          ? `⚠️ Este lead tem ${forceDeleteReg} inscrição(ões) no portal de matrículas. Apagá-lo vai desvinculá-las — elas ficam órfãs no módulo de Matrículas (sem lead). Confirme para apagar mesmo assim.`
          : 'O lead vai para a lixeira e pode ser restaurado.'}
        destructive
        confirmLabel={forceDeleteReg !== null ? 'Apagar mesmo assim' : 'Excluir'}
        loading={delMut.isPending}
        onConfirm={() => delMut.mutate({ id, force: forceDeleteReg !== null }, {
          onSuccess: () => {
            toast('Lead movido para a lixeira', 'success')
            setConfirmDelete(false)
            setForceDeleteReg(null)
            opts.onLeadDeleted?.()
          },
          onError: (e: unknown) => {
            const c = getRegistrationConflict(e)
            if (c && forceDeleteReg === null) setForceDeleteReg(c.count)
            else toast((e as Error).message, 'danger')
          },
        })}
      />

      {mergeOpen && lead && (
        <MergeLeadsModal
          masterId={id}
          masterName={lead.empresa ?? lead.nome ?? `Lead #${id}`}
          onClose={() => setMergeOpen(false)}
          onMerged={() => { setMergeOpen(false); opts.onLeadDeleted?.() }}
        />
      )}

      {duplicateOpen && (
        <DuplicateLeadModal
          leadId={id}
          onClose={() => setDuplicateOpen(false)}
          onDuplicated={(newId) => {
            setDuplicateOpen(false)
            opts.onLeadDuplicated?.(newId)
          }}
        />
      )}

      {editOpen && (
        <EditLeadModal id={id} onClose={() => setEditOpen(false)} />
      )}
    </>
  )

  return {
    dialogs,
    isEnrollmentLead,
    isWebChat: lead?.source === 'web_chat',
    isQualified: !!lead?.qualifiedAt,
    isPending: {
      qualify: qualify.isPending,
      delete: delMut.isPending,
      enrollLink: enrollLink.isPending,
      resendReport: resendReport.isPending,
    },
    actions: {
      qualify: handleQualify,
      edit: () => setEditOpen(true),
      delete: () => setConfirmDelete(true),
      merge: () => setMergeOpen(true),
      duplicate: () => setDuplicateOpen(true),
      enrollmentLink: handleEnrollmentLink,
      resendReport: handleResendReport,
    },
  }
}
