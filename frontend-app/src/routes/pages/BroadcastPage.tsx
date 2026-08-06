import { useEffect, useState } from 'preact/hooks'
import { Megaphone, Send, Pause, Play, X as XIcon, Trash2, Download, Upload, ArrowLeft, ArrowRight, Users, FileSpreadsheet, Clock, Pencil } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { LeadsAudiencePicker, Stat, AudienceCard } from '@/components/audience/LeadsAudiencePicker'
import { useCloudApiConnections, useCloudApiTemplates } from '@/hooks/useCloudApi'
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

type View =
  | { kind: 'list' }
  | { kind: 'wizard'; editId: number | null }
  | { kind: 'detail'; id: number }

export function BroadcastPage() {
  const [view, setView] = useState<View>({ kind: 'list' })

  if (view.kind === 'wizard') {
    return <CampaignWizard editId={view.editId} onClose={() => setView({ kind: 'list' })} onDone={(id) => setView({ kind: 'detail', id })} />
  }
  if (view.kind === 'detail') return <CampaignDetail id={view.id} onBack={() => setView({ kind: 'list' })} />
  return (
    <CampaignList
      onNew={() => setView({ kind: 'wizard', editId: null })}
      onEdit={(id) => setView({ kind: 'wizard', editId: id })}
      onOpen={(id) => setView({ kind: 'detail', id })}
    />
  )
}

// ─────────────────────────── LISTA ───────────────────────────
function CampaignList({ onNew, onEdit, onOpen }: { onNew: () => void; onEdit: (id: number) => void; onOpen: (id: number) => void }) {
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
              {/* Rascunho nunca foi enviado — pode voltar ao wizard e ser alterado. */}
              {c.status === 'draft' && (
                <button type="button" class="size-7 rounded grid place-items-center text-fg-muted hover:text-accent hover:bg-surface-3"
                  onClick={(e) => { e.stopPropagation(); onEdit(c.id) }} title="Editar rascunho"><Pencil size={13} /></button>
              )}
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
/**
 * Cria uma campanha nova ou retoma um RASCUNHO existente (`editId`). Rascunho
 * nunca foi enviado, então tudo pode mudar; a partir de "enviando" a campanha
 * só é acompanhada, nunca editada — quem faz valer isso é o PUT do backend.
 */
function CampaignWizard({ editId, onClose, onDone }: { editId: number | null; onClose: () => void; onDone: (id: number) => void }) {
  const [step, setStep] = useState(1)
  const [campaignId, setCampaignId] = useState<number | null>(editId)
  const isEdit = editId !== null
  // audiência já resolvida no rascunho: pode ser mantida sem refazer a seleção
  const [keptAudience, setKeptAudience] = useState<{ created: number; skipped: number } | null>(null)
  const [loadedEdit, setLoadedEdit] = useState(false)

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
  // no modo edição precisamos do detalhe já no passo 1 para preencher o formulário
  const { data: detail } = useBroadcastCampaign(isEdit || step === 4 ? campaignId : null)

  // Preenche o wizard com o rascunho salvo — uma vez só, para não sobrescrever
  // o que o usuário já estiver digitando.
  useEffect(() => {
    if (!isEdit || loadedEdit || !detail?.campaign) return
    const c = detail.campaign
    if (c.status !== 'draft') { toast('Esta campanha não é mais um rascunho e não pode ser editada', 'warning'); onClose(); return }
    setName(c.name)
    setConnId(c.cloudApiConnectionId)
    setTemplateId(c.templateId)
    setAudienceType(c.audienceType)
    setMapping(c.variableMapping ?? {})
    if (c.scheduledAt) setScheduledAt(new Date(c.scheduledAt).toISOString().slice(0, 16))
    const already = detail.metrics?.total ?? 0
    if (already > 0) setKeptAudience({ created: c.totalRecipients ?? 0, skipped: c.skippedCount ?? 0 })
    setLoadedEdit(true)
  }, [isEdit, loadedEdit, detail, onClose])

  async function step1Next() {
    if (!name.trim() || !connId || !templateId) { toast('Preencha nome, número e template', 'warning'); return }
    if (campaignId) {
      const res = await update.mutateAsync({ id: campaignId, name: name.trim(), cloudApiConnectionId: connId, templateId, audienceType })
      // trocar o template zera os destinatários no backend: a audiência tem que ser refeita
      if (res.recipientsReset) {
        setKeptAudience(null)
        setSelectedLeads(new Set())
        setSheetHeaders([]); setSheetTotal(0)
        setMapping({})
        toast('Template alterado — refaça a audiência e o mapeamento', 'warning')
      }
    } else {
      const res = await create.mutateAsync({ name: name.trim(), cloudApiConnectionId: connId, templateId, audienceType })
      setCampaignId(res.campaign.id)
    }
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

  /** O usuário mexeu na audiência nesta sessão? Se não, o rascunho mantém a que já tinha. */
  const audienceTouched = audienceType === 'leads' ? selectedLeads.size > 0 : sheetHeaders.length > 0

  function step2Next() {
    if (!audienceTouched && keptAudience) { setStep(3); return } // mantém a audiência do rascunho
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
    // Sem mexer na audiência, não reprocessa: os destinatários do rascunho seguem
    // valendo. Reprocessar aqui apagaria e recriaria tudo à toa.
    if (!audienceTouched && keptAudience) {
      setAudienceResult(keptAudience)
      setStep(4)
      return
    }
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

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null
  const selectedConn = connections.find((c) => c.id === connId) ?? null
  const audienceCount = audienceTouched
    ? (audienceType === 'leads' ? selectedLeads.size : sheetTotal)
    : (keptAudience?.created ?? 0)

  return (
    <Page title={isEdit ? 'Editar rascunho' : 'Novo disparo'} description={STEP_TITLES[step - 1] ?? `Passo ${step} de 4`}
      actions={<Button variant="ghost" onClick={onClose}><ArrowLeft size={14} /> Voltar à lista</Button>}>
      <WizardSteps current={step} />

      {/* PASSO 1 — configuração ao lado da prévia do template */}
      {step === 1 && (
        <div class="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card class="p-5 space-y-4">
            <div class="grid gap-4 sm:grid-cols-2">
              <Input label="Nome da campanha" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: Promoção de junho" />
              <Select label="Número de envio (WhatsApp Oficial)" value={connId ?? ''} onChange={(e) => setConnId(Number((e.target as HTMLSelectElement).value) || null)}>
                <option value="">Selecione…</option>
                {connections.map((c) => <option key={c.id} value={c.id}>{c.displayName || c.displayPhone}</option>)}
              </Select>
            </div>
            <Select label="Template aprovado (HSM)" value={templateId ?? ''} onChange={(e) => setTemplateId(Number((e.target as HTMLSelectElement).value) || null)}>
              <option value="">Selecione…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language} · {t.category})</option>)}
            </Select>
            {templates.length === 0 && <p class="text-xs text-warning">Nenhum template aprovado. Crie e aprove um em WhatsApp Oficial antes de disparar.</p>}
            <div>
              <label class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider">Audiência</label>
              <div class="grid gap-2 mt-1 sm:grid-cols-2">
                <AudienceCard active={audienceType === 'leads'} onClick={() => setAudienceType('leads')} icon={<Users size={16} />} title="Leads do sistema" desc="Selecionar leads existentes" />
                <AudienceCard active={audienceType === 'import'} onClick={() => setAudienceType('import')} icon={<FileSpreadsheet size={16} />} title="Importar base" desc="Planilha CSV/Excel" />
              </div>
            </div>
          </Card>
          <TemplatePreview template={selectedTemplate} connectionLabel={selectedConn?.displayName || selectedConn?.displayPhone || null} />
        </div>
      )}

      {/* PASSO 2 — audiência ocupa a tela inteira */}
      {step === 2 && keptAudience && !audienceTouched && (
        <div class="flex items-start gap-2 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-fg mb-3">
          <Users size={14} class="text-info shrink-0 mt-0.5" />
          <span>
            Este rascunho já tem <b>{keptAudience.created.toLocaleString('pt-BR')}</b> destinatário(s).
            Avance sem mexer para mantê-los, ou {audienceType === 'leads' ? 'selecione leads abaixo' : 'envie outra planilha'} para <b>substituir</b> a audiência.
          </span>
        </div>
      )}
      {step === 2 && (
        audienceType === 'leads' ? (
          <LeadsAudiencePicker selected={selectedLeads} onChange={setSelectedLeads} />
        ) : (
          <div class="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Card class="p-5 space-y-4">
              <div class="flex items-center gap-2 flex-wrap">
                <Button variant="ghost" size="sm" onClick={() => downloadAudienceTemplate(templateId).catch(() => toast('Falha ao baixar modelo', 'danger'))}><Download size={13} /> Baixar modelo</Button>
                <label class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border hover:bg-surface-2 cursor-pointer">
                  <Upload size={13} /> Enviar planilha
                  <input type="file" accept=".csv,.xlsx,.xls" class="hidden" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onUpload(f) }} />
                </label>
              </div>
              {sheetHeaders.length === 0 ? (
                <EmptyState icon={<FileSpreadsheet size={26} />} title="Nenhuma planilha enviada"
                  description="Baixe o modelo, preencha e envie o arquivo CSV/Excel com os destinatários." />
              ) : (
                <div class="grid gap-3 sm:grid-cols-2">
                  <Select label="Coluna do WhatsApp" value={phoneColumn} onChange={(e) => setPhoneColumn((e.target as HTMLSelectElement).value)}>
                    {sheetHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                  <Select label="Coluna do nome (opcional)" value={nameColumn} onChange={(e) => setNameColumn((e.target as HTMLSelectElement).value)}>
                    <option value="">—</option>
                    {sheetHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
              )}
            </Card>
            <Card class="p-4 space-y-3">
              <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">Planilha</div>
              {sheetHeaders.length === 0 ? (
                <p class="text-xs text-fg-subtle">Envie um arquivo para ver o resumo aqui.</p>
              ) : (
                <>
                  <Stat label="Linhas lidas" value={sheetTotal} tone="success" />
                  <div>
                    <div class="text-[0.6875rem] text-fg-muted mb-1">Colunas encontradas</div>
                    <div class="flex flex-wrap gap-1">
                      {sheetHeaders.map((h) => <span key={h} class="inline-flex h-6 items-center px-2 rounded-full border border-border text-[0.6875rem] text-fg-muted">{h}</span>)}
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>
        )
      )}

      {/* PASSO 3 — mapeamento das variáveis */}
      {step === 3 && (
        <div class="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card class="p-5 space-y-4">
            {(vars?.keys ?? []).length === 0 ? (
              <p class="text-sm text-fg-muted">Este template não tem variáveis. Avance para a revisão.</p>
            ) : (
              <div class="space-y-3">
                {(vars?.keys ?? []).map((k) => {
                  const m = mapping[k] ?? { type: audienceType === 'leads' ? 'lead_field' : 'column', value: '' }
                  return (
                    <div key={k} class="grid gap-2 items-end grid-cols-1 sm:grid-cols-[90px_minmax(0,1fr)_minmax(0,1.5fr)]">
                      <div class="text-xs font-mono text-fg sm:pb-2">{`{{${k.split(':')[1]}}}`}</div>
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
          </Card>
          <TemplatePreview template={selectedTemplate} connectionLabel={selectedConn?.displayName || selectedConn?.displayPhone || null} />
        </div>
      )}

      {/* PASSO 4 — revisão e envio */}
      {step === 4 && (
        <div class="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card class="p-5 space-y-4">
            <div class="grid gap-2 grid-cols-1 sm:grid-cols-3">
              <Stat label="Destinatários" value={audienceResult?.created ?? 0} tone="success" />
              <Stat label="Ignorados (opt-out/dup/inválido)" value={audienceResult?.skipped ?? 0} tone="warning" />
              <Stat label="Custo estimado" value={`US$ ${(detail?.metrics.estimatedCostUsd ?? 0).toFixed(2)}`} tone="info" />
            </div>
            {(audienceResult?.created ?? 0) === 0 && <p class="text-xs text-danger">Nenhum destinatário válido — volte e ajuste a audiência.</p>}
            <Input label="Agendar para (opcional)" type="datetime-local" value={scheduledAt} onInput={(e) => setScheduledAt((e.target as HTMLInputElement).value)} hint="Deixe vazio para enviar agora." />
          </Card>
          <TemplatePreview template={selectedTemplate} connectionLabel={selectedConn?.displayName || selectedConn?.displayPhone || null} />
        </div>
      )}

      {/* Navegação — barra fixa no rodapé, sempre visível em listas longas */}
      <div class="sticky bottom-0 -mx-1 px-1 pb-1 pt-3 bg-gradient-to-t from-surface via-surface to-transparent">
        <Card class="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div class="text-xs text-fg-muted">
            {step === 1 && (name.trim() && connId && templateId ? 'Tudo pronto para escolher a audiência.' : 'Preencha nome, número e template.')}
            {step === 2 && (audienceTouched
              ? `${audienceCount.toLocaleString('pt-BR')} ${audienceType === 'leads' ? 'lead(s) selecionado(s)' : 'linha(s) na planilha'}`
              : keptAudience
                ? `Mantendo os ${keptAudience.created.toLocaleString('pt-BR')} destinatário(s) já salvos`
                : 'Selecione a audiência para continuar.')}
            {step === 3 && `${(vars?.keys ?? []).length} variável(is) no template`}
            {step === 4 && `${(audienceResult?.created ?? 0).toLocaleString('pt-BR')} destinatário(s) prontos`}
          </div>
          <div class="flex items-center gap-2 ml-auto">
            {step > 1 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}><ArrowLeft size={14} /> Voltar</Button>
            )}
            {step === 1 && <Button variant="primary" onClick={step1Next} disabled={busy}>Avançar <ArrowRight size={14} /></Button>}
            {step === 2 && <Button variant="primary" onClick={step2Next} disabled={busy}>Avançar <ArrowRight size={14} /></Button>}
            {step === 3 && <Button variant="primary" onClick={step3Next} disabled={busy}>Processar audiência <ArrowRight size={14} /></Button>}
            {step === 4 && (
              <Button variant="primary" onClick={finish} disabled={busy || (audienceResult?.created ?? 0) === 0}>
                {scheduledAt ? <><Clock size={14} /> Agendar</> : <><Send size={14} /> Disparar agora</>}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </Page>
  )
}

// ─────────────────────── WIZARD: APOIO ───────────────────────
const STEP_TITLES = [
  '1. Configuração — número, template e tipo de audiência',
  '2. Audiência — quem vai receber o disparo',
  '3. Variáveis — de onde sai o conteúdo de cada campo',
  '4. Revisão — confira e dispare',
]
const STEP_LABELS = ['Configuração', 'Audiência', 'Variáveis', 'Revisão']

/** Trilha do wizard em largura total: mostra onde o usuário está e o que já ficou para trás. */
function WizardSteps({ current }: { current: number }) {
  return (
    <ol class="flex items-center gap-2 overflow-x-auto pb-1">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1
        const done = n < current
        const active = n === current
        return (
          <li key={label} class="flex items-center gap-2 shrink-0">
            <div class={cn('flex items-center gap-2 h-9 px-3 rounded-full border text-xs font-medium transition-colors',
              active ? 'bg-accent/15 text-accent border-accent'
                : done ? 'bg-surface-2 text-fg border-border'
                  : 'bg-surface text-fg-subtle border-border')}>
              <span class={cn('grid place-items-center size-5 rounded-full text-[0.625rem] font-semibold',
                active ? 'bg-accent text-white' : done ? 'bg-success/20 text-success' : 'bg-surface-3 text-fg-subtle')}>
                {done ? '✓' : n}
              </span>
              {label}
            </div>
            {n < STEP_LABELS.length && <div class={cn('h-px w-6', done ? 'bg-success/40' : 'bg-border')} />}
          </li>
        )
      })}
    </ol>
  )
}

/** Extrai o texto do componente BODY do template (formato da Cloud API). */
function templateBodyText(components: unknown): string | null {
  if (!Array.isArray(components)) return null
  const body = components.find((c) => c && typeof c === 'object' && (c as any).type === 'BODY')
  const text = body && typeof body === 'object' ? (body as any).text : null
  return typeof text === 'string' ? text : null
}

/** Painel lateral com a prévia da mensagem — ocupa a coluna direita nos passos 1, 3 e 4. */
function TemplatePreview({ template, connectionLabel }: { template: { name: string; language: string; category: string; components: unknown } | null; connectionLabel: string | null }) {
  const body = template ? templateBodyText(template.components) : null
  return (
    <Card class="p-4 space-y-3 lg:sticky lg:top-4">
      <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">Prévia da mensagem</div>
      {!template ? (
        <p class="text-xs text-fg-subtle">Selecione um template para ver a prévia.</p>
      ) : (
        <>
          <div class="text-xs text-fg">
            <div class="font-medium truncate">{template.name}</div>
            <div class="text-fg-subtle">{template.language} · {template.category}</div>
            {connectionLabel && <div class="text-fg-subtle mt-0.5">Envio por {connectionLabel}</div>}
          </div>
          <div class="rounded-lg bg-surface-2 p-3">
            {body ? (
              <p class="text-xs text-fg whitespace-pre-wrap break-words">{body}</p>
            ) : (
              <p class="text-xs text-fg-subtle italic">Sem corpo de texto neste template.</p>
            )}
          </div>
          <p class="text-[0.625rem] text-fg-subtle">
            Os campos <span class="font-mono">{'{{n}}'}</span> são substituídos por destinatário conforme o passo 3.
          </p>
        </>
      )}
    </Card>
  )
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
          <div class="flex items-center gap-2 mb-3 flex-wrap">
            <Badge tone={STATUS_TONE[c]}>{STATUS_LABEL[c]}</Badge>
            <span class="text-xs text-fg-muted">{metrics?.progress ?? 0}% processado</span>
          </div>
          {/* Barra de progresso — em tela cheia o avanço precisa se ler de longe */}
          <div class="h-1.5 rounded-full bg-surface-3 overflow-hidden mb-3">
            <div class="h-full bg-accent rounded-full transition-[width] duration-500" style={{ width: `${metrics?.progress ?? 0}%` }} />
          </div>
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
          <div class="p-3 border-b border-border flex items-center justify-between gap-2">
            <span class="text-sm font-semibold text-fg">Destinatários (amostra)</span>
            <span class="text-xs text-fg-muted">{recipients.length} listado(s)</span>
          </div>
          <div class="max-h-[min(60vh,44rem)] overflow-auto">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-surface-2 text-fg-muted">
                <tr>
                  <th class="text-left font-medium px-3 py-2">Nome</th>
                  <th class="text-left font-medium px-3 py-2 hidden sm:table-cell">Telefone</th>
                  <th class="text-left font-medium px-3 py-2">Situação</th>
                  <th class="text-left font-medium px-3 py-2">Detalhe</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {recipients.length === 0 ? (
                  <tr><td colSpan={4} class="px-3 py-6 text-center text-sm text-fg-muted">Nenhum destinatário ainda.</td></tr>
                ) : recipients.map((r) => (
                  <tr key={r.id} class="hover:bg-surface-2">
                    <td class="px-3 py-2 text-fg truncate max-w-[16rem]">{r.name || '—'}</td>
                    <td class="px-3 py-2 text-fg-subtle hidden sm:table-cell">{r.phone}</td>
                    <td class="px-3 py-2">
                      <Badge tone={r.status === 'read' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'delivered' ? 'info' : r.status === 'skipped' ? 'warning' : 'neutral'}>{r.status}</Badge>
                    </td>
                    <td class="px-3 py-2">
                      {r.error && <span class="text-danger" title={r.error}>{r.error}</span>}
                      {r.skipReason && <span class="text-warning">{r.skipReason}</span>}
                      {!r.error && !r.skipReason && <span class="text-fg-subtle">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Page>
  )
}
