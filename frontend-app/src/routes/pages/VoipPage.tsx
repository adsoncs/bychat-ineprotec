import { useState, useEffect } from 'preact/hooks'
import { Phone, PlugZap, Users, History, Save, Loader2, Check, X } from 'lucide-preact'
import {
  useVoipConfig,
  useUpdateVoipConfig,
  useTestVoipConnection,
  useVoipExtensions,
  useUpdateVoipExtensions,
  useVoipCalls,
  useSyncRecordings,
  type VoipConfigInput,
  type VoipTestResult,
  type VoipCall,
} from '@/hooks/useVoip'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

type Tab = 'conexao' | 'ramais' | 'historico'

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: any; children: any }) {
  const Icon = icon
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
        active ? 'border-primary text-primary' : 'border-transparent text-fg-muted hover:text-fg',
      )}
    >
      <Icon size={15} /> {children}
    </button>
  )
}

export function VoipPage() {
  const [tab, setTab] = useState<Tab>('conexao')
  return (
    <Page title="VoIP" description="Telefonia integrada FaleMaisVoip — click-to-call, ramais e gravações.">
      <div class="flex items-center gap-1 border-b border-border mb-4">
        <TabButton active={tab === 'conexao'} onClick={() => setTab('conexao')} icon={PlugZap}>Conexão</TabButton>
        <TabButton active={tab === 'ramais'} onClick={() => setTab('ramais')} icon={Users}>Ramais</TabButton>
        <TabButton active={tab === 'historico'} onClick={() => setTab('historico')} icon={History}>Histórico</TabButton>
      </div>
      {tab === 'conexao' && <ConnectionTab />}
      {tab === 'ramais' && <ExtensionsTab />}
      {tab === 'historico' && <HistoryTab />}
    </Page>
  )
}

// ─────────────────────────────────────────────────────────────
function ConnectionTab() {
  const { data, isLoading } = useVoipConfig()
  const update = useUpdateVoipConfig()
  const test = useTestVoipConnection()

  const [form, setForm] = useState<VoipConfigInput>({})
  const [testResult, setTestResult] = useState<VoipTestResult | null>(null)

  const cfg = data?.config

  // Preenche os campos não-secretos a partir do servidor (uma vez por carga).
  useEffect(() => {
    if (!cfg) return
    setForm({
      enabled: cfg.enabled,
      sigma: { baseUrl: cfg.sigma.baseUrl, user: cfg.sigma.user, accountCode: cfg.sigma.accountCode, defaultCallerId: cfg.sigma.defaultCallerId },
      gravacoes: { baseUrl: cfg.gravacoes.baseUrl, email: cfg.gravacoes.email, insecureTLS: cfg.gravacoes.insecureTLS },
      recordings: { autoSync: cfg.recordings.autoSync, syncIntervalMin: cfg.recordings.syncIntervalMin },
    })
  }, [cfg])

  function patchSigma(k: string, v: any) { setForm((f) => ({ ...f, sigma: { ...f.sigma, [k]: v } })) }
  function patchGrav(k: string, v: any) { setForm((f) => ({ ...f, gravacoes: { ...f.gravacoes, [k]: v } })) }
  function patchRec(k: string, v: any) { setForm((f) => ({ ...f, recordings: { ...f.recordings, [k]: v } })) }

  function handleSave() {
    update.mutate(form, {
      onSuccess: () => {
        toast('Configuração salva', 'success')
        // Limpa os campos de senha (já gravados) sem deixá-los como `undefined` explícito
        setForm((f) => {
          const { password: _sp, token: _st, ...sigma } = f.sigma ?? {}
          const { password: _gp, ...gravacoes } = f.gravacoes ?? {}
          return { ...f, sigma, gravacoes }
        })
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleTest() {
    test.mutate(undefined, {
      onSuccess: (r) => setTestResult(r),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  if (isLoading) return <Skeleton class="h-64" />

  return (
    <div class="space-y-4 max-w-3xl">
      <Card>
        <label class="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: (e.target as HTMLInputElement).checked }))} />
          Módulo VoIP ativo
        </label>
        <p class="text-xs text-fg-muted mt-1">Quando ativo, o botão "Ligar" aparece nos leads e o histórico/gravações são sincronizados.</p>
      </Card>

      <Card>
        <CardHeader><CardTitle>API de Ligação (Sigma REST)</CardTitle></CardHeader>
        <p class="text-xs text-fg-muted mb-3">Usada pelo click-to-call. Login do PABX Virtual.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Base URL" value={form.sigma?.baseUrl ?? ''} onInput={(e) => patchSigma('baseUrl', (e.target as HTMLInputElement).value)} placeholder="https://app.falemaisvoip.com.br/api/seg" />
          <Input label="Usuário" value={form.sigma?.user ?? ''} onInput={(e) => patchSigma('user', (e.target as HTMLInputElement).value)} />
          <Input label="Senha" type="password" value={form.sigma?.password ?? ''} onInput={(e) => patchSigma('password', (e.target as HTMLInputElement).value)} placeholder={cfg?.sigma.hasPassword ? cfg.sigma.passwordMasked : 'definir senha'} />
          <Input label="Token (opcional)" type="password" value={form.sigma?.token ?? ''} onInput={(e) => patchSigma('token', (e.target as HTMLInputElement).value)} placeholder={cfg?.sigma.hasToken ? cfg.sigma.tokenMasked : 'token pronto da FaleMaisVoip'} hint="Se a FaleMaisVoip te enviou um token pronto, cole aqui — ele dispensa usuário/senha. Deixe vazio para usar usuário/senha." />
          <Input label="Accountcode (fila)" value={form.sigma?.accountCode ?? ''} onInput={(e) => patchSigma('accountCode', (e.target as HTMLInputElement).value)} hint="Opcional — usado por /queue" />
          <Input label="Bina padrão (callerId)" value={form.sigma?.defaultCallerId ?? ''} onInput={(e) => patchSigma('defaultCallerId', (e.target as HTMLInputElement).value)} hint="Opcional — só dígitos" />
        </div>
      </Card>

      <Card>
        <CardHeader><CardTitle>API de Gravações (PabxVirtual)</CardTitle></CardHeader>
        <p class="text-xs text-fg-muted mb-3">Usada pela sincronização do histórico e download de gravações em massa.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Base URL" value={form.gravacoes?.baseUrl ?? ''} onInput={(e) => patchGrav('baseUrl', (e.target as HTMLInputElement).value)} placeholder="https://apigravacoes.falemaisvoip.com.br" />
          <Input label="Email" value={form.gravacoes?.email ?? ''} onInput={(e) => patchGrav('email', (e.target as HTMLInputElement).value)} />
          <Input label="Senha" type="password" value={form.gravacoes?.password ?? ''} onInput={(e) => patchGrav('password', (e.target as HTMLInputElement).value)} placeholder={cfg?.gravacoes.hasPassword ? cfg.gravacoes.passwordMasked : 'definir senha'} />
        </div>
        <label class="flex items-start gap-2 text-sm cursor-pointer mt-3">
          <input type="checkbox" class="mt-0.5" checked={!!form.gravacoes?.insecureTLS} onChange={(e) => patchGrav('insecureTLS', (e.target as HTMLInputElement).checked)} />
          <span>
            Aceitar certificado TLS inválido (Gravações)
            <span class="block text-xs text-fg-muted">Use apenas se o login das Gravações falhar com "certificate has expired" — o certificado da FaleMaisVoip está vencido. ⚠️ Desliga a validação do certificado só nas chamadas de Gravações (risco de interceptação).</span>
          </span>
        </label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!form.recordings?.autoSync} onChange={(e) => patchRec('autoSync', (e.target as HTMLInputElement).checked)} />
            Sincronizar gravações automaticamente
          </label>
          <Input label="Intervalo de sync (min)" type="number" value={String(form.recordings?.syncIntervalMin ?? 60)} onInput={(e) => patchRec('syncIntervalMin', parseInt((e.target as HTMLInputElement).value, 10) || 60)} />
        </div>
      </Card>

      <div class="flex items-center gap-2">
        <Button variant="primary" onClick={handleSave} disabled={update.isPending}>
          {update.isPending ? <Loader2 size={14} class="animate-spin" /> : <Save size={14} />} Salvar
        </Button>
        <Button variant="secondary" onClick={handleTest} disabled={test.isPending}>
          {test.isPending ? <Loader2 size={14} class="animate-spin" /> : <PlugZap size={14} />} Testar conexão
        </Button>
      </div>

      {testResult && (
        <Card>
          <CardHeader><CardTitle>Resultado do teste</CardTitle></CardHeader>
          <div class="space-y-2 text-sm">
            <TestLine ok={testResult.sigma.status} label="Sigma — serviço" detail={testResult.sigma.statusError ?? 'online'} />
            <TestLine ok={testResult.sigma.auth} label="Sigma — autenticação" detail={testResult.sigma.authMessage} />
            <TestLine ok={testResult.gravacoes.login} label="Gravações — login" detail={testResult.gravacoes.message} />
          </div>
        </Card>
      )}
    </div>
  )
}

function TestLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div class="flex items-center gap-2">
      {ok ? <Check size={16} class="text-success" /> : <X size={16} class="text-danger" />}
      <span class="font-medium">{label}:</span>
      <span class="text-fg-muted">{detail}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function ExtensionsTab() {
  const { data, isLoading } = useVoipExtensions()
  const update = useUpdateVoipExtensions()
  const [edits, setEdits] = useState<Record<number, string>>({})

  const users = data?.users ?? []

  function handleSave() {
    const extensions = users.map((u) => {
      const raw = edits[u.id] ?? u.voipExtension ?? ''
      return { userId: u.id, extension: raw.trim() || null }
    })
    update.mutate(extensions, {
      onSuccess: () => { toast('Ramais atualizados', 'success'); setEdits({}) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  if (isLoading) return <Skeleton class="h-64" />

  return (
    <Card>
      <CardHeader><CardTitle>Ramais por operador</CardTitle></CardHeader>
      <p class="text-xs text-fg-muted mb-3">O ramal é usado no click-to-call: a ligação toca neste ramal e depois disca o destino.</p>
      <div class="divide-y divide-border">
        {users.map((u) => (
          <div key={u.id} class="flex items-center gap-3 py-2">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">{u.name}</div>
              <div class="text-xs text-fg-muted truncate">{u.email} · {u.role}</div>
            </div>
            <input
              class="w-32 px-2 py-1 text-sm rounded border border-border bg-bg"
              placeholder="ramal"
              value={edits[u.id] !== undefined ? edits[u.id] : (u.voipExtension ?? '')}
              onInput={(e) => setEdits((s) => ({ ...s, [u.id]: (e.target as HTMLInputElement).value }))}
            />
          </div>
        ))}
      </div>
      <div class="mt-3">
        <Button variant="primary" onClick={handleSave} disabled={update.isPending}>
          {update.isPending ? <Loader2 size={14} class="animate-spin" /> : <Save size={14} />} Salvar ramais
        </Button>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  dialing: 'info',
  answered: 'accent' as any,
  completed: 'success',
  no_answer: 'warning',
  busy: 'warning',
  failed: 'danger',
}
const STATUS_LABEL: Record<string, string> = {
  dialing: 'Discando',
  answered: 'Atendida',
  completed: 'Concluída',
  no_answer: 'Não atendeu',
  busy: 'Ocupado',
  failed: 'Falhou',
}

function fmtDuration(sec: number | null): string {
  if (!sec || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function HistoryTab() {
  const { data, isLoading } = useVoipCalls({ limit: 200 })
  const sync = useSyncRecordings()
  const calls = data?.calls ?? []

  function handleSync() {
    sync.mutate({}, {
      onSuccess: (r) => {
        if (r.result.error) toast(r.result.error, 'danger')
        else toast(`Sync: ${r.result.imported} novas, ${r.result.recordings} gravações`, 'success')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const syncBtn = (
    <Button variant="secondary" size="sm" onClick={handleSync} disabled={sync.isPending}>
      {sync.isPending ? <Loader2 size={14} class="animate-spin" /> : <History size={14} />} Sincronizar gravações
    </Button>
  )

  if (isLoading) return <Skeleton class="h-64" />
  if (!calls.length) {
    return (
      <div class="space-y-3">
        <div class="flex justify-end">{syncBtn}</div>
        <EmptyState title="Sem ligações" description="As ligações aparecerão aqui assim que forem feitas ou sincronizadas." />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de chamadas</CardTitle>
        {syncBtn}
      </CardHeader>
      <div class="divide-y divide-border">
        {calls.map((c: VoipCall) => (
          <div key={c.id} class="flex items-center gap-3 py-2">
            <Phone size={16} class="text-fg-muted shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">{c.phone}{c.userName ? <span class="text-fg-muted font-normal"> · {c.userName}</span> : null}</div>
              <div class="text-xs text-fg-muted">{formatDateTime(c.startedAt)} · {fmtDuration(c.durationSec)} {c.extension ? `· ramal ${c.extension}` : ''} · {c.source === 'bulk_sync' ? 'sync' : 'click-to-call'}</div>
            </div>
            <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
            {c.recordingUrl && <audio controls src={c.recordingUrl} class="h-8 max-w-[220px]" />}
          </div>
        ))}
      </div>
    </Card>
  )
}
