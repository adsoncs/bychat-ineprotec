// Painel da integração Kommo CRM (Configurações → Integrações → Kommo CRM).
// Configura credenciais, testa conexão, dispara importação completa /
// sincronização incremental e acompanha o status ao vivo.
//
// Endpoints (backend routes/kommoIntegration.ts):
//   GET  /admin/kommo/config   POST /admin/kommo/config
//   POST /admin/kommo/test     POST /admin/kommo/sync   GET /admin/kommo/status

import { useState, useEffect, useCallback } from 'preact/hooks'
import { Plug, Save, Eye, EyeOff, RefreshCw, DownloadCloud, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-preact'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'
import { KommoBotsCard } from './KommoBotsCard'

interface KommoConfig {
  subdomain: string | null
  enabled: boolean
  hasToken: boolean
  lastSyncAt: string | null
}

interface KommoStatus {
  state: Record<string, unknown> | null
  lastSyncAt: number | null
  lastSyncAtIso: string | null
  queue: { waiting: number; active: number }
  counts: Record<string, number>
}

const COUNT_LABELS: Array<[string, string]> = [
  ['lead', 'Leads'],
  ['contact', 'Contatos'],
  ['note', 'Notas'],
  ['task', 'Tarefas'],
  ['tag', 'Tags'],
  ['custom_field', 'Campos'],
  ['pipeline', 'Funis'],
  ['catalog_element', 'Catálogo'],
]

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function KommoIntegration() {
  const [loading, setLoading] = useState(true)
  const [subdomain, setSubdomain] = useState('')
  const [token, setToken] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [hasToken, setHasToken] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<KommoStatus | null>(null)

  const loadConfig = useCallback(async () => {
    try {
      const c = await api.get<KommoConfig>('/admin/kommo/config')
      setSubdomain(c.subdomain ?? '')
      setEnabled(c.enabled)
      setHasToken(c.hasToken)
    } catch (e) {
      toast(msg(e), 'danger')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.get<KommoStatus>('/admin/kommo/status'))
    } catch {
      /* silencioso — status é best-effort */
    }
  }, [])

  useEffect(() => {
    void loadConfig()
    void loadStatus()
  }, [loadConfig, loadStatus])

  useEffect(() => {
    const id = setInterval(() => void loadStatus(), 5000)
    return () => clearInterval(id)
  }, [loadStatus])

  async function save() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { subdomain: subdomain.trim(), enabled }
      if (token.trim()) body.token = token.trim()
      await api.post('/admin/kommo/config', body)
      toast('Configuração salva', 'success')
      setToken('')
      await loadConfig()
    } catch (e) {
      toast(msg(e), 'danger')
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    try {
      const body: Record<string, unknown> = {}
      if (subdomain.trim()) body.subdomain = subdomain.trim()
      if (token.trim()) body.token = token.trim()
      const r = await api.post<{ ok: boolean; account?: { name: string } }>('/admin/kommo/test', body)
      toast(`Conectado à Kommo: ${r.account?.name ?? 'OK'}`, 'success')
    } catch (e) {
      toast(msg(e), 'danger')
    } finally {
      setTesting(false)
    }
  }

  async function sync(mode: 'full' | 'incremental') {
    try {
      await api.post('/admin/kommo/sync', { mode })
      toast(mode === 'full' ? 'Importação completa iniciada' : 'Sincronização iniciada', 'success')
      await loadStatus()
    } catch (e) {
      toast(msg(e), 'danger')
    }
  }

  if (loading) return <div class="text-sm text-fg-muted">Carregando…</div>

  const state = status?.state ?? null
  const running = Boolean(state?.['running'])
  const phase = (state?.['phase'] as string) ?? null

  return (
    <div class="space-y-3">
      {/* ── Configuração ── */}
      <Card>
        <div class="flex items-start gap-3">
          <Plug size={20} class="text-info shrink-0 mt-0.5" />
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <div class="text-sm font-semibold text-fg">Kommo CRM</div>
              {hasToken ? <Badge tone="accent">Configurado</Badge> : <Badge tone="warning" solid>Não configurado</Badge>}
              {enabled && <Badge tone="accent">Sync ativa</Badge>}
            </div>
            <p class="text-xs text-fg-muted mt-1">
              Importa leads, contatos, tags, notas e tarefas da Kommo. A sincronização incremental
              roda automaticamente quando ativa.
            </p>
          </div>
        </div>

        <div class="mt-4 space-y-3">
          <Input
            label="Subdomínio"
            type="text"
            value={subdomain}
            onInput={(e) => setSubdomain((e.target as HTMLInputElement).value)}
            placeholder="ex: minhaempresa (de minhaempresa.kommo.com)"
          />

          <div class="flex items-end gap-2">
            <div class="flex-1">
              <Input
                label="Token (JWT de longa duração)"
                type={showToken ? 'text' : 'password'}
                value={token}
                onInput={(e) => setToken((e.target as HTMLInputElement).value)}
                placeholder={hasToken ? '•••••••••• (salvo — preencha só para trocar)' : 'Cole o token da Kommo'}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowToken((v) => !v)} title={showToken ? 'Ocultar' : 'Mostrar'}>
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
          </div>

          <label class="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
              class="size-4 accent-[var(--accent)]"
            />
            Sincronização automática ativa (cron incremental)
          </label>

          <div class="flex items-start gap-2 p-2.5 rounded-md text-xs bg-warning/10 border border-warning/30 text-warning">
            <AlertTriangle size={14} class="shrink-0 mt-0.5" />
            <div>O token JWT da Kommo expira. Se a sincronização parar com erro de autenticação, gere um novo token na Kommo e cole aqui.</div>
          </div>

          <div class="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="secondary" size="sm" onClick={() => void test()} disabled={testing}>
              {testing ? <Loader2 size={12} class="animate-spin" /> : <CheckCircle2 size={12} />}
              {testing ? ' Testando…' : ' Testar conexão'}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
              <Save size={12} /> {saving ? ' Salvando…' : ' Salvar'}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Importação / Status ── */}
      <Card>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-sm font-semibold text-fg">Importação & Sincronização</div>
            <p class="text-xs text-fg-muted mt-0.5">
              {running ? (
                <span class="inline-flex items-center gap-1 text-info">
                  <Loader2 size={12} class="animate-spin" /> Em andamento — fase: <strong>{phase}</strong>
                  {typeof state?.['page'] === 'number' ? ` (página ${state['page'] as number})` : ''}
                </span>
              ) : phase === 'done' ? (
                <span class="text-accent">Última sincronização concluída.</span>
              ) : phase === 'error' ? (
                <span class="text-danger">Erro: {String(state?.['error'] ?? 'falha na sincronização')}</span>
              ) : (
                'Nenhuma sincronização em andamento.'
              )}
              {status?.lastSyncAtIso && (
                <span class="text-fg-muted"> · Último sync: {new Date(status.lastSyncAtIso).toLocaleString('pt-BR')}</span>
              )}
            </p>
          </div>
          <div class="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void sync('incremental')} disabled={running || !hasToken}>
              <RefreshCw size={12} /> Sincronizar agora
            </Button>
            <Button variant="primary" size="sm" onClick={() => void sync('full')} disabled={running || !hasToken}>
              <DownloadCloud size={12} /> Importar tudo
            </Button>
          </div>
        </div>

        {/* contadores */}
        <div class="mt-4 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {COUNT_LABELS.map(([key, label]) => (
            <div key={key} class="rounded-md border border-border bg-surface-muted/40 px-3 py-2 text-center">
              <div class="text-lg font-semibold text-fg tabular-nums">{status?.counts?.[key] ?? 0}</div>
              <div class="text-[11px] text-fg-muted">{label}</div>
            </div>
          ))}
        </div>
        {(status && (status.queue.waiting > 0 || status.queue.active > 0)) && (
          <div class="mt-2 text-[11px] text-fg-muted">Fila: {status.queue.active} ativo(s), {status.queue.waiting} aguardando.</div>
        )}
      </Card>

      {/* ── Chatbots (Salesbot) ── */}
      <KommoBotsCard subdomain={subdomain.trim()} hasToken={hasToken} />
    </div>
  )
}
