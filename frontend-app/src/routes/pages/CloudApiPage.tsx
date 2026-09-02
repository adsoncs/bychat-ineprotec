import { useEffect, useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  Cloud, Trash2, RefreshCw, Send, Plug, AlertCircle, CheckCircle,
  Webhook, AlertTriangle, HelpCircle, FileText, BarChart3, Smartphone,
  IdCard, Settings,
} from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useCloudApiConnections,
  useCloudApiConfig,
  useCloudApiDispatchReport,
  useDeleteCloudApiConnection,
  useTestCloudApiConnection,
  useSyncCloudApiTemplates,
  useUpdateCloudApiConnection,
  useRefreshCloudApiMode,
  useResubscribeWebhook,
  useSyncAppData,
  type CloudApiConnection,
} from '@/hooks/useCloudApi'
import { useChatbots } from '@/hooks/useChatbots'
import { useTeams } from '@/hooks/useTeams'
import { useUsers } from '@/hooks/useUsers'
import { ChannelVisibilityCard } from '@/components/ChannelVisibilityCard'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ConnectionFunnelPicker } from '@/components/ConnectionFunnelPicker'
import { EmbeddedSignupModal } from '@/components/EmbeddedSignupModal'
import { CloudApiProfileModal } from '@/components/CloudApiProfileModal'
import { cloudApiQualityLabel } from '@/lib/statusLabels'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { CANAL_CORES, corDoCanal } from '@/lib/channelColors'

/**
 * Abaixo deste número de linhas a tela mostra todas; acima, aparece a busca.
 * Cinco é o ponto em que a tabela deixa de caber sem rolar junto com a gaveta.
 */
const LIMITE_SEM_BUSCA = 5

/**
 * Piso de amostra da taxa de entrega. Com 4 envios, "100%" e "75%" são a mesma
 * coisa e a comparação entre números vira ruído — ver feedback_kpi_piso_de_amostra.
 */
const PISO_TAXA = 20

type Metrica = {
  count: number
  sent: number
  delivered: number
  read: number
  failed: number
  billable: number
  estimatedCostUsd: number
}

function moeda(n: number): string {
  if (n === 0) return 'US$ 0'
  return n < 0.01 ? `US$ ${n.toFixed(4)}` : `US$ ${n.toFixed(2)}`
}

/** Entregue é tudo que chegou ao aparelho — inclusive o que já foi lido. */
function taxaEntrega(m: Metrica | undefined): { texto: string; valor: number | null } {
  if (!m || m.count < PISO_TAXA) return { texto: '—', valor: null }
  const v = Math.round(((m.delivered + m.read) / m.count) * 100)
  return { texto: `${v}%`, valor: v }
}

/** Como o número está com a Meta e conosco, em uma palavra. */
type Alerta = { conn: CloudApiConnection; texto: string; tom: 'danger' | 'warning' }

function alertasDe(c: CloudApiConnection): Alerta[] {
  const out: Alerta[] = []
  if (c.tokenStatus === 'expired') out.push({ conn: c, texto: 'token expirado', tom: 'danger' })
  if (c.active && c.webhook && c.webhook.estado !== 'ok' && c.webhook.estado !== 'desconhecido') {
    out.push({
      conn: c,
      texto: c.webhook.estado === 'outro' ? 'entregando em outro painel' : 'webhook sem assinar',
      tom: 'danger',
    })
  }
  if (c.qualityRating === 'RED') out.push({ conn: c, texto: 'qualidade baixa', tom: 'danger' })
  else if (c.qualityRating === 'YELLOW') out.push({ conn: c, texto: 'qualidade média', tom: 'warning' })
  if (!c.active) out.push({ conn: c, texto: 'pausado', tom: 'warning' })
  return out
}

export function CloudApiPage() {
  const { data: conns, isLoading } = useCloudApiConnections()
  const { data: config } = useCloudApiConfig()
  const { data: chatbots } = useChatbots()
  const { data: teams } = useTeams()
  const { data: usersData } = useUsers()
  // Volume, entrega e custo dos últimos 30 dias — é o que transforma a lista de
  // números numa comparação. Mesmo relatório da tela Disparos & Custos.
  const { data: relatorio } = useCloudApiDispatchReport(null)
  const [, navigate] = useLocation()
  const eligibleAgents = (usersData?.users ?? []).filter(
    (u) => u.active && (u.role === 'AGENT' || u.role === 'MANAGER' || u.role === 'ADMIN' || u.role === 'SUPERADMIN'),
  )
  const [deleting, setDeleting] = useState<CloudApiConnection | null>(null)
  const [testing, setTesting] = useState<CloudApiConnection | null>(null)
  const [editingProfile, setEditingProfile] = useState<CloudApiConnection | null>(null)
  const [signupOpen, setSignupOpen] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null)
  const [configurandoId, setConfigurandoId] = useState<number | null>(null)
  const [busca, setBusca] = useState('')
  const del = useDeleteCloudApiConnection()
  const sync = useSyncCloudApiTemplates()
  const resubscribe = useResubscribeWebhook()

  const missingConfig = !!config && (!config.appId || !config.configId)
  const lista = conns?.connections ?? []

  // Ordem fixa: o padrão de envio primeiro, depois os ativos, pausados no fim.
  // Sem desempate por nome a ordem muda a cada carga (ver feedback_lista_paginada_offset_estavel).
  const ordenadas = useMemo(() => {
    const nome = (c: CloudApiConnection) => (c.displayName || c.displayPhone || '').toLocaleLowerCase('pt-BR')
    return [...lista].sort((a, b) =>
      Number(!!b.isDefault) - Number(!!a.isDefault) ||
      Number(b.active) - Number(a.active) ||
      nome(a).localeCompare(nome(b), 'pt-BR') ||
      a.id - b.id,
    )
  }, [lista])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase('pt-BR')
    if (!q) return ordenadas
    return ordenadas.filter((c) =>
      [c.displayName, c.displayPhone, c.phoneNumberId, ...(c.teamNames ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLocaleLowerCase('pt-BR').includes(q)),
    )
  }, [ordenadas, busca])

  const metricas = useMemo(() => {
    const m = new Map<number, Metrica>()
    for (const b of relatorio?.report.byConnection ?? []) {
      if (b.connectionId != null) m.set(b.connectionId, b)
    }
    return m
  }, [relatorio])

  // Some da tela quando o número selecionado é removido ou filtrado para fora.
  const selecionada = filtradas.find((c) => c.id === selecionadoId) ?? filtradas[0] ?? null
  useEffect(() => {
    if (selecionada && selecionada.id !== selecionadoId) setSelecionadoId(selecionada.id)
  }, [selecionada?.id])
  useEffect(() => {
    if (configurandoId != null && !lista.some((c) => c.id === configurandoId)) setConfigurandoId(null)
  }, [lista.length])

  const configurando = lista.find((c) => c.id === configurandoId) ?? null
  const alertas = ordenadas.flatMap(alertasDe)
  const padrao = ordenadas.find((c) => c.isDefault)
  const assinados = ordenadas.filter((c) => c.webhook?.estado === 'ok').length
  const saudaveis = ordenadas.filter((c) => c.active && c.tokenStatus === 'valid' && c.webhook?.estado !== 'outro' && c.webhook?.estado !== 'ausente').length

  function handleSync(wabaId: string) {
    sync.mutate({ wabaId }, {
      onSuccess: (r) => toast(`${r.synced} modelos sincronizados`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function quemResponde(c: CloudApiConnection): string {
    if (c.teamNames?.length) return c.teamNames.join(', ')
    if (c.ownerUserId != null) {
      const u = eligibleAgents.find((a) => a.id === c.ownerUserId)
      return u?.name || `Usuário #${c.ownerUserId}`
    }
    return 'Sem dono'
  }

  return (
    <Page
      title="WhatsApp API"
      description="Números oficiais da Meta (WABA) conectados a este painel."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setSignupOpen(true)}
            disabled={missingConfig}
            title={missingConfig ? 'Integração não configurada pelo administrador da plataforma' : undefined}
          >
            <Plug size={14} /> Conectar número
          </Button>
        </div>
      }
    >
      {missingConfig && (
        <Card class="mb-3 border-warning/40 bg-warning/10">
          <div class="flex items-start gap-2">
            <AlertTriangle size={16} class="text-warning shrink-0 mt-0.5" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-fg">Integração WhatsApp Oficial indisponível</div>
              <div class="text-xs text-fg-muted mt-1">
                A conexão precisa ser habilitada pelo administrador da plataforma (App ID + Config ID do Meta).
                Sem isso, novos números não podem ser conectados via Embedded Signup. Entre em contato com o suporte.
              </div>
            </div>
          </div>
        </Card>
      )}

      {isLoading && (
        <div class="flex flex-col gap-3">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-56 w-full" />
        </div>
      )}

      {!isLoading && lista.length === 0 && (
        <EmptyState
          icon={<Cloud size={24} />}
          title="Nenhum número conectado"
          description="Conecte um número WhatsApp Business via Embedded Signup para enviar e receber pela API oficial."
          action={
            <Button variant="primary" size="sm" onClick={() => setSignupOpen(true)} disabled={missingConfig}>
              <Plug size={14} /> Conectar número
            </Button>
          }
        />
      )}

      {!isLoading && lista.length > 0 && (
        <>
          {/* Faixa de saúde: o estado do conjunto antes de qualquer detalhe.
              É a resposta a "tem algo errado?" sem abrir número por número. */}
          <div class="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-surface-2 px-3.5 py-2.5 text-xs">
            <span class="flex items-center gap-1.5">
              <span class="size-2 rounded-full bg-success" />
              {ordenadas.length === 1
                ? (saudaveis ? 'Número entregando normalmente' : 'Número com pendência')
                : `${saudaveis} de ${ordenadas.length} números entregando`}
            </span>
            {alertas.slice(0, 3).map((a) => (
              <span key={`${a.conn.id}-${a.texto}`} class={cn('flex items-center gap-1.5', a.tom === 'danger' ? 'text-danger' : 'text-warning')}>
                <span class={cn('size-2 rounded-full', a.tom === 'danger' ? 'bg-danger' : 'bg-warning')} />
                <button
                  type="button"
                  class="hover:underline"
                  onClick={() => setSelecionadoId(a.conn.id)}
                >
                  {a.conn.displayName || a.conn.displayPhone}: {a.texto}
                </button>
              </span>
            ))}
            {alertas.length > 3 && <span class="text-fg-muted">+{alertas.length - 3} avisos</span>}
            <span class="ml-auto flex items-center gap-4 text-fg-muted">
              <span>Padrão de envio: <b class="text-fg">{padrao?.displayName || padrao?.displayPhone || 'nenhum definido'}</b></span>
              <span class="flex items-center gap-1.5">
                <Webhook size={12} /> {assinados} de {ordenadas.length} assinados
              </span>
            </span>
          </div>

          {ordenadas.length > LIMITE_SEM_BUSCA && (
            <div class="mb-3">
              <Input
                value={busca}
                placeholder="Buscar por nome, telefone ou setor"
                onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
              />
            </div>
          )}

          <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
            {/* Comparação: uma linha por número, com o que muda entre eles. */}
            <Card class="p-0 overflow-hidden">
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
                    <tr>
                      <th class="text-left px-3 py-2 font-medium">Número</th>
                      <th class="text-left px-3 py-2 font-medium">Quem responde</th>
                      <th class="text-left px-3 py-2 font-medium">Qualidade</th>
                      <th class="text-right px-3 py-2 font-medium">Enviadas</th>
                      <th class="text-right px-3 py-2 font-medium">Entrega</th>
                      <th class="text-right px-3 py-2 font-medium">Custo 30 d</th>
                      <th class="text-left px-3 py-2 font-medium">Webhook</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border">
                    {filtradas.map((c) => {
                      const m = metricas.get(c.id)
                      const taxa = taxaEntrega(m)
                      const eSelecionada = selecionada?.id === c.id
                      return (
                        <tr
                          key={c.id}
                          class={cn('cursor-pointer', eSelecionada ? 'bg-accent/10' : 'hover:bg-surface-3')}
                          onClick={() => setSelecionadoId(c.id)}
                        >
                          <td class="px-3 py-2.5">
                            <div class="flex items-center gap-2.5">
                              <span
                                class="size-2.5 rounded-sm shrink-0"
                                style={{ backgroundColor: corDoCanal(c.color, 'cloud_api') }}
                              />
                              <div class="min-w-0">
                                <div class="flex items-center gap-1.5">
                                  <span class={cn('font-medium truncate', !c.active && 'text-fg-muted')}>
                                    {c.displayName || c.displayPhone}
                                  </span>
                                  {c.isDefault && <Badge tone="accent">Padrão</Badge>}
                                  {!c.active && <Badge tone="neutral">Pausado</Badge>}
                                  {c.coexistence && <Smartphone size={11} class="text-fg-muted" />}
                                </div>
                                <div class="text-2xs text-fg-muted tabular-nums">{c.displayPhone}</div>
                              </div>
                            </div>
                          </td>
                          <td class="px-3 py-2.5 text-fg-muted truncate max-w-[12rem]">{quemResponde(c)}</td>
                          <td class="px-3 py-2.5">
                            {c.tokenStatus === 'expired' ? (
                              <Badge tone="danger">Token expirado</Badge>
                            ) : c.qualityRating ? (
                              <Badge tone={c.qualityRating === 'GREEN' ? 'success' : c.qualityRating === 'YELLOW' ? 'warning' : 'danger'}>
                                {cloudApiQualityLabel(c.qualityRating)}
                              </Badge>
                            ) : (
                              <span class="text-fg-muted">—</span>
                            )}
                          </td>
                          <td class="px-3 py-2.5 text-right tabular-nums">{m?.count ?? 0}</td>
                          <td
                            class="px-3 py-2.5 text-right tabular-nums"
                            title={taxa.valor == null ? `Menos de ${PISO_TAXA} envios no período — a proporção ainda não diz nada` : undefined}
                          >
                            {taxa.valor == null
                              ? <span class="text-fg-muted">—</span>
                              : <span class={taxa.valor < 70 ? 'text-danger' : taxa.valor < 90 ? 'text-warning' : 'text-fg'}>{taxa.texto}</span>}
                          </td>
                          <td class="px-3 py-2.5 text-right tabular-nums">{moeda(m?.estimatedCostUsd ?? 0)}</td>
                          <td class="px-3 py-2.5">
                            {c.webhook?.estado === 'ok' ? <Badge tone="success">Assinado</Badge>
                              : c.webhook?.estado === 'outro' ? <Badge tone="danger">Outro painel</Badge>
                              : c.webhook?.estado === 'ausente' ? <Badge tone="warning">Sem assinar</Badge>
                              : <span class="text-fg-muted">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                    {filtradas.length === 0 && (
                      <tr>
                        <td colSpan={7} class="px-3 py-6 text-center text-fg-muted">
                          Nenhum número corresponde a “{busca}”.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Gaveta do número escolhido: o resumo que decide se é preciso abrir
                as configurações — e os atalhos do que se faz sem abrir. */}
            {selecionada && (
              <Card>
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span
                        class="size-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: corDoCanal(selecionada.color, 'cloud_api') }}
                      />
                      <span class="font-semibold text-fg truncate">{selecionada.displayName || selecionada.displayPhone}</span>
                      {selecionada.isDefault && <Badge tone="accent">Padrão</Badge>}
                    </div>
                    <div class="text-2xs text-fg-muted tabular-nums mt-0.5">{selecionada.displayPhone}</div>
                  </div>
                  {selecionada.tokenStatus === 'valid'
                    ? <Badge tone="success"><CheckCircle size={10} class="mr-0.5 inline" /> Token OK</Badge>
                    : <Badge tone="danger"><AlertCircle size={10} class="mr-0.5 inline" /> Token expirado</Badge>}
                </div>

                {(() => {
                  const m = metricas.get(selecionada.id)
                  const total = m?.count ?? 0
                  const entregues = m ? m.delivered : 0
                  const lidas = m ? m.read : 0
                  const falhas = m ? m.failed : 0
                  const pct = (n: number) => (total ? `${(n / total) * 100}%` : '0%')
                  return (
                    <div class="mt-3 space-y-1.5">
                      <div class="flex items-center justify-between text-xs">
                        <span class="text-fg-muted">Entregues · lidas · falhas (30 d)</span>
                        <span class="tabular-nums text-fg">{entregues} · {lidas} · {falhas}</span>
                      </div>
                      <div class="flex h-1.5 overflow-hidden rounded-full bg-surface-3" role="img"
                        aria-label={`${entregues} entregues, ${lidas} lidas, ${falhas} falhas de ${total} envios`}>
                        <span class="bg-info" style={{ width: pct(entregues) }} />
                        <span class="bg-success" style={{ width: pct(lidas) }} />
                        <span class="bg-danger" style={{ width: pct(falhas) }} />
                      </div>
                      {total > 0 && total < PISO_TAXA && (
                        <p class="text-2xs text-fg-muted">
                          {total} {total === 1 ? 'envio' : 'envios'} no período — pouco para comparar proporções.
                        </p>
                      )}
                    </div>
                  )
                })()}

                <dl class="mt-3 space-y-1.5 border-t border-border pt-3 text-xs">
                  <div class="flex justify-between gap-2">
                    <dt class="text-fg-muted">Limite da Meta</dt>
                    <dd class="text-fg tabular-nums">{selecionada.messagingLimit || '—'}</dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt class="text-fg-muted">Chatbot</dt>
                    <dd class="text-fg truncate max-w-[10rem]">
                      {chatbots?.chatbots.find((b) => b.id === selecionada.chatbotId)?.name ?? 'Atendimento humano'}
                    </dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt class="text-fg-muted">Quem responde</dt>
                    <dd class="text-fg truncate max-w-[10rem]">{quemResponde(selecionada)}</dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt class="text-fg-muted">Conectado em</dt>
                    <dd class="text-fg tabular-nums">{new Date(selecionada.createdAt).toLocaleDateString('pt-BR')}</dd>
                  </div>
                </dl>

                {selecionada.webhook && selecionada.webhook.estado !== 'ok' && selecionada.webhook.estado !== 'desconhecido' && (
                  <div class="mt-3 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs">
                    <b class="text-fg">
                      {selecionada.webhook.estado === 'outro'
                        ? 'As mensagens deste número estão indo para outro painel.'
                        : 'A Meta não está entregando as mensagens deste número aqui.'}
                    </b>
                    <p class="text-fg-muted mt-1">
                      {selecionada.webhook.url
                        ? <>Endereço inscrito hoje: <code class="break-all">{selecionada.webhook.url}</code></>
                        : 'Nenhum aplicativo assinado nesta conta do WhatsApp.'}
                    </p>
                    <Button
                      class="mt-2"
                      variant="secondary"
                      size="sm"
                      disabled={resubscribe.isPending}
                      onClick={() => resubscribe.mutate(selecionada.id, {
                        onSuccess: () => toast('Webhook reinscrito para este painel', 'success'),
                        onError: (e: unknown) => toast((e as Error).message, 'danger'),
                      })}
                    >
                      <RefreshCw size={12} class={resubscribe.isPending ? 'animate-spin' : ''} /> Reinscrever webhook
                    </Button>
                  </div>
                )}

                <div class="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button variant="primary" size="sm" onClick={() => setConfigurandoId(selecionada.id)}>
                    <Settings size={12} /> Configurações
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setTesting(selecionada)}>
                    <Send size={12} /> Enviar teste
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEditingProfile(selecionada)}>
                    <IdCard size={12} /> Perfil
                  </Button>
                </div>
              </Card>
            )}
          </div>

          {/* O formulário inteiro do número, aberto sob demanda: é ele que fazia
              a tela ter quatro mil pixels quando vinha aberto para todos. */}
          {configurando && (
            <div class="mt-3">
              <div class="mb-2 flex items-center justify-between">
                <div class="text-sm font-medium text-fg">
                  Configurações de {configurando.displayName || configurando.displayPhone}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setConfigurandoId(null)}>Fechar</Button>
              </div>
              <ConnectionCard
                connection={configurando}
                chatbots={chatbots?.chatbots ?? []}
                teams={teams?.teams ?? []}
                agents={eligibleAgents}
                syncing={sync.isPending}
                onSync={() => handleSync(configurando.wabaId)}
                onTest={() => setTesting(configurando)}
                onProfile={() => setEditingProfile(configurando)}
                onDelete={() => setDeleting(configurando)}
              />
            </div>
          )}

          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <Card>
              <div class="flex items-center gap-3">
                <div class="size-9 rounded-md bg-accent/10 grid place-items-center text-accent shrink-0">
                  <FileText size={18} />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-fg">Modelos de Mensagem</div>
                  <div class="text-xs text-fg-muted">Modelos HSM aprovados pela Meta.</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => navigate('/whatsapp-templates')}>Abrir</Button>
              </div>
            </Card>
            <Card>
              <div class="flex items-center gap-3">
                <div class="size-9 rounded-md bg-accent/10 grid place-items-center text-accent shrink-0">
                  <BarChart3 size={18} />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-fg">Disparos & Custos</div>
                  <div class="text-xs text-fg-muted">Histórico completo, por número e categoria.</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => navigate('/whatsapp-dispatch')}>Abrir</Button>
              </div>
            </Card>
          </div>
        </>
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Remover "${deleting.displayName ?? deleting.displayPhone}"`}
          description="A conexão será desfeita. Para reconectar, será necessário passar pelo Embedded Signup novamente."
          destructive
          confirmLabel="Remover"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('Conexão removida', 'success'); setDeleting(null); setConfigurandoId(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}

      {testing && <TestMessageModal connection={testing} onClose={() => setTesting(null)} />}

      {editingProfile && (
        <CloudApiProfileModal connection={editingProfile} onClose={() => setEditingProfile(null)} />
      )}

      <EmbeddedSignupModal open={signupOpen} onOpenChange={setSignupOpen} />

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o WhatsApp API?"
        problem={<>
          Esta é a integração <strong>oficial da Meta</strong> com o WhatsApp Business (WABA). É
          diferente do WhatsApp comum: <strong>envio em massa</strong>, modelos aprovados, botões
          interativos, sem risco de bloqueio. Pra escala e operação séria, esta é a via.
        </>}
        steps={[
          {
            title: '🔌 Conectar número',
            body: <>Botão <strong>Conectar número</strong> abre o <em>Embedded Signup da Meta</em>. Você loga no Facebook, escolhe sua empresa (ou cria uma), seleciona o número de WhatsApp Business e autoriza o Attrae. Em ~5 minutos o número está conectado.</>,
          },
          {
            title: '📊 A tabela compara os números',
            body: <>Cada linha é um número: quem responde por ele, qualidade na Meta, volume, taxa de entrega e custo dos últimos 30 dias. Clique numa linha para ver o resumo ao lado e abrir as configurações.</>,
          },
          {
            title: '🎯 Número padrão de envio',
            body: <>Fluxo, cadência, notificação de agenda e resposta a lead sem histórico saem pelo número marcado como <strong>padrão</strong>. Sem essa marca, quem envia é o número ativo mais antigo.</>,
          },
          {
            title: '🪝 Webhook por número',
            body: <>A Meta precisa entregar as mensagens de cada conta neste painel. Quando a coluna <strong>Webhook</strong> não estiver "Assinado", o resumo ao lado traz o botão <strong>Reinscrever</strong>.</>,
          },
          {
            title: '📝 Modelos aprovados pela Meta',
            body: <>Toda mensagem inicial precisa ser <strong>modelo aprovado</strong>. Os modelos pertencem à conta (WABA), não ao número — dois números da mesma conta compartilham a mesma lista.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Quando usar WhatsApp API vs WhatsApp comum',
          body: <><strong>WhatsApp API</strong>: você precisa enviar pra muitos (lista de inscritos), quer modelos com botão "Confirmar", quer selo verde de Business verificado. <strong>WhatsApp comum (Evolution)</strong>: atendimento 1-pra-1, suporte, conversa contínua, números pessoais.</>,
        }}
      />
    </Page>
  )
}

function ConnectionCard({
  connection: c, chatbots, teams, agents, syncing,
  onSync, onTest, onProfile, onDelete,
}: {
  connection: CloudApiConnection
  chatbots: { id: number; name: string }[]
  teams: { id: number; name: string }[]
  agents: { id: number; name: string | null; role: string }[]
  syncing: boolean
  onSync: () => void
  onTest: () => void
  onProfile: () => void
  onDelete: () => void
}) {
  const update = useUpdateCloudApiConnection()
  const refreshMode = useRefreshCloudApiMode()
  const syncAppData = useSyncAppData()
  // Setores donos (vários) — um número de recepção costuma ser atendido por mais
  // de um setor. `defaultTeamId` entra como fallback de conexão antiga.
  const teamsIniciais: number[] = c.teamIds?.length
    ? c.teamIds
    : (c.defaultTeamId != null ? [c.defaultTeamId] : [])
  const [donoTipo, setDonoTipo] = useState<'team' | 'agent' | 'none'>(
    c.ownerUserId != null ? 'agent' : teamsIniciais.length ? 'team' : 'none',
  )
  const [teamIds, setTeamIds] = useState<number[]>(teamsIniciais)
  // Identidade do canal: nome que o operador vê na conversa e cor de origem.
  const [nomeCanal, setNomeCanal] = useState(c.displayName ?? '')
  const [cor, setCor] = useState(c.color ?? '')
  // O rádio do número padrão é um grupo entre CARDS: clicar num deles já
  // desmarca o outro no DOM, antes de qualquer resposta do servidor. Sem um
  // estado próprio, uma recusa (número pausado, sessão expirada) deixava a tela
  // com nenhum marcado — nem o novo, nem o que continuava valendo.
  const [ehPadrao, setEhPadrao] = useState(!!c.isDefault)
  useEffect(() => { setEhPadrao(!!c.isDefault) }, [c.isDefault])

  function salvarIdentidade(patch: { displayName?: string; color?: string | null }) {
    update.mutate({ id: c.id, ...patch }, {
      onSuccess: () => toast('Identificação do canal atualizada', 'success', 1_500),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleChatbotChange(value: string) {
    const chatbotId = value ? Number(value) : null
    update.mutate({ id: c.id, chatbotId }, {
      onSuccess: () => toast('Chatbot vinculado atualizado', 'success', 1_500),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleActiveToggle(active: boolean) {
    update.mutate({ id: c.id, active }, {
      onSuccess: () => toast(active ? 'Conexão ativada' : 'Conexão pausada', 'success', 1_500),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  // Roteamento por dono (setor OU agente — mutuamente exclusivos, igual à
  // instância Evolution). Salva ao escolher no select; "Sem dono" salva na hora.
  function saveDono(input: { teamIds?: number[]; defaultTeamId?: number | null; ownerUserId?: number | null }) {
    update.mutate({ id: c.id, ...input }, {
      onSuccess: () => toast('Roteamento da conexão atualizado', 'success', 1_500),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card class="group mb-3">
      <CardHeader>
        <CardTitle>
          <span class="inline-flex items-center gap-2">
            <Cloud size={16} class="text-fg-muted" />
            {c.displayName ?? c.displayPhone}
          </span>
        </CardTitle>
        <div class="flex items-center gap-2">
          {c.tokenStatus === 'valid' ? (
            <Badge tone="success"><CheckCircle size={10} class="mr-0.5 inline" /> Token OK</Badge>
          ) : (
            <Badge tone="danger"><AlertCircle size={10} class="mr-0.5 inline" /> Token expirado</Badge>
          )}
          {c.coexistence && <Badge tone="info"><Smartphone size={10} class="mr-0.5 inline" /> Coexistência</Badge>}
          {c.isDefault && <Badge tone="accent">Padrão de envio</Badge>}
          <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Ativa' : 'Inativa'}</Badge>
          <button
            type="button"
            title="Reconsultar na Meta se o número ainda está no app do celular"
            class="text-fg-muted hover:text-accent disabled:opacity-50"
            disabled={refreshMode.isPending}
            onClick={() => refreshMode.mutate(c.id, {
              onSuccess: (r) => toast(r.coexistence
                ? 'Número em coexistência: segue ativo no app do celular'
                : 'Número exclusivo da API (não está no app do celular)', 'success'),
              onError: (e) => toast((e as Error).message, 'danger'),
            })}
          >
            <RefreshCw size={12} class={refreshMode.isPending ? 'animate-spin' : ''} />
          </button>
        </div>
      </CardHeader>

      {c.coexistence && (
        <div class="mb-3 rounded-md border border-info/40 bg-info/10 px-2.5 py-2 text-xs text-fg">
          <b>Este número também atende pelo celular.</b> As mensagens continuam chegando no app
          WhatsApp Business. Nesse modo a Meta limita o envio a <b>20 msg/s</b>, <b>grupos não
          sincronizam</b> e o app precisa ser aberto ao menos uma vez a cada 14 dias — senão a
          Meta desliga a coexistência sozinha.
          <div class="mt-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={syncAppData.isPending}
              onClick={() => syncAppData.mutate(c.id, {
                onSuccess: () => toast('Importação pedida à Meta — os contatos e as conversas chegam aos poucos (pode levar até 24h)', 'success'),
                onError: (e) => toast((e as Error).message, 'danger'),
              })}
            >
              <RefreshCw size={13} class={syncAppData.isPending ? 'animate-spin' : ''} /> Importar contatos e histórico do celular
            </Button>
          </div>
        </div>
      )}

      {c.tokenError && (
        <div class="text-xs text-danger mb-3 bg-danger/10 rounded-md px-2 py-1.5">{c.tokenError}</div>
      )}

      <div class="grid gap-2 grid-cols-1 sm:grid-cols-3 text-xs">
        <Field label="Phone Number ID" value={c.phoneNumberId} mono />
        <Field label="WABA ID" value={c.wabaId} mono />
        <Field label="Telefone" value={c.displayPhone} />
        <Field label="Tipo de token" value={c.tokenType} />
        {c.qualityRating && <Field label="Qualidade" value={cloudApiQualityLabel(c.qualityRating)} />}
        {c.messagingLimit && <Field label="Limite" value={c.messagingLimit} />}
      </div>

      {/* Identificação do canal — é o que o operador vê na conversa */}
      <div class="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
        <Input
          label="Nome do canal"
          value={nomeCanal}
          placeholder={c.displayPhone}
          hint="Como este número aparece para quem atende. Ex.: Comercial, Suporte, Loja Centro."
          disabled={update.isPending}
          onInput={(e) => setNomeCanal((e.target as HTMLInputElement).value)}
          onBlur={() => {
            const v = nomeCanal.trim()
            if (v !== (c.displayName ?? '')) salvarIdentidade({ displayName: v })
          }}
        />
        <div>
          <label class="mb-1 block text-sm font-medium">Cor de identificação</label>
          <div class="flex flex-wrap items-center gap-1.5">
            {CANAL_CORES.map((cc) => (
              <button
                key={cc.hex}
                type="button"
                title={cc.nome}
                aria-label={cc.nome}
                aria-pressed={cor === cc.hex}
                disabled={update.isPending}
                onClick={() => {
                  const nova = cor === cc.hex ? '' : cc.hex
                  setCor(nova)
                  salvarIdentidade({ color: nova || null })
                }}
                class={cn(
                  'size-7 rounded-full border-2 transition-transform',
                  cor === cc.hex ? 'scale-110 border-fg' : 'border-transparent hover:scale-105',
                )}
                style={{ backgroundColor: cc.hex }}
              />
            ))}
          </div>
          <p class="mt-1 text-xs text-fg-muted">
            Marca a origem das conversas deste número na lista de atendimento.
          </p>
        </div>
      </div>

      {/* Inline edit: chatbot + ativa */}
      <div class="grid sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-border">
        <Select
          label="Chatbot vinculado"
          value={c.chatbotId != null ? String(c.chatbotId) : ''}
          onChange={(e) => handleChatbotChange((e.target as HTMLSelectElement).value)}
          disabled={update.isPending}
          hint="Se vinculado, leads passam pelo chatbot. Sem chatbot = atendimento humano."
        >
          <option value="">Nenhum (atendimento humano)</option>
          {chatbots.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
        <label class="flex items-center gap-2 text-sm text-fg-muted self-end h-9">
          <input
            type="checkbox"
            checked={c.active}
            disabled={update.isPending}
            onChange={(e) => handleActiveToggle((e.target as HTMLInputElement).checked)}
          />
          Conexão ativa (recebe mensagens e modelos)
        </label>
      </div>

      {/* Qual número o sistema usa quando ninguém escolheu um. Com uma conexão só
          a pergunta não existia; com duas, "a primeira ativa" era o banco decidindo. */}
      <div class="mt-3 pt-3 border-t border-border">
        <label class="flex items-start gap-2 text-sm text-fg">
          <input
            type="radio"
            // Um `name` por card, de propósito: com o grupo nativo, clicar aqui
            // desmarcava o outro card NO DOM antes de o servidor responder, e o
            // Preact não repõe aquilo (o VDOM daquele card não mudou) — numa
            // recusa a tela ficava sem padrão nenhum. Quem garante a
            // exclusividade é o servidor, e a lista recarregada é que apaga a
            // marca do card anterior.
            name={`cloud-api-padrao-${c.id}`}
            class="mt-0.5"
            checked={ehPadrao}
            disabled={update.isPending || !c.active}
            onChange={() => {
              setEhPadrao(true)
              update.mutate({ id: c.id, isDefault: true }, {
                onSuccess: () => toast('Este número passou a ser o padrão de envio', 'success', 2_000),
                // Volta ao que o servidor diz — o clique já mexeu no DOM do grupo.
                onError: (e: unknown) => { setEhPadrao(!!c.isDefault); toast((e as Error).message, 'danger') },
              })
            }}
          />
          <span>
            Número padrão de envio
            <span class="block text-xs text-fg-muted">
              Usado por fluxo, cadência, notificação de agenda e resposta a lead sem histórico —
              tudo que envia sem alguém escolher o número. {!c.active && 'Ative a conexão para poder marcá-la.'}
            </span>
          </span>
        </label>
      </div>

      {/* Funil dos leads do chatbot — só quando há chatbot vinculado */}
      {c.chatbotId != null && (
        <ConnectionFunnelPicker
          funnelId={c.funnelId}
          stageKey={c.stageKey}
          disabled={update.isPending}
          onSave={({ funnelId, stageKey }) => update.mutate({ id: c.id, funnelId, stageKey }, {
            onSuccess: () => toast('Funil da conexão atualizado', 'success', 1_500),
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}

      {/* Roteamento: setor padrão OU agente dedicado (paridade com instância Evolution) */}
      <div class="mt-3 pt-3 border-t border-border">
        <div class="text-sm font-medium text-fg mb-2">Para quem vão os leads desta conexão</div>
        <div class="flex gap-3 text-sm mb-2">
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={`dono-${c.id}`} checked={donoTipo === 'team'} disabled={update.isPending}
              onChange={() => setDonoTipo('team')} />
            Setor
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={`dono-${c.id}`} checked={donoTipo === 'agent'} disabled={update.isPending}
              onChange={() => setDonoTipo('agent')} />
            Agente
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={`dono-${c.id}`} checked={donoTipo === 'none'} disabled={update.isPending}
              onChange={() => { setDonoTipo('none'); setTeamIds([]); saveDono({ teamIds: [], ownerUserId: null }) }} />
            Sem dono
          </label>
        </div>
        {donoTipo === 'team' && (
          <div class="space-y-1.5">
            <div class="flex flex-wrap gap-x-4 gap-y-1.5">
              {teams.map((t) => (
                <label key={t.id} class="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={update.isPending}
                    checked={teamIds.includes(t.id)}
                    onChange={(e) => {
                      const on = (e.target as HTMLInputElement).checked
                      const next = on ? [...teamIds, t.id] : teamIds.filter((x) => x !== t.id)
                      setTeamIds(next)
                      saveDono({ teamIds: next, ownerUserId: null })
                    }}
                  />
                  {t.name}
                </label>
              ))}
            </div>
            {teamIds.length > 1 ? (
              <p class="text-xs text-warning">
                Com mais de um setor, o lead que chegar por este número entra <strong>sem setor</strong> —
                quem define é o menu do chatbot ou uma regra. Todos os setores marcados podem responder por ele.
              </p>
            ) : null}
          </div>
        )}
        {donoTipo === 'agent' && (
          <Select
            value={c.ownerUserId != null ? String(c.ownerUserId) : ''}
            disabled={update.isPending}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              setTeamIds([])
              saveDono({ ownerUserId: v ? Number(v) : null, teamIds: [] })
            }}
          >
            <option value="">— Selecionar agente —</option>
            {agents.map((u) => <option key={u.id} value={u.id}>{u.name || `Usuário #${u.id}`} ({u.role})</option>)}
          </Select>
        )}
        <p class="text-xs text-fg-muted mt-1">
          {donoTipo === 'agent'
            ? 'Leads que chegarem por este número são atribuídos direto ao agente.'
            : donoTipo === 'team'
            // Com 2+ setores o aviso acima já explica; repetir aqui só polui.
            ? (teamIds.length > 1 ? '' : 'Leads são roteados ao setor (round-robin conforme a configuração da equipe).')
            : 'Sem amarração — leads caem na fila global do tenant (regras/fallback).'}
        </p>
      </div>

      {/* Quem acompanha este número. Some inteiro para quem não é superadmin. */}
      <div class="mt-4">
        <ChannelVisibilityCard
          kind="cloud"
          channelId={c.id}
          channel={c as any}
          nomeDoCanal={(c as any).displayName || (c as any).displayPhone || 'este número'}
        />
      </div>

      <div class="flex gap-2 mt-4">
        <Button variant="secondary" size="sm" onClick={onTest}>
          <Send size={12} /> Enviar teste
        </Button>
        <Button variant="secondary" size="sm" onClick={onSync} disabled={syncing}>
          <RefreshCw size={12} class={syncing ? 'animate-spin' : ''} /> Sincronizar modelos
        </Button>
        <Button variant="secondary" size="sm" onClick={onProfile}>
          <IdCard size={12} /> Perfil da empresa
        </Button>
        <button
          type="button"
          class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3 ml-auto"
          onClick={onDelete}
          aria-label="Remover"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </Card>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div class="text-3xs text-fg-muted uppercase tracking-wider">{label}</div>
      <div class={`text-fg ${mono ? 'font-mono text-2xs' : 'text-sm'} truncate`}>{value}</div>
    </div>
  )
}

function TestMessageModal({ connection, onClose }: { connection: CloudApiConnection; onClose: () => void }) {
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const test = useTestCloudApiConnection()

  function handleSubmit() {
    if (!phone.trim()) { toast('Telefone obrigatório', 'danger'); return }
    test.mutate({ id: connection.id, phone: phone.trim(), message: message || undefined }, {
      onSuccess: (r) => { toast(`Mensagem enviada (id: ${r.messageId})`, 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Enviar mensagem de teste"
      description={`Via ${connection.displayName ?? connection.displayPhone}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={test.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={test.isPending}>
            {test.isPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input label="Telefone do destinatário" value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} placeholder="5511999999999" />
        <Input label="Mensagem (opcional)" value={message} onInput={(e) => setMessage((e.target as HTMLInputElement).value)} placeholder="Deixe em branco para mensagem padrão" />
      </div>
    </Modal>
  )
}

