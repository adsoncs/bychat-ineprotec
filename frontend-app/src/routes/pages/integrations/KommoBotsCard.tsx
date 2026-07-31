// Seção "Chatbots da Kommo" do painel de integração (Configurações → Integrações → Kommo).
//
// A API pública da Kommo entrega apenas os METADADOS dos Salesbots (id, nome,
// ativo) — o roteiro não sai por API. Então: listamos os bots da conta e, para
// cada um, o operador cola o código-fonte (editor do bot na Kommo → "Ver
// código-fonte"). O backend converte em Form + Chatbot `scripted` INATIVO.
//
// Endpoints: GET /admin/kommo/bots · POST /admin/kommo/bots/preview · .../import

import { useState, useEffect, useCallback } from 'preact/hooks'
import { Bot, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Download, ExternalLink } from 'lucide-preact'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'

interface KommoBot {
  id: number
  name: string
  typeFunctionality: string | null
  active: boolean
  imported: boolean
  chatbot: { id: number; name: string; active: boolean; formId: number | null } | null
  importedAt: string | null
}

interface PlanOption {
  value: string
  label: string
  route?: { funnelId?: number | null; stageKey?: string | null; teamId?: number | null; userIds?: number[]; confirmText?: string }
  branchNotes: string[]
}

interface ImportPlan {
  kind: 'chatbot' | 'automation'
  greetingMessage: string
  completionMessage: string
  fields: Array<{ key: string; type: string; label: string; options?: Array<{ value: string; label: string }> }>
  questionCount: number
  options: PlanOption[]
  unsupported: Array<{ handler: string; detail: string; count: number }>
  notes: string[]
  automationSummary: string[]
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function KommoBotsCard({ subdomain, hasToken }: { subdomain: string; hasToken: boolean }) {
  const [bots, setBots] = useState<KommoBot[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // modal de importação
  const [target, setTarget] = useState<KommoBot | null>(null)
  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get<{ bots: KommoBot[] }>('/admin/kommo/bots')
      setBots(r.bots)
    } catch (e) {
      setError(msg(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (hasToken) void load()
  }, [hasToken, load])

  function openImport(bot: KommoBot) {
    setTarget(bot)
    setName(bot.name)
    setSource('')
    setPlan(null)
  }

  async function check() {
    setChecking(true)
    try {
      const r = await api.post<{ plan: ImportPlan }>('/admin/kommo/bots/preview', { source: source.trim() })
      setPlan(r.plan)
      if (r.plan.kind === 'automation') {
        toast('Esse bot é automação de CRM, não conversa — veja o resumo abaixo', 'danger')
      }
    } catch (e) {
      setPlan(null)
      toast(msg(e), 'danger')
    } finally {
      setChecking(false)
    }
  }

  async function doImport() {
    if (!target) return
    setImporting(true)
    try {
      const r = await api.post<{ chatbotId: number; reimported: boolean }>('/admin/kommo/bots/import', {
        kommoBotId: target.id,
        name: name.trim(),
        source: source.trim(),
        channel: 'whatsapp',
      })
      toast(r.reimported ? 'Bot reimportado — chatbot recriado (inativo)' : 'Chatbot criado (inativo) a partir do bot da Kommo', 'success')
      setTarget(null)
      await load()
    } catch (e) {
      toast(msg(e), 'danger')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Card>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-start gap-3">
          <Bot size={20} class="text-info shrink-0 mt-0.5" />
          <div>
            <div class="text-sm font-semibold text-fg">Chatbots da Kommo (Salesbot)</div>
            <p class="text-xs text-fg-muted mt-0.5">
              A Kommo não expõe o roteiro dos bots por API — só o nome e o status. Para trazer um bot,
              abra-o na Kommo, use <strong>Ver código-fonte</strong> e cole o JSON aqui.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading || !hasToken}>
          {loading ? <Loader2 size={12} class="animate-spin" /> : <RefreshCw size={12} />} Atualizar
        </Button>
      </div>

      {!hasToken && (
        <div class="mt-3 text-xs text-fg-muted">Configure o token da Kommo para listar os bots.</div>
      )}

      {error && (
        <div class="mt-3 flex items-start gap-2 p-2.5 rounded-md text-xs bg-danger/10 border border-danger/30 text-danger">
          <AlertTriangle size={14} class="shrink-0 mt-0.5" /> <div>{error}</div>
        </div>
      )}

      {bots && bots.length > 0 && (
        <div class="mt-4 divide-y divide-border rounded-md border border-border overflow-hidden">
          {bots.map((b) => (
            <div key={b.id} class="flex items-center gap-3 px-3 py-2.5 bg-surface">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm text-fg truncate">{b.name}</span>
                  {b.active ? <Badge tone="accent">ativo na Kommo</Badge> : <Badge tone="muted">pausado</Badge>}
                  {b.typeFunctionality && b.typeFunctionality !== 'regular' && <Badge tone="muted">{b.typeFunctionality}</Badge>}
                </div>
                <div class="text-[11px] text-fg-muted mt-0.5">
                  {b.imported && b.chatbot ? (
                    <>
                      Importado como <strong>{b.chatbot.name}</strong> ({b.chatbot.active ? 'ativo' : 'inativo'} no bychat)
                      {b.importedAt && ` · ${new Date(b.importedAt).toLocaleString('pt-BR')}`}
                    </>
                  ) : (
                    <>Ainda não importado · id {b.id}</>
                  )}
                </div>
              </div>
              {subdomain && (
                <a
                  class="text-fg-muted hover:text-fg"
                  href={`https://${subdomain}.kommo.com/settings/pipeline/`}
                  target="_blank"
                  rel="noreferrer"
                  title="Abrir a Kommo"
                >
                  <ExternalLink size={14} />
                </a>
              )}
              <Button variant={b.imported ? 'ghost' : 'secondary'} size="sm" onClick={() => openImport(b)}>
                <Download size={12} /> {b.imported ? 'Reimportar' : 'Importar'}
              </Button>
            </div>
          ))}
        </div>
      )}

      {bots && bots.length === 0 && !loading && (
        <div class="mt-3 text-xs text-fg-muted">Nenhum bot encontrado nessa conta da Kommo.</div>
      )}

      {/* ── Modal de importação ── */}
      <Modal
        open={Boolean(target)}
        onOpenChange={(v) => !v && setTarget(null)}
        title={target ? `Importar “${target.name}”` : ''}
        description="Cole o código-fonte do bot (na Kommo: abra o bot → Ver código-fonte) e revise o que será criado."
        size="xl"
        footer={
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>Cancelar</Button>
            <Button variant="secondary" size="sm" onClick={() => void check()} disabled={checking || !source.trim()}>
              {checking ? <Loader2 size={12} class="animate-spin" /> : <CheckCircle2 size={12} />} Analisar
            </Button>
            <Button variant="primary" size="sm" onClick={() => void doImport()} disabled={importing || !plan || plan.kind === 'automation' || !name.trim()}>
              {importing ? <Loader2 size={12} class="animate-spin" /> : <Download size={12} />} Criar chatbot
            </Button>
          </div>
        }
      >
        <div class="space-y-3">
          <Input label="Nome do chatbot no bychat" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />

          <div>
            <label class="block text-xs font-medium text-fg-muted mb-1">Código-fonte do bot (JSON)</label>
            <textarea
              value={source}
              onInput={(e) => { setSource((e.target as HTMLTextAreaElement).value); setPlan(null) }}
              rows={10}
              spellcheck={false}
              placeholder='[{"question":[{"handler":"show","params":{"type":"text","value":"Olá!"}}]}]'
              class="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs font-mono text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {plan && plan.kind === 'automation' && (
            <div class="rounded-md border border-warning/30 bg-warning/10 p-3 space-y-2 text-xs text-warning">
              <div class="font-semibold">Esse bot não vira chatbot</div>
              <div>Ele não conversa — só executa automações de CRM. No bychat o lugar disso é roteamento de equipe e Workflow.</div>
              {plan.automationSummary.length > 0 && (
                <div>
                  <div class="font-medium mt-1">O que ele faz na Kommo:</div>
                  <ul class="list-disc list-inside">
                    {plan.automationSummary.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
              {plan.notes.map((n, i) => <div key={i}>{n}</div>)}
            </div>
          )}

          {plan && plan.kind === 'chatbot' && (
            <div class="rounded-md border border-border bg-surface-muted/40 p-3 space-y-2.5 text-xs">
              <div class="font-semibold text-fg">O que será criado</div>

              {plan.greetingMessage && (
                <div>
                  <div class="text-fg-muted">Mensagem de abertura</div>
                  <div class="mt-0.5 whitespace-pre-wrap text-fg">{plan.greetingMessage}</div>
                </div>
              )}

              <div>
                <div class="text-fg-muted">Perguntas ({plan.questionCount})</div>
                {plan.questionCount === 0 ? (
                  <div class="text-fg-subtle">Nenhuma — o chatbot só enviará a mensagem de abertura.</div>
                ) : (
                  <ol class="mt-1 space-y-1 list-decimal list-inside">
                    {plan.fields.map((f) => (
                      <li key={f.key} class="text-fg">
                        {f.label}
                        <span class="text-fg-subtle"> · {f.type}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {plan.options.length > 0 && (
                <div>
                  <div class="text-fg-muted">Para onde cada opção encaminha</div>
                  <div class="mt-1 space-y-1.5">
                    {plan.options.map((o) => (
                      <div key={o.value} class="rounded border border-border bg-surface px-2 py-1.5">
                        <div class="text-fg font-medium">{o.label}</div>
                        {o.branchNotes.length > 0 && (
                          <ul class="mt-0.5 list-disc list-inside text-fg-muted">
                            {o.branchNotes.map((n, i) => <li key={i}>{n}</li>)}
                          </ul>
                        )}
                        {o.route?.confirmText && (
                          <div class="mt-0.5 text-fg-subtle">responde: “{o.route.confirmText}”</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {plan.completionMessage && (
                <div>
                  <div class="text-fg-muted">Mensagem de encerramento</div>
                  <div class="mt-0.5 whitespace-pre-wrap text-fg">{plan.completionMessage}</div>
                </div>
              )}

              {(plan.unsupported.length > 0 || plan.notes.length > 0) && (
                <div class="flex items-start gap-2 p-2.5 rounded-md bg-warning/10 border border-warning/30 text-warning">
                  <AlertTriangle size={14} class="shrink-0 mt-0.5" />
                  <div class="space-y-1">
                    <div class="font-medium">Não foi convertido (precisa ser refeito no bychat)</div>
                    {plan.unsupported.map((u) => (
                      <div key={u.handler}>
                        <strong>{u.handler}</strong> ×{u.count} — {u.detail}
                      </div>
                    ))}
                    {plan.notes.map((n, i) => <div key={i}>{n}</div>)}
                  </div>
                </div>
              )}

              <div class="text-fg-muted">
                O chatbot é criado <strong>inativo</strong>, com um formulário próprio contendo as perguntas.
                Revise em Chatbots antes de ligar.
              </div>
            </div>
          )}
        </div>
      </Modal>
    </Card>
  )
}
