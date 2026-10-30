import { useMemo, useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { KpiCard } from '@/components/ui/KpiCard'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Table, THead, TBody, TR, TH, TD, TEmpty } from '@/components/ui/Table'
import { Download, QrCode, MousePointerClick, User } from '@/components/ui/icon-set'
import { downloadFile } from '@/lib/download'
import { formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { useQrAccesses, useQrStats, type QrCodeItem, type QrDayRow, type QrLabelCount } from '@/hooks/useQrCodes'

export const PERIODS: Array<[number, string]> = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']]

const LABELS: Record<string, string> = {
  mobile: 'Celular', desktop: 'Computador', tablet: 'Tablet', other: 'Outro', desconhecido: 'Não informado',
}
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Série diária completa (dias sem acesso entram com zero), separada por origem. */
export function dailySeries(rows: QrDayRow[], days: number) {
  const map = new Map<string, { qr: number; link: number }>()
  for (const r of rows) {
    const key = String(r.date).slice(0, 10)
    const cur = map.get(key) ?? { qr: 0, link: 0 }
    cur[r.via] += Number(r.total)
    map.set(key, cur)
  }
  const out: Array<{ key: string; label: string; qr: number; link: number }> = []
  const today = new Date()
  for (let i = Math.min(days, 90) - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const v = map.get(key) ?? { qr: 0, link: 0 }
    out.push({ key, label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, ...v })
  }
  return out
}

/** Barras empilhadas: leituras do QR (cor de destaque) + cliques no link (azul). */
export function StackedDays({ series }: { series: Array<{ key: string; label: string; qr: number; link: number }> }) {
  const max = Math.max(1, ...series.map((s) => s.qr + s.link))
  const [hover, setHover] = useState<number | null>(null)
  const h = hover !== null ? series[hover] : null
  return (
    <div>
      <div class="flex items-center gap-3 text-2xs text-fg-muted mb-2">
        <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-sm bg-accent" /> Leituras do QR</span>
        <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-sm bg-warning" /> Cliques no link</span>
        <span class="ml-auto tabular-nums">{h ? `${h.label}: ${h.qr} leitura(s), ${h.link} clique(s)` : ''}</span>
      </div>
      <div class="flex items-end gap-px h-36" onMouseLeave={() => setHover(null)}>
        {series.map((s, i) => (
          <div key={s.key} class="flex-1 h-full flex flex-col justify-end cursor-default" onMouseEnter={() => setHover(i)} title={`${s.label}: ${s.qr} leitura(s), ${s.link} clique(s)`}>
            <div class={cn('bg-warning rounded-t-[1px]', hover === i && 'opacity-80')} style={{ height: `${(s.link / max) * 100}%` }} />
            <div class={cn('bg-accent', s.link === 0 && 'rounded-t-[1px]', hover === i && 'opacity-80')} style={{ height: `${(s.qr / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div class="flex justify-between text-2xs text-fg-muted mt-1 tabular-nums">
        <span>{series[0]?.label}</span><span>{series[Math.floor(series.length / 2)]?.label}</span><span>{series[series.length - 1]?.label}</span>
      </div>
    </div>
  )
}

function BarList({ title, rows }: { title: string; rows: QrLabelCount[] }) {
  const total = rows.reduce((a, r) => a + Number(r.total), 0)
  return (
    <div class="rounded-lg border border-border p-3">
      <div class="text-xs font-semibold mb-2">{title}</div>
      {rows.length === 0 ? <div class="text-2xs text-fg-muted">Sem dados no período.</div> : (
        <div class="space-y-1.5">
          {rows.slice(0, 6).map((r) => {
            const pct = total ? (Number(r.total) / total) * 100 : 0
            return (
              <div key={r.label}>
                <div class="flex justify-between text-2xs mb-0.5"><span class="truncate">{LABELS[r.label] ?? r.label}</span><span class="tabular-nums text-fg-muted">{r.total} · {pct.toFixed(0)}%</span></div>
                <div class="h-1.5 rounded bg-surface-2 overflow-hidden"><div class="h-full bg-accent/70" style={{ width: `${pct}%` }} /></div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function HourGrid({ hours, weekdays }: { hours: Array<{ hour: number; total: number }>; weekdays: Array<{ dow: number; total: number }> }) {
  const h = Array.from({ length: 24 }, (_, i) => Number(hours.find((x) => Number(x.hour) === i)?.total ?? 0))
  const w = Array.from({ length: 7 }, (_, i) => Number(weekdays.find((x) => Number(x.dow) === i + 1)?.total ?? 0))
  const mh = Math.max(1, ...h), mw = Math.max(1, ...w)
  const peak = h.indexOf(Math.max(...h))
  return (
    <div class="rounded-lg border border-border p-3 space-y-3">
      <div>
        <div class="text-xs font-semibold mb-2">Horário (Brasília){h.some(Boolean) && <span class="font-normal text-fg-muted"> · pico às {peak}h</span>}</div>
        <div class="flex items-end gap-px h-16">
          {h.map((v, i) => <div key={i} class="flex-1 bg-accent/70 rounded-t-[1px]" style={{ height: `${Math.max(v ? 4 : 0, (v / mh) * 100)}%` }} title={`${i}h: ${v}`} />)}
        </div>
        <div class="flex justify-between text-2xs text-fg-muted mt-1"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
      </div>
      <div>
        <div class="text-xs font-semibold mb-2">Dia da semana</div>
        <div class="grid grid-cols-7 gap-1">
          {w.map((v, i) => (
            <div key={i} class="text-center">
              <div class="h-8 rounded" style={{ background: `color-mix(in srgb, var(--color-accent) ${Math.round((v / mw) * 85) + (v ? 15 : 4)}%, transparent)` }} title={`${WEEKDAYS[i]}: ${v}`} />
              <div class="text-2xs text-fg-muted mt-0.5">{WEEKDAYS[i]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function QrStatsModal({ qr, onOpenChange }: { qr: QrCodeItem | null; onOpenChange: (open: boolean) => void }) {
  const [days, setDays] = useState(30)
  const [page, setPage] = useState(1)
  const [via, setVia] = useState<'' | 'qr' | 'link'>('')
  const stats = useQrStats(qr?.id ?? null, days)
  const acc = useQrAccesses(qr?.id ?? null, page, via)
  const s = stats.data
  const series = useMemo(() => dailySeries(s?.byDay ?? [], days), [s, days])
  const isStatic = qr?.kind === 'wifi'

  async function exportCsv() {
    if (!qr) return
    try { await downloadFile(`/admin/tools/qrcodes/${qr.id}/accesses.csv`, `qr-${qr.slug}-acessos.csv`) }
    catch (e: any) { toast(e?.message || 'Falha ao exportar', 'danger') }
  }

  const pages = acc.data ? Math.max(1, Math.ceil(acc.data.total / acc.data.limit)) : 1

  return (
    <Modal open={!!qr} onOpenChange={onOpenChange} title={qr ? `Relatório: ${qr.name}` : ''} description={qr && !isStatic ? `${qr.qrUrl} · link ${qr.shortUrl}` : undefined} size="full" unconstrained>
      {qr && isStatic && <div class="text-sm text-fg-muted">QR de Wi-Fi não passa pelo sistema, por isso não tem contagem de leituras.</div>}
      {qr && !isStatic && (
        <div class="space-y-4 max-w-6xl mx-auto w-full">
          <div class="flex flex-wrap items-center gap-2">
            <div class="inline-flex rounded-md border border-border overflow-hidden">
              {PERIODS.map(([d, l]) => (
                <button key={d} type="button" onClick={() => setDays(d)} class={cn('px-2.5 py-1 text-xs', d === days ? 'bg-accent text-white' : 'bg-surface text-fg-muted hover:text-fg')}>{l}</button>
              ))}
            </div>
            <div class="text-2xs text-fg-muted">Total desde a criação: {qr.totalScans} leitura(s), {qr.totalClicks} clique(s)</div>
            <Button variant="ghost" size="sm" class="ml-auto" onClick={exportCsv}><Download size={12} /> Exportar CSV</Button>
          </div>

          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Leituras do QR" value={s?.scans ?? 0} loading={stats.isLoading} icon={<QrCode size={16} />} tone="accent" hint="Câmera apontada para o código" />
            <KpiCard label="Pessoas que leram" value={s?.uniqueScans ?? 0} loading={stats.isLoading} icon={<User size={16} />} tone="accent" hint="Celulares diferentes" />
            <KpiCard label="Cliques no link" value={s?.clicks ?? 0} loading={stats.isLoading} icon={<MousePointerClick size={16} />} tone="warning" hint="Link curto em bio, post, e-mail" />
            <KpiCard label="Pessoas que clicaram" value={s?.uniqueClicks ?? 0} loading={stats.isLoading} icon={<User size={16} />} tone="warning" hint="Aparelhos diferentes" />
          </div>

          <div class="rounded-lg border border-border p-3">
            <div class="text-xs font-semibold mb-2">Acessos por dia{days > 90 ? ' (últimos 90 dias)' : ''}</div>
            {stats.isLoading ? <Skeleton class="h-36" /> : <StackedDays series={series} />}
          </div>

          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <HourGrid hours={s?.byHour ?? []} weekdays={s?.byWeekday ?? []} />
            <BarList title="Aparelho" rows={s?.device ?? []} />
            <BarList title="Sistema" rows={s?.os ?? []} />
            <BarList title="Navegador / app" rows={s?.browser ?? []} />
            <BarList title="Idioma do aparelho" rows={s?.language ?? []} />
            <BarList title="Sites que mandaram o clique" rows={s?.referer ?? []} />
          </div>

          <div class="rounded-lg border border-border">
            <div class="flex items-center gap-2 p-3 border-b border-border">
              <div class="text-xs font-semibold">Últimos acessos</div>
              <div class="inline-flex rounded-md border border-border overflow-hidden ml-auto">
                {([['', 'Todos'], ['qr', 'QR'], ['link', 'Link']] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => { setVia(v); setPage(1) }} class={cn('px-2 py-0.5 text-2xs', v === via ? 'bg-accent text-white' : 'bg-surface text-fg-muted')}>{l}</button>
                ))}
              </div>
            </div>
            <Table minWidth="640px">
              <THead><TR><TH>Quando</TH><TH>Origem</TH><TH>Aparelho</TH><TH>Sistema</TH><TH>Navegador</TH><TH>Idioma</TH><TH>Veio de</TH></TR></THead>
              <TBody>
                {(acc.data?.accesses ?? []).length === 0 && <TEmpty colSpan={7}>{acc.isLoading ? 'Carregando…' : 'Nenhum acesso ainda. Assim que alguém ler o QR ou clicar no link, aparece aqui.'}</TEmpty>}
                {(acc.data?.accesses ?? []).map((a) => (
                  <TR key={a.id}>
                    <TD class="tabular-nums whitespace-nowrap">{formatDateTime(a.createdAt)}</TD>
                    <TD>
                      <Badge tone={a.via === 'qr' ? 'accent' : 'warning'}>{a.via === 'qr' ? 'Leitura QR' : 'Clique link'}</Badge>
                      {a.isUnique && <span class="text-2xs text-fg-muted ml-1">1º acesso</span>}
                    </TD>
                    <TD>{LABELS[a.deviceType ?? ''] ?? a.deviceType ?? '—'}</TD>
                    <TD>{a.os ?? '—'}</TD>
                    <TD>{a.browser ?? '—'}</TD>
                    <TD>{a.language ?? '—'}</TD>
                    <TD class="max-w-[200px] truncate" title={a.referer ?? ''}>{a.referer ? a.referer.replace(/^https?:\/\//, '').split('/')[0] : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {pages > 1 && (
              <div class="flex items-center justify-end gap-2 p-2 text-2xs">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                <span class="tabular-nums">{page} / {pages}</span>
                <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
