import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  Link2, Plus, Pencil, Trash2, Copy, Check, ExternalLink, BarChart3,
  Download, QrCode, FileText, HelpCircle, Pin, MessageCircle,
} from '@/components/ui/icon-set'
import {
  useTrackableLinks,
  useTrackableLink,
  useTrackableLinkClicks,
  useTrackableLinkLeads,
  useTrackableLinksOverview,
  useCreateTrackableLink,
  useUpdateTrackableLink,
  useDeleteTrackableLink,
  type TrackableLink,
  type TrackableLinkInput,
  type TrackableLinkClick,
} from '@/hooks/useTrackableLinks'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { KpiCard } from '@/components/ui/KpiCard'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { LineChart } from '@/components/charts/LineChart'
import { downloadFile } from '@/lib/download'
import { env } from '@/lib/env'
import { formatDateShort, formatRelative } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function LinksPage() {
  const { data: list, isLoading } = useTrackableLinks()
  const { data: overview, isLoading: ovLoading } = useTrackableLinksOverview()
  const [editing, setEditing] = useState<TrackableLink | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<TrackableLink | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [qrLink, setQrLink] = useState<TrackableLink | null>(null)
  const [floaterLink, setFloaterLink] = useState<TrackableLink | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [showPixelInstall, setShowPixelInstall] = useState(false)

  function copyText(text: string, key: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
      toast('URL copiada!', 'success')
    })
  }

  function exportClicksCsv(link: TrackableLink) {
    void downloadFile(`/admin/trackable-links/${link.id}/clicks.csv`, `clicks-${link.slug}.csv`)
      .catch((e: unknown) => toast(`Erro ao exportar CSV: ${(e as Error).message}`, 'danger'))
  }

  return (
    <Page
      title="Links rastreáveis"
      description="Links curtos com UTMs que medem cliques, leads gerados e vendas."
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowPixelInstall(true)}>
            <Pin size={14} /> Instalar Pixel
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Novo link
          </Button>
        </>
      }
    >
      <section class="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total de links" value={overview?.totalLinks ?? '—'} loading={ovLoading} hint={overview ? `${overview.activeLinks} ativos` : undefined} />
        <KpiCard label="Cliques (total)" value={overview?.totalClicks ?? '—'} loading={ovLoading} />
        <KpiCard label="Cliques (30 dias)" value={overview?.recentClicks ?? '—'} loading={ovLoading} />
        <KpiCard label="Leads" value={overview?.totalLeadsGenerated ?? '—'} loading={ovLoading} />
        <KpiCard label="Vendas" value={overview?.totalSales ?? '—'} loading={ovLoading} />
        <KpiCard label="Receita" value={overview ? brl.format(overview.totalRevenue ?? 0) : '—'} loading={ovLoading} />
      </section>

      <section class="grid gap-3 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle><span class="inline-flex items-center gap-2"><BarChart3 size={14} /> Cliques por dia (30d)</span></CardTitle>
          </CardHeader>
          {ovLoading ? (
            <Skeleton class="h-44 w-full" />
          ) : (overview?.clicksByDay.length ?? 0) === 0 ? (
            <EmptyState description="Sem cliques nos últimos 30 dias." />
          ) : (
            <LineChart
              data={(overview?.clicksByDay ?? []).map((d) => ({ label: formatDateShort(d.date), value: Number(d.clicks) }))}
              height={180}
            />
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Devices</CardTitle>
          </CardHeader>
          {ovLoading && <Skeleton class="h-32 w-full" />}
          {!ovLoading && (overview?.deviceBreakdown.length ?? 0) === 0 && <EmptyState title="Sem dados" />}
          {!ovLoading && overview && overview.deviceBreakdown.length > 0 && (
            <ul class="space-y-2">
              {overview.deviceBreakdown.map((d) => {
                const max = overview.deviceBreakdown[0]?.count ?? 1
                const pct = Math.max(2, Math.round((d.count / max) * 100))
                return (
                  <li key={d.deviceType} class="flex items-center gap-3 text-xs">
                    <span class="text-fg-muted w-20 truncate capitalize">{d.deviceType}</span>
                    <span class="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                      <span class="block h-full bg-accent" style={{ width: `${pct}%` }} />
                    </span>
                    <span class="text-fg w-10 text-right tabular-nums">{d.count}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </section>

      {overview && overview.topLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Principais links</CardTitle>
            <span class="text-xs text-fg-muted">por cliques</span>
          </CardHeader>
          <ul class="divide-y divide-border">
            {overview.topLinks.slice(0, 5).map((t) => (
              <li key={t.id} class="py-2 flex items-center gap-3 text-xs">
                <span class="text-fg flex-1 truncate" title={t.name}>{t.name}</span>
                <code class="font-mono text-fg-muted hidden sm:inline">/r/{t.slug}</code>
                <span class="text-fg tabular-nums">{t.totalClicks} cl</span>
                <span class="text-fg-muted tabular-nums">· {t.leadsGenerated} leads</span>
                <span class="text-fg-muted tabular-nums">· {brl.format(t.totalRevenue)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card class="p-0 overflow-hidden">
        {isLoading && (
          <div class="p-4 flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-14 w-full" />)}
          </div>
        )}
        {!isLoading && list?.links.length === 0 && (
          <EmptyState
            icon={<Link2 size={24} />}
            title="Nenhum link rastreável"
            action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Criar primeiro</Button>}
          />
        )}
        {!isLoading && list && list.links.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
                <tr>
                  <th class="text-left px-4 py-2 font-medium">Nome</th>
                  <th class="text-left px-4 py-2 font-medium">Slug / URL</th>
                  <th class="text-left px-4 py-2 font-medium">Campanha</th>
                  <th class="text-right px-4 py-2 font-medium">Cliques</th>
                  <th class="text-right px-4 py-2 font-medium">Leads</th>
                  <th class="text-right px-4 py-2 font-medium">Vendas</th>
                  <th class="text-right px-4 py-2 font-medium">Receita</th>
                  <th class="text-center px-4 py-2 font-medium">Status</th>
                  <th class="text-center px-4 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {list.links.map((l) => {
                  const origin = window.location.origin
                  const rUrl = `${origin}/r/${l.slug}`
                  const lUrl = `${origin}/l/${l.slug}`
                  const campaign = l.campaignName ?? l.utmCampaign ?? '—'
                  return (
                    <tr key={l.id} class="hover:bg-surface-3 align-top">
                      <td class="px-4 py-2 max-w-[14rem]">
                        <button
                          type="button"
                          class="text-left text-fg hover:text-accent font-medium break-words"
                          onClick={() => setDetailId(l.id)}
                        >
                          {l.name}
                        </button>
                      </td>
                      <td class="px-4 py-2 min-w-[18rem]">
                        <div class="flex flex-col gap-1">
                          <div class="flex items-center gap-1.5 min-w-0">
                            <span class="text-3xs text-fg-muted shrink-0 w-10">Direto:</span>
                            <code class="text-2xs bg-surface-3 px-1.5 py-0.5 rounded text-info truncate flex-1 min-w-0" title={rUrl}>{rUrl}</code>
                            <button
                              type="button"
                              class="size-6 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 shrink-0"
                              onClick={() => copyText(rUrl, `r-${l.id}`)}
                              aria-label="Copiar URL direta"
                            >
                              {copied === `r-${l.id}` ? <Check size={11} class="text-success" /> : <Copy size={11} />}
                            </button>
                          </div>
                          <div class="flex items-center gap-1.5 min-w-0">
                            <span class="text-3xs text-fg-muted shrink-0 w-10">Ads:</span>
                            <code
                              class="text-2xs bg-warning/15 text-warning px-1.5 py-0.5 rounded truncate flex-1 min-w-0"
                              title="Com delay + pixel — use no Meta Ads"
                            >
                              {lUrl}
                            </code>
                            <button
                              type="button"
                              class="size-6 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 shrink-0"
                              onClick={() => copyText(lUrl, `l-${l.id}`)}
                              aria-label="Copiar URL com pixel"
                            >
                              {copied === `l-${l.id}` ? <Check size={11} class="text-success" /> : <Copy size={11} />}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td class="px-4 py-2 text-fg-muted text-xs break-words max-w-[10rem]">{campaign}</td>
                      <td class="px-4 py-2 text-right tabular-nums font-semibold text-info">{l.totalClicks ?? 0}</td>
                      <td class="px-4 py-2 text-right tabular-nums font-semibold text-fg">{l.leadsGenerated ?? 0}</td>
                      <td class="px-4 py-2 text-right tabular-nums font-semibold text-success">{l.totalSales ?? 0}</td>
                      <td class="px-4 py-2 text-right tabular-nums text-success text-xs">{brl.format(l.totalRevenue ?? 0)}</td>
                      <td class="px-4 py-2 text-center"><Badge tone={l.active ? 'success' : 'neutral'}>{l.active ? 'Ativo' : 'Inativo'}</Badge></td>
                      <td class="px-4 py-2">
                        <div class="flex items-center justify-center gap-0.5 flex-wrap">
                          <button type="button" class="size-8 rounded grid place-items-center text-info hover:bg-surface-3" onClick={() => setDetailId(l.id)} aria-label="Detalhes / Jornada" title="Detalhes / Jornada"><BarChart3 size={14} /></button>
                          <button type="button" class="size-8 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => setEditing(l)} aria-label="Editar" title="Editar"><Pencil size={14} /></button>
                          <button type="button" class="size-8 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => setQrLink(l)} aria-label="QR Code" title="QR Code"><QrCode size={14} /></button>
                          <button type="button" class="size-8 rounded grid place-items-center text-success hover:bg-surface-3" onClick={() => setFloaterLink(l)} aria-label="Botão flutuante" title="Botão flutuante WhatsApp"><MessageCircle size={14} /></button>
                          <button type="button" class="size-8 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => exportClicksCsv(l)} aria-label="Exportar cliques (CSV)" title="Exportar cliques (CSV)"><Download size={14} /></button>
                          <button type="button" class="size-8 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3" onClick={() => setDeleting(l)} aria-label="Excluir" title="Excluir"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(creating || editing) && <LinkFormModal link={editing} onClose={() => { setCreating(false); setEditing(null) }} />}
      {deleting && <DeleteLinkDialog link={deleting} onClose={() => setDeleting(null)} />}
      {detailId !== null && <LinkDetailModal id={detailId} onClose={() => setDetailId(null)} onEdit={(link) => { setDetailId(null); setEditing(link) }} />}
      {qrLink && <QrCodeModal link={qrLink} onClose={() => setQrLink(null)} />}
      {floaterLink && <FloaterModal link={floaterLink} onClose={() => setFloaterLink(null)} />}
      {showHowItWorks && <HowItWorksModal onClose={() => setShowHowItWorks(false)} onShowPixel={() => { setShowHowItWorks(false); setShowPixelInstall(true) }} />}
      {showPixelInstall && <PixelInstallModal onClose={() => setShowPixelInstall(false)} />}
    </Page>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Form com 4 tabs

type FormTab = 'general' | 'utm' | 'pixel' | 'advanced'

function LinkFormModal({ link, onClose }: { link: TrackableLink | null; onClose: () => void }) {
  const isEdit = !!link
  const [tab, setTab] = useState<FormTab>('general')
  const [form, setForm] = useState({
    name: link?.name ?? '',
    slug: link?.slug ?? '',
    whatsappPhone: link?.whatsappPhone ?? '',
    description: link?.description ?? '',
    prefilledMessage: link?.prefilledMessage ?? '',
    utmSource: link?.utmSource ?? '',
    utmMedium: link?.utmMedium ?? '',
    utmCampaign: link?.utmCampaign ?? '',
    utmContent: link?.utmContent ?? '',
    utmTerm: link?.utmTerm ?? '',
    campaignId: link?.campaignId ?? '',
    campaignName: link?.campaignName ?? '',
    fbPixelId: link?.fbPixelId ?? '',
    fbCapiAccessToken: link?.fbCapiAccessToken ?? '',
    ga4MeasurementId: link?.ga4MeasurementId ?? '',
    redirectDelayMs: link?.redirectDelayMs ?? 3000,
    active: link?.active ?? true,
  })
  const create = useCreateTrackableLink()
  const update = useUpdateTrackableLink()
  const loading = create.isPending || update.isPending

  function patch<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.whatsappPhone.trim()) {
      toast('Nome e WhatsApp obrigatórios', 'danger')
      return
    }
    const payload: TrackableLinkInput = {
      name: form.name.trim(),
      whatsappPhone: form.whatsappPhone.trim(),
      slug: form.slug || undefined,
      description: form.description || null,
      prefilledMessage: form.prefilledMessage || null,
      utmSource: form.utmSource || null,
      utmMedium: form.utmMedium || null,
      utmCampaign: form.utmCampaign || null,
      utmContent: form.utmContent || null,
      utmTerm: form.utmTerm || null,
      campaignId: form.campaignId || null,
      campaignName: form.campaignName || null,
      fbPixelId: form.fbPixelId || null,
      fbCapiAccessToken: form.fbCapiAccessToken || null,
      ga4MeasurementId: form.ga4MeasurementId || null,
      redirectDelayMs: Number(form.redirectDelayMs) || 3000,
      active: form.active,
    }
    if (isEdit && link) {
      update.mutate({ id: link.id, ...payload }, {
        onSuccess: () => { toast('Link atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Link criado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar link' : 'Novo link rastreável'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <nav class="flex gap-1 mb-4 border-b border-border">
        {[
          { id: 'general' as FormTab, label: 'Geral' },
          { id: 'utm' as FormTab, label: 'UTMs' },
          { id: 'pixel' as FormTab, label: 'Pixel & CAPI' },
          { id: 'advanced' as FormTab, label: 'Avançado' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            class={cn(
              'px-3 h-9 text-sm font-medium border-b-2 transition-colors',
              tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'general' && (
        <div class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Nome *" value={form.name} onInput={(e) => patch('name', (e.target as HTMLInputElement).value)} />
            <Input label="Slug (URL)" value={form.slug} onInput={(e) => patch('slug', (e.target as HTMLInputElement).value)} hint={`/r/${form.slug || 'auto'}`} />
            <Input label="WhatsApp para redirect *" value={form.whatsappPhone} onInput={(e) => patch('whatsappPhone', (e.target as HTMLInputElement).value)} placeholder="5511999999999" />
            <Input label="Mensagem pré-preenchida" value={form.prefilledMessage} onInput={(e) => patch('prefilledMessage', (e.target as HTMLInputElement).value)} hint="Aparece pronto no WhatsApp" />
          </div>
          <Textarea label="Descrição (interna)" value={form.description} onInput={(e) => patch('description', (e.target as HTMLTextAreaElement).value)} rows={2} />
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={form.active} onChange={(e) => patch('active', (e.target as HTMLInputElement).checked)} />
            Link ativo
          </label>
        </div>
      )}

      {tab === 'utm' && (
        <div class="space-y-3">
          <p class="text-xs text-fg-muted">Os UTMs ficam gravados em cada clique e ajudam a atribuir leads ao canal correto.</p>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Input label="utm_source" value={form.utmSource} onInput={(e) => patch('utmSource', (e.target as HTMLInputElement).value)} placeholder="meta-ads" />
            <Input label="utm_medium" value={form.utmMedium} onInput={(e) => patch('utmMedium', (e.target as HTMLInputElement).value)} placeholder="cpc" />
            <Input label="utm_campaign" value={form.utmCampaign} onInput={(e) => patch('utmCampaign', (e.target as HTMLInputElement).value)} />
            <Input label="utm_content" value={form.utmContent} onInput={(e) => patch('utmContent', (e.target as HTMLInputElement).value)} />
            <Input label="utm_term" value={form.utmTerm} onInput={(e) => patch('utmTerm', (e.target as HTMLInputElement).value)} />
          </div>
          <div class="border-t border-border pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="ID da campanha (interno)" value={form.campaignId} onInput={(e) => patch('campaignId', (e.target as HTMLInputElement).value)} hint="Para vincular a uma campanha do Meta Ads" />
            <Input label="Nome da campanha (interno)" value={form.campaignName} onInput={(e) => patch('campaignName', (e.target as HTMLInputElement).value)} />
          </div>
        </div>
      )}

      {tab === 'pixel' && (
        <div class="space-y-3">
          <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info">
            Quando preenchidos, o link usa <strong>/l/&lt;slug&gt;</strong> (página intermediária com pixel) em vez do redirect direto. Sem isso, o pixel não dispara antes do WhatsApp abrir.
          </div>
          <Input
            label="Meta Pixel ID"
            value={form.fbPixelId}
            onInput={(e) => patch('fbPixelId', (e.target as HTMLInputElement).value)}
            placeholder="1234567890123456"
            hint="Dispara evento 'Lead' do Meta Pixel"
          />
          <Input
            label="Meta CAPI Access Token"
            type="password"
            value={form.fbCapiAccessToken}
            onInput={(e) => patch('fbCapiAccessToken', (e.target as HTMLInputElement).value)}
            hint="Server-side com dedup pelo eventId — só dispara quando há fbclid no clique"
          />
          <Input
            label="GA4 Measurement ID"
            value={form.ga4MeasurementId}
            onInput={(e) => patch('ga4MeasurementId', (e.target as HTMLInputElement).value)}
            placeholder="G-XXXXXXXXXX"
            hint="Dispara evento generate_lead"
          />
        </div>
      )}

      {tab === 'advanced' && (
        <div class="space-y-3">
          <Input
            label="Delay antes do redirect (ms)"
            type="number"
            min={500}
            max={10000}
            step={500}
            value={String(form.redirectDelayMs)}
            onInput={(e) => patch('redirectDelayMs', Number((e.target as HTMLInputElement).value))}
            hint="Tempo na página /l antes de redirecionar pro WhatsApp. Min 500ms, max 10s. Aumentar dá mais tempo ao pixel."
          />
        </div>
      )}
    </Modal>
  )
}

function DeleteLinkDialog({ link, onClose }: { link: TrackableLink; onClose: () => void }) {
  const del = useDeleteTrackableLink()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${link.name}"`}
      description="O link deixa de funcionar imediatamente. Cliques anteriores são preservados em estatísticas."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(link.id, {
        onSuccess: () => { toast('Link excluído', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail modal — clicks + leads + QR + CSV

type DetailTab = 'overview' | 'clicks' | 'leads' | 'qr'

function LinkDetailModal({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (link: TrackableLink) => void }) {
  const { data, isLoading } = useTrackableLink(id)
  const [tab, setTab] = useState<DetailTab>('overview')
  const link = data?.link ?? null

  function handleCsvExport() {
    if (!link) return
    void downloadFile(`/admin/trackable-links/${id}/clicks.csv`, `clicks-${link.slug}.csv`)
      .catch((e: unknown) => toast(`Erro ao exportar CSV: ${(e as Error).message}`, 'danger'))
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={link ? link.name : 'Carregando…'}
      description={link ? `/r/${link.slug}` : undefined}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={handleCsvExport} disabled={!link}>
            <FileText size={12} /> Exportar cliques (CSV)
          </Button>
          {link && (
            <Button variant="primary" size="sm" onClick={() => onEdit(link)}>
              <Pencil size={12} /> Editar link
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>Fechar</Button>
        </>
      }
    >
      {isLoading && <Skeleton class="h-64 w-full" />}
      {link && (
        <>
          <nav class="flex gap-1 mb-4 border-b border-border">
            {[
              { id: 'overview' as DetailTab, label: 'Visão geral' },
              { id: 'clicks' as DetailTab, label: 'Cliques' },
              { id: 'leads' as DetailTab, label: 'Leads' },
              { id: 'qr' as DetailTab, label: 'QR Code' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                class={cn(
                  'px-3 h-9 text-sm font-medium border-b-2 transition-colors',
                  tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === 'overview' && <DetailOverview link={link} />}
          {tab === 'clicks' && <DetailClicks linkId={id} slug={link.slug} />}
          {tab === 'leads' && <DetailLeads linkId={id} />}
          {tab === 'qr' && <DetailQR linkId={id} slug={link.slug} hasIntermediate={!!link.fbPixelId || !!link.ga4MeasurementId} />}
        </>
      )}
    </Modal>
  )
}

function DetailOverview({ link }: { link: TrackableLink & { clicks: TrackableLinkClick[] } }) {
  const directUrl = `${window.location.origin}/r/${link.slug}`
  const pixelUrl = `${window.location.origin}/l/${link.slug}`
  const usesIntermediate = !!link.fbPixelId || !!link.ga4MeasurementId

  const conv = link.totalClicks ? ((link.leadsGenerated / link.totalClicks) * 100).toFixed(1) : '0.0'
  const saleRate = link.leadsGenerated ? ((link.totalSales / link.leadsGenerated) * 100).toFixed(1) : '0.0'
  const ticket = link.totalSales ? Number(link.totalRevenue) / link.totalSales : 0

  function copyText(text: string, what: string) {
    void navigator.clipboard.writeText(text).then(() => toast(`${what} copiado`, 'success'))
  }

  return (
    <div class="space-y-4">
      <section class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Cliques" value={link.totalClicks} hint={`${link.uniqueClicks} únicos`} />
        <KpiCard label="Leads" value={link.leadsGenerated} hint={`${conv}% conv`} />
        <KpiCard label="Vendas" value={link.totalSales} hint={`${saleRate}% conv`} />
        <KpiCard label="Receita" value={brl.format(link.totalRevenue)} />
      </section>

      {link.totalSales > 0 && (
        <div class="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-xs text-success">
          <strong>Ticket médio por venda:</strong> {brl.format(ticket)}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>URLs</CardTitle>
        </CardHeader>
        <div class="space-y-2 text-xs">
          <UrlRow
            label={usesIntermediate ? 'Direto (sem pixel)' : 'Recomendado'}
            url={directUrl}
            onCopy={() => copyText(directUrl, 'URL direta')}
          />
          <UrlRow
            label={usesIntermediate ? 'Com pixel (Meta/GA4)' : 'Com pixel — configure pixel/CAPI primeiro'}
            url={pixelUrl}
            onCopy={() => copyText(pixelUrl, 'URL com pixel')}
            disabled={!usesIntermediate}
          />
        </div>
      </Card>

      {(link.utmSource ?? link.utmMedium ?? link.utmCampaign) && (
        <Card>
          <CardHeader>
            <CardTitle>UTMs</CardTitle>
          </CardHeader>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {link.utmSource && <KvPair label="source" value={link.utmSource} />}
            {link.utmMedium && <KvPair label="medium" value={link.utmMedium} />}
            {link.utmCampaign && <KvPair label="campaign" value={link.utmCampaign} />}
            {link.utmContent && <KvPair label="content" value={link.utmContent} />}
            {link.utmTerm && <KvPair label="term" value={link.utmTerm} />}
          </div>
        </Card>
      )}

      {(link.fbPixelId ?? link.ga4MeasurementId) && (
        <Card>
          <CardHeader>
            <CardTitle>Pixel & CAPI</CardTitle>
          </CardHeader>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {link.fbPixelId && <KvPair label="Meta Pixel" value={link.fbPixelId} />}
            {link.fbCapiAccessToken && <KvPair label="CAPI Token" value="••••••" />}
            {link.ga4MeasurementId && <KvPair label="GA4" value={link.ga4MeasurementId} />}
            <KvPair label="Delay /l" value={`${link.redirectDelayMs}ms`} />
          </div>
        </Card>
      )}
    </div>
  )
}

function UrlRow({ label, url, onCopy, disabled }: { label: string; url: string; onCopy: () => void; disabled?: boolean }) {
  return (
    <div class="flex items-center gap-2">
      <span class="text-fg-muted w-40 shrink-0">{label}:</span>
      <code class={cn('flex-1 font-mono px-2 py-1 rounded bg-surface-3 truncate', disabled && 'opacity-50')}>{url}</code>
      <button
        type="button"
        class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-30"
        onClick={onCopy}
        aria-label="Copiar"
        disabled={disabled}
      >
        <Copy size={12} />
      </button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        class={cn('size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3', disabled && 'pointer-events-none opacity-30')}
        aria-label="Abrir"
      >
        <ExternalLink size={12} />
      </a>
    </div>
  )
}

function KvPair({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex gap-2">
      <span class="text-fg-muted">{label}:</span>
      <code class="font-mono text-fg truncate flex-1">{value}</code>
    </div>
  )
}

function DetailClicks({ linkId, slug }: { linkId: number; slug: string }) {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useTrackableLinkClicks(linkId, page, 50)
  const clicks = data?.clicks ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 50))

  function handleCsvExport() {
    void downloadFile(`/admin/trackable-links/${linkId}/clicks.csv`, `clicks-${slug}.csv`)
      .catch((e: unknown) => toast((e as Error).message, 'danger'))
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs text-fg-muted">{total} clique(s) · página {page}/{totalPages}</span>
        <Button variant="secondary" size="sm" onClick={handleCsvExport}>
          <FileText size={12} /> Exportar CSV
        </Button>
      </div>

      {isLoading && <Skeleton class="h-48 w-full" />}
      {!isLoading && clicks.length === 0 && <EmptyState description="Sem cliques ainda." />}
      {!isLoading && clicks.length > 0 && (
        <div class="overflow-x-auto rounded-md border border-border">
          <table class="w-full text-xs">
            <thead class="bg-surface-3 text-fg-muted text-3xs uppercase tracking-wider">
              <tr>
                <th class="text-left px-2 py-1.5 font-medium">Quando</th>
                <th class="text-left px-2 py-1.5 font-medium">IP</th>
                <th class="text-left px-2 py-1.5 font-medium">Dispositivo</th>
                <th class="text-left px-2 py-1.5 font-medium">Navegador</th>
                <th class="text-left px-2 py-1.5 font-medium">UTM</th>
                <th class="text-left px-2 py-1.5 font-medium">IDs de clique</th>
                <th class="text-left px-2 py-1.5 font-medium">CAPI</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {clicks.map((c) => (
                <tr key={c.id} class="hover:bg-surface-3">
                  <td class="px-2 py-1.5 text-fg-muted whitespace-nowrap">{formatRelative(c.createdAt)}</td>
                  <td class="px-2 py-1.5 font-mono text-fg-muted">{c.ip ?? '—'}</td>
                  <td class="px-2 py-1.5 capitalize">{c.deviceType ?? '—'}</td>
                  <td class="px-2 py-1.5">{c.browser ?? '—'}/{c.os ?? '—'}</td>
                  <td class="px-2 py-1.5">
                    {c.utmCampaign ? <Badge tone="info">{c.utmCampaign}</Badge> : '—'}
                  </td>
                  <td class="px-2 py-1.5">
                    {c.fbclid && <Badge tone="info">fbclid</Badge>}
                    {c.gclid && <Badge tone="info">gclid</Badge>}
                    {c.ctwaClid && <Badge tone="info">ctwa</Badge>}
                    {!c.fbclid && !c.gclid && !c.ctwaClid && '—'}
                  </td>
                  <td class="px-2 py-1.5">
                    {c.capiSent ? <Check size={12} class="text-success" /> : <span class="text-fg-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div class="flex items-center justify-center gap-2 text-xs">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Anterior</Button>
          <span class="text-fg-muted">Página {page} de {totalPages}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Próxima</Button>
        </div>
      )}
    </div>
  )
}

function DetailLeads({ linkId }: { linkId: number }) {
  const { data, isLoading } = useTrackableLinkLeads(linkId)
  const leads = data?.leads ?? []

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs text-fg-muted">
          {leads.length} lead(s) atribuído(s) a este link
        </span>
      </div>

      {isLoading && <Skeleton class="h-48 w-full" />}
      {!isLoading && leads.length === 0 && <EmptyState description="Nenhum lead foi gerado por este link ainda." />}
      {!isLoading && leads.length > 0 && (
        <ul class="divide-y divide-border rounded-md border border-border">
          {leads.map((l) => (
            <li key={l.id} class="p-3 flex items-center gap-3 text-xs">
              <div class="min-w-0 flex-1">
                <div class="text-fg flex items-center gap-2 flex-wrap">
                  <span class="truncate font-medium">{l.nome ?? l.empresa ?? l.whatsapp ?? `Lead #${l.id}`}</span>
                  <Badge tone="info" class="whitespace-nowrap">
                    {l.stageName}
                  </Badge>
                  {l.saleDetected && <Badge tone="success">Vendeu {l.saleValue ? brl.format(l.saleValue) : ''}</Badge>}
                </div>
                <div class="text-fg-muted truncate mt-0.5">
                  {l.empresa ?? '—'} · {l.whatsapp ?? '—'} {l.email ? `· ${l.email}` : ''}
                </div>
              </div>
              <span class="text-fg-muted whitespace-nowrap shrink-0">{formatRelative(l.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DetailQR({ linkId, slug, hasIntermediate }: { linkId: number; slug: string; hasIntermediate: boolean }) {
  return (
    <div class="space-y-4">
      <p class="text-xs text-fg-muted">
        Use o QR direto na maioria dos casos. O QR /l/ é necessário se você quer disparar pixel Meta/GA4 antes do redirect — útil para anúncios com retargeting.
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <QrCard linkId={linkId} slug={slug} type="r" label="Direto (sem pixel)" />
        <QrCard linkId={linkId} slug={slug} type="l" label="Com pixel (intermediária)" disabled={!hasIntermediate} />
      </div>
    </div>
  )
}

function QrCard({ linkId, slug, type, label, disabled }: { linkId: number; slug: string; type: 'r' | 'l'; label: string; disabled?: boolean }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (disabled) return
    let cancelled = false
    let createdUrl: string | null = null
    const token = localStorage.getItem(env.authTokenKey)
    const headers = new Headers()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    fetch(`${env.apiBase}/admin/trackable-links/${linkId}/qrcode.png?type=${type}&size=256`, { headers })
      .then((r) => r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((blob) => {
        if (cancelled) return
        createdUrl = URL.createObjectURL(blob)
        setSrc(createdUrl)
      })
      .catch(() => { if (!cancelled) setSrc(null) })
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [linkId, type, disabled])

  function downloadQr() {
    void downloadFile(
      `/admin/trackable-links/${linkId}/qrcode.png?type=${type}&size=1024`,
      `qr-${slug}-${type}.png`,
    ).catch((e: unknown) => toast((e as Error).message, 'danger'))
  }

  return (
    <Card class={cn(disabled && 'opacity-50')}>
      <CardHeader>
        <CardTitle><span class="inline-flex items-center gap-2"><QrCode size={14} /> {label}</span></CardTitle>
      </CardHeader>
      {disabled ? (
        <p class="text-xs text-fg-muted">Configure Pixel/CAPI ou GA4 para habilitar.</p>
      ) : !src ? (
        <Skeleton class="h-64 w-full" />
      ) : (
        <div class="space-y-2">
          <div class="flex justify-center bg-white rounded-md p-3">
            <img src={src} alt={`QR ${type}`} width={240} height={240} class="block" />
          </div>
          <Button variant="secondary" size="sm" onClick={downloadQr} class="w-full">
            <Download size={12} /> Baixar PNG (1024px)
          </Button>
        </div>
      )}
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal QR Code autônomo (atalho da tabela: toggle direto/com pixel + download)

function QrCodeModal({ link, onClose }: { link: TrackableLink; onClose: () => void }) {
  const [type, setType] = useState<'r' | 'l'>('r')
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasIntermediate = !!link.fbPixelId || !!link.ga4MeasurementId

  useEffect(() => {
    let cancelled = false
    let createdUrl: string | null = null
    setSrc(null)
    setError(null)
    const token = localStorage.getItem(env.authTokenKey)
    const headers = new Headers()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    fetch(`${env.apiBase}/admin/trackable-links/${link.id}/qrcode.png?type=${type}&size=512`, { headers })
      .then((r) => r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((blob) => {
        if (cancelled) return
        createdUrl = URL.createObjectURL(blob)
        setSrc(createdUrl)
      })
      .catch((e: unknown) => { if (!cancelled) setError((e as Error).message) })
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [link.id, type])

  function handleDownload() {
    void downloadFile(
      `/admin/trackable-links/${link.id}/qrcode.png?type=${type}&size=1024`,
      `qr-${link.slug}-${type}.png`,
    ).catch((e: unknown) => toast(`Erro: ${(e as Error).message}`, 'danger'))
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`QR Code — ${link.slug}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
          <Button variant="primary" size="sm" onClick={handleDownload}>
            <Download size={12} /> Baixar 1024px
          </Button>
        </>
      }
    >
      <div class="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setType('r')}
          class={cn(
            'flex-1 h-9 rounded-md border text-xs font-medium transition-colors',
            type === 'r' ? 'bg-accent border-accent text-fg-on-brand' : 'bg-surface border-border text-fg-muted hover:text-fg',
          )}
        >
          Link direto (/r/)
        </button>
        <button
          type="button"
          onClick={() => setType('l')}
          disabled={!hasIntermediate}
          title={hasIntermediate ? '' : 'Configure Pixel/CAPI ou GA4 para habilitar'}
          class={cn(
            'flex-1 h-9 rounded-md border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            type === 'l' ? 'bg-accent border-accent text-fg-on-brand' : 'bg-surface border-border text-fg-muted hover:text-fg',
          )}
        >
          Com pixel (/l/)
        </button>
      </div>

      <div class="rounded-md border border-border bg-surface-3 min-h-[20rem] flex items-center justify-center p-5">
        {error ? (
          <div class="text-danger text-sm">Erro ao gerar QR: {error}</div>
        ) : !src ? (
          <Skeleton class="h-64 w-64" />
        ) : (
          <img src={src} alt="QR Code" class="block w-72 h-72 max-w-full bg-white rounded p-2" />
        )}
      </div>
      <p class="text-xs text-fg-muted mt-3">
        Clique direito na imagem para salvar, ou use o botão{' '}
        <strong>Baixar 1024px</strong> para alta resolução.
      </p>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal Botão flutuante WhatsApp (gerador de HTML)

const FLOATER_COLORS = ['#25D366', '#128C7E', '#1a73e8', '#000000', '#c5221f', '#e37400', '#6d49f9']

function FloaterModal({ link, onClose }: { link: TrackableLink; onClose: () => void }) {
  const [color, setColor] = useState('#25D366')
  const [side, setSide] = useState<'left' | 'right'>('right')
  const [size, setSize] = useState(64)
  const [bottom, setBottom] = useState(20)
  const [useLink, setUseLink] = useState<'r' | 'l'>('l')
  const hasIntermediate = !!link.fbPixelId || !!link.ga4MeasurementId

  useEffect(() => {
    if (useLink === 'l' && !hasIntermediate) setUseLink('r')
  }, [hasIntermediate, useLink])

  const html = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const href = `${origin}/${useLink}/${link.slug}`
    const iconSize = Math.round(size * 0.5)
    return `<a href="${href}" target="_blank" style="position:fixed;z-index:9999;${side}:20px;bottom:${bottom}px;width:${size}px;height:${size}px;display:flex;justify-content:center;align-items:center;background:${color};border-radius:100%;box-shadow:0 4px 12px rgba(0,0,0,0.2)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFFFFF" width="${iconSize}" height="${iconSize}"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.79 14.02c-.25.69-1.45 1.36-1.99 1.41-.54.06-1.02.27-3.37-.7-2.8-1.18-4.59-4.07-4.73-4.25-.14-.19-1.11-1.49-1.11-2.84 0-1.36.71-2.02.97-2.3.25-.28.55-.35.74-.35.19 0 .37 0 .55.01.17.01.42-.07.65.5.25.61.84 2.12.92 2.27.08.15.13.33.02.52-.11.19-.16.32-.33.5-.16.18-.34.4-.48.54-.16.16-.33.33-.14.64.19.31.83 1.37 1.78 2.22 1.22 1.09 2.25 1.43 2.57 1.58.31.16.49.13.68-.08.19-.21.78-.91 1-1.22.21-.31.42-.26.71-.16.29.11 1.83.86 2.14 1.02.31.16.52.23.6.36.08.13.08.73-.18 1.43z"/></svg></a>`
  }, [link.slug, color, side, size, bottom, useLink])

  const previewHtml = useMemo(() => html.replace('position:fixed', 'position:absolute').replace(/z-index:9999;/, ''), [html])

  function handleCopy() {
    void navigator.clipboard.writeText(html).then(() => toast('HTML copiado!', 'success'))
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Botão flutuante WhatsApp — ${link.slug}`}
      size="xl"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="space-y-3">
          <div>
            <span class="text-xs font-medium text-fg-muted block mb-1.5">Cor do botão</span>
            <div class="flex flex-wrap gap-2">
              {FLOATER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  title={c}
                  class={cn(
                    'size-8 rounded-full border-2 transition-all',
                    color === c ? 'border-fg outline outline-2 outline-accent' : 'border-surface',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <span class="text-xs font-medium text-fg-muted block mb-1.5">Lado</span>
            <div class="flex gap-2">
              {(['left', 'right'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  class={cn(
                    'flex-1 h-9 rounded-md border text-xs font-medium transition-colors',
                    side === s ? 'bg-accent border-accent text-fg-on-brand' : 'bg-surface border-border text-fg-muted hover:text-fg',
                  )}
                >
                  {s === 'left' ? 'Esquerdo' : 'Direito'}
                </button>
              ))}
            </div>
          </div>

          <Input
            label="Tamanho (px)"
            type="number"
            min={40}
            max={100}
            step={4}
            value={String(size)}
            onInput={(e) => setSize(parseInt((e.target as HTMLInputElement).value) || 64)}
          />

          <Input
            label="Distância do fundo (px)"
            type="number"
            min={0}
            max={200}
            step={4}
            value={String(bottom)}
            onInput={(e) => setBottom(parseInt((e.target as HTMLInputElement).value) || 20)}
          />

          <div>
            <span class="text-xs font-medium text-fg-muted block mb-1.5">Usar link</span>
            <div class="flex gap-2">
              <button
                type="button"
                onClick={() => setUseLink('r')}
                class={cn(
                  'flex-1 h-9 rounded-md border text-xs font-medium transition-colors',
                  useLink === 'r' ? 'bg-accent border-accent text-fg-on-brand' : 'bg-surface border-border text-fg-muted hover:text-fg',
                )}
              >
                Direto (/r/)
              </button>
              <button
                type="button"
                onClick={() => setUseLink('l')}
                disabled={!hasIntermediate}
                title={hasIntermediate ? '' : 'Configure Pixel/CAPI ou GA4'}
                class={cn(
                  'flex-1 h-9 rounded-md border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                  useLink === 'l' ? 'bg-accent border-accent text-fg-on-brand' : 'bg-surface border-border text-fg-muted hover:text-fg',
                )}
              >
                Com pixel (/l/)
              </button>
            </div>
          </div>
        </div>

        <div class="space-y-3">
          <div>
            <span class="text-xs font-medium text-fg-muted block mb-1.5">Pré-visualização</span>
            <div
              class="relative w-full h-56 bg-surface-3 border border-dashed border-border rounded-md overflow-hidden"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>

          <div>
            <span class="text-xs font-medium text-fg-muted block mb-1.5">HTML para colar no site</span>
            <Textarea readOnly value={html} rows={6} class="font-mono text-3xs" />
          </div>

          <Button variant="primary" size="sm" onClick={handleCopy} class="w-full">
            <Copy size={12} /> Copiar HTML
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Modais informativos: Como funciona + Instalar Pixel

function CopyableCode({ code, rows = 3 }: { code: string; rows?: number }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast('Copiado!', 'success')
    })
  }
  return (
    <div class="relative">
      <Textarea readOnly value={code} rows={rows} class="font-mono text-2xs bg-surface-3" />
      <button
        type="button"
        onClick={handleCopy}
        class="absolute top-2 right-2 px-2 py-1 text-3xs rounded bg-accent text-fg-on-brand hover:opacity-90"
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

function PixelInstallModal({ onClose }: { onClose: () => void }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const snippet = `<script src="${origin}/pixel/bychat.js" async></script>`
  const trackableSnippet = `<!-- Marque seus links de WhatsApp assim: -->
<a href="${origin}/l/SLUG" data-bychat-track>Fale com a gente</a>

<!-- Ou use a API JS: -->
<script>
  document.getElementById('meu-botao').href = window.bychat.trackableHref('${origin}/l/SLUG');
</script>`

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Instalar Pixel do Attrae"
      description="Conecte visitantes anônimos do seu site aos leads que chegam via WhatsApp."
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-4 text-sm">
        <div>
          <h3 class="font-semibold text-fg mb-2">1. Instale o snippet</h3>
          <p class="text-xs text-fg-muted mb-2">
            Cole esse código no <code class="bg-surface-3 px-1 rounded">&lt;head&gt;</code> de todas as páginas do seu site:
          </p>
          <CopyableCode code={snippet} rows={2} />
        </div>

        <div>
          <h3 class="font-semibold text-fg mb-2">2. Marque seus links de WhatsApp</h3>
          <p class="text-xs text-fg-muted mb-2">
            Adicione <code class="bg-surface-3 px-1 rounded">data-bychat-track</code> nos botões/links que levam para o WhatsApp. O pixel reescreve a URL adicionando <code class="bg-surface-3 px-1 rounded">?sid=VISITOR_ID</code>:
          </p>
          <CopyableCode code={trackableSnippet} rows={6} />
        </div>

        <div>
          <h3 class="font-semibold text-fg mb-2">3. O que acontece automaticamente</h3>
          <ul class="text-xs text-fg-muted space-y-1.5 list-disc pl-5">
            <li><strong>PageView anônimo:</strong> cada visita cria/atualiza um PixelVisitor com UTMs, fbclid/gclid, device. Cookie 365 dias.</li>
            <li><strong>Click do link:</strong> o pixel injeta <code class="bg-surface-3 px-1 rounded">sid=VISITOR_ID</code> na URL. Em <code class="bg-surface-3 px-1 rounded">/l/SLUG?sid=…</code>, o backend embute <code class="bg-surface-3 px-1 rounded">#ref:slug:sid</code> na mensagem.</li>
            <li><strong>Identificação:</strong> ao receber a mensagem, o webhook extrai o sid e amarra a navegação prévia ao lead.</li>
            <li><strong>Meta CAPI:</strong> com Pixel ID + Access Token, o evento Lead é disparado server-side com <code class="bg-surface-3 px-1 rounded">event_id</code> deduplicado.</li>
          </ul>
        </div>

        <div>
          <h3 class="font-semibold text-fg mb-2">4. API JavaScript disponível</h3>
          <div class="rounded-md border border-border bg-surface-3 p-3 font-mono text-2xs text-fg leading-relaxed space-y-1">
            <div><strong>window.bychat.visitorId</strong> — UUID do visitante</div>
            <div><strong>window.bychat.track('evento', data)</strong> — evento custom</div>
            <div><strong>window.bychat.trackableHref(href)</strong> — retorna URL com sid</div>
            <div><strong>window.bychat.rewriteLinks(selector?)</strong> — reescreve links</div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function HowItWorksModal({ onClose, onShowPixel }: { onClose: () => void; onShowPixel: () => void }) {
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Como funciona o Links Rastreáveis?"
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-4 text-sm">
        <div class="rounded-lg p-4 bg-accent/10 border border-accent/30">
          <div class="font-semibold text-fg mb-1">O problema que ele resolve</div>
          <div class="text-xs text-fg-muted leading-relaxed">
            Você anuncia no Instagram, Facebook, Google e joga tráfego pro WhatsApp. No fim do mês não dá pra dizer{' '}
            <strong>qual anúncio gerou venda</strong>. O módulo Links Rastreáveis amarra uma identidade invisível em cada
            clique e a leva até a venda.
          </div>
        </div>

        <div class="space-y-3">
          <Step n={1} title="🔗 Você cria um link no painel">
            No lugar de <code class="bg-surface-3 px-1 rounded">wa.me/5511…</code> no anúncio, você gera um link tipo{' '}
            <code class="bg-surface-3 px-1 rounded">bychat.ia.br/l/black-friday</code>.
          </Step>
          <Step n={2} title="🖱️ O cliente clica no anúncio">
            Passa por uma página intermediária (~3s). Nesses segundos o sistema captura fbclid/gclid, dispara o evento
            de Lead pro Meta (browser + servidor) e conta o clique no painel.
          </Step>
          <Step n={3} title="💬 Redireciona pro WhatsApp">
            O cliente abre o WhatsApp com mensagem pré-preenchida. No fim, uma marca invisível{' '}
            <code class="bg-surface-3 px-1 rounded">#ref:black-friday</code> que só o sistema lê.
          </Step>
          <Step n={4} title="👤 O lead entra no Attrae">
            Quando ele envia, o sistema lê a marca e amarra "esse lead veio do link Black Friday". Essa info gruda no
            lead pra sempre.
          </Step>
          <Step n={5} title="💰 Se virar venda, credita pro link">
            Quando a venda é detectada, o valor é creditado ao link. No final do mês você vê quanto cada link rendeu.
          </Step>
        </div>

        <div class="rounded-lg p-4 bg-warning/10 border border-warning/30">
          <div class="font-semibold text-fg mb-1">🕵️ O Pixel — o "detetive" do seu site</div>
          <div class="text-xs text-fg-muted leading-relaxed mb-3">
            Se você também tem site/landing page, o Pixel cola um cookie de 1 ano em cada visitante. Ele para de
            enxergar só "o último clique" e passa a ver a jornada inteira, do primeiro acesso anônimo até a venda.
          </div>
          <Button variant="primary" size="sm" onClick={onShowPixel}>
            Ver instruções de instalação do pixel →
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: preact.ComponentChildren }) {
  return (
    <div class="flex gap-3">
      <div class="shrink-0 size-9 rounded-full bg-accent text-fg-on-brand grid place-items-center text-sm font-bold">
        {n}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-fg mb-0.5">{title}</div>
        <div class="text-xs text-fg-muted leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

