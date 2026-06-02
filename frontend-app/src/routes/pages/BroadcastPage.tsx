import { useState } from 'preact/hooks'
import { Megaphone, Send, Pause, Play, X as XIcon, Trash2, Download, Upload, ArrowLeft, ArrowRight, Users, FileSpreadsheet, Clock } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useCloudApiConnections, useCloudApiTemplates } from '@/hooks/useCloudApi'
import { useLeads } from '@/hooks/useLeads'
import {
  useBroadcastCampaigns, useBroadcastCampaign, useCreateBroadcastCampaign, useUpdateBroadcastCampaign,
  useDeleteBroadcastCampaign, useTemplateVariables, useSetAudienceLeads, useParseSheet, useImportCommit,
  useStartCampaign, useCampaignAction, downloadAudienceTemplate, type BroadcastCampaign,
} from '@/hooks/useBroadcast'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', scheduled: 'Agendada', running: 'Enviando', paused: 'Pausada',
  completed: 'Concluída', canceled: 'Cancelada', failed: 'Falhou',
}
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', scheduled: 'info', running: 'info', paused: 'warning',
  completed: 'success', canceled: 'neutral', failed: 'danger',
}
const LEAD_FIELDS = [
  { value: 'nome', label: 'Nome' }, { value: 'empresa', label: 'Empresa' },
  { value: 'email', label: 'E-mail' }, { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'cidade', label: 'Cidade' }, { value: 'segmento', label: 'Segmento' },
]

export function BroadcastPage() {
  const [view, setView] = useState<'list' | 'wizard' | number>('list')

  if (view === 'wizard') return <CampaignWizard onClose={() => setView('list')} onDone={(id) => setView(id)} />
  if (typeof view === 'number') return <CampaignDetail id={view} onBack={() => setView('list')} />
  return <CampaignList onNew={() => setView('wizard')} onOpen={(id) => setView(id)} />
}

// ─────────────────────────── LISTA ───────────────────────────
function CampaignList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: number) => void }) {
  const { data, isLoading } = useBroadcastCampaigns()
  const del = useDeleteBroadcastCampaign()
  const [deleting, setDeleting] = useState<BroadcastCampaign | null>(null)
  const campaigns = data?.campaigns ?? []

  return (
    <Page title="Disparos em Massa" description="Campanhas de envio via WhatsApp Oficial (Cloud API) com templates aprovados."
      actions={<Button variant="primary" onClick={onNew}><Megaphone size={14} /> Novo disparo</Button>}>
      {isLoading ? (
        <div class="text-sm text-fg-muted">Carregando…</div>
      ) : campaigns.length === 0 ? (
        <EmptyState icon={<Megaphone size={28} />} title="Nenhuma campanha ainda"
          description="Crie um disparo em massa selecionando um template aprovado e a audiência (leads ou planilha)." />
      ) : (
        <div class="space-y-2">
          {campaigns.map((c) => (
            <Card key={c.id} class="p-4 flex items-center gap-4 hover:bg-surface-2 cursor-pointer" onClick={() => onOpen(c.id)}>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-fg truncate">{c.name}</span>
                  <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                </div>
                <div class="text-xs text-fg-muted mt-0.5">
                  {c.templateName} · {c.cloudApiConnection?.displayPhone ?? '—'} · {c.totalRecipients} destinatários
                  {c.scheduledAt && c.status === 'scheduled' ? ` · agendada p/ ${new Date(c.scheduledAt).toLocaleString('pt-BR')}` : ''}
                </div>
              </div>
              <div class="text-xs text-fg-muted shrink-0 text-right">
                <div>✅ {c.sentCount} · ❌ {c.failedCount}</div>
                <div class="text-fg-subtle">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</div>
              </div>
              {['draft', 'completed', 'canceled', 'failed'].includes(c.status) && (
                <button type="button" class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
                  onClick={(e) => { e.stopPropagation(); setDeleting(c) }} title="Excluir"><Trash2 size={13} /></button>
              )}
            </Card>
          ))}
        </div>
      )}
      {deleting && (
        <ConfirmDialog open onOpenChange={(o) => { if (!o) setDeleting(null) }} title={`Excluir "${deleting.name}"`}
          description="A campanha e seus destinatários serão removidos." destructive confirmLabel="Excluir" loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, { onSuccess: () => { toast('Campanha excluída', 'success'); setDeleting(null) } })} />
      )}
    </Page>
  )
}

// ─────────────────────────── WIZARD ───────────────────────────
function CampaignWizard({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [step, setStep] = useState(1)
  const [campaignId, setCampaignId] = useState<number | null>(null)

  // passo 1
  const { data: connData } = useCloudApiConnections()
  const { data: tplData } = useCloudApiTemplates()
  const connections = (connData?.connections ?? []).filter((c) => c.active)
  const templates = (tplData?.templates ?? []).filter((t) => t.status === 'APPROVED')
  const [name, setName] = useState('')
  const [connId, setConnId] = useState<number | null>(null)
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [audienceType, setAudienceType] = useState<'leads' | 'import'>('leads')

  // passo 2 (audiência)
  const [search, setSearch] = useState('')
  const { data: leadsData } = useLeads({ search: search || undefined, limit: 50 })
  const [selectedLeads, setSelectedLeads] = useState<Set<number>>(new Set())
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([])
  const [sheetTotal, setSheetTotal] = useState(0)
  const [phoneColumn, setPhoneColumn] = useState('')
  const [nameColumn, setNameColumn] = useState('')

  // passo 3 (variáveis)
  const { data: vars } = useTemplateVariables(templateId)
  const [mapping, setMapping] = useState<Record<string, { type: string; value: string }>>({})

  // passo 4 (revisão)
  const [audienceResult, setAudienceResult] = useState<{ created: number; skipped: number } | null>(null)
  const [scheduledAt, setScheduledAt] = useState('')

  const create = useCreateBroadcastCampaign()
  const update = useUpdateBroadcastCampaign()
  const setLeads = useSetAudienceLeads()
  const parse = useParseSheet()
  const importCommit = useImportCommit()
  const start = useStartCampaign()
  const { data: detail } = useBroadcastCampaign(step === 4 ? campaignId : null)

  async function step1Next() {
    if (!name.trim() || !connId || !templateId) { toast('Preencha nome, número e template', 'warning'); return }
    const res = await create.mutateAsync({ name: name.trim(), cloudApiConnectionId: connId, templateId, audienceType })
    setCampaignId(res.campaign.id)
    setStep(2)
  }

  async function onUpload(file: File) {
    if (!campaignId) return
    const res = await parse.mutateAsync({ id: campaignId, file })
    setSheetHeaders(res.headers); setSheetTotal(res.totalRows)
    const wa = res.headers.find((h) => /whats|fone|phone|tel|celular/i.test(h)) || res.headers[0] || ''
    const nm = res.headers.find((h) => /nome|name/i.test(h)) || ''
    setPhoneColumn(wa); setNameColumn(nm)
    toast(`${res.totalRows} linhas lidas`, 'success')
  }

  function step2Next() {
    if (audienceType === 'leads' && selectedLeads.size === 0) { toast('Selecione ao menos um lead', 'warning'); return }
    if (audienceType === 'import' && (!sheetHeaders.length || !phoneColumn)) { toast('Envie a planilha e indique a coluna do WhatsApp', 'warning'); return }
    setStep(3)
  }

  async function step3Next() {
    if (!campaignId) return
    // monta mapping só com variáveis preenchidas
    const finalMapping: Record<string, { type: string; value: string }> = {}
    for (const k of vars?.keys ?? []) {
      const m = mapping[k]
      if (m && m.value) finalMapping[k] = m
    }
    await update.mutateAsync({ id: campaignId, variableMapping: finalMapping })
    const res = audienceType === 'leads'
      ? await setLeads.mutateAsync({ id: campaignId, leadIds: [...selectedLeads] })
      : await importCommit.mutateAsync({ id: campaignId, phoneColumn, nameColumn: nameColumn || undefined })
    setAudienceResult(res)
    setStep(4)
  }

  async function finish() {
    if (!campaignId) return
    const when = scheduledAt ? new Date(scheduledAt).toISOString() : null
    await start.mutateAsync({ id: campaignId, scheduledAt: when })
    toast(when ? 'Campanha agendada' : 'Disparo iniciado', 'success')
    onDone(campaignId)
  }

  const busy = create.isPending || update.isPending || setLeads.isPending || importCommit.isPending || start.isPending || parse.isPending

  return (
    <Page title="Novo disparo" description={`Passo ${step} de 4`}
      actions={<Button variant="ghost" onClick={onClose}><ArrowLeft size={14} /> Voltar à lista</Button>}>
      <Card class="p-5 max-w-3xl">
        {/* PASSO 1 */}
        {step === 1 && (
          <div class="space-y-4">
            <h3 class="text-sm font-semibold text-fg">1. Configuração</h3>
            <Input label="Nome da campanha" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: Promoção de junho" />
            <Select label="Número de envio (WhatsApp Oficial)" value={connId ?? ''} onChange={(e) => setConnId(Number((e.target as HTMLSelectElement).value) || null)}>
              <option value="">Selecione…</option>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.displayName || c.displayPhone}</option>)}
            </Select>
            <Select label="Template aprovado (HSM)" value={templateId ?? ''} onChange={(e) => setTemplateId(Number((e.target as HTMLSelectElement).value) || null)}>
              <option value="">Selecione…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language} · {t.category})</option>)}
            </Select>
            {templates.length === 0 && <p class="text-xs text-warning">Nenhum template aprovado. Crie e aprove um em WhatsApp Oficial antes de disparar.</p>}
            <div>
              <label class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider">Audiência</label>
              <div class="grid grid-cols-2 gap-2 mt-1">
                <AudienceCard active={audienceType === 'leads'} onClick={() => setAudienceType('leads')} icon={<Users size={16} />} title="Leads do sistema" desc="Selecionar leads existentes" />
                <AudienceCard active={audienceType === 'import'} onClick={() => setAudienceType('import')} icon={<FileSpreadsheet size={16} />} title="Importar base" desc="Planilha CSV/Excel" />
              </div>
            </div>
            <div class="flex justify-end"><Button variant="primary" onClick={step1Next} disabled={busy}>Avançar <ArrowRight size={14} /></Button></div>
          </div>
        )}

        {/* PASSO 2 */}
        {step === 2 && (
          <div class="space-y-4">
            <h3 class="text-sm font-semibold text-fg">2. Audiência</h3>
            {audienceType === 'leads' ? (
              <>
                <Input label="Buscar leads" value={search} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} placeholder="Nome, empresa, WhatsApp…" />
                <div class="text-xs text-fg-muted">{selectedLeads.size} selecionado(s)</div>
                <div class="border border-border rounded-md max-h-72 overflow-auto divide-y divide-border">
                  {(leadsData?.leads ?? []).map((l) => (
                    <label key={l.id} class="flex items-center gap-2 px-3 py-2 hover:bg-surface-2 cursor-pointer text-sm">
                      <input type="checkbox" checked={selectedLeads.has(l.id)} onChange={(e) => {
                        const next = new Set(selectedLeads); (e.target as HTMLInputElement).checked ? next.add(l.id) : next.delete(l.id); setSelectedLeads(next)
                      }} />
                      <span class="text-fg">{l.nome || l.empresa || '(sem nome)'}</span>
                      <span class="text-fg-subtle text-xs">{l.whatsapp || 'sem WhatsApp'}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div class="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => downloadAudienceTemplate(templateId).catch(() => toast('Falha ao baixar modelo', 'danger'))}><Download size={13} /> Baixar modelo</Button>
                  <label class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border hover:bg-surface-2 cursor-pointer">
                    <Upload size={13} /> Enviar planilha
                    <input type="file" accept=".csv,.xlsx,.xls" class="hidden" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onUpload(f) }} />
                  </label>
                </div>
                {sheetHeaders.length > 0 && (
                  <div class="space-y-2">
                    <div class="text-xs text-success">{sheetTotal} linhas lidas.</div>
                    <Select label="Coluna do WhatsApp" value={phoneColumn} onChange={(e) => setPhoneColumn((e.target as HTMLSelectElement).value)}>
                      {sheetHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                    <Select label="Coluna do nome (opcional)" value={nameColumn} onChange={(e) => setNameColumn((e.target as HTMLSelectElement).value)}>
                      <option value="">—</option>
                      {sheetHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </div>
                )}
              </>
            )}
            <div class="flex justify-between"><Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft size={14} /> Voltar</Button><Button variant="primary" onClick={step2Next} disabled={busy}>Avançar <ArrowRight size={14} /></Button></div>
          </div>
        )}

        {/* PASSO 3 */}
        {step === 3 && (
          <div class="space-y-4">
            <h3 class="text-sm font-semibold text-fg">3. Variáveis do template</h3>
            {(vars?.keys ?? []).length === 0 ? (
              <p class="text-sm text-fg-muted">Este template não tem variáveis. Avance para a revisão.</p>
            ) : (
              <div class="space-y-3">
                {(vars?.keys ?? []).map((k) => {
                  const m = mapping[k] ?? { type: audienceType === 'leads' ? 'lead_field' : 'column', value: '' }
                  return (
                    <div key={k} class="grid grid-cols-[80px_1fr_1.5fr] gap-2 items-end">
                      <div class="text-xs font-mono text-fg pb-2">{`{{${k.split(':')[1]}}}`}</div>
                      <Select label="Origem" value={m.type} onChange={(e) => setMapping({ ...mapping, [k]: { type: (e.target as HTMLSelectElement).value, value: '' } })}>
                        {audienceType === 'leads' ? <option value="lead_field">Campo do lead</option> : <option value="column">Coluna da planilha</option>}
                        <option value="fixed">Texto fixo</option>
                      </Select>
                      {m.type === 'fixed' ? (
                        <Input label="Valor" value={m.value} onInput={(e) => setMapping({ ...mapping, [k]: { type: 'fixed', value: (e.target as HTMLInputElement).value } })} />
                      ) : (
                        <Select label="Selecione" value={m.value} onChange={(e) => setMapping({ ...mapping, [k]: { type: m.type, value: (e.target as HTMLSelectElement).value } })}>
                          <option value="">—</option>
                          {(audienceType === 'leads' ? LEAD_FIELDS.map((f) => ({ value: f.value, label: f.label })) : sheetHeaders.map((h) => ({ value: h, label: h }))).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <div class="flex justify-between"><Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft size={14} /> Voltar</Button><Button variant="primary" onClick={step3Next} disabled={busy}>Processar audiência <ArrowRight size={14} /></Button></div>
          </div>
        )}

        {/* PASSO 4 */}
        {step === 4 && (
          <div class="space-y-4">
            <h3 class="text-sm font-semibold text-fg">4. Revisão e envio</h3>
            <div class="grid grid-cols-3 gap-2">
              <Stat label="Destinatários" value={audienceResult?.created ?? 0} />
              <Stat label="Ignorados (opt-out/dup/inválido)" value={audienceResult?.skipped ?? 0} tone="warning" />
              <Stat label="Custo estimado" value={`US$ ${(detail?.metrics.estimatedCostUsd ?? 0).toFixed(2)}`} tone="info" />
            </div>
            {(audienceResult?.created ?? 0) === 0 && <p class="text-xs text-danger">Nenhum destinatário válido — volte e ajuste a audiência.</p>}
            <Input label="Agendar para (opcional)" type="datetime-local" value={scheduledAt} onInput={(e) => setScheduledAt((e.target as HTMLInputElement).value)} hint="Deixe vazio para enviar agora." />
            <div class="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft size={14} /> Voltar</Button>
              <Button variant="primary" onClick={finish} disabled={busy || (audienceResult?.created ?? 0) === 0}>
                {scheduledAt ? <><Clock size={14} /> Agendar</> : <><Send size={14} /> Disparar agora</>}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </Page>
  )
}

function AudienceCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: any; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick} class={`text-left rounded-md border p-3 transition-colors ${active ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2'}`}>
      <div class="flex items-center gap-2 text-fg">{icon}<span class="text-sm font-medium">{title}</span></div>
      <div class="text-xs text-fg-muted mt-0.5">{desc}</div>
    </button>
  )
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number | string; tone?: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }) {
  const color = { neutral: 'text-fg', info: 'text-info', warning: 'text-warning', success: 'text-success', danger: 'text-danger' }[tone]
  return <div class="rounded-md border border-border bg-surface-2 p-3"><div class={`text-lg font-semibold ${color}`}>{value}</div><div class="text-[0.6875rem] text-fg-muted">{label}</div></div>
}

// ─────────────────────────── DETALHE ───────────────────────────
function CampaignDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { data } = useBroadcastCampaign(id, 5000) // poll 5s p/ métricas em tempo real
  const action = useCampaignAction()
  const campaign = data?.campaign
  const metrics = data?.metrics
  const recipients = data?.recipients ?? []
  if (!campaign) return <Page title="Carregando…"><div /></Page>

  const c = campaign.status
  return (
    <Page title={campaign.name} description={`${campaign.templateName} · ${campaign.cloudApiConnection?.displayPhone ?? '—'}`}
      actions={<div class="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>
        {c === 'running' && <Button variant="ghost" onClick={() => action.mutate({ id, action: 'pause' })}><Pause size={14} /> Pausar</Button>}
        {c === 'paused' && <Button variant="primary" onClick={() => action.mutate({ id, action: 'resume' })}><Play size={14} /> Retomar</Button>}
        {['running', 'paused', 'scheduled'].includes(c) && <Button variant="ghost" onClick={() => action.mutate({ id, action: 'cancel' })}><XIcon size={14} /> Cancelar</Button>}
      </div>}>
      <div class="space-y-4">
        <Card class="p-4">
          <div class="flex items-center gap-2 mb-3"><Badge tone={STATUS_TONE[c]}>{STATUS_LABEL[c]}</Badge>
            <span class="text-xs text-fg-muted">{metrics?.progress ?? 0}% processado</span></div>
          <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <Stat label="Total" value={metrics?.total ?? 0} />
            <Stat label="Fila" value={(metrics?.counts.pending ?? 0) + (metrics?.counts.queued ?? 0)} />
            <Stat label="Enviadas" value={metrics?.counts.sent ?? 0} />
            <Stat label="Entregues" value={metrics?.counts.delivered ?? 0} tone="info" />
            <Stat label="Lidas" value={metrics?.counts.read ?? 0} tone="success" />
            <Stat label="Falhas" value={metrics?.counts.failed ?? 0} tone="danger" />
            <Stat label="Custo estim." value={`US$ ${(metrics?.estimatedCostUsd ?? 0).toFixed(2)}`} tone="warning" />
          </div>
          {(metrics?.counts.skipped ?? 0) > 0 && <div class="text-xs text-fg-muted mt-2">{metrics?.counts.skipped} ignorados (opt-out, duplicado ou telefone inválido).</div>}
        </Card>

        <Card class="p-0 overflow-hidden">
          <div class="p-3 border-b border-border text-sm font-semibold text-fg">Destinatários (amostra)</div>
          <div class="max-h-96 overflow-auto divide-y divide-border">
            {recipients.map((r) => (
              <div key={r.id} class="flex items-center justify-between px-3 py-2 text-xs">
                <span class="text-fg">{r.name || r.phone}</span>
                <span class="flex items-center gap-2">
                  {r.error && <span class="text-danger truncate max-w-[200px]" title={r.error}>{r.error}</span>}
                  {r.skipReason && <span class="text-warning">{r.skipReason}</span>}
                  <Badge tone={r.status === 'read' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'delivered' ? 'info' : r.status === 'skipped' ? 'warning' : 'neutral'}>{r.status}</Badge>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  )
}
