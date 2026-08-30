// Conectores de Banco de Dados externo — lista + modal de criar/editar +
// preview/test/run/histórico. Padrão genérico (MySQL/Postgres) com mapping
// por nome de coluna.

import { useState } from 'preact/hooks'
import { Database, Play, RefreshCw, Trash2, Pencil, History, AlertCircle, CheckCircle, Loader2 } from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import {
  useDbConnectors, useCreateDbConnector, useUpdateDbConnector, useDeleteDbConnector,
  useTestDbConnection, usePreviewDbConnector, useRunDbConnectorNow, useDbConnectorRuns,
  type DbConnector, type DbConnectorInput, type DbType,
} from '@/hooks/useDbConnectors'
import { useFunnels } from '@/hooks/useFunnels'
import { useTeams } from '@/hooks/useTeams'

const TARGET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ignore', label: 'Ignorar' },
  { value: 'nome', label: 'Nome' },
  { value: 'concat:nome', label: 'Concatenar em Nome' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'empresa', label: 'Empresa' },
  { value: 'cidade', label: 'Cidade' },
  { value: 'segmento', label: 'Segmento' },
  { value: 'utm:source', label: 'UTM Source' },
  { value: 'utm:medium', label: 'UTM Medium' },
  { value: 'utm:campaign', label: 'UTM Campaign' },
  { value: 'utm:content', label: 'UTM Content' },
  { value: 'utm:term', label: 'UTM Term' },
  { value: 'meta:page_url', label: 'URL da página (auto-parse UTMs)' },
  { value: 'meta:ip', label: 'IP de origem' },
  { value: 'meta:source_id', label: 'ID externo (dedup)' },
  { value: 'meta:created_at', label: 'Timestamp original' },
]

const selectCls = 'w-full px-3 py-2 border rounded bg-bg-base text-fg-base'

export function DbConnectorsPage() {
  const { data, isLoading, refetch } = useDbConnectors()
  const [editing, setEditing] = useState<DbConnector | null>(null)
  const [creating, setCreating] = useState(false)
  const [showRuns, setShowRuns] = useState<DbConnector | null>(null)
  const [askDelete, setAskDelete] = useState<DbConnector | null>(null)

  const del = useDeleteDbConnector()
  const runNow = useRunDbConnectorNow()
  const update = useUpdateDbConnector()

  function handleToggle(c: DbConnector) {
    update.mutate(
      { id: c.id, data: { active: !c.active } },
      { onSuccess: () => toast(c.active ? 'Conector desativado' : 'Conector ativado', 'success') },
    )
  }

  function handleRunNow(c: DbConnector) {
    runNow.mutate(c.id, {
      onSuccess: (r) => toast(`Sync OK — ${r.leadsCreated} criados, ${r.leadsSkipped} pulados, ${r.errors} erros`, r.errors > 0 ? 'warning' : 'success'),
      onError: (e: any) => toast(e?.message || 'Falha ao executar', 'danger'),
    })
  }

  return (
    <Page
      title="Conectores de Banco de Dados"
      description="Importe leads de bancos MySQL ou Postgres externos via query SQL configurável."
      actions={
        <Button onClick={() => setCreating(true)}>
          <Database size={16} class="mr-1" /> Novo conector
        </Button>
      }
    >
      {isLoading ? (
        <Card class="p-6 text-center text-fg-muted">
          <Loader2 size={20} class="inline animate-spin mr-2" /> Carregando…
        </Card>
      ) : !data?.items.length ? (
        <Card class="p-8 text-center text-fg-muted">
          Nenhum conector cadastrado. Clique em "Novo conector" pra começar.
        </Card>
      ) : (
        <div class="space-y-3">
          {data.items.map((c) => (
            <Card key={c.id} class="p-4">
              <div class="flex items-start gap-3">
                <div class="mt-1"><Database size={20} class="text-fg-muted" /></div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-medium">{c.name}</span>
                    <Badge tone={c.active ? 'accent' : 'neutral'}>
                      {c.active ? 'Ativo' : 'Inativo'}
                    </Badge>
                    <Badge tone="neutral">{c.dbType}</Badge>
                    {c.lastRunStatus === 'ok' && <Badge tone="accent"><CheckCircle size={12} class="inline mr-1" />OK</Badge>}
                    {c.lastRunStatus === 'error' && <Badge tone="danger"><AlertCircle size={12} class="inline mr-1" />Erro</Badge>}
                    {c.lastRunStatus === 'running' && <Badge tone="info"><Loader2 size={12} class="inline mr-1 animate-spin" />Rodando</Badge>}
                  </div>
                  <div class="text-sm text-fg-muted mt-1">
                    {c.description || `${c.host}:${c.port}/${c.dbName} • a cada ${c.intervalMinutes}min`}
                  </div>
                  <div class="text-xs text-fg-muted mt-1">
                    Total importado: <strong>{c.totalImported}</strong>
                    {c.lastRunAt && ` • Última: ${new Date(c.lastRunAt).toLocaleString('pt-BR')}`}
                    {c.lastSyncCursor && ` • Cursor: ${c.lastSyncCursor}`}
                  </div>
                  {c.lastError && (
                    <div class="text-xs text-red-600 mt-1 truncate" title={c.lastError}>⚠ {c.lastError}</div>
                  )}
                </div>
                <div class="flex flex-col gap-1">
                  <Button size="sm" variant="ghost" onClick={() => handleRunNow(c)} disabled={runNow.isPending}>
                    <Play size={14} class="mr-1" /> Rodar agora
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                    <Pencil size={14} class="mr-1" /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowRuns(c)}>
                    <History size={14} class="mr-1" /> Histórico
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleToggle(c)}>
                    <RefreshCw size={14} class="mr-1" /> {c.active ? 'Desativar' : 'Ativar'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setAskDelete(c)}>
                    <Trash2 size={14} class="mr-1" /> Excluir
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ConnectorEditModal
          connector={editing}
          onClose={() => { setCreating(false); setEditing(null); refetch() }}
        />
      )}

      {showRuns && (
        <RunsHistoryModal connector={showRuns} onClose={() => setShowRuns(null)} />
      )}

      <ConfirmDialog
        open={!!askDelete}
        onOpenChange={(o) => !o && setAskDelete(null)}
        title={askDelete ? `Excluir "${askDelete.name}"?` : ''}
        description="Os runs ficam preservados mas o conector é removido. Leads já importados continuam no sistema."
        confirmLabel="Excluir"
        destructive
        onConfirm={() => {
          if (!askDelete) return
          del.mutate(askDelete.id, {
            onSuccess: () => { toast('Conector excluído', 'success'); setAskDelete(null) },
            onError: (e: any) => toast(e?.message || 'Falha', 'danger'),
          })
        }}
      />
    </Page>
  )
}

// ─── Modal de edit/create ────────────────────────────────────────────────

function ConnectorEditModal({ connector, onClose }: { connector: DbConnector | null; onClose: () => void }) {
  const isEdit = !!connector
  const [form, setForm] = useState<DbConnectorInput>(() => connector ? {
    name: connector.name,
    channelLabel: connector.channelLabel,
    description: connector.description,
    dbType: connector.dbType,
    host: connector.host,
    port: connector.port,
    dbName: connector.dbName,
    dbUser: connector.dbUser,
    useTLS: connector.useTLS,
    query: connector.query,
    mapping: connector.mapping,
    deltaStrategy: connector.deltaStrategy,
    deltaColumn: connector.deltaColumn,
    lastSyncCursor: connector.lastSyncCursor,
    intervalMinutes: connector.intervalMinutes,
    active: connector.active,
    defaultTeamId: connector.defaultTeamId,
    defaultFunnelId: connector.defaultFunnelId,
    defaultStageKey: connector.defaultStageKey,
  } : {
    name: '', dbType: 'mysql', host: '', port: 3306,
    dbName: '', dbUser: '', password: '',
    useTLS: false, query: '', mapping: {},
    deltaStrategy: 'id', deltaColumn: 'id',
    intervalMinutes: 5, active: true,
    defaultStageKey: 'NOVO',
  })
  const [previewCols, setPreviewCols] = useState<string[]>(() => Object.keys(connector?.mapping || {}))

  const test = useTestDbConnection()
  const preview = usePreviewDbConnector()
  const create = useCreateDbConnector()
  const update = useUpdateDbConnector()
  const funnelsQ = useFunnels()
  const teamsQ = useTeams()
  const funnels = funnelsQ.data?.funnels ?? []
  const teams = teamsQ.data?.teams ?? []

  function handleTest() {
    const payload: any = {
      dbType: form.dbType, host: form.host, port: Number(form.port),
      dbName: form.dbName, dbUser: form.dbUser, useTLS: !!form.useTLS,
    }
    if (form.password) payload.password = form.password
    if (isEdit) payload.connectorId = connector!.id
    test.mutate(payload, {
      onSuccess: (r) => toast(r.ok ? 'Conexão OK' : `Falha: ${r.error}`, r.ok ? 'success' : 'danger'),
    })
  }

  async function handlePreview() {
    if (!isEdit) { toast('Salve o conector primeiro pra fazer preview', 'info'); return }
    const r = await preview.mutateAsync(connector!.id)
    if (!r.ok) { toast(r.error || 'Erro no preview', 'danger'); return }
    if (r.preview.length === 0) { toast('Query retornou 0 linhas. Verifique cursor / WHERE.', 'warning'); return }
    const cols = Object.keys(r.preview[0] || {})
    setPreviewCols(cols)
    const newMap = { ...form.mapping }
    for (const c of cols) if (!newMap[c]) newMap[c] = guessTarget(c)
    setForm((f) => ({ ...f, mapping: newMap }))
    toast(`${r.rowsRead} linhas detectadas. Configure o mapping abaixo.`, 'success')
  }

  function handleSave() {
    if (!form.name || !form.host || !form.dbName || !form.dbUser || !form.query) {
      toast('Preencha todos os campos obrigatórios', 'danger'); return
    }
    if (!isEdit && !form.password) { toast('Senha é obrigatória ao criar', 'danger'); return }
    const mut = isEdit
      ? update.mutateAsync({ id: connector!.id, data: form })
      : create.mutateAsync(form)
    mut
      .then(() => { toast(isEdit ? 'Atualizado' : 'Criado', 'success'); onClose() })
      .catch((e: any) => toast(e?.message || 'Falha', 'danger'))
  }

  return (
    <Modal open={true} onOpenChange={(o) => !o && onClose()} title={isEdit ? `Editar: ${connector!.name}` : 'Novo conector'} size="xl"
      footer={
        <div class="flex gap-2 justify-end w-full">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={create.isPending || update.isPending}>
            {(create.isPending || update.isPending) ? <Loader2 size={14} class="animate-spin mr-1" /> : null}
            {isEdit ? 'Salvar' : 'Criar'}
          </Button>
        </div>
      }
    >
      <div class="space-y-6">
        {/* === CONEXÃO === */}
        <section class="space-y-3">
          <h3 class="font-medium flex items-center gap-2"><Database size={16} /> Conexão</h3>
          <div class="grid grid-cols-2 gap-3">
            <Input label="Nome*" value={form.name} onInput={(e: any) => setForm({ ...form, name: e.target.value })} />
            <label class="block">
              <span class="text-sm block mb-1">Tipo*</span>
              <select class={selectCls} value={form.dbType} onChange={(e: any) => setForm({ ...form, dbType: e.target.value as DbType, port: e.target.value === 'postgres' ? 5432 : 3306 })}>
                <option value="mysql">MySQL / MariaDB</option>
                <option value="postgres">PostgreSQL</option>
              </select>
            </label>
            <Input label="Host*" value={form.host} onInput={(e: any) => setForm({ ...form, host: e.target.value })} placeholder="db.exemplo.com" />
            <Input label="Porta*" type="number" value={String(form.port)} onInput={(e: any) => setForm({ ...form, port: Number(e.target.value) })} />
            <Input label="Database*" value={form.dbName} onInput={(e: any) => setForm({ ...form, dbName: e.target.value })} />
            <Input label="Usuário*" value={form.dbUser} onInput={(e: any) => setForm({ ...form, dbUser: e.target.value })} />
            <Input label={isEdit ? 'Senha (deixe em branco pra manter)' : 'Senha*'} type="password" value={form.password ?? ''} onInput={(e: any) => setForm({ ...form, password: e.target.value })} />
            <label class="flex items-center gap-2 self-end mb-2">
              <input type="checkbox" checked={!!form.useTLS} onChange={(e: any) => setForm({ ...form, useTLS: e.target.checked })} />
              <span>Usar TLS/SSL</span>
            </label>
          </div>
          <Input
            label="Nome do canal (exibido em funis e relatórios)"
            value={form.channelLabel ?? ''}
            onInput={(e: any) => setForm({ ...form, channelLabel: e.target.value })}
            placeholder={form.name || 'Ex.: Site Terram, Landing Page WhatsApp…'}
            hint="Como esta origem aparece nos funis, relatórios e cards de lead. Se em branco, usa o nome do conector."
          />
          <Button variant="ghost" size="sm" onClick={handleTest} disabled={test.isPending}>
            {test.isPending ? <Loader2 size={14} class="animate-spin mr-1" /> : null}
            Testar conexão
          </Button>
        </section>

        {/* === QUERY === */}
        <section class="space-y-2">
          <h3 class="font-medium">Query SQL (apenas SELECT/WITH)</h3>
          <p class="text-xs text-fg-muted">
            Use <code>:cursor</code> como placeholder do último valor sincronizado.
            Ex: <code>WHERE id &gt; :cursor</code>. Limite com <code>LIMIT 100</code>.
          </p>
          <textarea
            class="w-full font-mono text-xs p-3 border rounded bg-bg-subtle min-h-[160px]"
            value={form.query}
            onInput={(e: any) => setForm({ ...form, query: e.target.value })}
            placeholder={`SELECT id, nome, email, telefone, created_at\nFROM leads\nWHERE id > :cursor AND is_completed = 1\nORDER BY id ASC\nLIMIT 100`}
          />
          <div class="flex gap-2 items-center">
            <Button variant="ghost" size="sm" onClick={handlePreview} disabled={!isEdit || preview.isPending}>
              {preview.isPending ? <Loader2 size={14} class="animate-spin mr-1" /> : null}
              Detectar colunas (preview)
            </Button>
            {!isEdit && <span class="text-xs text-fg-muted">Salve o conector primeiro</span>}
          </div>
        </section>

        {/* === MAPPING === */}
        <section class="space-y-2">
          <h3 class="font-medium">Mapping (coluna SQL → campo Lead)</h3>
          {previewCols.length === 0 && Object.keys(form.mapping).length === 0 ? (
            <p class="text-xs text-fg-muted">Use "Detectar colunas" pra preencher automaticamente. Você ainda pode adicionar manualmente abaixo.</p>
          ) : null}
          <div class="space-y-2">
            {Array.from(new Set([...previewCols, ...Object.keys(form.mapping)])).map((col) => (
              <div key={col} class="grid grid-cols-2 gap-3 items-center">
                <code class="text-xs px-2 py-1 bg-bg-subtle rounded truncate">{col}</code>
                <select class={selectCls} value={form.mapping[col] || 'ignore'} onChange={(e: any) => setForm({ ...form, mapping: { ...form.mapping, [col]: e.target.value } })}>
                  {TARGET_OPTIONS.map((o) => <option value={o.value}>{o.label}</option>)}
                  <option value={`cf:${col}`}>Custom field: cf_{col}</option>
                </select>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => {
            const name = prompt('Nome da coluna:')
            if (name) setForm({ ...form, mapping: { ...form.mapping, [name]: 'ignore' } })
          }}>+ Adicionar coluna manualmente</Button>
        </section>

        {/* === DELTA + CRON === */}
        <section class="space-y-3">
          <h3 class="font-medium">Delta + Agendamento</h3>
          <div class="grid grid-cols-3 gap-3">
            <label class="block">
              <span class="text-sm block mb-1">Estratégia delta</span>
              <select class={selectCls} value={form.deltaStrategy || 'id'} onChange={(e: any) => setForm({ ...form, deltaStrategy: e.target.value as any })}>
                <option value="id">ID (auto-incremento)</option>
                <option value="timestamp">Timestamp</option>
                <option value="none">Sem delta (trazer tudo)</option>
              </select>
            </label>
            <Input label="Coluna do cursor" value={form.deltaColumn ?? ''} onInput={(e: any) => setForm({ ...form, deltaColumn: e.target.value })} placeholder="id ou created_at" />
            <Input label="Cursor atual" value={form.lastSyncCursor ?? ''} onInput={(e: any) => setForm({ ...form, lastSyncCursor: e.target.value })} placeholder="ex: 143" />
            <label class="block">
              <span class="text-sm block mb-1">Intervalo (min)</span>
              <select class={selectCls} value={String(form.intervalMinutes ?? 5)} onChange={(e: any) => setForm({ ...form, intervalMinutes: Number(e.target.value) })}>
                <option value="1">1 min</option>
                <option value="5">5 min</option>
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="60">1 hora</option>
              </select>
            </label>
            <label class="block">
              <span class="text-sm block mb-1">Funil padrão</span>
              <select class={selectCls} value={String(form.defaultFunnelId ?? '')} onChange={(e: any) => setForm({ ...form, defaultFunnelId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— Nenhum —</option>
                {funnels.map((f) => <option value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label class="block">
              <span class="text-sm block mb-1">Setor padrão</span>
              <select class={selectCls} value={String(form.defaultTeamId ?? '')} onChange={(e: any) => setForm({ ...form, defaultTeamId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— Nenhum —</option>
                {teams.map((t) => <option value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <Input label="Etapa inicial" value={form.defaultStageKey ?? 'NOVO'} onInput={(e: any) => setForm({ ...form, defaultStageKey: e.target.value })} placeholder="NOVO" />
          </div>
          <label class="flex items-center gap-2">
            <input type="checkbox" checked={form.active !== false} onChange={(e: any) => setForm({ ...form, active: e.target.checked })} />
            <span>Conector ativo</span>
          </label>
        </section>
      </div>
    </Modal>
  )
}

// ─── Histórico modal ─────────────────────────────────────────────────────

function RunsHistoryModal({ connector, onClose }: { connector: DbConnector; onClose: () => void }) {
  const { data, isLoading } = useDbConnectorRuns(connector.id)

  return (
    <Modal open={true} onOpenChange={(o) => !o && onClose()} title={`Histórico: ${connector.name}`} size="xl">
      {isLoading ? <Loader2 class="animate-spin" /> : (
        <div class="space-y-2 max-h-[60vh] overflow-auto">
          {!data?.items.length && <p class="text-fg-muted">Sem runs ainda.</p>}
          {data?.items.map((r) => (
            <Card key={r.id} class="p-3 text-sm">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <Badge tone={r.status === 'ok' ? 'accent' : r.status === 'error' ? 'danger' : r.status === 'partial' ? 'warning' : 'info'}>
                    {r.status}
                  </Badge>
                  <span class="ml-2 text-xs text-fg-muted">{r.triggeredBy}</span>
                </div>
                <span class="text-xs text-fg-muted">{new Date(r.startedAt).toLocaleString('pt-BR')}</span>
              </div>
              <div class="text-xs text-fg-muted mt-1">
                {r.rowsRead} linhas • <strong>{r.leadsCreated}</strong> criados • {r.leadsSkipped} pulados • {r.errorCount} erros
                {r.cursorBefore && r.cursorAfter && r.cursorBefore !== r.cursorAfter && (
                  <> • cursor {r.cursorBefore} → {r.cursorAfter}</>
                )}
              </div>
              {r.error && <div class="text-xs text-red-600 mt-1">{r.error}</div>}
            </Card>
          ))}
        </div>
      )}
    </Modal>
  )
}

// Heurística simples de mapping inicial baseado no nome da coluna
function guessTarget(col: string): string {
  const c = col.toLowerCase()
  if (/^(id|lead_id)$/.test(c)) return 'meta:source_id'
  if (/^(nome|name|first_name|firstname)$/.test(c)) return 'nome'
  if (/^(sobrenome|surname|last_name|lastname)$/.test(c)) return 'concat:nome'
  if (/^(email|e-?mail)$/.test(c)) return 'email'
  if (/^(telefone|phone|whatsapp|celular|mobile|tel)$/.test(c)) return 'whatsapp'
  if (/^(empresa|company|fazenda)$/.test(c)) return 'empresa'
  if (/^(cidade|city)$/.test(c)) return 'cidade'
  if (/^(segmento|segment)$/.test(c)) return 'segmento'
  if (/^(created_at|createdat|criado_em|data_cadastro)$/.test(c)) return 'meta:created_at'
  if (/^(page_url|url)$/.test(c)) return 'meta:page_url'
  if (/^(ip|ip_address)$/.test(c)) return 'meta:ip'
  return 'ignore'
}
