import { useMemo, useState } from 'preact/hooks'
import {
  Megaphone,
  RefreshCw,
  Plug,
  AlertCircle,
  CheckCircle,
  Power,
  Trash2,
  Settings as SettingsIcon,
  Link2,
  Download,
  RotateCcw,
  ScrollText,
  HelpCircle,
  Plus,
} from '@/components/ui/icon-set'
import { useQueryClient } from '@tanstack/react-query'
import { useCreateCustomField } from '@/hooks/useCustomFields'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useMetaStatus,
  useToggleMetaIntegration,
  useDeleteMetaIntegration,
  useSyncMetaForms,
  useUpdateMetaForm,
  usePullMetaLeads,
  useReprocessMetaLeads,
  useUpdateMetaCustomFields,
  useMetaFormFields,
  useMetaLogs,
  type MetaIntegration,
  type MetaForm,
  type MetaLeadLog,
} from '@/hooks/useMeta'
import { useFunnels, useFunnel } from '@/hooks/useFunnels'
import { useTeams } from '@/hooks/useTeams'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { ConnectMetaModal } from '@/components/ConnectMetaModal'
import { formatDateTime, formatRelative } from '@/lib/format'
import { metaFormStatusLabel, metaLogStatusLabel } from '@/lib/statusLabels'
import { toast } from '@/lib/toast'

export function MetaAdsPage() {
  const { data, isLoading } = useMetaStatus()
  const [connectOpen, setConnectOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<MetaIntegration | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  return (
    <Page
      title="Meta Ads"
      description="Páginas conectadas ao Facebook/Instagram e seus formulários de Lead Ads."
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          {data && (
            <Badge tone={data.pollerActive ? 'accent' : 'neutral'}>
              {data.pollerActive ? 'Poller ativo' : 'Poller parado'}
            </Badge>
          )}
          <Button variant="secondary" size="sm" onClick={() => setLogsOpen(true)}>
            <ScrollText size={14} /> Logs
          </Button>
          <Button variant="primary" size="sm" onClick={() => setConnectOpen(true)}>
            <Plug size={14} /> Conectar página
          </Button>
        </>
      }
    >
      {isLoading && (
        <div class="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} class="h-32 w-full" />
          ))}
        </div>
      )}

      {!isLoading && data?.integrations.length === 0 && (
        <EmptyState
          icon={<Megaphone size={24} />}
          title="Nenhuma página conectada"
          description="Conecte uma página do Facebook ou Instagram para receber leads automaticamente."
          action={
            <Button variant="primary" size="sm" onClick={() => setConnectOpen(true)}>
              <Plug size={14} /> Conectar página
            </Button>
          }
        />
      )}

      {!isLoading &&
        data?.integrations.map((integ) => (
          <IntegrationCard key={integ.id} integ={integ} onAskDelete={() => setPendingDelete(integ)} />
        ))}

      <ConnectMetaModal open={connectOpen} onOpenChange={setConnectOpen} />

      {pendingDelete && (
        <DeleteIntegrationDialog
          integration={pendingDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {logsOpen && <MetaLogsModal onClose={() => setLogsOpen(false)} />}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Meta Ads?"
        problem={<>
          Você roda anúncios de <strong>Formulário Instantâneo</strong> (Lead Ads) no Facebook ou
          Instagram. Quem preenche, vira lead no Meta — mas seu vendedor precisa lá fora pra trabalhar.
          Esta tela conecta sua página do Facebook/IG e <strong>traz as leads automaticamente</strong>{' '}
          pro CRM, com tudo já mapeado.
        </>}
        steps={[
          {
            title: '🔌 Conecte sua página',
            body: <>Botão <strong>Conectar página</strong> faz login no Facebook e autoriza o Attrae. Você escolhe quais páginas e contas de anúncio conectar. Pode conectar múltiplas (uma por negócio).</>,
          },
          {
            title: '📋 Sincronize os formulários',
            body: <>Cada formulário de Lead Ad que existir aparece aqui. Configure pra cada um: <strong>funil + etapa de destino</strong>, <strong>equipe responsável</strong> e o <strong>mapeamento de campos</strong> (campo do Meta → campo do lead).</>,
          },
          {
            title: '⚡ Poller traz as leads sozinho',
            body: <>O <strong>Poller</strong> (badge no topo) verifica novos leads a cada minuto. Mostra "Poller ativo" quando está rodando. Cada lead novo vira lead no CRM automaticamente, com origem "meta_lead_ads".</>,
          },
          {
            title: '🔁 Re-puxar e reprocessar',
            body: <>Se algo deu errado (mapeamento errado, lead ficou perdido), você pode <strong>re-pull</strong> dos últimos X dias e <strong>reprocessar</strong> leads já recebidos pra recriar com config nova.</>,
          },
          {
            title: '📜 Logs',
            body: <>Botão <strong>Logs</strong>: histórico de cada lead recebido com status (sucesso, duplicado, erro). Útil pra debugar se um lead específico não chegou.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Antes de conectar',
          body: <>Você precisa ser <strong>admin</strong> da página do Facebook e da conta de anúncios. Se a conexão falhar com permissão, peça pro responsável da página re-autorizar você antes.</>,
        }}
      />
    </Page>
  )
}

interface IntegrationCardProps {
  integ: MetaIntegration
  onAskDelete: () => void
}

function IntegrationCard({ integ, onAskDelete }: IntegrationCardProps) {
  const toggle = useToggleMetaIntegration()
  const sync = useSyncMetaForms()
  const [configForm, setConfigForm] = useState<MetaForm | null>(null)
  const [mappingForm, setMappingForm] = useState<MetaForm | null>(null)
  const [pendingPull, setPendingPull] = useState<MetaForm | null>(null)
  const [pendingReprocess, setPendingReprocess] = useState<MetaForm | null>(null)
  const [pendingUpdateCf, setPendingUpdateCf] = useState<MetaForm | null>(null)

  function handleToggle() {
    toggle.mutate(integ.id, {
      onSuccess: (resp) => toast(resp.active ? 'Integração ativada' : 'Integração desativada', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleSync() {
    sync.mutate(integ.id, {
      onSuccess: (resp) => toast(`Sincronizado: ${resp.total ?? 0} formulários`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const isActive = integ.active !== false

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span class="inline-flex items-center gap-2">
            <Megaphone size={16} class="text-fg-muted" />
            {integ.pageName}
          </span>
        </CardTitle>
        <div class="flex items-center gap-2">
          {integ.tokenStatus === 'valid' ? (
            <Badge tone="accent">
              <CheckCircle size={10} class="mr-0.5 inline" /> Token OK
            </Badge>
          ) : (
            <Badge tone="danger" solid>
              <AlertCircle size={10} class="mr-0.5 inline" /> Token expirado
            </Badge>
          )}
          <Badge tone={isActive ? 'info' : 'neutral'}>{isActive ? 'Ativa' : 'Pausada'}</Badge>
          <Badge tone="info">{integ.leadsReceived} leads</Badge>
        </div>
      </CardHeader>

      <div class="-mt-1 mb-3 flex flex-wrap items-center gap-2 pb-3 border-b border-border">
        <Button variant="secondary" size="sm" onClick={handleSync} disabled={sync.isPending}>
          <RefreshCw size={12} class={sync.isPending ? 'animate-spin' : ''} />
          {sync.isPending ? 'Sincronizando…' : 'Sincronizar formulários'}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleToggle} disabled={toggle.isPending}>
          <Power size={12} /> {isActive ? 'Pausar' : 'Reativar'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onAskDelete} class="sm:ml-auto">
          <Trash2 size={12} /> Desconectar
        </Button>
      </div>

      {integ.tokenError && (
        <div class="mb-3 rounded-md bg-danger/10 px-2 py-1.5 text-xs text-danger">
          {integ.tokenError}
        </div>
      )}

      {integ.forms.length === 0 ? (
        <p class="text-sm text-fg-muted">
          Nenhum formulário sincronizado. Clique em "Sincronizar formulários".
        </p>
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-surface-3 text-3xs uppercase tracking-wider text-fg-muted">
              <tr>
                <th class="px-3 py-1.5 text-left font-medium">Formulário</th>
                <th class="px-3 py-1.5 text-left font-medium">Status</th>
                <th class="px-3 py-1.5 text-left font-medium">Funil/stage</th>
                <th class="px-3 py-1.5 text-right font-medium">Leads</th>
                <th class="px-3 py-1.5 text-left font-medium">Último</th>
                <th class="px-3 py-1.5 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {integ.forms.map((f) => (
                <tr key={f.id} class="group">
                  <td class="max-w-[14rem] truncate px-3 py-1.5 text-fg" title={f.formName}>
                    {f.formName}
                  </td>
                  <td class="px-3 py-1.5">
                    <Badge tone={f.status === 'ACTIVE' || f.status === 'active' ? 'accent' : 'neutral'}>{metaFormStatusLabel(f.status)}</Badge>
                  </td>
                  <td class="px-3 py-1.5 text-xs text-fg-muted">
                    {f.funnelId ? `#${f.funnelId} / ${f.stageKey ?? '—'}` : '—'}
                  </td>
                  <td class="px-3 py-1.5 text-right tabular-nums text-fg">{f.leadsReceived}</td>
                  <td class="px-3 py-1.5 text-xs text-fg-muted">
                    {f.lastLeadAt ? formatRelative(f.lastLeadAt) : '—'}
                  </td>
                  <td class="px-3 py-1.5 text-right">
                    <div class="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                        onClick={() => setConfigForm(f)}
                        aria-label="Configurar form"
                        title="Configurar funil/stage"
                      >
                        <SettingsIcon size={12} />
                      </button>
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                        onClick={() => setMappingForm(f)}
                        aria-label="Mapear campos"
                        title="Mapear campos Meta → Lead"
                      >
                        <Link2 size={12} />
                      </button>
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                        onClick={() => setPendingPull(f)}
                        aria-label="Puxar leads"
                        title="Puxar leads existentes via Graph API"
                      >
                        <Download size={12} />
                      </button>
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                        onClick={() => setPendingReprocess(f)}
                        aria-label="Reprocessar"
                        title="Reaplicar mapeamento atual aos leads existentes"
                      >
                        <RotateCcw size={12} />
                      </button>
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                        onClick={() => setPendingUpdateCf(f)}
                        aria-label="Atualizar campos personalizados"
                        title="Atualizar campos personalizados dos leads já puxados (após mapear)"
                      >
                        <RefreshCw size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {configForm && <MetaFormConfigModal form={configForm} onClose={() => setConfigForm(null)} />}
      {mappingForm && <MetaFormMappingModal form={mappingForm} onClose={() => setMappingForm(null)} />}
      {pendingPull && <PullLeadsDialog form={pendingPull} onClose={() => setPendingPull(null)} />}
      {pendingReprocess && <ReprocessLeadsDialog form={pendingReprocess} onClose={() => setPendingReprocess(null)} />}
      {pendingUpdateCf && <UpdateCustomFieldsDialog form={pendingUpdateCf} onClose={() => setPendingUpdateCf(null)} />}
    </Card>
  )
}

// ── Config modal: funil + stage + autoComplete + status ───────────────

function MetaFormConfigModal({ form, onClose }: { form: MetaForm; onClose: () => void }) {
  const [funnelId, setFunnelId] = useState(form.funnelId ? String(form.funnelId) : '')
  const [stageKey, setStageKey] = useState(form.stageKey ?? '')
  const [defaultTeamId, setDefaultTeamId] = useState(form.defaultTeamId ? String(form.defaultTeamId) : '')
  const [status, setStatus] = useState(form.status || 'active')
  const update = useUpdateMetaForm()
  const { data: funnels } = useFunnels()
  const { data: funnel } = useFunnel(funnelId ? Number(funnelId) : null)
  const { data: teamsData } = useTeams()
  const teams = (teamsData?.teams ?? []).filter((t) => t.active)

  function handleSave() {
    update.mutate({
      id: form.id,
      funnelId: funnelId ? Number(funnelId) : null,
      stageKey: stageKey || null,
      defaultTeamId: defaultTeamId ? Number(defaultTeamId) : null,
      status,
    }, {
      onSuccess: () => { toast('Configuração salva', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Configurar "${form.formName}"`}
      description="Defina o funil/etapa de destino e o status do formulário."
      size="lg"
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
        <Select label="Funil de destino" value={funnelId} onChange={(e) => { setFunnelId((e.target as HTMLSelectElement).value); setStageKey('') }}>
          <option value="">Sem funil (usa fluxo padrão)</option>
          {funnels?.funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <Select label="Etapa inicial" value={stageKey} onChange={(e) => setStageKey((e.target as HTMLSelectElement).value)} disabled={!funnel}>
          <option value="">{funnel ? 'Selecione…' : 'Selecione um funil primeiro'}</option>
          {funnel?.stages.map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
        </Select>
        <Select
          label="Setor padrão (opcional)"
          value={defaultTeamId}
          onChange={(e) => setDefaultTeamId((e.target as HTMLSelectElement).value)}
          hint="Leads desta campanha caem direto neste setor. Se vazio, usa o setor padrão global."
        >
          <option value="">Usar setor padrão global</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select label="Status" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="active">Ativo</option>
          <option value="paused">Pausado</option>
        </Select>
      </div>
    </Modal>
  )
}

// ── Mapping modal: Meta fields → Lead fields ───────────────────────────

function MetaFormMappingModal({ form, onClose }: { form: MetaForm; onClose: () => void }) {
  const { data, isLoading } = useMetaFormFields(form.id)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [hydrated, setHydrated] = useState(false)
  const update = useUpdateMetaForm()
  const qc = useQueryClient()
  const createField = useCreateCustomField()
  const [creatingKey, setCreatingKey] = useState<string | null>(null)

  // Normaliza igual ao backend (customFields.ts) p/ prever a key gerada.
  function normalizeKey(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 100)
  }
  function humanize(key: string): string {
    return key
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
  }
  function inferType(metaType: string): string {
    const t = (metaType || '').toUpperCase()
    if (t.includes('EMAIL')) return 'email'
    if (t.includes('PHONE')) return 'phone'
    if (t.includes('DATE')) return 'date'
    if (t.includes('NUMBER') || t.includes('NUMERIC')) return 'number'
    return 'text'
  }

  // Cria um custom field com o NOME do campo Meta e já o seleciona como
  // destino. Idempotente: se já existir um cf com a mesma key, só mapeia.
  async function createAndMap(mf: { key: string; label?: string; type: string }) {
    if (!data) return
    const label = (mf.label || '').trim() || humanize(mf.key)
    const key = normalizeKey(mf.key)
    const existing = data.leadFields.find((lf) => lf.key === `cf_${key}`)
    if (existing) {
      setMapping((m) => ({ ...m, [mf.key]: existing.key }))
      toast(`Campo "${label}" já existia — mapeado`, 'info')
      return
    }
    setCreatingKey(mf.key)
    try {
      let resp
      try {
        resp = await createField.mutateAsync({
          key,
          label,
          type: inferType(mf.type),
          group: 'custom',
          showInForm: true,
          showInList: false,
          showInKanban: false,
        })
      } catch (e) {
        // Código em uso (campo possivelmente inativo): tenta sem key fixa,
        // backend gera uma única automaticamente — nunca sobrescreve nada.
        if ((e as { status?: number }).status === 409) {
          resp = await createField.mutateAsync({
            key: '',
            label,
            type: inferType(mf.type),
            group: 'custom',
            showInForm: true,
            showInList: false,
            showInKanban: false,
          })
        } else {
          throw e
        }
      }
      const newKey = resp.field.key
      await qc.invalidateQueries({ queryKey: ['meta-form-fields'] })
      setMapping((m) => ({ ...m, [mf.key]: `cf_${newKey}` }))
      toast(`Campo "${label}" criado e mapeado`, 'success')
    } catch (e: unknown) {
      toast((e as Error).message || 'Falha ao criar campo', 'danger')
    } finally {
      setCreatingKey(null)
    }
  }

  // Hidrata uma vez com mapping atual + autoSuggest
  if (data && !hydrated) {
    setMapping({ ...data.autoSuggest, ...data.currentMapping })
    setHydrated(true)
  }

  function handleSave() {
    update.mutate({ id: form.id, fieldMapping: mapping }, {
      onSuccess: () => { toast('Mapeamento salvo', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function applyAutoSuggest() {
    if (!data) return
    setMapping((m) => ({ ...m, ...data.autoSuggest }))
    toast('Sugestões aplicadas', 'info')
  }

  const unmapped = useMemo(() => {
    if (!data) return 0
    return data.metaFields.filter((mf) => !mapping[mf.key] || mapping[mf.key] === '_ignore').length
  }, [data, mapping])

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Mapear campos de "${form.formName}"`}
      description="Para cada campo do formulário Meta, escolha onde o valor será salvo no Lead. Use 'ignorar' para descartar e 'dados extras' para guardar em formData."
      size="xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={applyAutoSuggest} disabled={isLoading || !data}>
            Aplicar sugestões
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={update.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending || isLoading}>
            {update.isPending ? 'Salvando…' : 'Salvar mapeamento'}
          </Button>
        </>
      }
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && data?.metaFields.length === 0 && (
        <div class="text-sm text-fg-muted text-center py-6">
          Sem campos catalogados ainda. Sincronize os formulários e tente novamente.
        </div>
      )}
      {!isLoading && data && data.metaFields.length > 0 && (
        <div class="space-y-2">
          {unmapped > 0 && (
            <div class="text-xs text-warning bg-warning/10 px-2 py-1.5 rounded-md">
              {unmapped} campo(s) sem destino. Clique em "Aplicar sugestões" ou ajuste manualmente.
            </div>
          )}
          <div class="text-2xs text-fg-muted flex items-center gap-1">
            <Plus size={12} class="shrink-0" />
            Sem destino na lista? Use o botão ao lado do campo para criar um campo personalizado com o mesmo nome e já mapear.
          </div>
          <table class="w-full text-sm">
            <thead class="bg-surface-3 text-3xs uppercase tracking-wider text-fg-muted">
              <tr>
                <th class="px-3 py-2 text-left font-medium">Campo do Meta</th>
                <th class="px-3 py-2 text-left font-medium">Tipo</th>
                <th class="px-3 py-2 text-left font-medium">Destino no Lead</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {data.metaFields.map((mf) => (
                <tr key={mf.key}>
                  <td class="px-3 py-2 font-mono text-xs text-fg">{mf.key}</td>
                  <td class="px-3 py-2 text-xs text-fg-muted">{mf.type}</td>
                  <td class="px-3 py-2">
                    <div class="flex items-center gap-1.5">
                      <select
                        class="h-8 px-2 text-sm rounded-md bg-surface border border-border text-fg focus:outline-none focus:border-accent w-full"
                        value={mapping[mf.key] ?? ''}
                        onChange={(e) => setMapping((m) => ({ ...m, [mf.key]: (e.target as HTMLSelectElement).value }))}
                      >
                        <option value="">— escolher —</option>
                        {data.leadFields.map((lf) => (
                          <option key={lf.key} value={lf.key}>{lf.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        title="Criar campo personalizado com o nome deste campo Meta e mapear"
                        disabled={creatingKey !== null}
                        onClick={() => createAndMap(mf)}
                        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-50"
                      >
                        {creatingKey === mf.key
                          ? <RefreshCw size={14} class="animate-spin" />
                          : <Plus size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

// ── Pull/Reprocess confirms ────────────────────────────────────────────

function PullLeadsDialog({ form, onClose }: { form: MetaForm; onClose: () => void }) {
  const pull = usePullMetaLeads()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Puxar leads de "${form.formName}"?`}
      description="Vai buscar os últimos 100 leads desse formulário pela Graph API e processá-los conforme o mapeamento atual. Leads já processados são ignorados."
      confirmLabel="Puxar agora"
      loading={pull.isPending}
      onConfirm={() => pull.mutate(form.id, {
        onSuccess: (r) => {
          toast(`Total ${r.total} · criados ${r.created} · ignorados ${r.skipped} · falhas ${r.failed}`, r.failed > 0 ? 'warning' : 'success')
          onClose()
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

function ReprocessLeadsDialog({ form, onClose }: { form: MetaForm; onClose: () => void }) {
  const reprocess = useReprocessMetaLeads()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Reprocessar leads de "${form.formName}"?`}
      description="Reaplica o mapeamento atual aos leads já processados. Campos vazios no Lead recebem valores; campos preenchidos NÃO são sobrescritos. Custom fields são mesclados."
      confirmLabel="Reprocessar"
      loading={reprocess.isPending}
      onConfirm={() => reprocess.mutate(form.id, {
        onSuccess: (r) => {
          toast(`Total ${r.total} · atualizados ${r.updated} · ignorados ${r.skipped}`, 'success')
          onClose()
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

function UpdateCustomFieldsDialog({ form, onClose }: { form: MetaForm; onClose: () => void }) {
  const updateCf = useUpdateMetaCustomFields()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Atualizar campos personalizados de "${form.formName}"?`}
      description="Preenche os campos personalizados dos leads já puxados usando o mapeamento atual e o conteúdo original do formulário Meta. Só preenche campos personalizados vazios — não sobrescreve valores existentes nem mexe em nome/e-mail/telefone. Use após mapear campos que ficaram sem destino quando os leads foram puxados."
      confirmLabel="Atualizar campos"
      loading={updateCf.isPending}
      onConfirm={() => updateCf.mutate(form.id, {
        onSuccess: (r) => {
          toast(
            r.message
              ? r.message
              : `Total ${r.total} · atualizados ${r.updated} · ignorados ${r.skipped}`,
            r.message ? 'warning' : 'success',
          )
          onClose()
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

// ── Logs modal ─────────────────────────────────────────────────────────

function MetaLogsModal({ onClose }: { onClose: () => void }) {
  const [statusFilter, setStatusFilter] = useState<'' | 'received' | 'processed' | 'failed'>('')
  const filters = statusFilter ? { status: statusFilter, limit: 100 } : { limit: 100 }
  const { data, isLoading } = useMetaLogs(filters)

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Logs de leads do Meta"
      description={data ? `Mostrando ${data.logs.length} de ${data.total} registros` : 'Carregando…'}
      size="xl"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-3">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value as '' | 'received' | 'processed' | 'failed')}
          label="Filtrar por status"
        >
          <option value="">Todos</option>
          <option value="received">Recebido</option>
          <option value="processed">Processado</option>
          <option value="failed">Falhou</option>
        </Select>

        {isLoading && <Skeleton class="h-32 w-full" />}
        {!isLoading && data?.logs.length === 0 && (
          <div class="text-sm text-fg-muted text-center py-6">Sem registros para esse filtro.</div>
        )}
        {!isLoading && data && data.logs.length > 0 && (
          <div class="overflow-x-auto -mx-4 max-h-[60dvh]">
            <table class="w-full text-sm">
              <thead class="bg-surface-3 text-3xs uppercase tracking-wider text-fg-muted sticky top-0">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">Status</th>
                  <th class="px-3 py-2 text-left font-medium">Meta lead ID</th>
                  <th class="px-3 py-2 text-left font-medium">Form ID</th>
                  <th class="px-3 py-2 text-right font-medium">Lead</th>
                  <th class="px-3 py-2 text-left font-medium">Erro</th>
                  <th class="px-3 py-2 text-left font-medium">Quando</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {data.logs.map((log) => <LogRow key={log.id} log={log} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}

function LogRow({ log }: { log: MetaLeadLog }) {
  const tone =
    log.status === 'processed' ? 'success' :
    log.status === 'failed' ? 'danger' :
    log.status === 'received' ? 'info' : 'neutral'
  return (
    <tr class="hover:bg-surface-3">
      <td class="px-3 py-1.5"><Badge tone={tone} solid={tone !== 'neutral'}>{metaLogStatusLabel(log.status)}</Badge></td>
      <td class="px-3 py-1.5 font-mono text-xs text-fg-muted truncate max-w-32">{log.metaLeadId}</td>
      <td class="px-3 py-1.5 font-mono text-xs text-fg-muted truncate max-w-32">{log.metaFormId}</td>
      <td class="px-3 py-1.5 text-right tabular-nums text-xs text-fg">
        {log.leadId ? `#${log.leadId}` : '—'}
      </td>
      <td class="px-3 py-1.5 text-xs text-danger truncate max-w-48" title={log.errorMessage ?? undefined}>
        {log.errorMessage ?? '—'}
      </td>
      <td class="px-3 py-1.5 text-xs text-fg-muted whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
    </tr>
  )
}

interface DeleteIntegrationDialogProps {
  integration: MetaIntegration
  onClose: () => void
}

function DeleteIntegrationDialog({ integration, onClose }: DeleteIntegrationDialogProps) {
  const remove = useDeleteMetaIntegration()

  function handleConfirm() {
    remove.mutate(integration.id, {
      onSuccess: () => {
        toast(`Integração "${integration.pageName}" removida`, 'success')
        onClose()
      },
      onError: (e: unknown) => {
        toast((e as Error).message, 'danger')
        onClose()
      },
    })
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Desconectar "${integration.pageName}"?`}
      description="Os formulários sincronizados serão removidos da página. O histórico de leads é preservado e você pode reconectar a qualquer momento."
      confirmLabel="Desconectar"
      destructive
      onConfirm={handleConfirm}
      loading={remove.isPending}
    />
  )
}
