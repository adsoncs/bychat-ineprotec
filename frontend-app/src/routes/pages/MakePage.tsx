import { useMemo, useState } from 'preact/hooks'
import {
  Boxes,
  Download,
  FileJson,
  ExternalLink,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  KeyRound,
  Activity,
  TriangleAlert,
  HelpCircle,
} from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { useWebhooks, useDeleteWebhook } from '@/hooks/useWebhooks'
import { useMakeAppDefinition } from '@/hooks/useMake'
import { useApiKeys } from '@/hooks/useApiKeys'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { downloadFile } from '@/lib/download'
import { formatRelative } from '@/lib/format'
import { toast } from '@/lib/toast'
import type { Webhook } from '@/hooks/useWebhooks'

const TRIGGERS = [
  'lead.created',
  'lead.stage_changed',
  'lead.tag_added',
  'lead.closed',
  'message.received',
  'message.sent',
  'sale.detected',
  'activity.completed',
]

const ACTIONS = [
  'Criar lead',
  'Atualizar lead',
  'Mover para etapa',
  'Adicionar etiqueta',
  'Enviar mensagem WhatsApp',
  'Encontrar lead (busca)',
]

const REQUIRED_PERMS = ['leads:read', 'leads:write', 'tags:read', 'tags:write', 'webhooks:manage'] as const

export function MakePage() {
  const { data, isLoading, refetch, isFetching } = useWebhooks()
  const { data: apiKeysData } = useApiKeys()
  const [jsonOpen, setJsonOpen] = useState(false)
  const [removeHook, setRemoveHook] = useState<Webhook | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const makeHooks = useMemo(
    () => (data?.data ?? []).filter((w) => w.name.startsWith('make:')),
    [data],
  )

  // Verifica se já existe alguma API Key com TODAS as permissões necessárias para o Make
  const apiKeyStatus = useMemo(() => {
    const keys = apiKeysData?.data ?? []
    const ready = keys.filter((k) => k.active && REQUIRED_PERMS.every((p) => k.permissions.includes(p)))
    return { keys, ready, count: keys.length, hasReady: ready.length > 0 }
  }, [apiKeysData])

  // KPIs agregados dos hooks Make
  const kpi = useMemo(() => {
    const totalSent = makeHooks.reduce((s, h) => s + (h.totalSent || 0), 0)
    const totalFailed = makeHooks.reduce((s, h) => s + (h.totalFailed || 0), 0)
    const total = totalSent + totalFailed
    const successRate = total > 0 ? Math.round((totalSent / total) * 100) : null
    const lastSent = makeHooks
      .map((h) => h.lastSentAt ? new Date(h.lastSentAt).getTime() : 0)
      .reduce((a, b) => Math.max(a, b), 0)
    return {
      totalSent,
      totalFailed,
      successRate,
      lastSentAt: lastSent > 0 ? new Date(lastSent).toISOString() : null,
    }
  }, [makeHooks])

  async function handleDownloadZip() {
    setDownloading(true)
    try {
      await downloadFile('/admin/make/app.zip', 'bychat-beyond-make-app.zip')
      toast('Pacote baixado', 'success')
    } catch (e: unknown) {
      const msg = (e as Error).message
      if (msg.includes('404')) {
        toast('Pacote não gerado. Rode installer/make-app/pack.sh no servidor.', 'warning')
      } else {
        toast(msg, 'danger')
      }
    } finally {
      setDownloading(false)
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <Page
      title="Make.com"
      description="Conecte o ByChat Beyond ao Make e automatize com 7000+ apps."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={14} class={isFetching ? 'animate-spin' : ''} /> Atualizar
          </Button>
        </div>
      }
    >
      {/* Hero */}
      <Card class="bg-gradient-to-br from-accent/10 to-surface-3">
        <div class="flex items-start gap-3">
          <div class="size-10 rounded-md bg-accent/20 grid place-items-center text-accent shrink-0">
            <Boxes size={20} />
          </div>
          <div class="flex-1">
            <CardTitle class="mb-1">Integração oficial Make.com</CardTitle>
            <p class="text-sm text-fg-muted leading-relaxed">
              Triggers instantâneos (lead criado, venda detectada, mensagem recebida) e actions
              (criar lead, enviar WhatsApp, mover etapa) já estão prontos via API. Configure uma
              vez e o Make conecta o ByChat ao Google Sheets, Slack, HubSpot, Stripe, Notion, e
              7000+ apps.
            </p>
          </div>
        </div>
      </Card>

      {/* API Key check */}
      <ApiKeyStatusBanner
        hasReady={apiKeyStatus.hasReady}
        readyCount={apiKeyStatus.ready.length}
        totalCount={apiKeyStatus.count}
      />

      {/* Como conectar */}
      <Card>
        <CardHeader>
          <CardTitle>Como conectar</CardTitle>
        </CardHeader>
        <ol class="space-y-2 text-sm text-fg-muted list-decimal pl-5">
          <li>
            Crie uma <strong class="text-fg">API Key</strong> em{' '}
            <a href="/app/settings#api-keys" class="text-accent hover:underline">
              Configurações &gt; API Keys
            </a>{' '}
            com as permissões{' '}
            <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">leads:read</code>,{' '}
            <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">leads:write</code>,{' '}
            <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">tags:read</code>,{' '}
            <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">tags:write</code>,{' '}
            <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">webhooks:manage</code>.
          </li>
          <li>
            Acesse o{' '}
            <a
              href="https://www.make.com/en/apps"
              target="_blank"
              rel="noreferrer"
              class="text-accent hover:underline inline-flex items-center gap-1"
            >
              Make <ExternalLink size={11} />
            </a>{' '}
            e crie um novo cenário.
          </li>
          <li>
            Escolha o app <strong class="text-fg">ByChat Beyond</strong> ou importe o pacote oficial
            (botão abaixo) em modo Developer.
          </li>
          <li>
            No formulário de <strong class="text-fg">Connection</strong>, preencha:
            <ul class="list-disc pl-5 mt-1 space-y-0.5">
              <li>
                <strong class="text-fg">URL:</strong>{' '}
                <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">{origin}</code>
              </li>
              <li>
                <strong class="text-fg">API Key:</strong> a chave gerada no passo 1 (começa com{' '}
                <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">byc_</code>).
              </li>
            </ul>
          </li>
          <li>
            O Make valida via{' '}
            <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">GET /api/make/ping</code>
            . Pronto.
          </li>
        </ol>
      </Card>

      {/* Triggers + Actions */}
      <div class="grid gap-3 grid-cols-1 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Triggers disponíveis</CardTitle>
          </CardHeader>
          <ul class="space-y-1.5">
            {TRIGGERS.map((t) => (
              <li key={t} class="text-xs">
                <code class="bg-accent/10 text-accent px-1.5 py-0.5 rounded font-mono">{t}</code>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Actions disponíveis</CardTitle>
          </CardHeader>
          <ul class="space-y-1.5">
            {ACTIONS.map((a) => (
              <li key={a} class="text-xs text-fg-muted">
                • {a}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Hooks registrados pelo Make */}
      <Card>
        <CardHeader>
          <CardTitle>
            Hooks registrados pelo Make ·{' '}
            <span class="text-fg-muted font-normal">{makeHooks.length} ativos</span>
          </CardTitle>
        </CardHeader>

        {!isLoading && makeHooks.length > 0 && (
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <KpiCell label="Eventos enviados" value={kpi.totalSent.toLocaleString('pt-BR')} />
            <KpiCell label="Falhas" value={kpi.totalFailed.toLocaleString('pt-BR')} tone={kpi.totalFailed > 0 ? 'danger' : 'neutral'} />
            <KpiCell label="Sucesso" value={kpi.successRate !== null ? `${kpi.successRate}%` : '—'} tone={
              kpi.successRate === null ? 'neutral' : kpi.successRate >= 95 ? 'success' : kpi.successRate >= 80 ? 'warning' : 'danger'
            } />
            <KpiCell label="Último envio" value={kpi.lastSentAt ? formatRelative(kpi.lastSentAt) : '—'} />
          </div>
        )}

        {isLoading && <Skeleton class="h-24 w-full" />}
        {!isLoading && makeHooks.length === 0 && (
          <EmptyState
            icon={<Boxes size={24} />}
            title="Nenhum webhook registrado pelo Make"
            description="Crie um cenário no Make com um gatilho do ByChat Beyond — o webhook aparece aqui."
          />
        )}
        {!isLoading && makeHooks.length > 0 && (
          <div class="overflow-x-auto -mx-4">
            <table class="w-full text-sm">
              <thead class="bg-surface-3 text-3xs uppercase tracking-wider text-fg-muted">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">Eventos</th>
                  <th class="px-3 py-2 text-left font-medium">URL</th>
                  <th class="px-3 py-2 text-right font-medium">Enviados</th>
                  <th class="px-3 py-2 text-right font-medium">Falhas</th>
                  <th class="px-3 py-2 text-left font-medium">Último</th>
                  <th class="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {makeHooks.map((h) => (
                  <tr key={h.id} class="hover:bg-surface-3 group">
                    <td class="px-3 py-1.5">
                      <div class="flex flex-wrap gap-1">
                        {h.events.map((ev) => (
                          <Badge key={ev} tone="info">
                            {ev}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td
                      class="px-3 py-1.5 font-mono text-2xs text-fg-muted truncate max-w-[20rem]"
                      title={h.url}
                    >
                      {h.url}
                    </td>
                    <td class="px-3 py-1.5 text-right tabular-nums text-fg">{h.totalSent}</td>
                    <td
                      class={`px-3 py-1.5 text-right tabular-nums ${h.totalFailed > 0 ? 'text-danger' : 'text-fg'}`}
                    >
                      {h.totalFailed}
                    </td>
                    <td class="px-3 py-1.5 text-xs text-fg-muted">
                      {h.lastSentAt ? formatRelative(h.lastSentAt) : '—'}
                    </td>
                    <td class="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setRemoveHook(h)}
                        aria-label="Remover hook"
                        title="Remover hook"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div class="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 flex items-start gap-2">
          <TriangleAlert size={14} class="text-warning shrink-0 mt-0.5" />
          <p class="text-2xs text-fg leading-relaxed">
            <strong>Dica:</strong> os hooks desta lista são criados automaticamente pelo Make
            quando você adiciona um trigger num cenário. Não edite aqui manualmente — para
            webhooks de outros sistemas use{' '}
            <a href="/app/settings#webhooks" class="text-accent hover:underline">Webhooks</a>.
          </p>
        </div>
      </Card>

      {/* Publicar app */}
      <Card>
        <CardHeader>
          <CardTitle>Publicar o app ByChat Beyond no Make</CardTitle>
        </CardHeader>
        <p class="text-sm text-fg-muted mb-3 leading-relaxed">
          O Make tem um conceito de <strong class="text-fg">Custom App</strong>. Em vez de cada
          cliente configurar webhooks manualmente, você cria um app no Developer Hub — clientes
          conectam com 2 cliques informando só URL e API Key.
        </p>

        <div class="grid gap-2 grid-cols-1 md:grid-cols-3 mb-3">
          <ModeCard
            title="Modo 1 — Privado"
            tone="accent"
            text="30 minutos. Link de invite. Para uso interno ou com clientes diretos. Sem review da Make."
          />
          <ModeCard
            title="Modo 2 — Marketplace"
            tone="info"
            text="2-4 semanas de review. Listado publicamente. Exige ícones 512px, screenshots, privacy policy e demo account."
          />
          <ModeCard
            title="Modo 3 — SDK"
            tone="muted"
            text="Não recomendado. /api/make/* já é completo — usar SDK seria reinventar o que existe."
          />
        </div>

        {/* Passo a passo Modo 1 — Privado */}
        <div class="rounded-md border border-accent/30 bg-accent/5 p-3 mt-4">
          <div class="text-xs font-semibold text-fg mb-2">
            Passo a passo — Modo 1 (Privado)
          </div>
          <ol class="list-decimal pl-5 space-y-1.5 text-xs text-fg-muted leading-relaxed">
            <li>
              Acesse{' '}
              <a href="https://www.make.com/en/apps/manage" target="_blank" rel="noreferrer" class="text-accent hover:underline">
                make.com/en/apps/manage
              </a>{' '}
              (precisa de plano Pro ou superior).
            </li>
            <li>Clique em <strong class="text-fg">Create a new app</strong> → tipo <strong class="text-fg">Private app</strong>.</li>
            <li>
              Baixe o pacote oficial e use <strong class="text-fg">Import app definition</strong> para colar tudo de uma vez,
              ou cole JSON por JSON nas abas:
              <ul class="list-disc pl-5 mt-1 space-y-0.5">
                <li><strong class="text-fg">General</strong> → <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">app.iml.json</code></li>
                <li><strong class="text-fg">Base</strong> → <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">base.iml.json</code></li>
                <li><strong class="text-fg">Connections</strong> → <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">connection.iml.json</code> (tipo "API Key auth")</li>
                <li><strong class="text-fg">Modules → Triggers</strong> → JSONs em <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">triggers/</code></li>
                <li><strong class="text-fg">Modules → Actions</strong> → JSONs em <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">actions/</code></li>
                <li><strong class="text-fg">Modules → Searches</strong> → <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">find-lead.iml.json</code></li>
              </ul>
            </li>
            <li>
              Em <strong class="text-fg">Collaborators → Invite</strong>, o Make gera um link estilo{' '}
              <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">make.com/en/hq/apps/bychat-beyond?invite=…</code>.
            </li>
            <li>
              Cada cliente que abrir esse link vê o app na lista. Ao criar cenário, ele só preenche
              <strong class="text-fg"> Base URL</strong> + <strong class="text-fg">API Key</strong> (geradas no ByChat).
            </li>
          </ol>
        </div>

        <div class="flex flex-wrap gap-2 mt-4">
          <Button variant="primary" size="sm" onClick={() => void handleDownloadZip()} disabled={downloading}>
            <Download size={14} /> {downloading ? 'Baixando…' : 'Baixar pacote oficial (.zip)'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setJsonOpen(true)}>
            <FileJson size={14} /> Ver JSONs consolidados
          </Button>
          <a
            href="https://www.make.com/en/apps/manage"
            target="_blank"
            rel="noreferrer"
            class="inline-flex items-center gap-1 px-3 h-8 rounded-md text-sm bg-surface border border-border text-fg-muted hover:text-fg hover:border-fg-muted transition-colors"
          >
            Abrir Developer Hub <ExternalLink size={12} />
          </a>
        </div>

        {/* Requisitos Modo 2 — Marketplace */}
        <details class="mt-4 rounded-md border border-border bg-surface">
          <summary class="cursor-pointer px-3 py-2 text-xs font-semibold text-fg flex items-center justify-between">
            <span>Requisitos para publicação pública (Modo 2 — Marketplace)</span>
            <span class="text-fg-muted font-normal text-2xs">expandir</span>
          </summary>
          <ul class="px-5 py-3 list-disc space-y-1 text-xs text-fg-muted leading-relaxed">
            <li>App testado com 5+ cenários reais por ≥1 semana</li>
            <li>Ícones: PNG 512×512 colorido + monocromático branco + SVG</li>
            <li>Capturas de tela: mínimo 3 (16:9) mostrando módulos em uso</li>
            <li>Descrições em inglês (máx 2000 caracteres)</li>
            <li>URLs públicas de <strong class="text-fg">Política de Privacidade</strong> e <strong class="text-fg">Termos de Serviço</strong></li>
            <li>E-mail de suporte ativo</li>
            <li>Conta de demonstração com credenciais funcionais para o revisor do Make testar</li>
            <li>Envio via Developer Hub → revisão em 14-30 dias úteis</li>
          </ul>
        </details>
      </Card>

      {jsonOpen && <JsonViewerModal onClose={() => setJsonOpen(false)} />}
      {removeHook && <RemoveHookDialog hook={removeHook} onClose={() => setRemoveHook(null)} />}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Make.com?"
        problem={<>
          O Make (antigo Integromat) é uma plataforma de automação que conecta <strong>7000+ apps</strong>.
          Você quer mandar leads do ByChat pro HubSpot? Avisar Slack quando alguém compra? Salvar
          contato no Notion? Em vez de pedir desenvolvedor, monta no Make em minutos.
        </>}
        steps={[
          {
            title: '🔑 Crie uma API Key',
            body: <>Pra autenticar o Make no ByChat, você precisa de uma <strong>API Key</strong> com permissões adequadas. O sistema te avisa se ainda não tem — basta criar em <strong>Integrações › API Keys</strong>.</>,
          },
          {
            title: '⚡ Use os triggers (eventos)',
            body: <>O Make ouve eventos do ByChat: <strong>lead criado, mudou de etapa, virou venda, recebeu mensagem, foi etiquetado</strong>. Cada vez que o evento acontece, dispara o cenário no Make.</>,
          },
          {
            title: '🛠️ Use as actions (comandos)',
            body: <>Do Make, você manda comandos pro ByChat: <strong>criar lead, atualizar campo, mover etapa, enviar WhatsApp, adicionar etiqueta</strong>. Ideal pra trazer dados de outras ferramentas.</>,
          },
          {
            title: '🔗 Webhooks visíveis aqui',
            body: <>Cada webhook que o Make registrou aparece na lista. Você vê: qual evento ele ouve, última execução, se está ativo. Pode remover daqui se algum cenário ficou órfão.</>,
          },
          {
            title: '📦 App oficial em revisão',
            body: <>Existe um app ByChat no Make em desenvolvimento (esperando aprovação da equipe Make). Enquanto isso, você usa via webhook genérico + API Key — funciona igual.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Exemplo prático',
          body: <>Cenário comum: "quando lead virar venda no ByChat → criar fatura no Asaas → enviar PIX por WhatsApp → adicionar em planilha mensal". Tudo isso no Make, sem código, encadeando módulos.</>,
        }}
      />
    </Page>
  )
}

function ApiKeyStatusBanner({
  hasReady, readyCount, totalCount,
}: { hasReady: boolean; readyCount: number; totalCount: number }) {
  if (hasReady) {
    return (
      <Card class="border-success/30 bg-success/5">
        <div class="flex items-start gap-2">
          <CheckCircle size={14} class="text-success shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0 text-xs text-fg leading-relaxed">
            <strong class="text-fg">{readyCount} API Key(s)</strong> prontas para o Make
            (com todas as permissões necessárias). Use uma delas no campo <em>API Key</em> da Connection.
            <a href="/app/settings#api-keys" class="ml-2 text-accent hover:underline inline-flex items-center gap-0.5">
              Gerenciar <ExternalLink size={10} />
            </a>
          </div>
        </div>
      </Card>
    )
  }
  if (totalCount === 0) {
    return (
      <Card class="border-warning/40 bg-warning/10">
        <div class="flex items-start gap-2">
          <AlertTriangle size={14} class="text-warning shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0 text-xs text-fg leading-relaxed">
            <strong class="text-fg">Nenhuma API Key criada.</strong>{' '}
            O Make precisa de uma API Key com permissões{' '}
            <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">leads:*</code>,{' '}
            <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">tags:*</code> e{' '}
            <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">webhooks:manage</code>.
            <a href="/app/settings#api-keys" class="ml-1 text-accent hover:underline inline-flex items-center gap-0.5">
              <KeyRound size={10} /> Criar API Key
            </a>
          </div>
        </div>
      </Card>
    )
  }
  return (
    <Card class="border-warning/40 bg-warning/10">
      <div class="flex items-start gap-2">
        <AlertTriangle size={14} class="text-warning shrink-0 mt-0.5" />
        <div class="flex-1 min-w-0 text-xs text-fg leading-relaxed">
          Há {totalCount} API Key(s), mas <strong class="text-fg">nenhuma com todas as permissões</strong> que o Make exige
          (<code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">leads:read</code>,{' '}
          <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">leads:write</code>,{' '}
          <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">tags:read</code>,{' '}
          <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">tags:write</code>,{' '}
          <code class="text-2xs bg-surface-3 px-1 py-0.5 rounded">webhooks:manage</code>).
          Edite uma key existente ou crie uma nova:
          <a href="/app/settings#api-keys" class="ml-1 text-accent hover:underline inline-flex items-center gap-0.5">
            <KeyRound size={10} /> API Keys <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </Card>
  )
}

function KpiCell({
  label, value, tone = 'neutral',
}: { label: string; value: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const toneCls =
    tone === 'success' ? 'text-success' :
    tone === 'warning' ? 'text-warning' :
    tone === 'danger' ? 'text-danger' : 'text-fg'
  return (
    <div class="rounded-md border border-border bg-surface px-3 py-2">
      <div class="text-3xs uppercase tracking-wider text-fg-muted flex items-center gap-1">
        <Activity size={10} class="opacity-60" />
        {label}
      </div>
      <div class={`text-base font-semibold tabular-nums truncate ${toneCls}`}>{value}</div>
    </div>
  )
}

function ModeCard({
  title,
  text,
  tone,
}: {
  title: string
  text: string
  tone: 'accent' | 'info' | 'muted'
}) {
  const ring =
    tone === 'accent'
      ? 'border-accent/30 bg-accent/5'
      : tone === 'info'
        ? 'border-info/30 bg-info/5'
        : 'border-border bg-surface'
  const titleColor =
    tone === 'accent' ? 'text-accent' : tone === 'info' ? 'text-info' : 'text-fg-muted'
  return (
    <div class={`rounded-md border p-3 ${ring}`}>
      <div class={`text-2xs uppercase tracking-wider font-semibold mb-1 ${titleColor}`}>
        {title}
      </div>
      <div class="text-xs text-fg-muted leading-relaxed">{text}</div>
    </div>
  )
}

function JsonViewerModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, error } = useMakeAppDefinition(true)

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title="Definição completa do app ByChat Beyond"
      description="Cole cada bloco na aba correspondente do Developer Hub."
      size="xl"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {isLoading && <Skeleton class="h-64 w-full" />}
      {error && (
        <div class="text-sm text-danger">Falha ao carregar definição: {error.message}</div>
      )}
      {data && (
        <div class="max-h-[60dvh] overflow-y-auto space-y-2">
          <JsonSection title="General (app.iml.json)" data={data.app} />
          <JsonSection title="Base (base.iml.json)" data={data.base} />
          <JsonSection title="Connections (connection.iml.json)" data={data.connection} />
          {Object.entries(data.triggers).map(([name, json]) => (
            <JsonSection key={`t-${name}`} title={`Gatilho: ${name}`} data={json} />
          ))}
          {Object.entries(data.actions).map(([name, json]) => (
            <JsonSection key={`a-${name}`} title={`Action: ${name}`} data={json} />
          ))}
          {Object.entries(data.searches).map(([name, json]) => (
            <JsonSection key={`s-${name}`} title={`Search: ${name}`} data={json} />
          ))}
        </div>
      )}
    </Modal>
  )
}

function JsonSection({ title, data }: { title: string; data: unknown }) {
  const [copied, setCopied] = useState(false)
  const json = useMemo(() => JSON.stringify(data, null, 2), [data])

  function copy() {
    void navigator.clipboard.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <details class="rounded-md border border-border bg-surface">
      <summary class="cursor-pointer px-3 py-2 text-xs font-medium text-fg flex items-center justify-between">
        <span>{title}</span>
        <span class="text-fg-muted">{json.length.toLocaleString()} chars</span>
      </summary>
      <div class="p-2 space-y-2">
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? 'Copiado!' : 'Copiar JSON'}
        </Button>
        <pre class="bg-surface-3 p-3 rounded-md text-2xs font-mono text-fg overflow-x-auto max-h-96">
          {json}
        </pre>
      </div>
    </details>
  )
}

function RemoveHookDialog({ hook, onClose }: { hook: Webhook; onClose: () => void }) {
  const del = useDeleteWebhook()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title="Remover hook do Make?"
      description={`O cenário do Make em "${hook.name}" deixa de receber eventos. Você precisará recriá-lo no Make para reativar.`}
      destructive
      confirmLabel="Remover"
      loading={del.isPending}
      onConfirm={() =>
        del.mutate(hook.id, {
          onSuccess: () => {
            toast('Hook removido', 'success')
            onClose()
          },
          onError: (e: unknown) => toast((e as Error).message, 'danger'),
        })
      }
    />
  )
}
