import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  QrCode, Download, Copy, Plus, Pencil, Trash2, BarChart3, HelpCircle, MousePointerClick, User,
  ExternalLink, Search, RefreshCw, Power, Folder,
} from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { KpiCard } from '@/components/ui/KpiCard'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { QrEditorModal } from '@/components/qr/QrEditorModal'
import { QrStatsModal, StackedDays, dailySeries, PERIODS } from '@/components/qr/QrStatsModal'
import { formatRelative } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import {
  DEFAULT_QR_STYLE, KIND_LABEL, renderQrSvg, saveBlob, svgToPngBlob, useDeleteQrCode, useQrCodes,
  useQrOverview, useUpdateQrCode, type QrCodeItem, type QrStyle,
} from '@/hooks/useQrCodes'

function readUrlParam(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('url') ?? ''
}

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(() => toast(`${what} copiado`, 'success')).catch(() => toast('Falha ao copiar', 'danger'))
}

function fileBase(qr: { name: string; slug: string }) {
  return `qr-${qr.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || qr.slug}`
}

async function downloadQr(qr: QrCodeItem, format: 'png' | 'svg', width = 1024) {
  try {
    const svg = await renderQrSvg({ data: qr.encodedData, style: qr.style ?? {}, size: width })
    if (format === 'svg') saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase(qr)}.svg`)
    else saveBlob(await svgToPngBlob(svg, width), `${fileBase(qr)}-${width}px.png`)
  } catch (e: any) {
    toast(e?.message || 'Falha ao baixar', 'danger')
  }
}

/** Miniatura do QR salvo na lista. */
function Thumb({ qr }: { qr: QrCodeItem }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let alive = true
    renderQrSvg({ data: qr.encodedData, style: qr.style ?? {}, size: 96 }).then((s) => alive && setSvg(s)).catch(() => {})
    return () => { alive = false }
  }, [qr.encodedData, JSON.stringify(qr.style)])
  return (
    <div class="h-12 w-12 shrink-0 rounded border border-border bg-white p-0.5 grid place-items-center [&>svg]:w-full [&>svg]:h-full">
      {svg ? <div class="w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <QrCode size={18} class="text-fg-muted" />}
    </div>
  )
}

function destinationText(qr: QrCodeItem): string {
  const p = qr.payload ?? {}
  switch (qr.kind) {
    case 'url': return qr.destinationUrl ?? ''
    case 'whatsapp': return `wa.me/${p.phone ?? ''}${p.message ? ` · “${String(p.message).slice(0, 40)}”` : ''}`
    case 'vcard': return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.company || 'Contato'
    case 'text': return String(p.text ?? '').slice(0, 60)
    case 'email': return p.to ?? ''
    case 'sms': case 'tel': return p.phone ?? ''
    case 'wifi': return `Rede ${p.ssid ?? ''}`
  }
}

function status(qr: QrCodeItem): { tone: 'success' | 'neutral' | 'warning'; label: string } {
  if (!qr.active) return { tone: 'neutral', label: 'Pausado' }
  if (qr.expiresAt && new Date(qr.expiresAt).getTime() < Date.now()) return { tone: 'warning', label: 'Expirado' }
  return { tone: 'success', label: 'Ativo' }
}

function DownloadMenu({ qr }: { qr: QrCodeItem }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const item = (label: string, fn: () => void) => (
    <button type="button" class="block w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2" onClick={() => { setOpen(false); fn() }}>{label}</button>
  )
  return (
    <div class="relative" ref={ref}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} title="Baixar"><Download size={13} /></Button>
      {open && (
        <div class="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border bg-surface shadow-lg py-1">
          {item('PNG 512 px — redes e telas', () => downloadQr(qr, 'png', 512))}
          {item('PNG 1024 px — panfleto, cartão', () => downloadQr(qr, 'png', 1024))}
          {item('PNG 2048 px — banner, cartaz', () => downloadQr(qr, 'png', 2048))}
          {item('SVG vetor — gráfica', () => downloadQr(qr, 'svg', 1024))}
        </div>
      )}
    </div>
  )
}

// ── Gerador rápido (sem salvar, sem rastreio) ─────────────────

function QuickGenerator() {
  const [data, setData] = useState(readUrlParam())
  const [style, setStyle] = useState<QrStyle>(DEFAULT_QR_STYLE)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const debounce = useRef<any>(null)

  useEffect(() => {
    if (!data.trim()) { setSvg(''); setError(null); return }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try { setSvg(await renderQrSvg({ data, style, size: 320 })); setError(null) }
      catch (e: any) { setError(e?.message || 'Falha ao gerar') }
      finally { setLoading(false) }
    }, 350)
    return () => debounce.current && clearTimeout(debounce.current)
  }, [data, style])

  async function dl(format: 'png' | 'svg') {
    try {
      const out = await renderQrSvg({ data, style, size: 1024 })
      if (format === 'svg') saveBlob(new Blob([out], { type: 'image/svg+xml' }), 'qrcode.svg')
      else saveBlob(await svgToPngBlob(out, 1024), 'qrcode.png')
    } catch (e: any) { toast(e?.message || 'Falha ao baixar', 'danger') }
  }

  return (
    <Card class="p-4">
      <div class="text-xs text-fg-muted mb-3">
        Para um QR rápido que não precisa de relatório. Ele grava o conteúdo direto no código: <strong>não conta leituras e não dá para mudar o destino depois</strong>.
        Para medir resultado, use <em>Novo QR Code</em>.
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-3">
          <Textarea label="Conteúdo (URL ou texto) *" rows={3} value={data} onInput={(e) => setData((e.target as HTMLTextAreaElement).value)} maxLength={2048} placeholder="https://site.com/pagina" />
          <div class="grid grid-cols-2 gap-2">
            <Select label="Pontos" value={style.dotStyle} onChange={(e) => setStyle({ ...style, dotStyle: (e.target as HTMLSelectElement).value as QrStyle['dotStyle'] })}>
              <option value="square">Quadrado</option><option value="rounded">Arredondado</option><option value="dots">Bolinhas</option>
            </Select>
            <Select label="Correção de erro" value={style.errorCorrection} onChange={(e) => setStyle({ ...style, errorCorrection: (e.target as HTMLSelectElement).value as QrStyle['errorCorrection'] })}>
              <option value="L">Baixa (7%)</option><option value="M">Média (15%)</option><option value="Q">Alta (25%)</option><option value="H">Máxima (30%)</option>
            </Select>
            <Input label="Cor do código" type="color" value={style.foreground} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setStyle({ ...style, foreground: v, eyeColor: v }) }} />
            <Input label="Fundo" type="color" value={style.background} onInput={(e) => setStyle({ ...style, background: (e.target as HTMLInputElement).value })} />
          </div>
        </div>
        <div>
          <div class="rounded-lg border border-border p-4 grid place-items-center min-h-[18rem]" style={{ background: style.background }}>
            {error ? <div class="text-xs text-danger">{error}</div>
              : svg ? <div class="w-full max-w-[260px] [&>svg]:w-full [&>svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
                : <div class="text-xs text-fg-muted">Digite o conteúdo para gerar.</div>}
          </div>
          <div class="flex gap-2 mt-3 items-center">
            <Button variant="primary" size="sm" disabled={!svg || loading} onClick={() => dl('png')}><Download size={12} /> PNG</Button>
            <Button variant="ghost" size="sm" disabled={!svg || loading} onClick={() => dl('svg')}><Download size={12} /> SVG</Button>
            {loading && <RefreshCw size={12} class="animate-spin text-fg-muted" />}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Página ────────────────────────────────────────────────────

export function QrCodePage() {
  const [tab, setTab] = useState<'meus' | 'rapido'>(readUrlParam() ? 'rapido' : 'meus')
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<QrCodeItem | null>(null)
  const [statsQr, setStatsQr] = useState<QrCodeItem | null>(null)
  const [deleting, setDeleting] = useState<QrCodeItem | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const list = useQrCodes()
  const overview = useQrOverview(days)
  const update = useUpdateQrCode()
  const del = useDeleteQrCode()

  const qrcodes = list.data?.qrcodes ?? []
  const folders = list.data?.folders ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return qrcodes.filter((x) =>
      (!folder || x.folder === folder) &&
      (!statusFilter || (statusFilter === 'active' ? x.active : !x.active)) &&
      (!q || x.name.toLowerCase().includes(q) || x.slug.includes(q) || (x.utmCampaign ?? '').toLowerCase().includes(q) || destinationText(x).toLowerCase().includes(q)),
    )
  }, [qrcodes, search, folder, statusFilter])

  const ov = overview.data
  const series = useMemo(() => dailySeries(ov?.byDay ?? [], days), [ov, days])

  function openNew() { setEditing(null); setEditorOpen(true) }
  function openEdit(qr: QrCodeItem) { setEditing(qr); setEditorOpen(true) }

  async function toggle(qr: QrCodeItem) {
    try {
      await update.mutateAsync({ id: qr.id, active: !qr.active })
      toast(qr.active ? 'QR pausado — quem ler verá que não está ativo' : 'QR reativado', 'success')
    } catch (e: any) { toast(e?.message || 'Falha', 'danger') }
  }

  async function confirmDelete() {
    if (!deleting) return
    try { await del.mutateAsync(deleting.id); toast('QR Code excluído', 'success') }
    catch (e: any) { toast(e?.message || 'Falha ao excluir', 'danger') }
    finally { setDeleting(null) }
  }

  return (
    <Page
      title="QR Code"
      description="Crie QR Codes e links curtos que contam cada leitura e cada clique. Troque o destino quando quiser, sem reimprimir."
      actions={<>
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}><HelpCircle size={14} /> Como funciona?</Button>
        <Button variant="primary" size="sm" onClick={openNew}><Plus size={14} /> Novo QR Code</Button>
      </>}
    >
      <div class="flex gap-1 border-b border-border mb-4">
        {([['meus', 'Meus QR Codes'], ['rapido', 'Gerador rápido (sem rastreio)']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} class={cn('px-3 py-2 text-sm -mb-px border-b-2', tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg')}>{l}</button>
        ))}
      </div>

      {tab === 'rapido' && <QuickGenerator />}

      {tab === 'meus' && (
        <div class="space-y-4">
          <div class="flex items-center gap-2">
            <div class="inline-flex rounded-md border border-border overflow-hidden">
              {PERIODS.map(([d, l]) => (
                <button key={d} type="button" onClick={() => setDays(d)} class={cn('px-2.5 py-1 text-xs', d === days ? 'bg-accent text-white' : 'bg-surface text-fg-muted hover:text-fg')}>{l}</button>
              ))}
            </div>
          </div>
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Leituras do QR" value={ov?.scans ?? 0} loading={overview.isLoading} icon={<QrCode size={16} />} tone="accent" hint={`${ov?.uniqueScans ?? 0} pessoa(s) diferentes`} sparkline={series.map((s) => s.qr)} />
            <KpiCard label="Cliques nos links" value={ov?.clicks ?? 0} loading={overview.isLoading} icon={<MousePointerClick size={16} />} tone="warning" hint={`${ov?.uniqueClicks ?? 0} pessoa(s) diferentes`} sparkline={series.map((s) => s.link)} />
            <KpiCard label="Alcance total" value={(ov?.uniqueScans ?? 0) + (ov?.uniqueClicks ?? 0)} loading={overview.isLoading} icon={<User size={16} />} tone="success" hint="Pessoas únicas (QR + link)" />
            <KpiCard label="QR Codes ativos" value={`${ov?.activeQrCodes ?? 0} / ${ov?.totalQrCodes ?? 0}`} loading={overview.isLoading} icon={<Folder size={16} />} tone="neutral" />
          </div>

          {(ov?.scans || ov?.clicks) ? (
            <div class="grid gap-3 lg:grid-cols-[1fr_280px]">
              <Card class="p-3">
                <div class="text-xs font-semibold mb-2">Acessos por dia{days > 90 ? ' (últimos 90 dias)' : ''}</div>
                <StackedDays series={series} />
              </Card>
              <Card class="p-3">
                <div class="text-xs font-semibold mb-2">Mais acessados no período</div>
                <div class="space-y-1.5">
                  {(ov?.top ?? []).map((t, i) => {
                    const qr = qrcodes.find((x) => x.id === Number(t.qrId))
                    return (
                      <button key={t.qrId} type="button" onClick={() => qr && setStatsQr(qr)} class="w-full flex items-center gap-2 text-left text-xs hover:bg-surface-2 rounded px-1 py-1">
                        <span class="text-fg-muted tabular-nums w-4">{i + 1}.</span>
                        <span class="truncate flex-1">{t.name}</span>
                        <span class="tabular-nums font-medium">{t.total}</span>
                      </button>
                    )
                  })}
                </div>
              </Card>
            </div>
          ) : null}

          <Card class="p-0">
            <div class="flex flex-wrap items-end gap-2 p-3 border-b border-border">
              <div class="relative flex-1 min-w-[200px]">
                <Search size={13} class="absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input value={search} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} placeholder="Buscar por nome, destino, campanha…" class="w-full text-sm rounded-md border border-border bg-surface pl-7 pr-2 py-1.5 focus:outline-none focus:border-accent" />
              </div>
              {folders.length > 0 && (
                <select value={folder} onChange={(e) => setFolder((e.target as HTMLSelectElement).value)} class="text-sm rounded-md border border-border bg-surface px-2 py-1.5">
                  <option value="">Todas as pastas</option>
                  {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              )}
              <select value={statusFilter} onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value as any)} class="text-sm rounded-md border border-border bg-surface px-2 py-1.5">
                <option value="">Todos</option><option value="active">Ativos</option><option value="inactive">Pausados</option>
              </select>
            </div>

            {list.isLoading ? (
              <div class="p-4 space-y-2"><Skeleton class="h-12" /><Skeleton class="h-12" /><Skeleton class="h-12" /></div>
            ) : qrcodes.length === 0 ? (
              <div class="p-6">
                <EmptyState
                  icon={<QrCode size={22} />}
                  title="Nenhum QR Code ainda"
                  description="Crie o primeiro: escolha o destino (site, WhatsApp, cartão de contato…), ajuste o visual e baixe. Cada leitura e cada clique aparece aqui."
                  action={<Button variant="primary" size="sm" onClick={openNew}><Plus size={14} /> Novo QR Code</Button>}
                />
              </div>
            ) : (
              <Table minWidth="860px">
                <THead><TR><TH>QR Code</TH><TH>Destino</TH><TH align="right">Leituras</TH><TH align="right">Cliques</TH><TH>Último acesso</TH><TH>Status</TH><TH align="right">Ações</TH></TR></THead>
                <TBody>
                  {filtered.length === 0 && <TR><TD colSpan={7}><div class="text-xs text-fg-muted py-3 text-center">Nenhum QR com esses filtros.</div></TD></TR>}
                  {filtered.map((qr) => {
                    const st = status(qr)
                    const isStatic = qr.kind === 'wifi'
                    return (
                      <TR key={qr.id}>
                        <TD>
                          <div class="flex items-center gap-2.5 min-w-0">
                            <Thumb qr={qr} />
                            <div class="min-w-0">
                              <button type="button" onClick={() => setStatsQr(qr)} class="font-medium text-sm hover:underline truncate block max-w-[220px] text-left">{qr.name}</button>
                              <div class="text-2xs text-fg-muted flex flex-wrap items-center gap-x-1.5 whitespace-nowrap">
                                <span>{KIND_LABEL[qr.kind]}</span>
                                {qr.folder && <span>· {qr.folder}</span>}
                                {!isStatic && <span class="font-mono">· /{qr.slug}</span>}
                              </div>
                            </div>
                          </div>
                        </TD>
                        <TD class="max-w-[240px]"><span class="text-xs truncate block" title={destinationText(qr)}>{destinationText(qr)}</span></TD>
                        <TD align="right">
                          {isStatic ? <span class="text-2xs text-fg-muted">sem rastreio</span> : (
                            <div class="tabular-nums"><div class="font-medium">{qr.totalScans}</div><div class="text-2xs text-fg-muted">{qr.uniqueScans} {qr.uniqueScans === 1 ? 'único' : 'únicos'}</div></div>
                          )}
                        </TD>
                        <TD align="right">
                          {isStatic ? <span class="text-2xs text-fg-muted">—</span> : (
                            <div class="tabular-nums"><div class="font-medium">{qr.totalClicks}</div><div class="text-2xs text-fg-muted">{qr.uniqueClicks} {qr.uniqueClicks === 1 ? 'único' : 'únicos'}</div></div>
                          )}
                        </TD>
                        <TD><span class="text-xs text-fg-muted">{qr.lastAccessAt ? formatRelative(qr.lastAccessAt) : '—'}</span></TD>
                        <TD><Badge tone={st.tone}>{st.label}</Badge></TD>
                        <TD align="right">
                          <div class="flex justify-end items-center gap-0.5">
                            {!isStatic && <Button variant="ghost" size="sm" title="Copiar link curto (conta como clique)" onClick={() => copy(qr.shortUrl, 'Link')}><Copy size={13} /></Button>}
                            <DownloadMenu qr={qr} />
                            {!isStatic && <Button variant="ghost" size="sm" title="Relatório" onClick={() => setStatsQr(qr)}><BarChart3 size={13} /></Button>}
                            <Button variant="ghost" size="sm" title="Editar" onClick={() => openEdit(qr)}><Pencil size={13} /></Button>
                            {!isStatic && <Button variant="ghost" size="sm" title={qr.active ? 'Pausar' : 'Reativar'} onClick={() => toggle(qr)}><Power size={13} class={qr.active ? '' : 'text-fg-muted'} /></Button>}
                            {!isStatic && <a href={qr.shortUrl} target="_blank" rel="noopener" title="Testar (abre o destino e conta 1 clique)" class="inline-flex p-1.5 text-fg-muted hover:text-fg"><ExternalLink size={13} /></a>}
                            <Button variant="ghost" size="sm" title="Excluir" onClick={() => setDeleting(qr)}><Trash2 size={13} class="text-danger" /></Button>
                          </div>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      )}

      <QrEditorModal open={editorOpen} onOpenChange={setEditorOpen} editing={editing} folders={folders} />
      <QrStatsModal qr={statsQr} onOpenChange={(o) => { if (!o) setStatsQr(null) }} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null) }}
        title={`Excluir “${deleting?.name ?? ''}”?`}
        description={deleting && deleting.kind !== 'wifi'
          ? `O QR impresso e o link curto param de funcionar, e o histórico de ${deleting.totalScans + deleting.totalClicks} acesso(s) é apagado. Para só tirar do ar mantendo o histórico, use Pausar.`
          : 'O QR de Wi-Fi já impresso continua funcionando (ele não passa pelo sistema); só some da lista.'}
        confirmLabel="Excluir"
        destructive
        loading={del.isPending}
        onConfirm={confirmDelete}
      />

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o QR Code rastreável?"
        problem={<>
          Um QR comum guarda o destino dentro do desenho: depois de impresso, não dá para trocar e ninguém sabe quantas pessoas leram.
          Aqui o QR aponta para um <strong>endereço curto do sistema</strong>, que registra o acesso e leva a pessoa ao destino em menos de um segundo.
        </>}
        steps={[
          { title: '1. Crie e escolha o destino', body: <>Site, WhatsApp com mensagem pronta, cartão de contato, e-mail, SMS, ligação, texto ou Wi-Fi.</> },
          { title: '2. Ajuste o visual', body: <>Cores, formato dos pontos e dos cantos, logo no centro e moldura com chamada (“Escaneie e ganhe 10%”). A prévia mostra o resultado na hora.</> },
          { title: '3. Use o QR e o link', body: <>Baixe em PNG (até 2048 px) ou SVG para a gráfica. Cada QR também tem um <strong>link curto</strong> para bio, post ou e-mail. O relatório separa <em>leituras do QR</em> de <em>cliques no link</em>.</> },
          { title: '4. Acompanhe', body: <>Leituras por dia, horário de pico, dia da semana, celular ou computador, sistema, navegador, idioma e de qual site veio o clique. Visitante único é contado por aparelho. Robôs e prévias de link (WhatsApp, Facebook…) não contam.</> },
          { title: '5. Mude quando quiser', body: <>Troque o destino, pause, ou defina validade com página de “campanha encerrada”. O QR impresso continua o mesmo.</> },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Teste antes de imprimir',
          body: <>Leia com 2 ou 3 celulares diferentes, principalmente se usar bolinhas, logo grande ou cores claras. Wi-Fi é a exceção: ele vai gravado no código e não tem contagem.</>,
        }}
      />
    </Page>
  )
}
