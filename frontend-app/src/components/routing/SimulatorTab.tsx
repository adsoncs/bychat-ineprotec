import { useState } from 'preact/hooks'
import { Check, X as XIcon, ArrowRight, AlertTriangle } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'
import {
  useSimulateRouting, useRoutingTeams, useAgents,
  type RoutingSimContext, type SimulationResponse,
} from '@/hooks/useRouting'

const SOURCE_OPTIONS = ['form', 'inbound', 'meta', 'chatbot', 'whatsapp', 'api', 'manual']

export function SimulatorTab() {
  const [ctx, setCtx] = useState<RoutingSimContext>({})
  const [result, setResult] = useState<SimulationResponse | null>(null)
  const simulate = useSimulateRouting()
  const teams = useRoutingTeams()
  const agents = useAgents()

  const set = (patch: Record<string, unknown>) => setCtx((p) => ({ ...p, ...patch } as RoutingSimContext))

  const handleRun = async () => {
    try {
      const payload = { ...ctx }
      // Coerce IDs vazios pra undefined.
      if ((payload as any).formId === '') delete (payload as any).formId
      if ((payload as any).chatbotId === '') delete (payload as any).chatbotId
      const res = await simulate.mutateAsync(payload)
      setResult(res)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao simular'
      toast(msg, 'danger')
    }
  }

  const teamName = (id: number | null | undefined) =>
    id ? (teams.data?.teams.find((t) => t.id === id)?.name ?? `#${id}`) : '—'
  const agentName = (id: number | null | undefined) =>
    id ? (agents.data?.agents.find((a) => a.id === id)?.name ?? `#${id}`) : '—'

  return (
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <div class="p-4 space-y-3">
          <div>
            <h3 class="text-sm font-semibold">Contexto sintético</h3>
            <p class="text-xs text-fg-muted">Preencha somente os campos que viriam no payload real.</p>
          </div>
          <Select
            label="Origem (source)"
            value={ctx.source ?? ''}
            onChange={(e) => set({ source: (e.currentTarget as HTMLSelectElement).value || undefined })}
          >
            <option value="">—</option>
            {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <div class="grid grid-cols-2 gap-2">
            <Input label="UTM Source" value={ctx.utmSource ?? ''} onInput={(e) => set({ utmSource: (e.currentTarget as HTMLInputElement).value })} />
            <Input label="UTM Medium" value={ctx.utmMedium ?? ''} onInput={(e) => set({ utmMedium: (e.currentTarget as HTMLInputElement).value })} />
            <Input label="UTM Campaign" value={ctx.utmCampaign ?? ''} onInput={(e) => set({ utmCampaign: (e.currentTarget as HTMLInputElement).value })} />
            <Input label="UTM Content" value={ctx.utmContent ?? ''} onInput={(e) => set({ utmContent: (e.currentTarget as HTMLInputElement).value })} />
            <Input label="UTM Term" value={ctx.utmTerm ?? ''} onInput={(e) => set({ utmTerm: (e.currentTarget as HTMLInputElement).value })} />
            <Input label="Form ID" type="number" value={ctx.formId == null ? '' : String(ctx.formId)} onInput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value
              set({ formId: v === '' ? null : parseInt(v) })
            }} />
            <Input label="Chatbot ID" type="number" value={ctx.chatbotId == null ? '' : String(ctx.chatbotId)} onInput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value
              set({ chatbotId: v === '' ? null : parseInt(v) })
            }} />
            <Input label="WhatsApp instance" value={ctx.instanceName ?? ''} onInput={(e) => set({ instanceName: (e.currentTarget as HTMLInputElement).value })} />
            <Input label="Tag" value={ctx.tag ?? ''} onInput={(e) => set({ tag: (e.currentTarget as HTMLInputElement).value })} />
          </div>
          <div class="flex gap-2">
            <Button onClick={handleRun} disabled={simulate.isPending}>
              {simulate.isPending ? 'Avaliando…' : 'Avaliar regras'}
            </Button>
            <Button variant="ghost" onClick={() => { setCtx({}); setResult(null) }}>
              Limpar
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div class="p-4">
          <h3 class="text-sm font-semibold mb-3">Resultado</h3>
          {!result ? (
            <p class="text-xs text-fg-muted">Preencha o contexto e clique em Avaliar.</p>
          ) : (
            <>
              <div class="bg-surface-2 border border-border rounded p-3 mb-4">
                <div class="text-xs uppercase tracking-wide text-fg-muted mb-1">Decisão final</div>
                {result.decision.ruleId ? (
                  <div class="text-sm">
                    Regra <strong>#{result.decision.ruleId} {result.decision.ruleName}</strong>{' '}
                    <ArrowRight class="inline w-4 h-4 mx-1 text-fg-muted" />{' '}
                    Setor <strong>{teamName(result.decision.teamId)}</strong> /{' '}
                    Agente <strong>{agentName(result.decision.userId)}</strong>
                  </div>
                ) : (
                  <div class="text-sm flex items-center gap-2 text-fg-muted">
                    <AlertTriangle class="w-4 h-4" />
                    Nenhuma regra casou — caiu na cascata legada:{' '}
                    Setor <strong>{teamName(result.decision.teamId)}</strong> /{' '}
                    Agente <strong>{agentName(result.decision.userId)}</strong>
                  </div>
                )}
              </div>

              <div class="space-y-2">
                {result.inspection.rules.length === 0 ? (
                  <p class="text-xs text-fg-muted">Nenhuma regra cadastrada.</p>
                ) : result.inspection.rules.map((r) => (
                  <div
                    key={r.ruleId}
                    class={`border rounded p-3 text-xs ${
                      r.matched
                        ? 'border-success/40 bg-success/5'
                        : r.skipped
                          ? 'border-border opacity-60'
                          : 'border-border'
                    }`}
                  >
                    <div class="flex items-center justify-between gap-2 mb-2">
                      <div class="flex items-center gap-2">
                        <span class="text-fg-muted tabular-nums">#{r.order + 1}</span>
                        <span class="font-medium">{r.name}</span>
                        {r.matched && <Badge tone="success">VENCEDORA</Badge>}
                        {r.skipped === 'disabled' && <Badge tone="neutral">Desabilitada</Badge>}
                        {r.skipped === 'invalid' && <Badge tone="danger">Inválida</Badge>}
                      </div>
                    </div>
                    {r.conditions.length === 0 ? (
                      <div class="text-fg-muted italic">sem condições (catch-all)</div>
                    ) : (
                      <ul class="space-y-1">
                        {r.conditions.map((c, i) => (
                          <li key={i} class="flex items-start gap-2">
                            {c.matched
                              ? <Check class="w-3 h-3 text-success mt-0.5 shrink-0" />
                              : <XIcon class="w-3 h-3 text-danger mt-0.5 shrink-0" />
                            }
                            <span>
                              <code class="text-fg">{c.field}</code>{' '}
                              <span class="text-fg-muted">{c.op}</span>{' '}
                              <code class="text-fg">
                                {Array.isArray(c.expected) ? `[${c.expected.join(', ')}]` : JSON.stringify(c.expected ?? null)}
                              </code>
                              <span class="text-fg-muted ml-2">(valor: {JSON.stringify(c.fieldValue ?? null)})</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.action && (
                      <div class="mt-2 text-fg-muted">
                        Ação:{' '}
                        {r.action.type === 'team' && `Setor ${teamName(r.action.teamId)}`}
                        {r.action.type === 'user' && `Agente ${agentName(r.action.userId)}`}
                        {r.action.type === 'skill' && `Skill ${r.action.skill} em ${teamName(r.action.teamId)}`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
