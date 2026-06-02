import { useState } from 'preact/hooks'
import { useQueryClient } from '@tanstack/react-query'
import { Award, FileText, ClipboardList, Check, X as XIcon, Sparkles, BarChart3, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-preact'
import {
  useEnemImports,
  useEnemImport,
  useValidateEnem,
  useRejectEnem,
  usePresencialExams,
  useUpsertPresencialExam,
  useEssaySubmissions,
  useEssaySubmission,
  useReviewEssay,
  type EnemImport,
  type EnemImportDetail,
  type EnemStatus,
  type PresencialExam,
  type PresencialStatus,
  type EssaySubmission,
  type EssayStatus,
} from '@/hooks/useEducationalReview'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EduListHero } from '@/components/educational/EduListHero'
import { formatRelative, formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

type Tab = 'overview' | 'enem' | 'presencial' | 'essay'

const TABS: { id: Tab; label: string; icon: typeof Award }[] = [
  { id: 'overview', label: 'Visão geral', icon: BarChart3 },
  { id: 'enem', label: 'ENEM', icon: Award },
  { id: 'presencial', label: 'Presencial', icon: ClipboardList },
  { id: 'essay', label: 'Redação', icon: FileText },
]

export function EducationalEvaluationsPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const qc = useQueryClient()

  function handleRefresh() {
    void qc.invalidateQueries({ queryKey: ['edu-enem-imports'] })
    void qc.invalidateQueries({ queryKey: ['edu-presencial'] })
    void qc.invalidateQueries({ queryKey: ['edu-essays'] })
    toast('Atualizando…', 'info')
  }

  return (
    <Page
      title="Avaliações"
      description="ENEM, Vestibular Presencial e Redação Online — análise por inscrição"
      actions={
        <Button variant="secondary" size="sm" onClick={handleRefresh}>
          <RefreshCw size={14} /> Atualizar
        </Button>
      }
    >
      <div class="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              class={cn(
                'inline-flex items-center gap-1.5 px-3 h-9 -mb-px border-b-2 text-sm font-medium whitespace-nowrap transition-colors',
                tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && <OverviewTab onNavigate={setTab} />}
      {tab === 'enem' && <EnemTab />}
      {tab === 'presencial' && <PresencialTab />}
      {tab === 'essay' && <EssayTab />}
    </Page>
  )
}

function OverviewTab({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const enemQ = useEnemImports({ status: 'all' })
  const presencialQ = usePresencialExams({ status: 'all' })
  const essayQ = useEssaySubmissions({ status: 'all' })

  const enemKpi = enemQ.data?.kpi
  const presKpi = presencialQ.data?.kpi
  const essayKpi = essayQ.data?.kpi

  const isLoading = enemQ.isLoading || presencialQ.isLoading || essayQ.isLoading

  const totalPending = (enemKpi?.pending ?? 0) + (presKpi?.pending ?? 0) + (essayKpi?.pending ?? 0)
  const totalApproved = (enemKpi?.approved ?? 0) + (presKpi?.approved ?? 0) + (essayKpi?.approved ?? 0)
  const totalRejected = (enemKpi?.rejected ?? 0) + (presKpi?.rejected ?? 0) + (essayKpi?.rejected ?? 0)
  const total = totalPending + totalApproved + totalRejected
  const approvalRate = total > 0 ? Math.round((totalApproved / total) * 100) : 0

  return (
    <div class="space-y-3">
      <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <OverviewKpi label="Pendentes" value={totalPending} loading={isLoading} color="#f9ab00" />
        <OverviewKpi label="Aprovadas" value={totalApproved} loading={isLoading} color="#137333" />
        <OverviewKpi label="Rejeitadas" value={totalRejected} loading={isLoading} color="#c5221f" />
        <OverviewKpi label="Taxa de aprovação" value={`${approvalRate}%`} loading={isLoading} color="#1a73e8" />
      </div>

      <div class="grid gap-3 lg:grid-cols-3">
        <OverviewCard
          title="ENEM"
          icon={<Award size={14} />}
          kpi={enemKpi}
          loading={enemQ.isLoading}
          onOpen={() => onNavigate('enem')}
        />
        <OverviewCard
          title="Presencial"
          icon={<ClipboardList size={14} />}
          kpi={presKpi}
          loading={presencialQ.isLoading}
          onOpen={() => onNavigate('presencial')}
        />
        <OverviewCard
          title="Redação"
          icon={<FileText size={14} />}
          kpi={essayKpi}
          loading={essayQ.isLoading}
          onOpen={() => onNavigate('essay')}
        />
      </div>

      <Card class="border-info/30 bg-info/5">
        <div class="text-xs text-fg-muted">
          <strong class="text-fg">💡 Sugestão de ordem:</strong> priorize <em>pendentes</em> (sobretudo redações sem
          revisão IA) — depois revise rejeitados para confirmar feedback ao candidato. Use <strong>"Aprovar pendentes
          por IA"</strong> em DocReview para acelerar inscrições com documentos limpos.
        </div>
      </Card>
    </div>
  )
}

function OverviewKpi({
  label, value, loading, color,
}: {
  label: string
  value: number | string
  loading: boolean
  color: string
}) {
  return (
    <Card>
      <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div
        class="text-2xl font-bold tabular-nums mt-1"
        style={{ color }}
      >
        {loading ? '—' : value}
      </div>
    </Card>
  )
}

function OverviewCard({
  title, icon, kpi, loading, onOpen,
}: {
  title: string
  icon: preact.ComponentChildren
  kpi: { pending?: number; approved?: number; rejected?: number } | undefined
  loading: boolean
  onOpen: () => void
}) {
  const pending = kpi?.pending ?? 0
  const approved = kpi?.approved ?? 0
  const rejected = kpi?.rejected ?? 0
  const total = pending + approved + rejected
  const pendPct = total > 0 ? (pending / total) * 100 : 0
  const apprPct = total > 0 ? (approved / total) * 100 : 0
  const rejPct = total > 0 ? (rejected / total) * 100 : 0

  return (
    <Card>
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-semibold text-fg inline-flex items-center gap-2">
          {icon} {title}
        </div>
        <button
          type="button"
          onClick={onOpen}
          class="text-[0.6875rem] text-accent hover:underline"
        >
          Abrir →
        </button>
      </div>

      {loading ? (
        <Skeleton class="h-24 w-full" />
      ) : (
        <>
          <div class="grid grid-cols-3 gap-2 text-center mb-3">
            <div>
              <div class="text-lg font-bold text-warning tabular-nums">{pending}</div>
              <div class="text-[0.625rem] text-fg-subtle uppercase">Pend.</div>
            </div>
            <div>
              <div class="text-lg font-bold text-success tabular-nums">{approved}</div>
              <div class="text-[0.625rem] text-fg-subtle uppercase">Aprov.</div>
            </div>
            <div>
              <div class="text-lg font-bold text-danger tabular-nums">{rejected}</div>
              <div class="text-[0.625rem] text-fg-subtle uppercase">Rejeit.</div>
            </div>
          </div>

          {total > 0 && (
            <div class="h-1.5 rounded-full bg-surface-3 overflow-hidden flex">
              <div class="h-full bg-warning" style={{ width: `${pendPct}%` }} />
              <div class="h-full bg-success" style={{ width: `${apprPct}%` }} />
              <div class="h-full bg-danger" style={{ width: `${rejPct}%` }} />
            </div>
          )}
          {total === 0 && <div class="text-xs text-fg-subtle text-center py-2">Sem dados ainda</div>}
        </>
      )}
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ENEM tab

function EnemTab() {
  const [status, setStatus] = useState<EnemStatus>('pending')
  const [search, setSearch] = useState('')
  const [validating, setValidating] = useState<EnemImport | null>(null)
  const [rejecting, setRejecting] = useState<EnemImport | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const { data, isLoading } = useEnemImports({ status, q: search || undefined })
  const items = data?.items ?? []
  const kpi = data?.kpi
  const totalCount = (kpi?.pending ?? 0) + (kpi?.approved ?? 0) + (kpi?.rejected ?? 0)

  return (
    <>
      <EduListHero
        icon={<Award size={26} />}
        title="Análise de boletins ENEM"
        summary={`${items.length} item(ns) no filtro atual`}
        kpis={[
          { value: kpi?.pending ?? 0, label: 'Pendentes', tone: 'warning' },
          { value: kpi?.approved ?? 0, label: 'Aprovados', tone: 'success' },
          { value: kpi?.rejected ?? 0, label: 'Rejeitados', tone: 'danger' },
        ]}
      />

      <Card class="p-3 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <StatusPill active={status === 'pending'}  tone="warning" count={kpi?.pending}  onClick={() => setStatus('pending')}>⏳ Pendentes</StatusPill>
          <StatusPill active={status === 'approved'} tone="success" count={kpi?.approved} onClick={() => setStatus('approved')}>✓ Aprovados</StatusPill>
          <StatusPill active={status === 'rejected'} tone="danger"  count={kpi?.rejected} onClick={() => setStatus('rejected')}>✕ Rejeitados</StatusPill>
          <StatusPill active={status === 'all'}      tone="neutral" count={totalCount}    onClick={() => setStatus('all')}>📋 Todos</StatusPill>
        </div>
        <Input
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder="Buscar por nome, inscrição ou candidato"
        />
      </Card>

      <Card class="p-0 overflow-hidden">
        {isLoading && <div class="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-20 w-full" />)}</div>}
        {!isLoading && items.length === 0 && (
          <div class="p-8">
            <EmptyState
              title={status === 'pending' ? 'Nada pendente' : 'Sem importações'}
              description={status === 'pending' ? 'Sem candidatos com ENEM aguardando validação. Mude o filtro para "Todos" para ver todos os imports.' : 'Tente ajustar os filtros.'}
            />
          </div>
        )}
        {!isLoading && items.length > 0 && (
          <ul class="divide-y divide-border">
            {items.map((it) => (
              <EnemRow
                key={it.id}
                item={it}
                onOpen={() => setDetailId(it.id)}
                onValidate={() => setValidating(it)}
                onReject={() => setRejecting(it)}
              />
            ))}
          </ul>
        )}
      </Card>

      {detailId !== null && (
        <EnemDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onValidate={(item) => { setDetailId(null); setValidating(item) }}
          onReject={(item) => { setDetailId(null); setRejecting(item) }}
        />
      )}
      {validating && <ValidateEnemModal item={validating} onClose={() => setValidating(null)} />}
      {rejecting && <RejectEnemModal item={rejecting} onClose={() => setRejecting(null)} />}
    </>
  )
}

function EnemRow({ item: it, onOpen, onValidate, onReject }: { item: EnemImport; onOpen: () => void; onValidate: () => void; onReject: () => void }) {
  const reg = it.registration
  const lead = reg?.lead
  const off = reg?.processRegistration?.offering
  const sp = reg?.processRegistration?.selectionProcess
  return (
    <li>
      <button type="button" class="w-full text-left p-4 hover:bg-surface-3 transition-colors flex flex-wrap items-center gap-3" onClick={onOpen}>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg truncate">{it.nome ?? lead?.nome ?? '—'}</span>
            {reg?.candidateCode && <code class="text-[0.6875rem] text-fg-subtle font-mono">{reg.candidateCode}</code>}
            {it.inscricao && <span class="text-[0.6875rem] text-fg-subtle">insc: <code>{it.inscricao}</code></span>}
            {it.ano !== null && <Badge tone="neutral">ENEM {it.ano}</Badge>}
            {it.passed === true && <Badge tone="success">Aprovado</Badge>}
            {it.passed === false && <Badge tone="danger">Rejeitado</Badge>}
            {it.passed === null && !it.validatedAt && <Badge tone="warning">Pendente</Badge>}
            {it.treineiro && <Badge tone="info">Treineiro</Badge>}
          </div>
          <div class="text-xs text-fg-muted mt-0.5">
            {(off?.course?.nome ?? off?.nome) && <span>📚 {off?.course?.nome ?? off?.nome}</span>}
            {sp?.nome && <span class="text-fg-subtle"> · {sp.nome}</span>}
            {reg?.portal?.nome && <span class="text-fg-subtle"> · 🌐 {reg.portal.nome}</span>}
          </div>
          <div class="text-xs text-fg-muted mt-0.5">
            Média: <strong class="text-fg">{it.mediaSimples?.toFixed(1) ?? '—'}</strong>
            {it.cutoffScore !== null && <span class="text-fg-subtle"> · corte oferta: {it.cutoffScore}</span>}
            {it.aiConfidence !== null && <span class="text-fg-subtle"> · IA {Math.round(it.aiConfidence * 100)}%</span>}
            {it.source && <span class="text-fg-subtle"> · {it.source === 'ai_extracted' ? 'extraído IA' : it.source}</span>}
          </div>
          <div class="text-[0.6875rem] text-fg-subtle mt-0.5 font-mono">
            CN {it.cienciasNatureza ?? '—'} · CH {it.cienciasHumanas ?? '—'} · LG {it.linguagens ?? '—'} · MT {it.matematica ?? '—'} · RD {it.redacao ?? '—'}
          </div>
          {(it.nomeBateComForm === false || it.inscricaoBateComForm === false || it.anoBateComForm === false) && (
            <div class="text-[0.6875rem] text-warning mt-0.5">⚠ divergência com formulário</div>
          )}
          {(lead?.email ?? lead?.whatsapp) && (
            <div class="text-[0.6875rem] text-fg-subtle mt-0.5">
              {lead?.email && <span>✉ {lead.email}</span>}
              {lead?.whatsapp && <span class="ml-2">📱 {lead.whatsapp}</span>}
            </div>
          )}
          {it.validationNote && (
            <div class="text-[0.6875rem] text-fg-muted mt-1 italic">"{it.validationNote}"</div>
          )}
        </div>
        {!it.validatedAt && (
          <div class="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button variant="primary" size="sm" onClick={onValidate}>
              <Check size={12} /> Validar
            </Button>
            <Button variant="secondary" size="sm" onClick={onReject}>
              <XIcon size={12} /> Rejeitar
            </Button>
          </div>
        )}
        {it.validatedAt && (
          <span class="text-xs text-fg-subtle whitespace-nowrap">{formatRelative(it.validatedAt)}</span>
        )}
      </button>
    </li>
  )
}

function EnemReviewView({ item }: { item: EnemImportDetail }) {
  const reg = item.registration
  const lead = reg?.lead
  const off = reg?.processRegistration?.offering
  const sp = reg?.processRegistration?.selectionProcess
  const portal = reg?.portal
  const cutoff = off?.notaCorte ?? sp?.notaCorte ?? item.cutoffScore ?? null

  const doc = item.document
  const isImage = (doc?.mimeType ?? '').startsWith('image/')
  const isPdf = (doc?.mimeType ?? '') === 'application/pdf'

  const divergences: string[] = []
  if (item.nomeBateComForm === false) divergences.push('Nome divergente do formulário')
  if (item.inscricaoBateComForm === false) divergences.push('Inscrição divergente do formulário')
  if (item.anoBateComForm === false) divergences.push('Ano divergente do formulário')

  return (
    <div class="space-y-4">
      {/* Banner de status */}
      <div class={cn(
        'rounded-md border p-3 flex items-center gap-2 text-sm font-medium',
        item.passed === true ? 'border-success/30 bg-success/10 text-success'
          : item.passed === false ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-warning/30 bg-warning/10 text-warning',
      )}>
        {item.passed === true ? <Check size={16} /> : item.passed === false ? <XIcon size={16} /> : <Sparkles size={16} />}
        <span>
          {item.passed === true ? 'Boletim aprovado'
            : item.passed === false ? 'Boletim rejeitado'
            : 'Aguardando validação humana'}
        </span>
        {item.treineiro && <Badge tone="info">Treineiro</Badge>}
        {item.ano !== null && <Badge tone="neutral">ENEM {item.ano}</Badge>}
      </div>

      {/* Metadados */}
      <div class="rounded-md border border-border bg-surface p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <Row label="Candidato" value={lead?.nome ?? item.nome ?? '—'} />
        <Row label="Código" value={reg?.candidateCode ?? '—'} />
        {lead?.email && <Row label="E-mail" value={lead.email} />}
        {lead?.whatsapp && <Row label="WhatsApp" value={lead.whatsapp} />}
        {sp?.nome && <Row label="Processo" value={sp.nome} />}
        {(off?.course?.nome ?? off?.nome) && <Row label="Curso" value={off?.course?.nome ?? off?.nome ?? '—'} />}
        {portal?.nome && <Row label="Portal" value={portal.nome} />}
        {item.inscricao && <Row label="Nº inscrição ENEM" value={item.inscricao} />}
      </div>

      {/* Análise da IA */}
      <div class="rounded-md border border-accent/30 bg-accent/5 p-3 space-y-2">
        <div class="flex items-baseline gap-3 flex-wrap">
          <Sparkles size={14} class="text-accent shrink-0" />
          <span class="text-[0.625rem] uppercase tracking-wider font-semibold text-accent">Análise da IA</span>
          {item.aiConfidence !== null && (
            <span class="text-xs text-fg-muted">Confiança: <strong class="text-fg">{Math.round(item.aiConfidence * 100)}%</strong></span>
          )}
          {item.source && (
            <Badge tone="neutral">{item.source === 'ai_extracted' ? 'extraído IA' : item.source}</Badge>
          )}
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <ScoreCell label="C. Naturezas" value={item.cienciasNatureza} />
          <ScoreCell label="C. Humanas" value={item.cienciasHumanas} />
          <ScoreCell label="Linguagens" value={item.linguagens} />
          <ScoreCell label="Matemática" value={item.matematica} />
          <ScoreCell label="Redação" value={item.redacao} />
          <ScoreCell label="Média simples" value={item.mediaSimples} highlight />
        </div>

        {cutoff !== null && (
          <div class="text-[0.6875rem] text-fg-muted">
            Nota de corte aplicada: <strong class="text-fg">{cutoff}</strong>
            {item.mediaSimples !== null && (
              <span class={item.mediaSimples >= cutoff ? 'text-success' : 'text-danger'}>
                {' '}— média {item.mediaSimples >= cutoff ? '≥' : '<'} corte
              </span>
            )}
          </div>
        )}
      </div>

      {/* Divergências */}
      {divergences.length > 0 && (
        <div class="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning flex items-start gap-2">
          <AlertTriangle size={14} class="mt-0.5 shrink-0" />
          <div>
            <div class="font-semibold mb-1">Divergências detectadas com o formulário:</div>
            <ul class="list-disc pl-4 space-y-0.5">
              {divergences.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Observação do revisor */}
      {item.validationNote && (
        <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs">
          <div class="text-[0.625rem] uppercase tracking-wider font-semibold text-info mb-1">Observação do revisor</div>
          <div class="text-fg whitespace-pre-line">{item.validationNote}</div>
        </div>
      )}

      {/* Documento (boletim) */}
      {doc ? (
        <div class="rounded-md border border-border bg-surface overflow-hidden">
          <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-surface-2 text-xs">
            <span class="text-fg-muted truncate">
              📄 {doc.fileName ?? 'boletim.pdf'}
              {doc.sizeBytes !== null && <span class="ml-1 text-fg-subtle">· {(doc.sizeBytes / 1024).toFixed(0)} KB</span>}
            </span>
            <a href={doc.fileUrl} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-accent hover:underline">
              Abrir em nova aba <ExternalLink size={10} />
            </a>
          </div>
          <div class="bg-[oklch(0.15_0_0)] flex items-center justify-center min-h-[280px]">
            {isImage ? (
              <img src={doc.fileUrl} alt={doc.fileName ?? 'Boletim ENEM'} class="max-w-full max-h-[55vh] object-contain" />
            ) : isPdf ? (
              <iframe src={doc.fileUrl} class="w-full h-[55vh] bg-white border-0" title={doc.fileName ?? 'Boletim ENEM'} />
            ) : (
              <div class="text-fg-on-brand/80 p-8 text-center text-xs">
                Tipo de arquivo não pré-visualizável.
                <br />
                <a href={doc.fileUrl} target="_blank" rel="noreferrer" class="text-accent hover:underline">Abrir em nova aba ↗</a>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div class="rounded-md border border-fg-subtle/20 bg-surface p-3 text-xs text-fg-subtle italic">
          📄 Nenhum boletim foi anexado a este registro (notas inseridas manualmente ou via integração).
        </div>
      )}
    </div>
  )
}

function EnemDetailModal({
  id, onClose, onValidate, onReject,
}: {
  id: number
  onClose: () => void
  onValidate: (item: EnemImport) => void
  onReject: (item: EnemImport) => void
}) {
  const { data, isLoading, error } = useEnemImport(id)
  const item = data?.item

  const reg = item?.registration
  const lead = reg?.lead
  const off = reg?.processRegistration?.offering

  const isPending = !!item && !item.validatedAt && item.passed === null

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={item ? `ENEM — ${item.nome ?? lead?.nome ?? '—'}` : 'Carregando…'}
      description={item ? `${reg?.candidateCode ?? ''}${off?.course?.nome ? ' · ' + off.course.nome : ''}` : ''}
      size="xl"
      footer={
        item ? (
          <div class="flex items-center justify-between w-full gap-2 flex-wrap">
            <div class="text-[0.6875rem] text-fg-subtle">
              {item.validatedAt
                ? <>Validado {formatRelative(item.validatedAt)}{item.validatedBy ? ` por usuário #${item.validatedBy}` : ''}</>
                : 'Aguardando validação'}
            </div>
            <div class="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
              {isPending && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => onReject(item)}>
                    <XIcon size={12} /> Rejeitar
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => onValidate(item)}>
                    <Check size={12} /> Validar
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : undefined
      }
    >
      {isLoading && <Skeleton class="h-64 w-full" />}
      {error && !isLoading && (
        <div class="rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          Erro ao carregar: {error.message}
        </div>
      )}
      {item && <EnemReviewView item={item} />}
    </Modal>
  )
}

function ScoreCell({ label, value, highlight = false }: { label: string; value: number | null; highlight?: boolean }) {
  return (
    <div class={cn(
      'rounded-md border p-2',
      highlight ? 'border-accent/30 bg-accent/10' : 'border-border bg-surface',
    )}>
      <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div class={cn('text-base font-semibold tabular-nums mt-0.5', highlight ? 'text-accent' : 'text-fg')}>
        {value !== null ? value.toFixed(1) : '—'}
      </div>
    </div>
  )
}

function ValidateEnemModal({ item, onClose }: { item: EnemImport; onClose: () => void }) {
  const validate = useValidateEnem()
  const { data: detailData, isLoading: detailLoading } = useEnemImport(item.id)
  const detail = detailData?.item
  const [acceptAi, setAcceptAi] = useState(true)
  const [scores, setScores] = useState({
    cienciasHumanas: item.cienciasHumanas?.toString() ?? '',
    cienciasNatureza: item.cienciasNatureza?.toString() ?? '',
    linguagens: item.linguagens?.toString() ?? '',
    matematica: item.matematica?.toString() ?? '',
    redacao: item.redacao?.toString() ?? '',
  })
  const [forcePassed, setForcePassed] = useState<'auto' | 'true' | 'false'>('auto')
  const [note, setNote] = useState('')

  function n(v: string): number | undefined {
    if (v === '') return undefined
    const x = Number(v)
    return Number.isFinite(x) ? x : undefined
  }

  function handleSubmit() {
    const payload: Parameters<typeof validate.mutate>[0] = { id: item.id }
    if (acceptAi) {
      payload.acceptAi = true
    } else {
      payload.scores = {
        cienciasHumanas: n(scores.cienciasHumanas),
        cienciasNatureza: n(scores.cienciasNatureza),
        linguagens: n(scores.linguagens),
        matematica: n(scores.matematica),
        redacao: n(scores.redacao),
      }
    }
    if (forcePassed === 'true') payload.passed = true
    else if (forcePassed === 'false') payload.passed = false
    if (note.trim()) payload.validationNote = note.trim()

    validate.mutate(payload, {
      onSuccess: () => { toast('ENEM validado', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Validar ENEM — ${item.nome ?? item.registration?.candidateCode ?? '?'}`}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={validate.isPending}>
            <Check size={12} /> {validate.isPending ? 'Validando…' : 'Validar'}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        {detailLoading && !detail && <Skeleton class="h-64 w-full" />}
        {detail && <EnemReviewView item={detail} />}

        <div class="border-t border-border pt-4 space-y-3">
          <h3 class="text-sm font-semibold text-fg flex items-center gap-1.5">
            <Check size={14} class="text-accent" /> Decisão de validação
          </h3>

          <label class="flex items-start gap-2 text-sm cursor-pointer p-2 rounded-md border border-border bg-surface">
            <input type="checkbox" checked={acceptAi} onChange={(e) => setAcceptAi((e.target as HTMLInputElement).checked)} class="mt-0.5" />
            <div>
              <div class="text-fg">Aceitar valores extraídos pela IA</div>
              <div class="text-xs text-fg-muted">
                Confiança: {item.aiConfidence !== null ? `${Math.round(item.aiConfidence * 100)}%` : 'n/a'}
              </div>
            </div>
          </label>

          {!acceptAi && (
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Input label="C. Humanas" type="number" value={scores.cienciasHumanas} onInput={(e) => setScores((s) => ({ ...s, cienciasHumanas: (e.target as HTMLInputElement).value }))} />
              <Input label="C. Natureza" type="number" value={scores.cienciasNatureza} onInput={(e) => setScores((s) => ({ ...s, cienciasNatureza: (e.target as HTMLInputElement).value }))} />
              <Input label="Linguagens" type="number" value={scores.linguagens} onInput={(e) => setScores((s) => ({ ...s, linguagens: (e.target as HTMLInputElement).value }))} />
              <Input label="Matemática" type="number" value={scores.matematica} onInput={(e) => setScores((s) => ({ ...s, matematica: (e.target as HTMLInputElement).value }))} />
              <Input label="Redação" type="number" value={scores.redacao} onInput={(e) => setScores((s) => ({ ...s, redacao: (e.target as HTMLInputElement).value }))} />
            </div>
          )}

          <Select label="Veredito" value={forcePassed} onChange={(e) => setForcePassed((e.target as HTMLSelectElement).value as typeof forcePassed)} hint="Auto = compara média com nota de corte">
            <option value="auto">Automático (corte da oferta)</option>
            <option value="true">Forçar APROVADO</option>
            <option value="false">Forçar REJEITADO</option>
          </Select>

          <Textarea
            label="Observação (opcional)"
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            rows={2}
          />
        </div>
      </div>
    </Modal>
  )
}

function RejectEnemModal({ item, onClose }: { item: EnemImport; onClose: () => void }) {
  const reject = useRejectEnem()
  const { data: detailData, isLoading: detailLoading } = useEnemImport(item.id)
  const detail = detailData?.item
  const [reason, setReason] = useState('')

  function handleConfirm() {
    if (!reason.trim()) { toast('Motivo é obrigatório', 'danger'); return }
    reject.mutate({ id: item.id, reason: reason.trim() }, {
      onSuccess: () => { toast('ENEM rejeitado', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Rejeitar ENEM — ${item.nome ?? '?'}`}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" size="sm" onClick={handleConfirm} disabled={reject.isPending}>
            <XIcon size={12} /> {reject.isPending ? 'Rejeitando…' : 'Rejeitar'}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        {detailLoading && !detail && <Skeleton class="h-64 w-full" />}
        {detail && <EnemReviewView item={detail} />}

        <div class="border-t border-border pt-4 space-y-3">
          <h3 class="text-sm font-semibold text-fg flex items-center gap-1.5">
            <XIcon size={14} class="text-danger" /> Motivo da rejeição
          </h3>
          <Textarea
            label="Motivo da rejeição *"
            value={reason}
            onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
            rows={3}
            placeholder="Ex.: nota abaixo do corte, foi treineiro, ano não vale para este processo…"
          />
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Presencial tab

function PresencialTab() {
  const [status, setStatus] = useState<PresencialStatus>('pending')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<PresencialExam | null>(null)
  const { data, isLoading } = usePresencialExams({ status, q: search || undefined })
  const items = data?.items ?? []
  const kpi = data?.kpi
  const totalCount = (kpi?.pending ?? 0) + (kpi?.approved ?? 0) + (kpi?.rejected ?? 0)

  return (
    <>
      <EduListHero
        icon={<ClipboardList size={26} />}
        title="Vestibular Presencial — agendamento e veredito"
        summary={`${items.length} item(ns) no filtro atual`}
        kpis={[
          { value: kpi?.pending ?? 0, label: 'Pendentes', tone: 'warning' },
          { value: kpi?.approved ?? 0, label: 'Aprovados', tone: 'success' },
          { value: kpi?.rejected ?? 0, label: 'Rejeitados', tone: 'danger' },
        ]}
      />

      <Card class="p-3 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <StatusPill active={status === 'pending'}   tone="warning" count={kpi?.pending}   onClick={() => setStatus('pending')}>⏳ Pendentes</StatusPill>
          <StatusPill active={status === 'scheduled'} tone="info"    count={kpi?.scheduled} onClick={() => setStatus('scheduled')}>🕒 Agendados</StatusPill>
          <StatusPill active={status === 'absent'}    tone="neutral" count={kpi?.absent}    onClick={() => setStatus('absent')}>👤 Ausentes</StatusPill>
          <StatusPill active={status === 'approved'}  tone="success" count={kpi?.approved}  onClick={() => setStatus('approved')}>✓ Aprovados</StatusPill>
          <StatusPill active={status === 'rejected'}  tone="danger"  count={kpi?.rejected}  onClick={() => setStatus('rejected')}>✕ Rejeitados</StatusPill>
          <StatusPill active={status === 'all'}       tone="neutral" count={totalCount}     onClick={() => setStatus('all')}>📋 Todos</StatusPill>
        </div>
        <Input
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder="Buscar candidato"
        />
      </Card>

      <Card class="p-0 overflow-hidden">
        {isLoading && <div class="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-20 w-full" />)}</div>}
        {!isLoading && items.length === 0 && (
          <div class="p-8">
            <EmptyState
              title={status === 'pending' ? 'Nada pendente' : 'Sem provas presenciais'}
              description={status === 'pending' ? 'Sem provas aguardando avaliação. Mude o filtro para "Todos" para ver tudo.' : 'Tente ajustar os filtros.'}
            />
          </div>
        )}
        {!isLoading && items.length > 0 && (
          <ul class="divide-y divide-border">
            {items.map((it) => (
              <PresencialRow key={it.id} item={it} onOpen={() => setEditing(it)} />
            ))}
          </ul>
        )}
      </Card>

      {editing && <PresencialExamModal exam={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function PresencialRow({ item: it, onOpen }: { item: PresencialExam; onOpen: () => void }) {
  const reg = it.registration
  const lead = reg?.lead
  const off = reg?.processRegistration?.offering
  const sp = reg?.processRegistration?.selectionProcess
  return (
    <li>
      <button type="button" class="w-full text-left p-4 hover:bg-surface-3 flex flex-wrap items-center gap-3" onClick={onOpen}>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg">{lead?.nome ?? '—'}</span>
            {reg?.candidateCode && <code class="text-[0.6875rem] text-fg-subtle font-mono">{reg.candidateCode}</code>}
            <Badge tone={it.verdict === 'approved' ? 'success' : it.verdict === 'rejected' ? 'danger' : 'warning'}>
              {it.verdict === 'approved' ? 'Aprovado' : it.verdict === 'rejected' ? 'Rejeitado' : 'Pendente'}
            </Badge>
            {it.attendanceStatus === 'absent' && <Badge tone="neutral">Ausente</Badge>}
            {it.attendanceStatus === 'scheduled' && <Badge tone="info">Agendado</Badge>}
            {it.attendanceStatus === 'present' && <Badge tone="success">Presente</Badge>}
          </div>
          <div class="text-xs text-fg-muted mt-0.5">
            {(off?.course?.nome ?? off?.nome) && <span>📚 {off?.course?.nome ?? off?.nome}</span>}
            {sp?.nome && <span class="text-fg-subtle"> · {sp.nome}</span>}
            {reg?.portal?.nome && <span class="text-fg-subtle"> · 🌐 {reg.portal.nome}</span>}
          </div>
          <div class="text-xs text-fg-muted mt-0.5">
            {it.scheduledAt ? `🕒 ${formatDateTime(it.scheduledAt)}` : <span class="italic text-fg-subtle">Sem agendamento</span>}
            {it.location && ` · ${it.location}`}
            {it.room && ` · sala ${it.room}`}
            {it.seatNumber && ` · carteira ${it.seatNumber}`}
            {it.score !== null && <span class="text-fg"> · nota <strong>{it.score}</strong>{it.maxScore !== null ? `/${it.maxScore}` : ''}</span>}
          </div>
          {(lead?.email ?? lead?.whatsapp) && (
            <div class="text-[0.6875rem] text-fg-subtle mt-0.5">
              {lead?.email && <span>✉ {lead.email}</span>}
              {lead?.whatsapp && <span class="ml-2">📱 {lead.whatsapp}</span>}
            </div>
          )}
          {it.verdictReason && (
            <div class="text-[0.6875rem] text-fg-muted mt-1 italic">"{it.verdictReason}"</div>
          )}
        </div>
      </button>
    </li>
  )
}

function PresencialExamModal({ exam, onClose }: { exam: PresencialExam; onClose: () => void }) {
  const upsert = useUpsertPresencialExam()
  const [form, setForm] = useState({
    scheduledAt: exam.scheduledAt ? exam.scheduledAt.slice(0, 16) : '',
    location: exam.location ?? '',
    room: exam.room ?? '',
    seatNumber: exam.seatNumber ?? '',
    score: exam.score?.toString() ?? '',
    maxScore: exam.maxScore?.toString() ?? '',
    examNote: exam.examNote ?? '',
    attendanceStatus: exam.attendanceStatus ?? 'scheduled',
    verdict: exam.verdict,
    verdictReason: exam.verdictReason ?? '',
  })

  function patch<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function handleSubmit() {
    const regId = exam.registration?.id
    if (!regId) { toast('Registro inválido', 'danger'); return }
    const n = (s: string) => s ? Number(s) : null
    upsert.mutate({
      registrationId: regId,
      scheduledAt: form.scheduledAt || null,
      location: form.location || null,
      room: form.room || null,
      seatNumber: form.seatNumber || null,
      score: n(form.score),
      maxScore: n(form.maxScore),
      examNote: form.examNote || null,
      attendanceStatus: form.attendanceStatus,
      verdict: form.verdict,
      verdictReason: form.verdictReason || null,
    }, {
      onSuccess: () => { toast('Prova atualizada', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Prova presencial — ${exam.registration?.lead?.nome ?? ''}`}
      description={exam.registration?.candidateCode}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={upsert.isPending}>
            {upsert.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Data/hora" type="datetime-local" value={form.scheduledAt} onInput={(e) => patch('scheduledAt', (e.target as HTMLInputElement).value)} />
          <Select label="Presença" value={form.attendanceStatus} onChange={(e) => patch('attendanceStatus', (e.target as HTMLSelectElement).value as typeof form.attendanceStatus)}>
            <option value="scheduled">Agendado</option>
            <option value="present">Presente</option>
            <option value="absent">Ausente</option>
          </Select>
          <Input label="Local" value={form.location} onInput={(e) => patch('location', (e.target as HTMLInputElement).value)} />
          <Input label="Sala" value={form.room} onInput={(e) => patch('room', (e.target as HTMLInputElement).value)} />
          <Input label="Carteira" value={form.seatNumber} onInput={(e) => patch('seatNumber', (e.target as HTMLInputElement).value)} />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <Input label="Nota" type="number" step="0.1" value={form.score} onInput={(e) => patch('score', (e.target as HTMLInputElement).value)} />
          <Input label="Nota máxima" type="number" value={form.maxScore} onInput={(e) => patch('maxScore', (e.target as HTMLInputElement).value)} />
        </div>

        <Select label="Veredito" value={form.verdict} onChange={(e) => patch('verdict', (e.target as HTMLSelectElement).value as typeof form.verdict)}>
          <option value="pending">Pendente</option>
          <option value="approved">Aprovado</option>
          <option value="rejected">Rejeitado</option>
        </Select>

        {form.verdict === 'rejected' && (
          <Textarea label="Motivo da rejeição" value={form.verdictReason} onInput={(e) => patch('verdictReason', (e.target as HTMLTextAreaElement).value)} rows={2} />
        )}

        <Textarea label="Observação geral" value={form.examNote} onInput={(e) => patch('examNote', (e.target as HTMLTextAreaElement).value)} rows={2} />
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Essay tab

function EssayTab() {
  const [status, setStatus] = useState<EssayStatus>('pending')
  const [search, setSearch] = useState('')
  const [reviewing, setReviewing] = useState<EssaySubmission | null>(null)
  const { data, isLoading } = useEssaySubmissions({ status, q: search || undefined })
  const items = data?.items ?? []
  const kpi = data?.kpi
  const totalCount = (kpi?.pending ?? 0) + (kpi?.approved ?? 0) + (kpi?.rejected ?? 0)

  return (
    <>
      <EduListHero
        icon={<FileText size={26} />}
        title="Redação Online — correção e revisão"
        summary={`${items.length} item(ns) no filtro atual`}
        kpis={[
          { value: kpi?.pending ?? 0, label: 'A revisar', tone: 'warning' },
          { value: kpi?.approved ?? 0, label: 'Aprovadas', tone: 'success' },
          { value: kpi?.rejected ?? 0, label: 'Rejeitadas', tone: 'danger' },
        ]}
      />

      <Card class="p-3 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <StatusPill active={status === 'pending'}  tone="warning" count={kpi?.pending}  onClick={() => setStatus('pending')}>⏳ A revisar</StatusPill>
          <StatusPill active={status === 'approved'} tone="success" count={kpi?.approved} onClick={() => setStatus('approved')}>✓ Aprovadas</StatusPill>
          <StatusPill active={status === 'rejected'} tone="danger"  count={kpi?.rejected} onClick={() => setStatus('rejected')}>✕ Rejeitadas</StatusPill>
          <StatusPill active={status === 'all'}      tone="neutral" count={totalCount}    onClick={() => setStatus('all')}>📋 Todas</StatusPill>
        </div>
        <Input
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder="Buscar candidato"
        />
      </Card>

      <Card class="p-0 overflow-hidden">
        {isLoading && <div class="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-20 w-full" />)}</div>}
        {!isLoading && items.length === 0 && (
          <div class="p-8">
            <EmptyState
              title={status === 'pending' ? 'Nenhuma redação aguardando revisão' : 'Sem redações'}
              description={status === 'pending' ? 'Sem redações enviadas para revisão. Mude o filtro para "Todas" para ver tudo.' : 'Tente ajustar os filtros.'}
            />
          </div>
        )}
        {!isLoading && items.length > 0 && (
          <ul class="divide-y divide-border">
            {items.map((it) => (
              <EssayRow key={it.id} item={it} onOpen={() => setReviewing(it)} />
            ))}
          </ul>
        )}
      </Card>

      {reviewing && <EssayReviewModal essay={reviewing} onClose={() => setReviewing(null)} />}
    </>
  )
}

function essayStatusLabel(s: EssaySubmission['status']): { label: string; tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral' } {
  switch (s) {
    case 'approved':     return { label: 'Aprovada',         tone: 'success' }
    case 'rejected':     return { label: 'Rejeitada',         tone: 'danger' }
    case 'submitted':    return { label: 'Enviada',          tone: 'warning' }
    case 'ai_reviewing': return { label: 'IA analisando',    tone: 'info' }
    case 'needs_human':  return { label: 'Aguardando humano', tone: 'warning' }
    case 'expired':      return { label: 'Expirada',         tone: 'neutral' }
    default:             return { label: s,                  tone: 'neutral' }
  }
}

function EssayRow({ item: it, onOpen }: { item: EssaySubmission; onOpen: () => void }) {
  const reg = it.registration
  const lead = reg?.lead
  const off = reg?.processRegistration?.offering
  const sp = reg?.processRegistration?.selectionProcess
  const cutoff = off?.essayCutoff ?? sp?.essayCutoff ?? null
  const score = it.finalScore ?? it.humanScore ?? it.aiScore
  const statusInfo = essayStatusLabel(it.status)
  return (
    <li>
      <button type="button" class="w-full text-left p-4 hover:bg-surface-3 flex flex-wrap items-center gap-3" onClick={onOpen}>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg">{lead?.nome ?? '—'}</span>
            {reg?.candidateCode && <code class="text-[0.6875rem] text-fg-subtle font-mono">{reg.candidateCode}</code>}
            <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
            {it.passed === true && <Badge tone="success">✓ Aprovado</Badge>}
            {it.passed === false && <Badge tone="danger">✕ Reprovado</Badge>}
            {it.attemptNumber > 1 && <Badge tone="info">tentativa {it.attemptNumber}</Badge>}
          </div>
          <div class="text-xs text-fg-muted mt-0.5">
            {(off?.course?.nome ?? off?.nome) && <span>📚 {off?.course?.nome ?? off?.nome}</span>}
            {sp?.nome && <span class="text-fg-subtle"> · {sp.nome}</span>}
            {reg?.portal?.nome && <span class="text-fg-subtle"> · 🌐 {reg.portal.nome}</span>}
          </div>
          <div class="text-xs text-fg-muted mt-0.5">
            {it.wordCount > 0 && <span>{it.wordCount} palavras</span>}
            {score !== null && <span class="text-fg ml-2">nota <strong>{score.toFixed(1)}</strong>{cutoff !== null ? `/100 · corte ${cutoff}` : '/100'}</span>}
            {it.aiScore !== null && it.humanScore === null && it.finalScore === null && (
              <span class="text-fg-subtle ml-2"><Sparkles size={10} class="inline" /> IA: {it.aiScore.toFixed(1)}{it.aiConfidence !== null ? ` (${Math.round(it.aiConfidence * 100)}%)` : ''}</span>
            )}
            {(it.pasteAttempts > 0 || it.visibilityChanges > 0) && (
              <span class="text-warning ml-2">⚠ {it.pasteAttempts} colagem(ns) · {it.visibilityChanges} mudança(s) de aba</span>
            )}
          </div>
          {it.submittedAt && <div class="text-[0.6875rem] text-fg-subtle mt-0.5">Enviada {formatRelative(it.submittedAt)}</div>}
          {(lead?.email) && (
            <div class="text-[0.6875rem] text-fg-subtle mt-0.5">✉ {lead.email}</div>
          )}
        </div>
      </button>
    </li>
  )
}

function EssayReviewModal({ essay, onClose }: { essay: EssaySubmission; onClose: () => void }) {
  const { data, isLoading } = useEssaySubmission(essay.id)
  const review = useReviewEssay()
  const [humanScore, setHumanScore] = useState(essay.humanScore?.toString() ?? '')
  const [humanNote, setHumanNote] = useState('')
  const [confirmReject, setConfirmReject] = useState(false)
  const [forceOverride, setForceOverride] = useState(false)

  const item = data?.item
  const reg = item?.registration ?? essay.registration
  const lead = reg?.lead
  const off = reg?.processRegistration?.offering
  const sp = reg?.processRegistration?.selectionProcess
  const cutoff = off?.essayCutoff ?? sp?.essayCutoff ?? null

  // Score que será efetivamente usado: prioriza humanScore digitado; senão aiScore.
  const effectiveScore = humanScore.trim() !== ''
    ? (isFinite(Number(humanScore)) ? Number(humanScore) : null)
    : (item?.aiScore ?? null)

  const wouldConflictApprove = effectiveScore != null && cutoff != null && effectiveScore < cutoff
  const wouldConflictReject = effectiveScore != null && cutoff != null && effectiveScore >= cutoff

  function submit(status: 'approved' | 'rejected') {
    review.mutate({
      id: essay.id,
      status,
      humanScore: humanScore ? Number(humanScore) : null,
      humanNote: humanNote || null,
      ...(forceOverride ? { forceOverride: true } : {}),
    }, {
      onSuccess: () => {
        toast(status === 'approved' ? 'Redação aprovada' : 'Redação rejeitada', 'success')
        onClose()
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleApprove() {
    if (wouldConflictApprove && !forceOverride) {
      toast(`Nota ${effectiveScore} está abaixo do corte ${cutoff}. Marque "Aprovar como exceção" para prosseguir.`, 'warning')
      return
    }
    if (wouldConflictApprove && !humanNote.trim()) {
      toast('Justifique a exceção em "Observação interna" antes de aprovar', 'warning')
      return
    }
    submit('approved')
  }
  function handleReject() {
    if (wouldConflictReject && !forceOverride) {
      toast(`Nota ${effectiveScore} atinge o corte ${cutoff}. Marque "Rejeitar como exceção" para prosseguir.`, 'warning')
      return
    }
    if (!confirmReject) { setConfirmReject(true); return }
    submit('rejected')
  }

  return (
    <>
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Redação — ${lead?.nome ?? '—'}`}
        description={`${reg?.candidateCode ?? ''}${off?.course?.nome ? ' · ' + (off.course.nome) : ''}`}
        size="xl"
        footer={
          item ? (
            <div class="flex items-center gap-2 justify-end w-full">
              <Button variant="secondary" size="sm" onClick={handleReject} disabled={review.isPending} class="border-danger text-danger hover:bg-danger/10">
                <XIcon size={12} /> Rejeitar
              </Button>
              <Button variant="primary" size="sm" onClick={handleApprove} disabled={review.isPending} class="bg-success hover:bg-success/90">
                <Check size={12} /> Aprovar
              </Button>
            </div>
          ) : undefined
        }
      >
        {isLoading && <Skeleton class="h-64 w-full" />}
        {item && (
          <div class="space-y-4">
            {/* Cabeçalho com infos do processo */}
            <div class="rounded-md border border-border bg-surface p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <Row label="Candidato" value={lead?.nome ?? '—'} />
              <Row label="Código" value={reg?.candidateCode ?? '—'} />
              {lead?.email && <Row label="E-mail" value={lead.email} />}
              {sp?.nome && <Row label="Processo" value={sp.nome} />}
              {(off?.course?.nome ?? off?.nome) && <Row label="Curso" value={off?.course?.nome ?? off?.nome ?? ''} />}
              {reg?.portal?.nome && <Row label="Portal" value={reg.portal.nome} />}
              <Row label="Tentativa" value={`${item.attemptNumber}`} />
              <Row label="Status" value={essayStatusLabel(item.status).label} />
              {item.submittedAt && <Row label="Enviada em" value={formatDateTime(item.submittedAt)} />}
              {cutoff !== null && <Row label="Nota de corte" value={`${cutoff}/100`} />}
            </div>

            {/* Tema (prompt snapshotado) */}
            {item.prompt && (
              <div class="rounded-md border border-info/30 bg-info/10 p-3">
                <div class="text-[0.625rem] uppercase tracking-wider font-semibold text-info mb-1">📄 Tema sorteado para esta tentativa</div>
                <div class="text-xs text-fg whitespace-pre-wrap font-serif leading-relaxed">{item.prompt}</div>
              </div>
            )}

            {/* Texto da redação */}
            <div>
              <div class="text-[0.625rem] uppercase tracking-wider font-semibold text-fg-subtle mb-1">
                ✍ Redação · {item.wordCount} palavras
                {item.pasteAttempts > 0 && <span class="text-warning ml-2">⚠ {item.pasteAttempts} tentativa(s) de colar</span>}
                {item.visibilityChanges > 0 && <span class="text-warning ml-2">⚠ {item.visibilityChanges} mudança(s) de aba</span>}
              </div>
              <pre class="whitespace-pre-wrap text-sm text-fg bg-surface border border-border rounded-md p-4 max-h-80 overflow-y-auto font-serif leading-relaxed">
                {item.essayText ?? <span class="italic text-fg-subtle">(redação vazia)</span>}
              </pre>
            </div>

            {/* Análise IA */}
            {item.aiScore !== null || item.aiAnalysis ? (
              <div class="rounded-md border border-accent/30 bg-accent/5 p-3 space-y-2">
                <div class="flex items-baseline gap-3 flex-wrap">
                  <Sparkles size={14} class="text-accent shrink-0" />
                  <span class="text-[0.625rem] uppercase tracking-wider font-semibold text-accent">Análise da IA</span>
                  {item.aiScore !== null && (
                    <span class="text-base font-semibold text-fg">{item.aiScore.toFixed(1)}/100</span>
                  )}
                  {item.aiConfidence !== null && (
                    <span class="text-xs text-fg-muted">Confiança: {Math.round(item.aiConfidence * 100)}%</span>
                  )}
                  {item.aiCostUsd !== null && (
                    <span class="text-[0.6875rem] text-fg-subtle">${item.aiCostUsd.toFixed(4)}</span>
                  )}
                </div>

                {Array.isArray(item.aiAnalysis?.criteria) && (
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    {item.aiAnalysis.criteria.map((c, i) => (
                      <div key={i} class="rounded-md border border-border bg-surface p-2">
                        <div class="flex items-center justify-between gap-2 mb-1">
                          <span class="text-xs font-medium text-fg">{c.label || c.key}</span>
                          <span class="text-xs font-semibold tabular-nums text-fg">{c.score.toFixed(1)}</span>
                        </div>
                        {c.comment && <div class="text-[0.6875rem] text-fg-muted">{c.comment}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {item.aiAnalysis?.overall && (
                  <div class="text-xs text-fg whitespace-pre-wrap">{item.aiAnalysis.overall}</div>
                )}

                {Array.isArray(item.aiAnalysis?.suggestions) && item.aiAnalysis.suggestions.length > 0 && (
                  <div>
                    <div class="text-[0.6875rem] font-medium text-fg-muted mb-1">Sugestões:</div>
                    <ul class="text-xs text-fg-muted list-disc pl-4 space-y-0.5">
                      {item.aiAnalysis.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            {/* Decisão humana — formulário */}
            <div class="rounded-md border border-border bg-surface p-3 space-y-2">
              <div class="text-[0.625rem] uppercase tracking-wider font-semibold text-fg-subtle">
                Decisão humana
                {item.humanScore !== null && <span class="ml-2 text-fg">(nota anterior: {item.humanScore})</span>}
              </div>
              <Input
                label="Nota humana (0–100, opcional)"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={humanScore}
                onInput={(e) => setHumanScore((e.target as HTMLInputElement).value)}
                hint={item.aiScore !== null ? `Se vazio, IA (${item.aiScore.toFixed(1)}) é usada como nota final.` : 'Deixe vazio para usar a nota da IA.'}
              />
              <Textarea
                label={wouldConflictApprove || wouldConflictReject
                  ? 'Observação interna (obrigatória — justifique a exceção)'
                  : 'Observação (interna)'}
                value={humanNote}
                onInput={(e) => setHumanNote((e.target as HTMLTextAreaElement).value)}
                rows={3}
                hint="Visível apenas para administradores."
              />

              {(wouldConflictApprove || wouldConflictReject) && (
                <div class="rounded-md border border-warning/40 bg-warning/10 p-3">
                  <div class="text-xs text-warning font-semibold mb-1.5 inline-flex items-center gap-1">
                    ⚠ Conflito com a nota de corte
                  </div>
                  <div class="text-xs text-fg-muted mb-2">
                    {wouldConflictApprove
                      ? <>A nota efetiva <strong>{effectiveScore}</strong> está <strong>abaixo</strong> do corte configurado <strong>{cutoff}</strong>. Aprovar nesse cenário marca esta redação como <em>exceção administrativa</em>.</>
                      : <>A nota efetiva <strong>{effectiveScore}</strong> está <strong>igual ou acima</strong> do corte <strong>{cutoff}</strong>. Rejeitar nesse cenário marca esta redação como <em>exceção administrativa</em>.</>}
                  </div>
                  <label class="flex items-start gap-2 text-xs text-fg-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forceOverride}
                      onChange={(e) => setForceOverride((e.target as HTMLInputElement).checked)}
                      class="mt-0.5"
                    />
                    <span>
                      {wouldConflictApprove
                        ? <>Confirmo que quero <strong>aprovar como exceção</strong> apesar da nota abaixo do corte (justificativa obrigatória acima).</>
                        : <>Confirmo que quero <strong>rejeitar como exceção</strong> apesar da nota acima do corte (justificativa obrigatória acima).</>}
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {confirmReject && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmReject(false) }}
          title="Confirmar rejeição"
          description="Rejeitar uma redação pode reprovar o candidato no processo. Tem certeza?"
          destructive
          confirmLabel="Rejeitar"
          loading={review.isPending}
          onConfirm={() => {
            setConfirmReject(false)
            submit('rejected')
          }}
        />
      )}
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span class="text-fg-subtle">{label}:</span>{' '}
      <span class="text-fg">{value}</span>
    </div>
  )
}

function StatusPill({
  active, tone, count, onClick, children,
}: {
  active: boolean
  tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
  count?: number | undefined
  onClick: () => void
  children: preact.ComponentChildren
}) {
  const toneCls = {
    success: 'border-success bg-success text-fg-on-brand',
    danger:  'border-danger bg-danger text-fg-on-brand',
    warning: 'border-warning bg-warning text-fg-on-brand',
    info:    'border-info bg-info text-fg-on-brand',
    neutral: 'border-fg-muted bg-fg-muted text-fg-on-brand',
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors inline-flex items-center gap-1.5',
        active ? toneCls : 'border-border bg-surface text-fg-muted hover:text-fg',
      )}
    >
      {children}
      {count !== undefined && (
        <span class={cn('px-1.5 rounded-full text-[0.625rem] font-bold', active ? 'bg-fg-on-brand/25' : 'bg-surface-3 text-fg-muted')}>{count}</span>
      )}
    </button>
  )
}
