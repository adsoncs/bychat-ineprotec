import { useState, useMemo, useEffect } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  ChevronLeft, School, ListChecks, ExternalLink, Download, Search, Palette, Settings, BarChart3, FormInput,
  AlertTriangle, Eye, Copy, MoreVertical, MessageCircle, Send, Ban,
  QrCode, Code, UserPlus, Plus, Pencil, Trash2,
} from '@/components/ui/icon-set'
import {
  useEnrollmentPortal,
  usePortalRegistrations,
  useUpdateEnrollmentPortal,
  useCancelRegistration,
  useResendRegistrationLink,
  useEnsureRegistrationLead,
  useCreateEnrollmentRegistration,
  useUpdateEnrollmentRegistration,
  useDeleteEnrollmentRegistration,
  usePortalAnalytics,
  type EnrollmentPortal,
  type EnrollmentRegistration,
  type RegistrationStatus,
  type RegistrationUpsertInput,
  type RegistrationsKpis,
  type RegistrationFilters,
} from '@/hooks/useEnrollmentPortals'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Input, Select } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { Modal } from '@/components/ui/Modal'
import { PortalBrandingTab } from './enrollmentPortal/PortalBrandingTab'
import { PortalConfigTab } from './enrollmentPortal/PortalConfigTab'
import { PortalAnalyticsTab } from './enrollmentPortal/PortalAnalyticsTab'
import { PortalFormTab } from './enrollmentPortal/PortalFormTab'
import { downloadFile } from '@/lib/download'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { env } from '@/lib/env'
import { formatRelative } from '@/lib/format'
import { paymentStatusLabel, paymentStatusTone } from '@/lib/paymentLabels'

type Tab = 'overview' | 'registrations' | 'form' | 'branding' | 'config' | 'analytics'

const STATUS_LABELS: Record<RegistrationStatus, string> = {
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

const STATUS_COLORS: Record<RegistrationStatus, string> = {
  draft: 'text-fg-muted',
  pending: 'text-warning',
  submitted: 'text-info',
  paid: 'text-success',
  docs_uploaded: 'text-info',
  docs_reviewing: 'text-warning',
  docs_approved: 'text-success',
  docs_rejected: 'text-danger',
  reviewing: 'text-warning',
  approved: 'text-success',
  enrolled: 'text-success',
  rejected: 'text-danger',
  cancelled: 'text-fg-muted',
  expired: 'text-fg-muted',
}

const PAYMENT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'pending',   label: 'Pendente' },
  { value: 'paid',      label: 'Pago' },
  { value: 'overdue',   label: 'Vencido' },
  { value: 'refunded',  label: 'Reembolsado' },
  { value: 'cancelled', label: 'Cancelado' },
]

export function EnrollmentPortalDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const { data, isLoading, error } = useEnrollmentPortal(Number.isFinite(id) ? id : null)
  const [, navigate] = useLocation()
  const [tab, setTab] = useState<Tab>('overview')

  const portal = data?.portal

  return (
    <Page
      title={portal?.nome ?? 'Portal de Matrículas'}
      description={portal?.slug ? `/${portal.slug}` : 'Configuração e inscrições do portal'}
      actions={
        <Button variant="ghost" size="sm" onClick={() => navigate('/enrollment-portals')}>
          <ChevronLeft size={14} /> Voltar
        </Button>
      }
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {error && (
        <Card>
          <div class="text-sm text-danger">Erro: {(error).message}</div>
        </Card>
      )}

      {portal && (
        <>
          <PortalTabs tab={tab} onChange={setTab} />
          {tab === 'overview' && <OverviewTab portal={portal} onTabChange={setTab} />}
          {tab === 'registrations' && <RegistrationsTab portal={portal} />}
          {tab === 'form' && <PortalFormTab portal={portal} />}
          {tab === 'branding' && <PortalBrandingTab portal={portal} />}
          {tab === 'config' && <PortalConfigTab portal={portal} />}
          {tab === 'analytics' && <PortalAnalyticsTab portal={portal} />}
        </>
      )}
    </Page>
  )
}

function PortalTabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: preact.ComponentChildren }[] = [
    { id: 'overview',      label: 'Visão geral',  icon: <School size={14} /> },
    { id: 'registrations', label: 'Inscrições',   icon: <ListChecks size={14} /> },
    { id: 'form',          label: 'Formulário',   icon: <FormInput size={14} /> },
    { id: 'branding',      label: 'Branding',     icon: <Palette size={14} /> },
    { id: 'config',        label: 'Configuração', icon: <Settings size={14} /> },
    { id: 'analytics',     label: 'Analytics',    icon: <BarChart3 size={14} /> },
  ]
  return (
    <div class="border-b border-border flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          class={cn(
            'inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-[1px]',
            tab === t.id
              ? 'border-accent text-accent'
              : 'border-transparent text-fg-muted hover:text-fg',
          )}
          onClick={() => onChange(t.id)}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Overview ───────────────────────────────────────────────────

function OverviewTab({ portal: p, onTabChange }: { portal: EnrollmentPortal; onTabChange: (t: Tab) => void }) {
  const publicUrl = portalPublicUrl(p)
  const formModeLabel = p.formMode === 'interest' ? 'Captura de interesse' : 'Inscrição completa'
  const update = useUpdateEnrollmentPortal()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)

  // KPIs reais do analytics (30d)
  const { data: analytics } = usePortalAnalytics(p.id, 30)

  const incompleteWarnings = useMemo(() => buildIncompleteWarnings(p), [p])

  const meta: { label: string; value: preact.ComponentChildren }[] = [
    { label: 'Slug público', value: <code class="text-fg">{p.slug}</code> },
    { label: 'Unidade', value: p.unit?.nome ?? '—' },
    { label: 'Modo', value: formModeLabel },
    { label: 'Processos vinculados', value: p.selectionProcessIds.length },
    { label: 'Prefixo do código', value: p.codePrefix },
    { label: 'TTL magic link', value: `${p.magicLinkTtlDays} dia(s)` },
    { label: 'Pagamento obrigatório', value: p.requirePayment ? 'Sim' : 'Não' },
    { label: 'Equipe', value: p.team?.name ?? '—' },
    { label: 'Status', value: p.active ? 'Ativo' : 'Inativo' },
    {
      label: 'Publicado em',
      value: p.publishedAt
        ? new Date(p.publishedAt).toLocaleString('pt-BR')
        : <span class="text-fg-muted">— (sitemap não indexa)</span>,
    },
  ]

  function handlePublish() {
    update.mutate({ id: p.id, publishedAt: new Date().toISOString() }, {
      onSuccess: () => toast('Portal publicado — agora aparece no sitemap', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleUnpublish() {
    update.mutate({ id: p.id, publishedAt: null }, {
      onSuccess: () => toast('Publicação removida — sitemap não indexa', 'info'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      <Card>
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <div class="text-xs uppercase tracking-wider text-fg-muted">URL pública</div>
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="text-sm text-accent hover:underline truncate inline-flex items-center gap-1"
            >
              {publicUrl} <ExternalLink size={12} />
            </a>
            <div class="text-2xs text-fg-muted mt-1">
              {p.active
                ? 'O portal já está acessível na URL acima.'
                : 'Portal inativo — a URL retorna 404. Reative em "Configuração".'}
            </div>
          </div>
          <div class="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(publicUrl).then(() => toast('URL copiada', 'success'))
              }}
            >
              <Copy size={12} /> Copiar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPreviewOpen(true)}>
              <Eye size={12} /> Pré-visualizar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setQrOpen(true)}>
              <QrCode size={12} /> QR Code
            </Button>
            {p.formMode === 'interest' && (
              <Button size="sm" variant="secondary" onClick={() => setEmbedOpen(true)}>
                <Code size={12} /> Embed
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => window.open(publicUrl, '_blank')}>
              <ExternalLink size={12} /> Abrir
            </Button>
          </div>
        </div>
      </Card>

      {incompleteWarnings.length > 0 && (
        <Card>
          <div class="flex items-start gap-3">
            <span class="size-8 rounded-md bg-warning/10 text-warning grid place-items-center shrink-0">
              <AlertTriangle size={16} />
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold text-fg">
                Configuração incompleta ({incompleteWarnings.length})
              </div>
              <div class="text-xs text-fg-muted mt-0.5">
                Estes itens podem fazer o portal funcionar parcialmente ou prejudicar a experiência do candidato.
              </div>
              <ul class="mt-3 space-y-1.5">
                {incompleteWarnings.map((w) => (
                  <li key={w.id} class="flex items-start gap-2 text-xs">
                    <span class={`mt-0.5 ${w.severity === 'high' ? 'text-danger' : 'text-warning'}`}>•</span>
                    <span class="text-fg-muted flex-1">{w.message}</span>
                    {w.tab && (
                      <button
                        type="button"
                        class="text-accent hover:underline shrink-0"
                        onClick={() => onTabChange(w.tab!)}
                      >
                        Resolver →
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <KpiOverviewRow analytics={analytics} totalRegistrations={p._count?.registrations ?? null} />

      <Card>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-fg">Publicação no sitemap (SEO)</div>
            <div class="text-xs text-fg-muted mt-0.5">
              {p.publishedAt
                ? <>Indexado no sitemap.xml desde <strong>{new Date(p.publishedAt).toLocaleDateString('pt-BR')}</strong>. Mecanismos de busca podem encontrar este portal.</>
                : <>Não indexado no sitemap.xml. O portal <strong>já funciona</strong> na URL pública, mas não aparece em buscadores via sitemap.</>}
            </div>
          </div>
          <Button
            size="sm"
            variant={p.publishedAt ? 'secondary' : 'primary'}
            onClick={p.publishedAt ? handleUnpublish : handlePublish}
            disabled={update.isPending}
          >
            {update.isPending ? '…' : p.publishedAt ? 'Despublicar' : 'Publicar'}
          </Button>
        </div>
      </Card>

      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-muted mb-2">Atalhos</div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ShortcutButton label="Branding" icon={<Palette size={14} />} onClick={() => onTabChange('branding')} />
          <ShortcutButton label="Configuração" icon={<Settings size={14} />} onClick={() => onTabChange('config')} />
          <ShortcutButton label="Formulário" icon={<FormInput size={14} />} onClick={() => onTabChange('form')} />
          <ShortcutButton label="Inscrições" icon={<ListChecks size={14} />} onClick={() => onTabChange('registrations')} />
        </div>
      </Card>

      <Card>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {meta.map((m) => (
            <div key={m.label} class="flex items-center gap-2 text-sm">
              <span class="text-fg-muted text-xs w-40 shrink-0">{m.label}</span>
              <span class="text-fg truncate">{m.value}</span>
            </div>
          ))}
        </div>
      </Card>

      {(p.metaTitle ?? p.metaDescription) && (
        <Card>
          <div class="text-xs uppercase tracking-wider text-fg-muted mb-2">SEO</div>
          {p.metaTitle && <div class="text-sm text-fg">{p.metaTitle}</div>}
          {p.metaDescription && <div class="text-xs text-fg-muted mt-1">{p.metaDescription}</div>}
        </Card>
      )}

      {previewOpen && (
        <PreviewModal portal={p} onClose={() => setPreviewOpen(false)} />
      )}
      {qrOpen && (
        <QrCodeModal portal={p} onClose={() => setQrOpen(false)} />
      )}
      {embedOpen && (
        <EmbedModal portal={p} onClose={() => setEmbedOpen(false)} />
      )}
    </div>
  )
}

function KpiOverviewRow({
  analytics, totalRegistrations,
}: {
  analytics: { views: number; submissions: number; conversions: number; conversionRate: number; revenue: number } | undefined
  totalRegistrations: number | null
}) {
  const tiles: { label: string; value: preact.ComponentChildren; sub?: string | undefined }[] = [
    {
      label: 'Visualizações (30d)',
      value: analytics?.views ?? '—',
      sub: 'do portal público',
    },
    {
      label: 'Submissões (30d)',
      value: analytics?.submissions ?? '—',
      sub: analytics ? `${analytics.conversionRate.toFixed(1)}% taxa de conversão` : undefined,
    },
    {
      label: 'Inscrições (total)',
      value: totalRegistrations ?? '—',
    },
    {
      label: 'Receita (30d)',
      value: analytics ? `R$ ${Number(analytics.revenue).toFixed(2)}` : '—',
      sub: analytics ? `${analytics.conversions} pago(s)` : undefined,
    },
  ]
  return (
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {tiles.map((t) => (
        <Card key={t.label}>
          <div class="text-xs uppercase tracking-wider text-fg-muted">{t.label}</div>
          <div class="text-2xl font-semibold text-fg tabular-nums">{t.value}</div>
          {t.sub && <div class="text-2xs text-fg-muted">{t.sub}</div>}
        </Card>
      ))}
    </div>
  )
}

function ShortcutButton({ label, icon, onClick }: { label: string; icon: preact.ComponentChildren; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface hover:bg-surface-3 text-sm text-fg-muted hover:text-fg"
      onClick={onClick}
    >
      <span class="size-7 rounded-md bg-surface-3 grid place-items-center text-fg-muted">{icon}</span>
      <span class="text-xs font-medium">{label}</span>
    </button>
  )
}

interface IncompleteWarning {
  id: string
  severity: 'low' | 'high'
  message: string
  tab?: Tab | undefined
}

function buildIncompleteWarnings(p: EnrollmentPortal): IncompleteWarning[] {
  const warnings: IncompleteWarning[] = []
  if (p.formMode === 'full' && p.selectionProcessIds.length === 0) {
    warnings.push({ id: 'no-process', severity: 'high', message: 'Sem processo seletivo vinculado — o portal não exibirá ofertas.', tab: undefined })
  }
  if (!p.funnelId) {
    warnings.push({ id: 'no-funnel', severity: 'low', message: 'Sem funil destino — leads vão para o funil padrão da conta.', tab: 'config' })
  }
  if (!p.captchaType && p.publishedAt) {
    warnings.push({ id: 'no-captcha', severity: 'low', message: 'Portal publicado sem captcha — risco maior de spam de formulário.', tab: 'config' })
  }
  if (p.requirePayment && !p.paymentConnectionId) {
    warnings.push({ id: 'no-payment-conn', severity: 'high', message: 'Pagamento obrigatório sem conexão com provedor — pagamentos vão falhar.', tab: 'config' })
  }
  if (!p.brandLogoUrl) {
    warnings.push({ id: 'no-logo', severity: 'low', message: 'Sem logo no branding — portal exibe um placeholder genérico.', tab: 'branding' })
  }
  if (!p.brandPrimaryColor) {
    warnings.push({ id: 'no-color', severity: 'low', message: 'Sem cor primária definida — portal usa o tema padrão.', tab: 'branding' })
  }
  if (!p.metaTitle || !p.metaDescription) {
    warnings.push({ id: 'no-seo', severity: 'low', message: 'Meta title/description não preenchidos — SEO e compartilhamento prejudicados.', tab: 'config' })
  }
  if (!p.active) {
    warnings.push({ id: 'inactive', severity: 'high', message: 'Portal está inativo — a URL pública retorna 404.', tab: 'config' })
  }
  return warnings
}

function portalPublicUrl(p: EnrollmentPortal): string {
  return p.customDomain
    ? `https://${p.customDomain}/${p.slug}`
    : `${window.location.origin}/portal/${p.slug}`
}

function PreviewModal({ portal: p, onClose }: { portal: EnrollmentPortal; onClose: () => void }) {
  const url = `${portalPublicUrl(p)}?embed=1`
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Pré-visualização · ${p.nome}`}
      description={url}
      size="xl"
      unconstrained
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
          <Button variant="primary" size="sm" onClick={() => window.open(portalPublicUrl(p), '_blank')}>
            <ExternalLink size={12} /> Abrir em nova aba
          </Button>
        </>
      }
    >
      <iframe
        src={url}
        title={`Pré-visualização ${p.nome}`}
        class="w-full h-[70vh] border-0 rounded-md bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </Modal>
  )
}

function QrCodeModal({ portal: p, onClose }: { portal: EnrollmentPortal; onClose: () => void }) {
  const url = portalPublicUrl(p)
  const [busy, setBusy] = useState<'png' | 'svg' | null>(null)

  function handleDownload(fmt: 'png' | 'svg') {
    setBusy(fmt)
    const sizeQs = fmt === 'png' ? '?size=1024' : ''
    downloadFile(
      `/admin/enrollment-portals/${p.id}/qrcode.${fmt}${sizeQs}`,
      `qr-${p.slug}.${fmt}`,
    )
      .then(() => toast('QR Code baixado', 'success'))
      .catch((e) => toast((e as Error).message, 'danger'))
      .finally(() => setBusy(null))
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="QR Code do portal"
      description={url}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
          <Button variant="secondary" size="sm" onClick={() => handleDownload('svg')} disabled={busy !== null}>
            <Download size={12} /> SVG
          </Button>
          <Button variant="primary" size="sm" onClick={() => handleDownload('png')} disabled={busy !== null}>
            <Download size={12} /> PNG (1024px)
          </Button>
        </>
      }
    >
      <div class="text-xs text-fg-muted mb-3">
        Aponte a câmera do celular para o QR Code para abrir o portal. Útil para banners, panfletos e materiais físicos.
      </div>
      <QrPreview portalId={p.id} />
    </Modal>
  )
}

function QrPreview({ portalId }: { portalId: number }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let revoke: string | null = null
    let cancelled = false
    const headers = new Headers()
    const tok = localStorage.getItem(env.authTokenKey)
    if (tok) headers.set('Authorization', `Bearer ${tok}`)
    fetch(`${env.apiBase}/admin/enrollment-portals/${portalId}/qrcode.png?size=512`, { headers })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const blob = await r.blob()
        const url = URL.createObjectURL(blob)
        revoke = url
        if (!cancelled) setSrc(url)
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => {
      cancelled = true
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [portalId])

  if (error) return <div class="text-sm text-danger">Erro ao gerar QR Code: {error}</div>
  if (!src) return <Skeleton class="aspect-square w-full max-w-64 mx-auto" />
  return (
    <div class="flex justify-center">
      <img src={src} alt="QR Code" class="size-64 bg-white rounded-md p-2" />
    </div>
  )
}

function EmbedModal({ portal: p, onClose }: { portal: EnrollmentPortal; onClose: () => void }) {
  const url = portalPublicUrl(p)
  const snippet = `<iframe src="${url}?embed=1" style="width:100%;height:680px;border:0" allowtransparency="true" title="${p.nome}"></iframe>`
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Embed (iframe)"
      description="Cole esse snippet em landing pages ou sites de parceiros."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
          <Button variant="primary" size="sm" onClick={() => {
            void navigator.clipboard.writeText(snippet).then(() => toast('Snippet copiado', 'success'))
          }}>
            <Copy size={12} /> Copiar snippet
          </Button>
        </>
      }
    >
      <textarea
        readOnly
        class="w-full font-mono text-xs px-2 py-2 rounded-md bg-surface border border-border text-fg min-h-32"
        value={snippet}
      />
      <div class="text-2xs text-fg-muted mt-2">
        O servidor envia <code>frame-ancestors *</code> para portais públicos, então o iframe funciona em qualquer domínio.
      </div>
    </Modal>
  )
}

// ── Inscrições ─────────────────────────────────────────────────

function RegistrationsTab({ portal }: { portal: EnrollmentPortal }) {
  const [, navigate] = useLocation()
  const [status, setStatus] = useState<RegistrationStatus | ''>('')
  const [paymentStatus, setPaymentStatus] = useState('')
  const [utmSource, setUtmSource] = useState('')
  const [utmMedium, setUtmMedium] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const limit = 50

  const filters: RegistrationFilters = useMemo(() => ({
    ...(status ? { status } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(utmSource.trim() ? { utmSource: utmSource.trim() } : {}),
    ...(utmMedium.trim() ? { utmMedium: utmMedium.trim() } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    limit,
    offset: page * limit,
  }), [status, paymentStatus, utmSource, utmMedium, dateFrom, dateTo, search, page])

  const { data, isLoading } = usePortalRegistrations(portal.id, filters)
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const kpis = data?.kpis

  const cancel = useCancelRegistration(portal.id)
  const resend = useResendRegistrationLink()
  const ensureLead = useEnsureRegistrationLead(portal.id)
  const deleteReg = useDeleteEnrollmentRegistration(portal.id)
  const [cancelling, setCancelling] = useState<EnrollmentRegistration | null>(null)
  const [editing, setEditing] = useState<EnrollmentRegistration | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<EnrollmentRegistration | null>(null)

  const activeFiltersCount = [status, paymentStatus, utmSource.trim(), utmMedium.trim(), dateFrom, dateTo].filter(Boolean).length

  function handleExport() {
    const qs = new URLSearchParams()
    if (status) qs.set('status', status)
    if (paymentStatus) qs.set('paymentStatus', paymentStatus)
    if (utmSource.trim()) qs.set('utmSource', utmSource.trim())
    if (utmMedium.trim()) qs.set('utmMedium', utmMedium.trim())
    if (dateFrom) qs.set('dateFrom', dateFrom)
    if (dateTo) qs.set('dateTo', dateTo)
    if (search.trim()) qs.set('search', search.trim())
    const filename = `inscricoes-${portal.slug}-${new Date().toISOString().slice(0, 10)}.csv`
    const qsStr = qs.toString()
    downloadFile(
      `/admin/enrollment-portals/${portal.id}/registrations.csv${qsStr ? `?${qsStr}` : ''}`,
      filename,
    ).then(() => toast('CSV baixado', 'success'))
      .catch((e) => toast((e as Error).message, 'danger'))
  }

  function handleResend(r: EnrollmentRegistration) {
    resend.mutate(r.id, {
      onSuccess: () => toast(`Link reenviado para ${r.candidateCode}`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleEnsureLead(r: EnrollmentRegistration) {
    ensureLead.mutate(r.id, {
      onSuccess: (res) => {
        const msg = res.action === 'created' ? 'Lead criado e vinculado'
          : res.action === 'linked' ? 'Inscrição vinculada a lead existente'
          : res.action === 'already' ? 'Inscrição já tinha lead'
          : 'Nada a fazer'
        toast(`${msg} (${r.candidateCode})`, 'success')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleClearFilters() {
    setStatus(''); setPaymentStatus(''); setUtmSource(''); setUtmMedium('')
    setDateFrom(''); setDateTo(''); setSearch(''); setPage(0)
  }

  return (
    <div class="space-y-3">
      {kpis && <KpiRow kpis={kpis} />}

      <Card>
        <div class="space-y-3">
          <div class="flex flex-wrap items-end gap-3">
            <Input
              label="Buscar"
              value={search}
              onInput={(e) => { setSearch((e.target as HTMLInputElement).value); setPage(0) }}
              placeholder="Código, nome, e-mail, WhatsApp"
              class="min-w-56"
            />
            <Select
              label="Status"
              value={status}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value as RegistrationStatus | ''
                setStatus(v); setPage(0)
              }}
            >
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
            <Select
              label="Pagamento"
              value={paymentStatus}
              onChange={(e) => { setPaymentStatus((e.target as HTMLSelectElement).value); setPage(0) }}
            >
              <option value="">Todos</option>
              {PAYMENT_STATUS_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            <Button size="sm" variant="primary" onClick={() => setCreating(true)} class="ml-auto self-end">
              <Plus size={12} /> Nova inscrição
            </Button>
            <Button size="sm" variant="secondary" onClick={handleExport} class="self-end">
              <Download size={12} /> Exportar CSV
            </Button>
          </div>
          <div class="flex flex-wrap items-end gap-3">
            <Input
              label="UTM Source"
              value={utmSource}
              onInput={(e) => { setUtmSource((e.target as HTMLInputElement).value); setPage(0) }}
              placeholder="ex.: meta_ads"
            />
            <Input
              label="UTM Medium"
              value={utmMedium}
              onInput={(e) => { setUtmMedium((e.target as HTMLInputElement).value); setPage(0) }}
              placeholder="ex.: cpc"
            />
            <Input
              label="De"
              type="date"
              value={dateFrom}
              onInput={(e) => { setDateFrom((e.target as HTMLInputElement).value); setPage(0) }}
            />
            <Input
              label="Até"
              type="date"
              value={dateTo}
              onInput={(e) => { setDateTo((e.target as HTMLInputElement).value); setPage(0) }}
            />
            {activeFiltersCount > 0 && (
              <Button size="sm" variant="ghost" onClick={handleClearFilters} class="self-end">
                Limpar filtros ({activeFiltersCount})
              </Button>
            )}
          </div>
        </div>
      </Card>

      {isLoading && <Skeleton class="h-32 w-full" />}

      {!isLoading && items.length === 0 && (
        <Card>
          <div class="text-sm text-fg-muted text-center py-6">
            <Search size={20} class="mx-auto mb-2 text-fg-muted" />
            Nenhuma inscrição encontrada com esses filtros.
          </div>
        </Card>
      )}

      {!isLoading && items.length > 0 && (
        <Card>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left border-b border-border text-xs uppercase tracking-wider text-fg-muted">
                  <th class="py-2 px-2 font-medium">Código</th>
                  <th class="py-2 px-2 font-medium">Candidato</th>
                  <th class="py-2 px-2 font-medium">Oferta</th>
                  <th class="py-2 px-2 font-medium">Status</th>
                  <th class="py-2 px-2 font-medium">Pagamento</th>
                  <th class="py-2 px-2 font-medium">Docs</th>
                  <th class="py-2 px-2 font-medium">Origem</th>
                  <th class="py-2 px-2 font-medium">Criada</th>
                  <th class="py-2 px-2 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <RegistrationRow
                    key={r.id}
                    r={r}
                    portal={portal}
                    onClick={() => navigate(`/enrollment-portals/${portal.id}/registrations/${r.id}`)}
                    onResend={() => handleResend(r)}
                    onCancel={() => setCancelling(r)}
                    onOpenLead={() => {
                      if (r.lead?.id) navigate(`/conversations?leadId=${r.lead.id}`)
                    }}
                    onEnsureLead={() => handleEnsureLead(r)}
                    onEdit={() => setEditing(r)}
                    onDelete={() => setDeleting(r)}
                    busy={resend.isPending || ensureLead.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {total > limit && (
        <Pagination
          total={total}
          limit={limit}
          offset={page * limit}
          onChange={(off) => setPage(Math.floor(off / limit))}
        />
      )}

      {cancelling && (
        <CancelRegistrationDialog
          registration={cancelling}
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => {
            cancel.mutate({ id: cancelling.id, ...(reason ? { reason } : {}) }, {
              onSuccess: () => { toast(`Inscrição ${cancelling.candidateCode} cancelada`, 'success'); setCancelling(null) },
              onError: (e: unknown) => { toast((e as Error).message, 'danger') },
            })
          }}
          loading={cancel.isPending}
        />
      )}

      {(creating || editing) && (
        <RegistrationFormModal
          portalId={portal.id}
          registration={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteRegistrationDialog
          registration={deleting}
          loading={deleteReg.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            deleteReg.mutate(deleting.id, {
              onSuccess: () => { toast(`Inscrição ${deleting.candidateCode} excluída`, 'success'); setDeleting(null) },
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })
          }}
        />
      )}
    </div>
  )
}

function KpiRow({ kpis }: { kpis: RegistrationsKpis }) {
  const tiles = [
    { label: 'Total', value: kpis.total },
    { label: 'Hoje', value: kpis.today },
    { label: 'Últimos 7 dias', value: kpis.week },
    { label: 'Aprovadas / matriculadas', value: kpis.conversions },
  ]
  return (
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {tiles.map((t) => (
        <Card key={t.label}>
          <div class="text-xs uppercase tracking-wider text-fg-muted">{t.label}</div>
          <div class="text-2xl font-semibold text-fg tabular-nums">{t.value}</div>
        </Card>
      ))}
    </div>
  )
}

function RegistrationRow({
  r, portal, onClick, onResend, onCancel, onOpenLead, onEnsureLead, onEdit, onDelete, busy,
}: {
  r: EnrollmentRegistration
  portal: EnrollmentPortal
  onClick: () => void
  onResend: () => void
  onCancel: () => void
  onOpenLead: () => void
  onEnsureLead: () => void
  onEdit: () => void
  onDelete: () => void
  busy: boolean
}) {
  const fd = (r.formData ?? {})
  const nome = r.lead?.nome ?? (fd.nome as string | undefined) ?? '—'
  const contact = r.lead?.email ?? r.lead?.whatsapp ?? (fd.email as string | undefined) ?? ''
  const offering = r.processRegistration?.offering?.nome ?? '—'
  const statusKey = (r.status) ?? 'draft'
  const amount = r.paymentAmount != null ? Number(r.paymentAmount) : null
  const canCancel = r.status !== 'cancelled' && r.status !== 'enrolled'

  return (
    <tr
      class="border-b border-border last:border-0 hover:bg-surface-3 cursor-pointer"
      onClick={onClick}
    >
      <td class="py-2 px-2">
        <code class="text-xs text-fg">{r.candidateCode}</code>
      </td>
      <td class="py-2 px-2">
        <div class="min-w-0">
          <div class="text-fg truncate">{nome}</div>
          {contact && <div class="text-xs text-fg-muted truncate">{contact}</div>}
        </div>
      </td>
      <td class="py-2 px-2 text-xs text-fg-muted truncate max-w-48" title={offering}>{offering}</td>
      <td class="py-2 px-2">
        <span class={`text-xs uppercase tracking-wider font-medium ${STATUS_COLORS[statusKey] ?? 'text-fg-muted'}`}>
          {STATUS_LABELS[statusKey] ?? r.status}
        </span>
      </td>
      <td class="py-2 px-2 text-xs">
        {r.paymentStatus
          ? <>
              <div class={`font-medium ${paymentStatusTone(r.paymentStatus) === 'success' ? 'text-success' : paymentStatusTone(r.paymentStatus) === 'danger' ? 'text-danger' : paymentStatusTone(r.paymentStatus) === 'warning' ? 'text-warning' : 'text-fg'}`}>
                {paymentStatusLabel(r.paymentStatus)}
              </div>
              {amount != null && <div class="text-fg-muted tabular-nums">R$ {amount.toFixed(2)}</div>}
            </>
          : <span class="text-fg-muted">—</span>}
      </td>
      <td class="py-2 px-2 text-xs text-fg-muted tabular-nums">
        {r._count?.documents ?? 0}
      </td>
      <td class="py-2 px-2 text-xs text-fg-muted truncate max-w-24" title={[r.utmSource, r.utmMedium].filter(Boolean).join(' · ') || ''}>
        {r.utmSource ?? '—'}
      </td>
      <td class="py-2 px-2 text-xs text-fg-muted whitespace-nowrap">
        {formatRelative(r.createdAt)}
      </td>
      <td class="py-2 px-2 text-right" onClick={(e) => e.stopPropagation()}>
        <RowActionsMenu
          r={r}
          portal={portal}
          onResend={onResend}
          onCancel={onCancel}
          onOpenLead={onOpenLead}
          onEnsureLead={onEnsureLead}
          onEdit={onEdit}
          onDelete={onDelete}
          canCancel={canCancel}
          busy={busy}
        />
      </td>
    </tr>
  )
}

function RowActionsMenu({
  r, portal, onResend, onCancel, onOpenLead, onEnsureLead, onEdit, onDelete, canCancel, busy,
}: {
  r: EnrollmentRegistration
  portal: EnrollmentPortal
  onResend: () => void
  onCancel: () => void
  onOpenLead: () => void
  onEnsureLead: () => void
  onEdit: () => void
  onDelete: () => void
  canCancel: boolean
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    function close() { setOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  function copyPublicLink() {
    const base = portal.customDomain
      ? `https://${portal.customDomain}/${portal.slug}`
      : `${window.location.origin}/portal/${portal.slug}`
    const url = `${base}?c=${encodeURIComponent(r.candidateCode)}`
    void navigator.clipboard.writeText(url).then(() => toast('Link da inscrição copiado', 'success'))
  }

  return (
    <div class="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface border border-border"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        aria-label="Ações"
      >
        <MoreVertical size={12} />
      </button>
      {open && (
        <div class="absolute right-0 top-full mt-1 w-56 rounded-md border border-border bg-surface-2 shadow-lg py-1 z-20">
          <MenuButton
            icon={<Pencil size={12} />}
            label="Editar inscrição"
            onClick={() => { setOpen(false); onEdit() }}
          />
          <MenuButton
            icon={<Send size={12} />}
            label="Reenviar link"
            disabled={busy}
            onClick={() => { setOpen(false); onResend() }}
          />
          <MenuButton
            icon={<Copy size={12} />}
            label="Copiar link público"
            onClick={() => { setOpen(false); copyPublicLink() }}
          />
          {r.lead?.id ? (
            <MenuButton
              icon={<MessageCircle size={12} />}
              label="Abrir lead no chat"
              onClick={() => { setOpen(false); onOpenLead() }}
            />
          ) : (
            <MenuButton
              icon={<UserPlus size={12} />}
              label="Criar/vincular Lead"
              disabled={busy}
              onClick={() => { setOpen(false); onEnsureLead() }}
            />
          )}
          <div class="my-1 h-px bg-border" />
          <MenuButton
            icon={<Ban size={12} />}
            label={canCancel ? 'Cancelar inscrição' : 'Não pode cancelar'}
            disabled={!canCancel}
            destructive
            onClick={() => { setOpen(false); if (canCancel) onCancel() }}
          />
          <MenuButton
            icon={<Trash2 size={12} />}
            label="Excluir inscrição"
            destructive
            onClick={() => { setOpen(false); onDelete() }}
          />
        </div>
      )}
    </div>
  )
}

function MenuButton({
  icon, label, onClick, disabled = false, destructive = false,
}: {
  icon: preact.ComponentChildren
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      class={cn(
        'w-full text-left px-3 py-1.5 text-xs inline-flex items-center gap-2',
        disabled
          ? 'text-fg-muted cursor-not-allowed'
          : destructive
            ? 'text-danger hover:bg-surface-3'
            : 'text-fg hover:bg-surface-3',
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {label}
    </button>
  )
}

function CancelRegistrationDialog({
  registration, onClose, onConfirm, loading,
}: {
  registration: EnrollmentRegistration
  onClose: () => void
  onConfirm: (reason: string) => void
  loading: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Cancelar inscrição ${registration.candidateCode}?`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Voltar</Button>
          <Button variant="danger" size="sm" onClick={() => onConfirm(reason.trim())} disabled={loading}>
            {loading ? 'Cancelando…' : 'Cancelar inscrição'}
          </Button>
        </>
      }
    >
      <p class="text-sm text-fg-muted">
        O candidato é notificado por evento e a inscrição passa para status <code>cancelled</code>. A ação fica registrada no histórico do lead.
      </p>
      <div class="mt-3">
        <label class="text-xs text-fg-muted block mb-1">Motivo (opcional)</label>
        <textarea
          class="w-full text-sm px-2 py-1.5 rounded-md bg-surface border border-border text-fg min-h-20"
          value={reason}
          onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
          placeholder="Ex.: candidato desistiu, duplicidade, dados incorretos…"
        />
      </div>
    </Modal>
  )
}

// Criar (registration=null) ou editar uma inscrição do portal.
function RegistrationFormModal({
  portalId, registration, onClose,
}: {
  portalId: number
  registration: EnrollmentRegistration | null
  onClose: () => void
}) {
  const isEdit = !!registration
  const fd = (registration?.formData ?? {}) as Record<string, unknown>
  const [nome, setNome] = useState(String(fd.nome ?? ''))
  const [email, setEmail] = useState(String(fd.email ?? ''))
  const [whatsapp, setWhatsapp] = useState(String(fd.whatsapp ?? ''))
  const [cpf, setCpf] = useState(String(fd.cpf ?? ''))
  const [status, setStatus] = useState<RegistrationStatus>(registration?.status ?? 'submitted')
  const [paymentStatus, setPaymentStatus] = useState(registration?.paymentStatus ?? '')
  const [amount, setAmount] = useState(
    registration?.paymentAmount != null ? String(Number(registration.paymentAmount)) : '',
  )

  const createReg = useCreateEnrollmentRegistration(portalId)
  const updateReg = useUpdateEnrollmentRegistration(portalId)
  const loading = createReg.isPending || updateReg.isPending

  function handleSubmit() {
    if (!nome.trim() && !whatsapp.trim() && !email.trim()) {
      toast('Informe ao menos Nome, WhatsApp ou E-mail', 'danger')
      return
    }
    const input: RegistrationUpsertInput = {
      status,
      paymentStatus: paymentStatus || null,
      paymentAmount: amount.trim() ? Number(amount) : null,
      formData: {
        nome: nome.trim(),
        email: email.trim(),
        whatsapp: whatsapp.trim(),
        cpf: cpf.trim(),
      },
    }
    if (isEdit && registration) {
      updateReg.mutate({ id: registration.id, ...input }, {
        onSuccess: () => { toast(`Inscrição ${registration.candidateCode} atualizada`, 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      createReg.mutate({ ...input, createLead: true }, {
        onSuccess: (res) => { toast(`Inscrição ${res.registration.candidateCode} criada`, 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar inscrição ${registration?.candidateCode}` : 'Nova inscrição'}
      description={isEdit ? undefined : 'Cria a inscrição no portal e gera o código do candidato. Um Lead é criado/vinculado automaticamente.'}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : (isEdit ? 'Salvar' : 'Criar inscrição')}
          </Button>
        </>
      }
    >
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Input label="Nome" value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} />
        <Input label="WhatsApp" value={whatsapp} onInput={(e) => setWhatsapp((e.target as HTMLInputElement).value)} placeholder="5511999999999" />
        <Input label="E-mail" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        <Input label="CPF" value={cpf} onInput={(e) => setCpf((e.target as HTMLInputElement).value)} />
        <Select label="Status" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value as RegistrationStatus)}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select label="Pagamento" value={paymentStatus} onChange={(e) => setPaymentStatus((e.target as HTMLSelectElement).value)}>
          <option value="">Sem pagamento</option>
          {PAYMENT_STATUS_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
        <Input label="Valor (R$)" type="number" value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} placeholder="0,00" />
      </div>
    </Modal>
  )
}

function DeleteRegistrationDialog({
  registration, onClose, onConfirm, loading,
}: {
  registration: EnrollmentRegistration
  onClose: () => void
  onConfirm: () => void
  loading: boolean
}) {
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir inscrição ${registration.candidateCode}?`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Voltar</Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={loading}>
            {loading ? 'Excluindo…' : 'Excluir definitivamente'}
          </Button>
        </>
      }
    >
      <p class="text-sm text-fg-muted">
        A inscrição e seus dados associados (documentos, métodos de pagamento) serão <strong>removidos definitivamente</strong>. O Lead vinculado <strong>não</strong> é apagado. Esta ação não pode ser desfeita.
      </p>
    </Modal>
  )
}

