import { useState } from 'preact/hooks'
import { Upload, Check, X as XIcon, AlertTriangle, ArrowRight, ArrowLeft, History, FileSpreadsheet } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'
import {
  useUploadImport, useComputePlan, useCommitImport, useImportHistory,
  type MappingEntry, type ImportOptions, type PreviewResponse, type ImportPlan, type TargetField,
} from '@/hooks/useLeadsImport'

type Step = 'upload' | 'mapping' | 'preview' | 'done'

const FIELD_LABELS: Record<string, string> = {
  empresa: 'Empresa',
  nome: 'Nome',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  cidade: 'Cidade',
  segmento: 'Segmento',
  funnelName: 'Funil (nome)',
  stageName: 'Etapa (nome)',
  status: 'Status (Ganho/Aberto/Perdido)',
  lossReasonName: 'Motivo de perda',
  ownerEmail: 'Responsável (email ou nome)',
  tags: 'Tags (separadas por vírgula ou ;)',
  utmSource: 'UTM Source',
  utmMedium: 'UTM Medium',
  utmCampaign: 'UTM Campaign',
  utmContent: 'UTM Content',
  utmTerm: 'UTM Term',
  sourceId: 'Source ID',
  __custom: 'Custom Field',
  __ignore: 'Ignorar',
}

const STANDARD_TARGETS: TargetField[] = [
  'empresa', 'nome', 'whatsapp', 'email', 'cidade', 'segmento',
  'funnelName', 'stageName', 'status', 'lossReasonName', 'ownerEmail', 'tags',
  'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'sourceId',
]

function targetToKey(t: TargetField): string {
  if (typeof t === 'string') return t
  if (t.kind === 'customField') return `__custom__${t.key}`
  return '__ignore'
}

function keyToTarget(key: string, fallback: TargetField): TargetField {
  if (key.startsWith('__custom__')) {
    if (typeof fallback === 'object' && fallback.kind === 'customField') return fallback
    return { kind: 'customField', key: key.replace('__custom__', ''), label: '', type: 'text' }
  }
  if (key === '__ignore') return { kind: 'ignore' }
  return key as TargetField
}

export function LeadsImportPage() {
  const [step, setStep] = useState<Step>('upload')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [mapping, setMapping] = useState<MappingEntry[]>([])
  const [options, setOptions] = useState<ImportOptions>({
    matchBy: 'whatsapp_first',
    overrideFilled: false,
    createMissingFields: true,
    migrationMode: false,
  })
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [rejectedIndices, setRejectedIndices] = useState<Set<number>>(new Set())
  const [commitResult, setCommitResult] = useState<{ created: number; updated: number; skipped: number; failed: any[] } | null>(null)

  const upload = useUploadImport()
  const compute = useComputePlan()
  const commit = useCommitImport()
  const history = useImportHistory(10)

  const handleFile = async (file: File) => {
    try {
      const res = await upload.mutateAsync(file)
      setPreview(res)
      setMapping(res.suggestedMapping)
      setStep('mapping')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao enviar arquivo', 'danger')
    }
  }

  const handleComputePlan = async () => {
    if (!preview) return
    try {
      const p = await compute.mutateAsync({ importId: preview.importId, mapping, options })
      setPlan(p)
      setRejectedIndices(new Set(p.rows.filter((r) => r.action === 'invalid').map((r) => r.lineIndex)))
      setStep('preview')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao montar plano', 'danger')
    }
  }

  const handleCommit = async () => {
    if (!preview || !plan) return
    const acceptedLineIndices = plan.rows
      .filter((r) => (r.action === 'create' || r.action === 'update') && !rejectedIndices.has(r.lineIndex))
      .map((r) => r.lineIndex)

    const confirmText = window.prompt(
      `Confirma a importação de ${acceptedLineIndices.length} leads?\nDigite "IMPORTAR" para confirmar.`,
    )
    if (confirmText !== 'IMPORTAR') {
      toast('Importação cancelada', 'info')
      return
    }

    try {
      const res = await commit.mutateAsync({
        importId: preview.importId,
        mapping,
        options,
        acceptedLineIndices,
      })
      setCommitResult(res.result)
      setStep('done')
      toast(`${res.result.created} criados, ${res.result.updated} atualizados`, 'success')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao importar', 'danger')
    }
  }

  const reset = () => {
    setStep('upload')
    setPreview(null)
    setMapping([])
    setPlan(null)
    setRejectedIndices(new Set())
    setCommitResult(null)
  }

  return (
    <Page
      title="Importar leads"
      description="Suba uma planilha (CSV ou Excel). O sistema valida cada linha, identifica duplicatas e mostra o que vai mudar antes de gravar."
    >
      <div class="space-y-4">
        <StepIndicator current={step} />
        {step === 'upload' && <UploadStep onFile={handleFile} pending={upload.isPending} history={history.data?.imports ?? []} />}
        {step === 'mapping' && preview && (
          <MappingStep
            preview={preview}
            mapping={mapping}
            setMapping={setMapping}
            options={options}
            setOptions={setOptions}
            onBack={reset}
            onNext={handleComputePlan}
            pending={compute.isPending}
          />
        )}
        {step === 'preview' && plan && (
          <PreviewStep
            plan={plan}
            rejectedIndices={rejectedIndices}
            setRejectedIndices={setRejectedIndices}
            onBack={() => setStep('mapping')}
            onCommit={handleCommit}
            pending={commit.isPending}
          />
        )}
        {step === 'done' && commitResult && (
          <DoneStep result={commitResult} onReset={reset} />
        )}
      </div>
    </Page>
  )
}

function StepIndicator({ current }: { current: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'upload', label: '1. Upload' },
    { key: 'mapping', label: '2. Mapeamento' },
    { key: 'preview', label: '3. Pré-visualização' },
    { key: 'done', label: '4. Concluído' },
  ]
  return (
    <div class="flex gap-2 text-sm">
      {steps.map((s, i) => (
        <div
          key={s.key}
          class={`flex-1 px-3 py-2 rounded border ${
            current === s.key
              ? 'border-accent bg-accent/10 text-accent font-medium'
              : steps.findIndex((x) => x.key === current) > i
              ? 'border-success/40 bg-success/5 text-success'
              : 'border-border text-fg-muted'
          }`}
        >
          {s.label}
        </div>
      ))}
    </div>
  )
}

function UploadStep({
  onFile, pending, history,
}: {
  onFile: (file: File) => void
  pending: boolean
  history: any[]
}) {
  return (
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card class="lg:col-span-2">
        <div class="p-6">
          <label class="block">
            <div class="border-2 border-dashed border-border rounded-lg p-12 text-center hover:bg-surface-2 cursor-pointer">
              <Upload size={32} class="mx-auto text-fg-muted mb-3" />
              <div class="text-sm font-medium mb-1">Clique para selecionar o arquivo</div>
              <div class="text-xs text-fg-muted">
                Aceita CSV e Excel (.xlsx). Até 5.000 linhas.
              </div>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.tsv"
                onChange={(e) => {
                  const f = (e.target as HTMLInputElement).files?.[0]
                  if (f) onFile(f)
                }}
                disabled={pending}
                class="hidden"
              />
            </div>
          </label>
          {pending && <div class="mt-4 text-center text-sm text-fg-muted">Enviando e validando…</div>}

          <div class="mt-6 text-xs text-fg-muted space-y-1">
            <p><strong>Como funciona:</strong></p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Sistema lê o cabeçalho e sugere automaticamente o mapeamento de colunas</li>
              <li>Detecta duplicatas via WhatsApp (últimos 8 dígitos) ou email</li>
              <li>Pra leads já existentes, <strong>só preenche campos vazios</strong> — nunca sobrescreve sem confirmação</li>
              <li>Mostra preview com diff por linha antes de gravar qualquer coisa</li>
            </ul>
          </div>
        </div>
      </Card>

      <Card>
        <div class="p-4">
          <div class="flex items-center gap-2 mb-3">
            <History size={16} class="text-fg-muted" />
            <h3 class="text-sm font-semibold">Histórico</h3>
          </div>
          {history.length === 0 ? (
            <p class="text-xs text-fg-muted">Sem importações anteriores.</p>
          ) : (
            <div class="space-y-2 text-xs">
              {history.slice(0, 5).map((h) => (
                <div key={h.id} class="p-2 rounded bg-surface-2 border border-border">
                  <div class="flex items-center gap-2 mb-1">
                    <FileSpreadsheet size={12} class="text-fg-muted" />
                    <span class="truncate flex-1 font-medium">{h.fileName}</span>
                    <Badge tone={
                      h.status === 'done' ? 'success' :
                      h.status === 'failed' ? 'danger' :
                      h.status === 'running' ? 'warning' :
                      'neutral'
                    }>{h.status}</Badge>
                  </div>
                  {h.totals && (
                    <div class="text-fg-muted">
                      {h.totals.created || 0} criados · {h.totals.updated || 0} atualizados · {h.totals.skipped || 0} pulados
                    </div>
                  )}
                  <div class="text-fg-subtle text-[10px] mt-1">
                    {new Date(h.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    {h.importedBy && ` • ${h.importedBy.name}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

function MappingStep({
  preview, mapping, setMapping, options, setOptions, onBack, onNext, pending,
}: {
  preview: PreviewResponse
  mapping: MappingEntry[]
  setMapping: (m: MappingEntry[]) => void
  options: ImportOptions
  setOptions: (o: ImportOptions) => void
  onBack: () => void
  onNext: () => void
  pending: boolean
}) {
  const updateMapping = (idx: number, target: TargetField) => {
    setMapping(mapping.map((m, i) => (i === idx ? { ...m, target } : m)))
  }

  return (
    <>
      <Card>
        <div class="p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-base font-semibold">Mapear colunas</h3>
            <div class="text-sm text-fg-muted">
              <strong>{preview.totalRows}</strong> linhas · <strong>{preview.headers.length}</strong> colunas
            </div>
          </div>
          <p class="text-xs text-fg-muted mb-3">
            Cada coluna da planilha → campo no sistema. Colunas sem match viram custom field automaticamente.
          </p>

          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-xs uppercase tracking-wide text-fg-muted border-b border-border">
                <tr>
                  <th class="px-3 py-2">Coluna da planilha</th>
                  <th class="px-3 py-2">Exemplo</th>
                  <th class="px-3 py-2">→ Mapeia para</th>
                </tr>
              </thead>
              <tbody>
                {mapping.map((m, idx) => {
                  const sample = preview.sampleRows.map((r) => r[m.source]).filter(Boolean)[0] || ''
                  const currentKey = targetToKey(m.target)
                  return (
                    <tr key={m.source} class="border-b border-border last:border-0">
                      <td class="px-3 py-2 font-medium">{m.source}</td>
                      <td class="px-3 py-2 text-xs text-fg-muted truncate max-w-[12rem]">{sample}</td>
                      <td class="px-3 py-2">
                        <Select
                          value={currentKey}
                          onChange={(e) => updateMapping(idx, keyToTarget((e.currentTarget as HTMLSelectElement).value, m.target))}
                        >
                          <option value="__ignore">— Ignorar —</option>
                          <optgroup label="Campos do Lead">
                            {STANDARD_TARGETS.map((t) => (
                              <option key={t as string} value={t as string}>
                                {FIELD_LABELS[t as string] ?? (t as string)}
                              </option>
                            ))}
                          </optgroup>
                          <option value={`__custom__${typeof m.target === 'object' && m.target.kind === 'customField' ? m.target.key : `col_${idx}`}`}>
                            ✨ Custom Field (criar)
                          </option>
                        </Select>
                        {typeof m.target === 'object' && m.target.kind === 'customField' && (
                          <div class="mt-1 grid grid-cols-2 gap-1">
                            <Input
                              placeholder="Chave (slug)"
                              value={m.target.key}
                              onInput={(e) => updateMapping(idx, {
                                ...m.target as any,
                                key: (e.currentTarget as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                              })}
                            />
                            <Input
                              placeholder="Rótulo"
                              value={m.target.label}
                              onInput={(e) => updateMapping(idx, {
                                ...m.target as any,
                                label: (e.currentTarget as HTMLInputElement).value,
                              })}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card>
        <div class="p-4 space-y-3">
          <h3 class="text-sm font-semibold">Opções</h3>
          <Select
            label="Critério para identificar lead existente"
            value={options.matchBy}
            onChange={(e) => setOptions({ ...options, matchBy: (e.currentTarget as HTMLSelectElement).value as any })}
          >
            <option value="whatsapp_first">WhatsApp (8 dígitos) → email como fallback</option>
            <option value="email_first">Email → WhatsApp como fallback</option>
            <option value="whatsapp_only">Apenas WhatsApp</option>
          </Select>
          <label class="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={options.createMissingFields}
              onChange={(e) => setOptions({ ...options, createMissingFields: (e.currentTarget as HTMLInputElement).checked })}
            />
            <div>
              <div>Criar custom fields e tags novos automaticamente</div>
              <div class="text-xs text-fg-muted">Colunas marcadas como "Custom Field (criar)" viram fields permanentes; tags ausentes são criadas com cor cinza.</div>
            </div>
          </label>
          <label class={`flex items-start gap-2 text-sm cursor-pointer p-3 rounded border ${options.migrationMode ? 'border-warning bg-warning/10' : 'border-border bg-surface-2'}`}>
            <input
              type="checkbox"
              checked={options.migrationMode}
              onChange={(e) => setOptions({ ...options, migrationMode: (e.currentTarget as HTMLInputElement).checked })}
            />
            <div>
              <div class="font-semibold">🚚 Modo Migração (histórico de outro CRM)</div>
              <div class="text-xs text-fg-muted mt-1">
                Quando ligado, em leads que JÁ EXISTEM o importador atualiza também:
              </div>
              <ul class="text-xs text-fg-muted list-disc pl-4 mt-1 space-y-0.5">
                <li><strong>Etapa do funil</strong> (sobrescreve a atual)</li>
                <li><strong>Status</strong> Ganho/Perdido + <strong>Motivo da perda</strong></li>
                <li><strong>Responsável</strong> — apenas se o lead estiver SEM responsável (não rouba atendimento)</li>
                <li><strong>Tags</strong> — sempre adiciona (nunca remove tags existentes)</li>
              </ul>
              <div class="text-xs text-warning mt-1">⚠️ Sem este modo, leads existentes mantêm etapa, status e responsável.</div>
            </div>
          </label>
          <label class="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={options.overrideFilled}
              onChange={(e) => setOptions({ ...options, overrideFilled: (e.currentTarget as HTMLInputElement).checked })}
            />
            <div>
              <div>⚠️ Sobrescrever todos os campos já preenchidos (modo agressivo)</div>
              <div class="text-xs text-fg-muted">Por padrão, leads existentes só recebem dados em campos VAZIOS. Marque pra forçar sobreposição. Independente do Modo Migração.</div>
            </div>
          </label>
        </div>
      </Card>

      <div class="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onBack} disabled={pending}>
          <ArrowLeft size={14} /> Voltar
        </Button>
        <Button onClick={onNext} disabled={pending}>
          {pending ? 'Calculando…' : 'Pré-visualizar plano'}
          <ArrowRight size={14} />
        </Button>
      </div>
    </>
  )
}

function PreviewStep({
  plan, rejectedIndices, setRejectedIndices, onBack, onCommit, pending,
}: {
  plan: ImportPlan
  rejectedIndices: Set<number>
  setRejectedIndices: (s: Set<number>) => void
  onBack: () => void
  onCommit: () => void
  pending: boolean
}) {
  const [filter, setFilter] = useState<'all' | 'create' | 'update' | 'skip' | 'invalid'>('all')
  const filtered = plan.rows.filter((r) => filter === 'all' || r.action === filter)
  const toAccept = plan.rows.filter((r) => (r.action === 'create' || r.action === 'update') && !rejectedIndices.has(r.lineIndex)).length

  const toggleRejected = (idx: number) => {
    const next = new Set(rejectedIndices)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setRejectedIndices(next)
  }

  return (
    <>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KpiCard label="Total" value={plan.summary.total} />
        <KpiCard label="Novos" value={plan.summary.new} tone="info" />
        <KpiCard label="Atualizar" value={plan.summary.update} tone="success" />
        <KpiCard label="Pular" value={plan.summary.skip} tone="warning" />
        <KpiCard label="Inválidos" value={plan.summary.invalid} tone="danger" />
      </div>

      {plan.newCustomFields.length > 0 && (
        <Card>
          <div class="p-4">
            <h3 class="text-sm font-semibold mb-2">Custom fields que serão criados ({plan.newCustomFields.length})</h3>
            <div class="flex flex-wrap gap-2">
              {plan.newCustomFields.map((cf) => (
                <Badge tone="accent" key={cf.key}>{cf.label} ({cf.type})</Badge>
              ))}
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div class="p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold">Plano de importação</h3>
            <div class="flex gap-1 bg-surface-2 border border-border rounded p-0.5">
              {(['all', 'create', 'update', 'skip', 'invalid'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  class={`px-3 py-1 text-xs rounded ${filter === f ? 'bg-accent text-fg-on-brand' : 'text-fg-muted hover:text-fg'}`}
                >
                  {f === 'all' ? 'Todos' : f === 'create' ? 'Novos' : f === 'update' ? 'Atualizar' : f === 'skip' ? 'Pular' : 'Inválidos'}
                </button>
              ))}
            </div>
          </div>
          <div class="text-xs text-fg-muted mb-2">
            {toAccept} de {plan.summary.new + plan.summary.update} serão aplicados. Desmarque linhas pra excluir do commit.
          </div>
          <div class="max-h-[28rem] overflow-y-auto space-y-1">
            {filtered.map((r) => (
              <PlanRow key={r.lineIndex} row={r} rejected={rejectedIndices.has(r.lineIndex)} onToggle={() => toggleRejected(r.lineIndex)} />
            ))}
            {filtered.length === 0 && <div class="text-sm text-fg-muted text-center py-8">Nenhuma linha neste filtro.</div>}
          </div>
        </div>
      </Card>

      <div class="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onBack} disabled={pending}>
          <ArrowLeft size={14} /> Voltar
        </Button>
        <Button variant="danger" onClick={onCommit} disabled={pending || toAccept === 0}>
          {pending ? 'Importando…' : `Executar (${toAccept} leads)`}
        </Button>
      </div>
    </>
  )
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone?: 'info' | 'success' | 'warning' | 'danger' }) {
  const cls = tone === 'info' ? 'text-info' : tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-fg'
  return (
    <Card>
      <div class="p-3 text-center">
        <div class={`text-2xl font-bold ${cls}`}>{value}</div>
        <div class="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      </div>
    </Card>
  )
}

function PlanRow({ row, rejected, onToggle }: { row: any; rejected: boolean; onToggle: () => void }) {
  const actionable = row.action === 'create' || row.action === 'update'
  const actionLabel = row.action === 'create' ? 'CRIAR' : row.action === 'update' ? 'ATUALIZAR' : row.action === 'skip' ? 'PULAR' : 'INVÁLIDO'
  const actionTone =
    row.action === 'create' ? 'info' :
    row.action === 'update' ? 'success' :
    row.action === 'skip' ? 'warning' : 'danger'

  return (
    <div class={`border rounded p-2 ${rejected ? 'opacity-50 bg-surface-3' : 'bg-surface'}`}>
      <div class="flex items-start gap-2">
        <input
          type="checkbox"
          checked={actionable && !rejected}
          disabled={!actionable}
          onChange={onToggle}
          class="mt-1"
        />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <Badge tone={actionTone as any}>{actionLabel}</Badge>
            <span class="text-xs text-fg-muted">Linha {row.lineIndex + 1}</span>
            {row.existingLeadId && (
              <a href={`/app/leads/${row.existingLeadId}`} target="_blank" class="text-xs text-accent hover:underline">
                Lead #{row.existingLeadId}
              </a>
            )}
          </div>
          <div class="text-sm mt-1 truncate">
            {row.parsedFields.empresa || row.parsedFields.nome || '(sem nome)'} — {row.parsedFields.whatsapp || row.parsedFields.email || ''}
          </div>
          {row.matchReason && <div class="text-xs text-fg-muted mt-1">{row.matchReason}</div>}
          {row.errors.length > 0 && (
            <div class="text-xs text-danger mt-1 flex items-start gap-1">
              <AlertTriangle size={12} class="shrink-0 mt-0.5" />
              <span>{row.errors.join(' · ')}</span>
            </div>
          )}
          {row.diff && row.diff.length > 0 && row.action === 'update' && (
            <details class="mt-2">
              <summary class="text-xs text-fg-muted cursor-pointer">Diff ({row.diff.length} campos)</summary>
              <div class="mt-1 text-xs space-y-0.5 pl-2">
                {row.diff.slice(0, 10).map((d: any, i: number) => (
                  <div key={i} class="flex items-center gap-2">
                    {d.action === 'fill' && <Check size={10} class="text-success" />}
                    {d.action === 'skip-already-set' && <XIcon size={10} class="text-fg-subtle" />}
                    {d.action === 'override' && <AlertTriangle size={10} class="text-warning" />}
                    <code class="text-fg-muted">{d.field}</code>:
                    <span class="text-fg-subtle line-through">{String(d.oldValue ?? '∅')}</span>
                    →
                    <span>{String(d.newValue ?? '∅')}</span>
                  </div>
                ))}
                {row.diff.length > 10 && <div class="text-fg-subtle">+{row.diff.length - 10} campos…</div>}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

function DoneStep({ result, onReset }: { result: any; onReset: () => void }) {
  return (
    <Card>
      <div class="p-8 text-center">
        <Check size={48} class="mx-auto text-success mb-3" />
        <h3 class="text-lg font-semibold mb-1">Importação concluída</h3>
        <p class="text-sm text-fg-muted mb-4">
          <strong class="text-success">{result.created}</strong> leads criados ·{' '}
          <strong class="text-info">{result.updated}</strong> atualizados ·{' '}
          <strong class="text-warning">{result.skipped}</strong> pulados
          {result.failed.length > 0 && (
            <> · <strong class="text-danger">{result.failed.length}</strong> falhas</>
          )}
        </p>
        {result.failed.length > 0 && (
          <div class="bg-danger/5 border border-danger/30 rounded p-3 text-left mb-4 text-xs">
            <strong>Falhas:</strong>
            <ul class="mt-1">
              {result.failed.slice(0, 10).map((f: any, i: number) => (
                <li key={i}>Linha {f.lineIndex + 1}: {f.error}</li>
              ))}
            </ul>
          </div>
        )}
        <div class="flex gap-2 justify-center">
          <Button onClick={onReset}>Importar outra planilha</Button>
          <Button variant="ghost" onClick={() => { window.location.href = '/app/leads' }}>
            Ver leads
          </Button>
        </div>
      </div>
    </Card>
  )
}
