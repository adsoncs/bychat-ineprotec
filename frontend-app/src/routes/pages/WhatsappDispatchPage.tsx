import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { Cloud } from '@/components/ui/icon-set'
import {
  useCloudApiConnections,
  useCloudApiDispatchReport,
} from '@/hooks/useCloudApi'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { cloudApiQualityLabel, cloudApiMessageStatusLabel } from '@/lib/statusLabels'

const CAT_LABEL: Record<string, string> = {
  marketing: 'Marketing', utility: 'Utilidade', authentication: 'Autenticação',
  service: 'Atendimento (grátis)', referral_conversion: 'Conversão',
}
const catLabel = (c: string) => CAT_LABEL[c] ?? c
const usd = (n: number) => `US$ ${n.toFixed(4)}`

export function WhatsappDispatchPage() {
  const { data: conns, isLoading: connsLoading } = useCloudApiConnections()
  const [, navigate] = useLocation()
  // null = todos os números; senão filtra por conexão
  const [selected, setSelected] = useState<number | null>(null)
  const { data, isLoading } = useCloudApiDispatchReport(selected)

  const connections = conns?.connections ?? []
  const hasConnections = connections.length > 0
  const multi = connections.length > 1

  const nameOf = (id: number | null): string => {
    if (id == null) return 'Sem número (legado)'
    const c = connections.find((x) => x.id === id)
    return c?.displayName || c?.displayPhone || `#${id}`
  }

  const r = data?.report
  const reportConns = data?.connections ?? []
  const selectedConn = selected != null ? reportConns.find((c) => c.id === selected) : null

  return (
    <Page
      title="Disparos & Custos"
      description="Acompanhamento de envios pelo WhatsApp API (oficial): status, categorias e custo estimado da Meta. Últimos 30 dias."
    >
      {connsLoading && <div class="p-6 text-center text-sm text-fg-muted">Carregando…</div>}

      {!connsLoading && !hasConnections && (
        <EmptyState
          icon={<Cloud size={24} />}
          title="Nenhuma conta WhatsApp API conectada"
          description="O relatório de disparos depende de uma conexão oficial (WABA). Conecte um número em WhatsApp API."
          action={
            <Button variant="primary" size="sm" onClick={() => navigate('/cloud-api')}>
              <Cloud size={14} /> Ir para WhatsApp API
            </Button>
          }
        />
      )}

      {!connsLoading && hasConnections && (
        <div class="space-y-4">
          {/* Seletor por número (controle por número quando há mais de um) */}
          {multi && (
            <div class="flex flex-wrap gap-1">
              <NumChip label="Todos os números" active={selected === null} onClick={() => setSelected(null)} />
              {connections.map((c) => (
                <NumChip
                  key={c.id}
                  label={c.displayName || c.displayPhone || `#${c.id}`}
                  active={selected === c.id}
                  onClick={() => setSelected(c.id)}
                />
              ))}
            </div>
          )}

          {isLoading ? (
            <div class="p-6 text-center text-sm text-fg-muted">Carregando relatório…</div>
          ) : !r ? (
            <div class="p-6 text-center text-sm text-fg-muted">Sem dados de disparo ainda.</div>
          ) : (
            <>
              {/* KPIs do escopo selecionado */}
              <div>
                {multi && (
                  <div class="text-2xs text-fg-muted uppercase tracking-wider mb-1">
                    {selected === null ? 'Todos os números' : nameOf(selected)}
                  </div>
                )}
                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <DKpi label="Enviadas" value={r.totals.sent} />
                  <DKpi label="Entregues" value={r.totals.delivered} tone="info" />
                  <DKpi label="Lidas" value={r.totals.read} tone="success" />
                  <DKpi label="Falhas" value={r.totals.failed} tone="danger" />
                  <DKpi label="Cobráveis" value={r.totals.billable} tone="warning" />
                  <DKpi label="Custo estim." value={usd(r.totals.estimatedCostUsd)} tone="warning" />
                </div>
              </div>

              {/* Comparativo por número (só quando vendo todos e há mais de um) */}
              {multi && selected === null && r.byConnection.length > 0 && (
                <Card class="p-0 overflow-hidden">
                  <div class="p-3 border-b border-border text-2xs text-fg-muted uppercase tracking-wider">
                    Por número
                  </div>
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
                        <tr>
                          <th class="text-left px-4 py-2 font-medium">Número</th>
                          <th class="text-right px-4 py-2 font-medium">Enviadas</th>
                          <th class="text-right px-4 py-2 font-medium">Entregues</th>
                          <th class="text-right px-4 py-2 font-medium">Lidas</th>
                          <th class="text-right px-4 py-2 font-medium">Falhas</th>
                          <th class="text-right px-4 py-2 font-medium">Cobráveis</th>
                          <th class="text-right px-4 py-2 font-medium">Custo estim.</th>
                          <th class="px-4 py-2"></th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-border">
                        {r.byConnection.map((b) => (
                          <tr key={String(b.connectionId)} class="hover:bg-surface-3">
                            <td class="px-4 py-2 text-fg">{nameOf(b.connectionId)}</td>
                            <td class="px-4 py-2 text-right tabular-nums text-fg">{b.sent}</td>
                            <td class="px-4 py-2 text-right tabular-nums text-info">{b.delivered}</td>
                            <td class="px-4 py-2 text-right tabular-nums text-success">{b.read}</td>
                            <td class="px-4 py-2 text-right tabular-nums text-danger">{b.failed}</td>
                            <td class="px-4 py-2 text-right tabular-nums text-warning">{b.billable}</td>
                            <td class="px-4 py-2 text-right tabular-nums font-medium text-fg">{usd(b.estimatedCostUsd)}</td>
                            <td class="px-4 py-2 text-right">
                              {b.connectionId != null && (
                                <button
                                  type="button"
                                  class="text-2xs text-accent hover:underline"
                                  onClick={() => setSelected(b.connectionId)}
                                >
                                  Detalhar
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {/* Por categoria */}
              {r.byCategory.length > 0 && (
                <Card>
                  <div class="text-2xs text-fg-muted uppercase tracking-wider mb-2">Por categoria</div>
                  <div class="space-y-1">
                    {r.byCategory.map((c) => (
                      <div key={c.category} class="flex items-center justify-between text-xs rounded-md bg-surface-2 px-3 py-1.5">
                        <span class="text-fg">{catLabel(c.category)}</span>
                        <span class="text-fg-muted">{c.count} msg · {c.billable} cobr. · <strong class="text-fg">{usd(c.estimatedCostUsd)}</strong></span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Qualidade/limite por número (Meta) */}
              {reportConns.length > 0 && (
                <Card>
                  <div class="text-2xs text-fg-muted uppercase tracking-wider mb-2">Saúde dos números (qualidade e limite Meta)</div>
                  <div class="space-y-1">
                    {(selectedConn ? [selectedConn] : reportConns).map((c) => (
                      <div key={c.id} class="flex items-center justify-between text-xs rounded-md bg-surface-2 px-3 py-1.5">
                        <span class="text-fg">
                          {c.displayName || c.displayPhone || `#${c.id}`}
                          {c.isDefault && <span class="ml-1.5 text-2xs text-accent">padrão</span>}
                        </span>
                        <span class="flex items-center gap-2">
                          {/* Pausado continua na lista: ele tem envios no período,
                              e sumir daqui era o que fazia o nome virar "#7". */}
                          {c.active === false && <Badge tone="neutral">Pausado</Badge>}
                          {c.qualityRating && <Badge tone={c.qualityRating === 'GREEN' ? 'success' : c.qualityRating === 'YELLOW' ? 'warning' : 'danger'}>{cloudApiQualityLabel(c.qualityRating)}</Badge>}
                          {c.messagingLimit && <span class="text-fg-muted">Limite {c.messagingLimit}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Recentes */}
              {r.recent.length > 0 && (
                <Card>
                  <div class="text-2xs text-fg-muted uppercase tracking-wider mb-2">Disparos recentes</div>
                  <div class="space-y-1 max-h-96 overflow-auto">
                    {r.recent.map((m) => (
                      <div key={m.wamid} class="flex items-center justify-between text-xs rounded-md bg-surface px-3 py-1.5 border border-border">
                        <span class="text-fg truncate">{m.templateName || 'Mensagem'}{m.category ? ` · ${catLabel(m.category)}` : ''}</span>
                        <span class="flex items-center gap-2 shrink-0">
                          {/* Vendo "todos os números", saber de qual linha saiu cada
                              envio é o que separa relatório de amontoado. */}
                          {multi && selected === null && (
                            <span class="text-fg-muted truncate max-w-[12rem]">{nameOf(m.connectionId)}</span>
                          )}
                          {m.billable && <span class="text-warning">cobrável</span>}
                          <Badge tone={m.status === 'read' ? 'success' : m.status === 'failed' ? 'danger' : m.status === 'delivered' ? 'info' : 'neutral'}>{cloudApiMessageStatusLabel(m.status)}</Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </Page>
  )
}

function NumChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${
        active ? 'bg-accent/15 text-accent border-accent/40' : 'border-border text-fg-muted hover:text-fg hover:bg-surface-3'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function DKpi({ label, value, tone = 'neutral' }: { label: string; value: number | string; tone?: 'neutral' | 'info' | 'success' | 'danger' | 'warning' }) {
  const color = { neutral: 'text-fg', info: 'text-info', success: 'text-success', danger: 'text-danger', warning: 'text-warning' }[tone]
  return (
    <div class="rounded-md border border-border bg-surface-2 p-2.5">
      <div class={`text-lg font-semibold leading-tight ${color}`}>{value}</div>
      <div class="text-2xs text-fg-muted">{label}</div>
    </div>
  )
}
