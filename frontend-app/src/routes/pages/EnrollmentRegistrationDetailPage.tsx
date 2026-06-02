import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  ChevronLeft, FileCheck2, AlertCircle, Bot, ExternalLink, Download, RefreshCw, Bell, CheckCircle, XCircle, Clock, Award, Send, Pencil, CreditCard, FileText,
} from 'lucide-preact'
import {
  useRegistrationReview,
  useRegistrationFull,
  useReviewDocument,
  useRenotifyDocument,
  useReanalyzeDocument,
  useBulkApproveAi,
  useUpdateEnemImport,
  useResendMagicLink,
  useSyncRegistrationPayment,
  type RegistrationReview,
  type DocumentSlot,
  type EnrollmentDocument,
  type DocumentStatus,
  type EnemImportFull,
} from '@/hooks/useEnrollmentPortals'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { downloadFile } from '@/lib/download'
import { toast } from '@/lib/toast'
import { formatRelative } from '@/lib/format'
import { paymentStatusLabel, paymentStatusTone, paymentMethodLabel, paymentProviderLabel } from '@/lib/paymentLabels'

const STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
}

const REGISTRATION_STATUS_LABELS: Record<string, string> = {
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

export function EnrollmentRegistrationDetailPage({ params }: { params: { portalId: string; regId: string } }) {
  const portalId = parseInt(params.portalId)
  const regId = parseInt(params.regId)
  const { data, isLoading, error } = useRegistrationReview(Number.isFinite(regId) ? regId : null)
  const [, navigate] = useLocation()

  const review = data

  function handleReceipt() {
    downloadFile(
      `/admin/enrollment-registrations/${regId}/receipt.pdf`,
      `comprovante-${review?.registration.candidateCode ?? regId}.html`,
    )
      .then(() => toast('Comprovante baixado', 'success'))
      .catch((e) => toast((e as Error).message, 'danger'))
  }

  return (
    <Page
      title={review?.registration.candidateCode ?? 'Inscrição'}
      description={review?.lead?.nome ?? 'Detalhe da inscrição'}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/enrollment-portals/${portalId}`)}>
            <ChevronLeft size={14} /> Voltar
          </Button>
          {review && (
            <Button variant="secondary" size="sm" onClick={handleReceipt}>
              <Download size={12} /> Comprovante
            </Button>
          )}
        </>
      }
    >
      {isLoading && (
        <>
          <Skeleton class="h-32 w-full" />
          <Skeleton class="h-48 w-full" />
        </>
      )}
      {error && (
        <Card>
          <div class="text-sm text-danger">Erro ao carregar inscrição: {(error).message}</div>
        </Card>
      )}

      {review && (
        <>
          <StatusBanner review={review} />
          <CandidateCard review={review} />
          <RegistrationCard review={review} />
          <EnemBlock registrationId={review.registration.id} />
          <PaymentMethodsBlock registrationId={review.registration.id} />
          <CandidatePortalCard review={review} />
          {review.autoAdvance.enabled && <AutoAdvanceCard review={review} />}
          <SlotsCard review={review} />
          {review.extras.length > 0 && <ExtrasCard extras={review.extras} registrationId={review.registration.id} />}
          <BulkActionsCard registrationId={review.registration.id} />
        </>
      )}
    </Page>
  )
}

function EnemBlock({ registrationId }: { registrationId: number }) {
  const { data } = useRegistrationFull(registrationId)
  const imports = data?.registration.enemScoreImports ?? []
  const [editing, setEditing] = useState<EnemImportFull | null>(null)

  if (imports.length === 0) return null

  return (
    <Card>
      <div class="flex items-center justify-between mb-3">
        <div class="text-xs uppercase tracking-wider text-fg-subtle inline-flex items-center gap-2">
          <Award size={12} /> ENEM ({imports.length})
        </div>
      </div>
      <ul class="space-y-2">
        {imports.map((imp) => (
          <li key={imp.id} class="rounded-md border border-border p-3 bg-surface">
            <div class="flex items-start gap-3 flex-wrap">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <span class="text-sm font-medium text-fg">{imp.nome ?? '—'}</span>
                  {imp.inscricao && <code class="text-[0.6875rem] text-fg-subtle font-mono">{imp.inscricao}</code>}
                  {imp.ano && <span class="text-[0.6875rem] text-fg-muted">ENEM {imp.ano}</span>}
                  {imp.treineiro && <Badge tone="info">Treineiro</Badge>}
                  {imp.passed === true && <Badge tone="success">Aprovado</Badge>}
                  {imp.passed === false && <Badge tone="danger">Reprovado</Badge>}
                  {imp.passed === null && <Badge tone="warning">Pendente</Badge>}
                </div>
                <div class="text-xs text-fg-muted">
                  Média: <strong class="text-fg">{imp.mediaSimples?.toFixed(1) ?? '—'}</strong>
                  {imp.cutoffScore !== null && <span class="text-fg-subtle"> · corte {imp.cutoffScore}</span>}
                  {imp.aiConfidence !== null && <span class="text-fg-subtle"> · IA {Math.round(imp.aiConfidence * 100)}%</span>}
                </div>
                <div class="text-[0.6875rem] text-fg-subtle mt-1">
                  CN {imp.cienciasNatureza ?? '—'} · CH {imp.cienciasHumanas ?? '—'} · LG {imp.linguagens ?? '—'} · MT {imp.matematica ?? '—'} · RD {imp.redacao ?? '—'}
                </div>
                {imp.validationNote && (
                  <div class="text-[0.6875rem] text-fg-muted mt-1 italic">"{imp.validationNote}"</div>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setEditing(imp)}>
                <Pencil size={11} /> Editar notas
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {editing && <EnemEditModal imp={editing} registrationId={registrationId} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function PaymentMethodsBlock({ registrationId }: { registrationId: number }) {
  const { data } = useRegistrationFull(registrationId)
  const sync = useSyncRegistrationPayment(registrationId)
  const methods = data?.registration.paymentMethods ?? []
  const paymentStatus = data?.registration.paymentStatus
  const requirePayment = !!data?.registration.portal?.requirePayment

  // Pode aparecer mesmo sem methods (modo link antigo) — desde que requirePayment.
  if (methods.length === 0 && !requirePayment) return null

  const methodLabel = paymentMethodLabel
  const providerLabel = paymentProviderLabel
  const statusTone = paymentStatusTone
  const statusLabel = paymentStatusLabel

  const hasPending = methods.some(m => m.status !== 'paid') || paymentStatus !== 'paid'

  function handleSync() {
    sync.mutate(undefined, {
      onSuccess: (r) => {
        if (r.transitionedToPaid) {
          toast('Pagamento confirmado!', 'success')
        } else {
          const stillPending = r.results.find(x => x.error)
          if (stillPending?.error) toast(stillPending.error, 'warning')
          else toast('Sincronizado — status atual no provider mantido.', 'info')
        }
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card>
      <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div class="text-xs uppercase tracking-wider text-fg-subtle inline-flex items-center gap-2">
          <CreditCard size={12} /> Cobranças ({methods.length})
        </div>
        {hasPending && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSync}
            disabled={sync.isPending}
            title="Consulta o status atual no Pagar.me/Asaas e replica no banco. Útil quando o webhook não chegou."
          >
            <RefreshCw size={11} class={sync.isPending ? 'animate-spin' : ''} />
            {sync.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
        )}
      </div>
      {methods.length === 0 && (
        <div class="text-xs text-fg-subtle py-2">
          Sem histórico de cobrança transparente.
          {data?.registration.paymentUrl && (
            <> Modo link: <a href={data.registration.paymentUrl} target="_blank" rel="noopener noreferrer" class="text-accent underline">abrir link de pagamento ↗</a></>
          )}
        </div>
      )}
      <ul class="space-y-2">
        {methods.map((m) => (
          <li key={m.id} class="rounded-md border border-border p-3 bg-surface">
            <div class="flex items-start gap-3 flex-wrap mb-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <span class="text-sm font-medium text-fg">{methodLabel(m.method)}</span>
                  <span class="text-[0.6875rem] text-fg-subtle">via {providerLabel(m.provider)}</span>
                  <Badge tone={statusTone(m.status)}>{statusLabel(m.status)}</Badge>
                  {m.externalId && (
                    <code class="text-[0.6875rem] text-fg-subtle font-mono truncate max-w-[180px]" title={m.externalId}>
                      {m.externalId}
                    </code>
                  )}
                </div>
                <div class="text-xs text-fg-muted">
                  Valor: <strong class="text-fg">R$ {Number(m.amount ?? 0).toFixed(2)}</strong>
                  {m.expiresAt && (
                    <span class="text-fg-subtle"> · expira {formatRelative(m.expiresAt)}</span>
                  )}
                  {m.paidAt && (
                    <span class="text-success"> · pago {formatRelative(m.paidAt)}</span>
                  )}
                </div>
                {m.method === 'credit_card' && (m.cardBrand || m.cardLastDigits) && (
                  <div class="text-[0.6875rem] text-fg-muted mt-1">
                    {m.cardBrand || 'Cartão'} •••• {m.cardLastDigits || '????'}
                  </div>
                )}
                {m.method === 'boleto' && m.boletoLine && (
                  <div class="text-[0.6875rem] text-fg-muted mt-1 font-mono truncate" title={m.boletoLine}>
                    {m.boletoLine}
                  </div>
                )}
                {m.lastErrorMessage && (
                  <div class="text-[0.6875rem] text-danger mt-1 italic">
                    {m.lastErrorMessage}
                  </div>
                )}
              </div>
              {m.boletoPdfUrl && (
                <a
                  href={m.boletoPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[0.6875rem] text-accent underline inline-flex items-center gap-1"
                >
                  <ExternalLink size={10} /> PDF
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function EnemEditModal({
  imp, registrationId, onClose,
}: { imp: EnemImportFull; registrationId: number; onClose: () => void }) {
  const update = useUpdateEnemImport(registrationId)
  const [scores, setScores] = useState({
    linguagens: imp.linguagens?.toString() ?? '',
    cienciasHumanas: imp.cienciasHumanas?.toString() ?? '',
    cienciasNatureza: imp.cienciasNatureza?.toString() ?? '',
    matematica: imp.matematica?.toString() ?? '',
    redacao: imp.redacao?.toString() ?? '',
  })
  const [decision, setDecision] = useState<'auto' | 'true' | 'false'>(
    imp.passed === true ? 'true' : imp.passed === false ? 'false' : 'auto',
  )
  const [note, setNote] = useState(imp.validationNote ?? '')

  function n(v: string): number | null {
    if (v.trim() === '') return null
    const x = Number(v)
    return Number.isFinite(x) ? x : null
  }

  function patch<K extends keyof typeof scores>(k: K, v: string) {
    setScores((s) => ({ ...s, [k]: v }))
  }

  function handleSave() {
    update.mutate({
      importId: imp.id,
      linguagens: n(scores.linguagens),
      cienciasHumanas: n(scores.cienciasHumanas),
      cienciasNatureza: n(scores.cienciasNatureza),
      matematica: n(scores.matematica),
      redacao: n(scores.redacao),
      passed: decision === 'true' ? true : decision === 'false' ? false : null,
      validationNote: note.trim() || null,
    }, {
      onSuccess: () => { toast('Notas atualizadas', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Editar notas ENEM"
      description={imp.nome ?? imp.inscricao ?? `Import #${imp.id}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={update.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <Input label="Linguagens" type="number" step="0.1" value={scores.linguagens} onInput={(e) => patch('linguagens', (e.target as HTMLInputElement).value)} />
          <Input label="C. Humanas" type="number" step="0.1" value={scores.cienciasHumanas} onInput={(e) => patch('cienciasHumanas', (e.target as HTMLInputElement).value)} />
          <Input label="C. Natureza" type="number" step="0.1" value={scores.cienciasNatureza} onInput={(e) => patch('cienciasNatureza', (e.target as HTMLInputElement).value)} />
          <Input label="Matemática" type="number" step="0.1" value={scores.matematica} onInput={(e) => patch('matematica', (e.target as HTMLInputElement).value)} />
        </div>
        <Input label="Redação" type="number" step="0.1" value={scores.redacao} onInput={(e) => patch('redacao', (e.target as HTMLInputElement).value)} />
        <Select label="Decisão de classificação" value={decision} onChange={(e) => setDecision((e.target as HTMLSelectElement).value as 'auto' | 'true' | 'false')}>
          <option value="auto">Automática (média × corte)</option>
          <option value="true">Forçar APROVADO</option>
          <option value="false">Forçar REPROVADO</option>
        </Select>
        <Textarea
          label="Nota do operador (opcional)"
          value={note}
          onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          rows={2}
          placeholder="Ex.: Nota de Redação ilegível, confirmada por e-mail com candidato"
        />
      </div>
    </Modal>
  )
}

function CandidatePortalCard({ review }: { review: RegistrationReview }) {
  const slug = review.portal?.slug
  const code = review.registration.candidateCode
  const [resending, setResending] = useState(false)
  const resend = useResendMagicLink(slug ?? '')

  if (!slug) return null

  const candidateUrl = `${window.location.origin}/candidato/${code}`

  function handleResend() {
    if (!review.lead?.email && !review.lead?.whatsapp) {
      toast('Lead não tem email nem WhatsApp', 'danger'); return
    }
    setResending(true)
    resend.mutate(
      review.lead.email ? { email: review.lead.email } : { whatsapp: review.lead.whatsapp ?? '' },
      {
        onSuccess: () => { toast('Magic link reenviado', 'success'); setResending(false) },
        onError: (e: unknown) => { toast((e as Error).message, 'danger'); setResending(false) },
      },
    )
  }

  function handleCopy() {
    void navigator.clipboard.writeText(candidateUrl).then(() => toast('Link copiado', 'success'))
  }

  return (
    <Card>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0 flex-1">
          <div class="text-xs uppercase tracking-wider text-fg-subtle">Portal do candidato</div>
          <a
            href={candidateUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm text-accent hover:underline truncate inline-flex items-center gap-1 mt-0.5"
          >
            {candidateUrl} <ExternalLink size={12} />
          </a>
          <div class="text-[0.6875rem] text-fg-subtle mt-0.5">
            URL pública onde o candidato faz login com email/WhatsApp para enviar documentos.
          </div>
        </div>
        <div class="flex gap-2 shrink-0">
          <Button variant="secondary" size="sm" onClick={handleCopy}>Copiar link</Button>
          <Button variant="primary" size="sm" onClick={handleResend} disabled={resending || resend.isPending}>
            <Send size={12} /> {resending || resend.isPending ? 'Enviando…' : 'Reenviar magic link'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function StatusBanner({ review }: { review: RegistrationReview }) {
  const inscStatus = review.registration.status
  const inscLabel = REGISTRATION_STATUS_LABELS[inscStatus] ?? inscStatus
  const inscTone = REGISTRATION_STATUS_TONE[inscStatus] ?? 'info'

  const docsConfig = {
    complete: { tone: 'success' as const, icon: <CheckCircle size={11} />, label: 'Documentos completos' },
    pending:  { tone: 'warning' as const, icon: <Clock size={11} />, label: 'Documentos pendentes' },
    rejected: { tone: 'danger'  as const, icon: <XCircle size={11} />, label: 'Documentos rejeitados' },
  }[review.completion]

  // Pagamento (se houver) — exibe junto pra dar a visão completa.
  const payStatus = review.registration.paymentStatus
  const payAmount = review.registration.paymentAmount != null ? Number(review.registration.paymentAmount) : null

  // Redação (se for parte do entry mode)
  const essay = review.essay
  const essayConfig: Record<string, { tone: 'success' | 'warning' | 'danger' | 'info'; icon: any; label: string }> = {
    pending:   { tone: 'warning', icon: <Clock size={11} />, label: 'Redação pendente' },
    submitted: { tone: 'info',    icon: <FileText size={11} />, label: 'Redação enviada' },
    reviewing: { tone: 'warning', icon: <Bot size={11} />, label: 'Redação em análise' },
    approved:  { tone: 'success', icon: <CheckCircle size={11} />, label: 'Redação aprovada' },
    rejected:  { tone: 'danger',  icon: <XCircle size={11} />, label: 'Redação rejeitada' },
  }
  const essayBadge = essay?.required ? essayConfig[essay.status] : null

  return (
    <Card>
      <div class="flex items-center gap-2 flex-wrap">
        <code class="text-sm text-fg font-mono font-medium px-2 py-0.5 rounded bg-surface-3 border border-border">
          {review.registration.candidateCode}
        </code>
        <Badge tone={inscTone}>
          <span class="inline-flex items-center gap-1">
            <FileCheck2 size={11} /> {inscLabel}
          </span>
        </Badge>
        <Badge tone={docsConfig.tone}>
          <span class="inline-flex items-center gap-1">
            {docsConfig.icon} {docsConfig.label}
          </span>
        </Badge>
        {essayBadge && (
          <Badge tone={essayBadge.tone}>
            <span class="inline-flex items-center gap-1">
              {essayBadge.icon} {essayBadge.label}
              {essay?.score != null && <span class="font-mono">· {Math.round(essay.score)}</span>}
            </span>
          </Badge>
        )}
        {payStatus && (
          <Badge tone={paymentStatusTone(payStatus)}>
            <span class="inline-flex items-center gap-1">
              <CreditCard size={11} /> {paymentStatusLabel(payStatus)}
              {payAmount != null && <span class="font-mono">· R$ {payAmount.toFixed(2)}</span>}
            </span>
          </Badge>
        )}
        <span class="text-[0.6875rem] text-fg-subtle ml-auto">
          Criada {formatRelative(review.registration.createdAt)}
        </span>
      </div>
    </Card>
  )
}

const REGISTRATION_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  draft: 'info',
  pending: 'warning',
  submitted: 'info',
  paid: 'success',
  docs_uploaded: 'info',
  docs_reviewing: 'warning',
  docs_approved: 'success',
  docs_rejected: 'danger',
  reviewing: 'warning',
  approved: 'success',
  enrolled: 'success',
  rejected: 'danger',
  cancelled: 'info',
  expired: 'info',
}

function CandidateCard({ review }: { review: RegistrationReview }) {
  if (!review.lead) return null
  const fd = (review.registration.formData ?? {})
  const cpf = (fd.cpf as string | undefined) ?? null

  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">Candidato</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <Field label="Nome" value={review.lead.nome ?? '—'} />
        {cpf && <Field label="CPF" value={cpf} />}
        <Field label="E-mail" value={review.lead.email ?? '—'} />
        <Field label="WhatsApp" value={review.lead.whatsapp ?? '—'} />
      </div>
      <a
        href={`/app/leads/${review.lead.id}`}
        class="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-3"
      >
        Abrir lead no CRM <ExternalLink size={11} />
      </a>
    </Card>
  )
}

function RegistrationCard({ review }: { review: RegistrationReview }) {
  const sp = review.processRegistration?.selectionProcess
  const offering = review.processRegistration?.offering
  const portal = review.portal

  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">Inscrição</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <Field label="Portal" value={portal?.nome ?? '—'} />
        <Field label="Slug" value={portal?.slug ? <code class="text-xs">{portal.slug}</code> : '—'} />
        <Field label="Processo seletivo" value={sp?.nome ?? '—'} />
        <Field
          label="Modo de ingresso"
          value={sp?.entryMode ? `${sp.entryMode.icon ?? ''} ${sp.entryMode.name}`.trim() : '—'}
        />
        <Field label="Curso" value={offering?.course?.nome ?? '—'} />
        <Field label="Oferta" value={offering?.nome ?? '—'} />
        <Field label="Turno" value={offering?.turno ?? '—'} />
        <Field
          label="Campus"
          value={
            offering?.campuses && offering.campuses.length > 0
              ? offering.campuses.map((c) => `${c.campus.nome}${c.campus.cidade ? ` (${c.campus.cidade})` : ''}`).join(', ')
              : '—'
          }
        />
      </div>
    </Card>
  )
}

function AutoAdvanceCard({ review }: { review: RegistrationReview }) {
  if (!review.autoAdvance.enabled) return null
  const aa = review.autoAdvance
  return (
    <Card>
      <div class="flex items-start gap-2">
        <Bot size={16} class="text-accent mt-0.5 shrink-0" />
        <div class="text-xs text-fg-muted">
          Auto-avanço configurado: ao aprovar todos os documentos obrigatórios, o lead será movido para
          a etapa <strong class="text-fg">{aa.stageName}</strong>
          {aa.funnelName ? ` no funil ${aa.funnelName}` : ''}.
        </div>
      </div>
    </Card>
  )
}

function SlotsCard({ review }: { review: RegistrationReview }) {
  if (review.slots.length === 0) {
    return (
      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">Documentos esperados</div>
        <div class="text-sm text-fg-muted text-center py-4">
          Nenhum documento foi configurado para este modo de ingresso.
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">
        Documentos esperados ({review.slots.length})
      </div>
      <ul class="space-y-2">
        {review.slots.map((s, idx) => (
          <SlotRow key={idx} slot={s} registrationId={review.registration.id} />
        ))}
      </ul>
    </Card>
  )
}

function SlotRow({ slot, registrationId }: { slot: DocumentSlot; registrationId: number }) {
  const dt = slot.documentType
  const doc = slot.latestDoc
  const reqLabel = slot.required ? 'Obrigatório' : 'Opcional'

  return (
    <li class="rounded-md border border-border p-3 bg-surface">
      <div class="flex items-start gap-3">
        <span class="size-8 rounded-md bg-surface-3 grid place-items-center text-fg-muted shrink-0">
          <FileCheck2 size={14} />
        </span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg truncate">{dt?.name ?? '—'}</span>
            {dt?.code && <code class="text-[0.625rem] text-fg-subtle">{dt.code}</code>}
            <span class={`text-[0.625rem] uppercase ${slot.required ? 'text-warning' : 'text-fg-subtle'}`}>
              {reqLabel}
            </span>
          </div>
          {slot.helpText && (
            <div class="text-xs text-fg-subtle mt-0.5">{slot.helpText}</div>
          )}
        </div>
        <DocStatusBadge doc={doc} />
      </div>
      {doc && <DocBody doc={doc} registrationId={registrationId} />}
      {!doc && (
        <div class="ml-11 mt-2 text-[0.6875rem] text-fg-subtle">
          Candidato ainda não enviou este documento.
        </div>
      )}
    </li>
  )
}

function ExtrasCard({
  extras, registrationId,
}: { extras: EnrollmentDocument[]; registrationId: number }) {
  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">
        Documentos extras ({extras.length})
      </div>
      <div class="text-[0.6875rem] text-fg-subtle mb-2">
        Documentos enviados pelo candidato que não correspondem a nenhum requisito esperado.
      </div>
      <ul class="space-y-2">
        {extras.map((d) => (
          <li key={d.id} class="rounded-md border border-border p-3 bg-surface">
            <div class="flex items-start gap-3">
              <span class="size-8 rounded-md bg-surface-3 grid place-items-center text-fg-muted shrink-0">
                <AlertCircle size={14} />
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium text-fg truncate">
                    {d.label ?? d.type?.name ?? d.fileName ?? `Doc #${d.id}`}
                  </span>
                  {d.typeCode && <code class="text-[0.625rem] text-fg-subtle">{d.typeCode}</code>}
                </div>
              </div>
              <DocStatusBadge doc={d} />
            </div>
            <DocBody doc={d} registrationId={registrationId} />
          </li>
        ))}
      </ul>
    </Card>
  )
}

function DocStatusBadge({ doc }: { doc: EnrollmentDocument | null }) {
  if (!doc) {
    return (
      <span class="text-[0.625rem] uppercase tracking-wider text-fg-subtle shrink-0">
        Não enviado
      </span>
    )
  }
  const cfg = {
    pending:  { label: 'Pendente',  color: 'text-warning' },
    approved: { label: 'Aprovado',  color: 'text-success' },
    rejected: { label: 'Rejeitado', color: 'text-danger' },
  }[doc.status]
  return (
    <span class={`text-[0.625rem] uppercase tracking-wider font-medium shrink-0 ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

function DocBody({ doc, registrationId }: { doc: EnrollmentDocument; registrationId: number }) {
  const review = useReviewDocument(registrationId)
  const renotify = useRenotifyDocument(registrationId)
  const reanalyze = useReanalyzeDocument(registrationId)
  const [rejecting, setRejecting] = useState(false)

  const sizeKb = doc.sizeBytes ? Math.round(doc.sizeBytes / 1024) : null

  return (
    <div class="ml-11 mt-2 space-y-2">
      <div class="flex flex-wrap items-center gap-2 text-[0.6875rem] text-fg-muted">
        {doc.fileName && <span class="truncate max-w-48" title={doc.fileName}>{doc.fileName}</span>}
        {sizeKb != null && <span class="tabular-nums">{sizeKb} KB</span>}
        <span>· enviado {formatRelative(doc.uploadedAt)}</span>
        {doc.fileUrl && (
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-accent hover:underline inline-flex items-center gap-1"
          >
            Abrir <ExternalLink size={10} />
          </a>
        )}
      </div>

      {doc.aiSuggestion && <AiSummary doc={doc} />}

      {doc.status === 'rejected' && doc.reviewNote && (
        <div class="text-[0.6875rem] text-danger">
          <strong>Motivo da rejeição:</strong> {doc.reviewNote}
        </div>
      )}
      {doc.reviewedAt && (
        <div class="text-[0.6875rem] text-fg-subtle">
          {STATUS_LABELS[doc.status]} por {doc.reviewerName ?? `User #${doc.reviewedBy}`} em {formatRelative(doc.reviewedAt)}
        </div>
      )}

      <div class="flex flex-wrap gap-1.5">
        {doc.status !== 'approved' && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              review.mutate({ docId: doc.id, status: 'approved' }, {
                onSuccess: () => toast('Documento aprovado', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })
            }}
            disabled={review.isPending}
          >
            <CheckCircle size={11} /> Aprovar
          </Button>
        )}
        {doc.status !== 'rejected' && (
          <Button size="sm" variant="secondary" onClick={() => setRejecting(true)}>
            <XCircle size={11} /> Rejeitar
          </Button>
        )}
        {doc.type?.aiAnalysisTemplate && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              reanalyze.mutate(doc.id, {
                onSuccess: () => toast('Re-análise IA enfileirada', 'info'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })
            }}
            disabled={reanalyze.isPending}
            title="Re-disparar análise IA"
          >
            <RefreshCw size={11} /> IA
          </Button>
        )}
        {(doc.status === 'approved' || doc.status === 'rejected') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              renotify.mutate(doc.id, {
                onSuccess: () => toast('Notificação reenviada', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })
            }}
            disabled={renotify.isPending}
            title="Reenviar notificação ao candidato"
          >
            <Bell size={11} /> Notificar
          </Button>
        )}
      </div>

      {rejecting && (
        <RejectModal
          onClose={() => setRejecting(false)}
          onSubmit={(note) => {
            review.mutate({ docId: doc.id, status: 'rejected', reviewNote: note }, {
              onSuccess: () => { toast('Documento rejeitado', 'success'); setRejecting(false) },
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })
          }}
          submitting={review.isPending}
        />
      )}
    </div>
  )
}

function AiSummary({ doc }: { doc: EnrollmentDocument }) {
  const sug = doc.aiSuggestion
  const conf = doc.aiConfidence
  const cfg = sug === 'approve'
    ? { color: 'text-success', label: 'IA sugere aprovar' }
    : sug === 'reject'
      ? { color: 'text-danger',  label: 'IA sugere rejeitar' }
      : { color: 'text-warning', label: 'IA sugere revisão humana' }
  return (
    <div class="flex items-center gap-2 text-[0.6875rem]">
      <Bot size={11} class={cfg.color} />
      <span class={cfg.color}>{cfg.label}</span>
      {conf != null && (
        <span class="text-fg-subtle">· confiança {Math.round(conf * 100)}%</span>
      )}
      {doc.aiStatus === 'analyzing' && <span class="text-info">· analisando…</span>}
      {doc.aiStatus === 'failed' && <span class="text-danger">· falhou</span>}
    </div>
  )
}

function RejectModal({
  onClose, onSubmit, submitting,
}: { onClose: () => void; onSubmit: (note: string) => void; submitting: boolean }) {
  const [note, setNote] = useState('')

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Rejeitar documento"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!note.trim()) {
                toast('Informe o motivo da rejeição', 'danger')
                return
              }
              onSubmit(note.trim())
            }}
            disabled={submitting}
          >
            {submitting ? 'Rejeitando…' : 'Rejeitar'}
          </Button>
        </>
      }
    >
      <Textarea
        label="Motivo (será enviado ao candidato)"
        value={note}
        onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        rows={4}
        placeholder="Ex.: Documento ilegível. Por favor, envie uma foto mais nítida."
      />
    </Modal>
  )
}

function BulkActionsCard({ registrationId }: { registrationId: number }) {
  const bulk = useBulkApproveAi(registrationId)

  function handleBulk() {
    bulk.mutate({ minConfidence: 0.85 }, {
      onSuccess: (r) => toast(
        r.approved > 0
          ? `${r.approved} documento(s) aprovado(s) automaticamente`
          : 'Nenhum documento atendia aos critérios',
        r.approved > 0 ? 'success' : 'info',
      ),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <div class="text-sm font-medium text-fg">Aprovação em lote por IA</div>
          <div class="text-xs text-fg-subtle mt-0.5">
            Aprova todos os documentos pendentes com IA sugerindo "aprovar" e confiança ≥ 85%.
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={handleBulk} disabled={bulk.isPending}>
          <Bot size={12} /> {bulk.isPending ? 'Processando…' : 'Aprovar com IA'}
        </Button>
      </div>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: preact.ComponentChildren }) {
  return (
    <div class="flex items-center gap-2">
      <span class="text-fg-subtle text-xs w-32 shrink-0">{label}</span>
      <span class="text-fg truncate">{value}</span>
    </div>
  )
}
