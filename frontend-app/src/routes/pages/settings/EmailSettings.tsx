import { useState, useEffect, useMemo } from 'preact/hooks'
import {
  Mail, Save, CheckCircle, AlertCircle, Send, Eye, EyeOff, Info, ExternalLink, Power,
  AtSign,
} from 'lucide-preact'
import { useSettings, useUpdateSettings, useTestSmtp, useTestEmail } from '@/hooks/useSettings'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import type { Tab } from '../SettingsPage'

const SMTP_KEYS = [
  'smtp.host', 'smtp.port', 'smtp.secure', 'smtp.user', 'smtp.pass',
  'smtp.from_name', 'smtp.from_email',
] as const

const RESEND_KEYS = [
  'notification.resend_api_key', 'notification.sender_name', 'notification.email_domain',
] as const

const SMTP_TEST_LS_KEY = 'bh_smtp_test_result'

type Provider = 'resend' | 'smtp'
interface CardStatus {
  state: 'idle' | 'saving' | 'success' | 'error'
  message?: string
}
interface SmtpTestResult {
  ok: boolean
  at: number
  error?: string
}

export function EmailSettings({ onGoToTab }: { onGoToTab?: (tab: Tab) => void } = {}) {
  const { data, isLoading } = useSettings()
  const update = useUpdateSettings()
  const testSmtp = useTestSmtp()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [resendDirty, setResendDirty] = useState(false)
  const [smtpDirty, setSmtpDirty] = useState(false)
  const [resendStatus, setResendStatus] = useState<CardStatus>({ state: 'idle' })
  const [smtpStatus, setSmtpStatus] = useState<CardStatus>({ state: 'idle' })
  const [testEmailOpen, setTestEmailOpen] = useState(false)
  const [resendKeyVisible, setResendKeyVisible] = useState(false)
  const [smtpPassVisible, setSmtpPassVisible] = useState(false)
  const [smtpTest, setSmtpTest] = useState<SmtpTestResult | null>(() => loadSmtpTest())

  const initial = useMemo(() => {
    const out: Record<string, string> = {}
    if (data) {
      for (const s of data.settings) {
        if (
          s.key === 'email.provider' ||
          (SMTP_KEYS as readonly string[]).includes(s.key) ||
          (RESEND_KEYS as readonly string[]).includes(s.key)
        ) {
          out[s.key] = stringifyValue(s.value)
        }
      }
    }
    out['email.provider'] ??= 'resend'
    return out
  }, [data])

  useEffect(() => {
    setDraft(initial)
    setResendDirty(false)
    setSmtpDirty(false)
  }, [initial])

  function patch(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }))
    if ((RESEND_KEYS as readonly string[]).includes(key)) setResendDirty(true)
    else if ((SMTP_KEYS as readonly string[]).includes(key)) {
      setSmtpDirty(true)
      if (smtpTest) {
        setSmtpTest(null)
        clearSmtpTest()
      }
    }
  }

  function activateProvider(provider: Provider) {
    update.mutate({ 'email.provider': provider }, {
      onSuccess: () => {
        setDraft((d) => ({ ...d, 'email.provider': provider }))
        toast(`Provedor ativado: ${provider === 'resend' ? 'Resend' : 'SMTP'}`, 'success')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function saveResend() {
    setResendStatus({ state: 'saving' })
    const payload = Object.fromEntries(
      RESEND_KEYS.map((k) => [k, draft[k] ?? '']),
    )
    update.mutate(payload, {
      onSuccess: () => {
        setResendStatus({ state: 'success', message: 'Salvo com sucesso!' })
        setResendDirty(false)
        setTimeout(() => setResendStatus({ state: 'idle' }), 2500)
      },
      onError: (e: unknown) => {
        setResendStatus({ state: 'error', message: (e as Error).message || 'Erro ao salvar.' })
      },
    })
  }

  function saveSmtp() {
    setSmtpStatus({ state: 'saving' })
    const payload = Object.fromEntries(
      SMTP_KEYS.map((k) => [k, draft[k] ?? '']),
    )
    update.mutate(payload, {
      onSuccess: () => {
        setSmtpStatus({ state: 'success', message: 'Salvo com sucesso!' })
        setSmtpDirty(false)
        setTimeout(() => setSmtpStatus({ state: 'idle' }), 2500)
      },
      onError: (e: unknown) => {
        setSmtpStatus({ state: 'error', message: (e as Error).message || 'Erro ao salvar.' })
      },
    })
  }

  function handleTestSmtp() {
    if (smtpDirty) {
      toast('Salve as alterações antes de testar', 'warning')
      return
    }
    testSmtp.mutate(undefined, {
      onSuccess: () => {
        const r: SmtpTestResult = { ok: true, at: Date.now() }
        setSmtpTest(r)
        saveSmtpTest(r)
        toast('Conexão SMTP OK', 'success')
      },
      onError: (e: unknown) => {
        const err = (e as Error).message
        const r: SmtpTestResult = { ok: false, at: Date.now(), error: err }
        setSmtpTest(r)
        saveSmtpTest(r)
        toast(err, 'danger')
      },
    })
  }

  if (isLoading) return <Skeleton class="h-64 w-full" />

  const provider = (draft['email.provider'] as Provider) ?? 'resend'
  const dirty = resendDirty || smtpDirty
  const resendComplete = !!(draft['notification.resend_api_key'] ?? '').trim()
  const smtpComplete = !!(
    (draft['smtp.host'] ?? '').trim() &&
    (draft['smtp.user'] ?? '').trim() &&
    (draft['smtp.pass'] ?? '').trim()
  )

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setTestEmailOpen(true)}
          disabled={dirty}
          title={dirty ? 'Salve as alterações antes de enviar um teste' : 'Enviar um email de teste'}
        >
          <Send size={12} /> Enviar e-mail de teste
        </Button>
      </div>

      <div class="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-xs text-fg-muted">
        <Info size={16} class="mt-0.5 shrink-0 text-info" />
        <div class="flex-1 leading-relaxed">
          <strong class="text-fg">Provedor de e-mail:</strong> Escolha entre <strong>Resend</strong>{' '}
          (API dedicada, requer DNS) ou <strong>SMTP da hospedagem</strong> (usa servidor de e-mail
          da VPS/domínio). Apenas um provedor fica ativo por vez. Os registros DNS devem ser
          configurados na{' '}
          {onGoToTab ? (
            <button
              type="button"
              onClick={() => onGoToTab('dns')}
              class="text-accent font-semibold hover:underline focus:outline-none focus-visible:underline"
            >
              aba DNS
            </button>
          ) : (
            <strong>aba DNS</strong>
          )}
          .
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ProviderCard
          title="Resend"
          icon={<Mail size={16} class="text-fg-subtle" />}
          active={provider === 'resend'}
          complete={resendComplete}
          onActivate={() => activateProvider('resend')}
          activating={update.isPending}
        >
          <div class="text-[0.6875rem] text-fg-subtle leading-relaxed">
            API de e-mail transacional. Requer configuração de DNS (SPF, DKIM, DMARC) no provedor
            de domínio.
          </div>

          <div class="flex items-start gap-2 rounded-md border border-accent/30 bg-accent/10 p-2.5 text-[0.6875rem] text-fg-muted">
            <Info size={12} class="mt-0.5 shrink-0 text-accent" />
            <span class="flex-1">
              O domínio precisa estar verificado no Resend.{' '}
              <a
                href="https://resend.com/domains"
                target="_blank"
                rel="noopener noreferrer"
                class="text-accent inline-flex items-center gap-0.5 hover:underline"
              >
                Resend → Domains
                <ExternalLink size={10} />
              </a>
            </span>
          </div>

          <div>
            <div class="text-xs font-medium text-fg-muted mb-1">
              API Key <span class="text-danger" aria-label="obrigatório">*</span>
            </div>
            <div class="flex items-stretch gap-2">
              <input
                type={resendKeyVisible ? 'text' : 'password'}
                value={draft['notification.resend_api_key'] ?? ''}
                onInput={(e) => patch('notification.resend_api_key', (e.target as HTMLInputElement).value)}
                placeholder="re_..."
                class="flex-1 h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setResendKeyVisible((v) => !v)}
                aria-label={resendKeyVisible ? 'Ocultar' : 'Mostrar'}
              >
                {resendKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
          </div>

          <Input
            label="Domínio de e-mail"
            value={draft['notification.email_domain'] ?? ''}
            onInput={(e) => patch('notification.email_domain', (e.target as HTMLInputElement).value)}
            placeholder="beyondhub.com.br"
          />

          <Input
            label="Nome do remetente"
            value={draft['notification.sender_name'] ?? ''}
            onInput={(e) => patch('notification.sender_name', (e.target as HTMLInputElement).value)}
            placeholder="BeyondHub"
          />

          {provider === 'resend' && (
            <FromPreview
              from={resendFrom(draft)}
            />
          )}

          <CardFooter
            saveLabel="Salvar Resend"
            onSave={saveResend}
            saving={resendStatus.state === 'saving'}
            disabled={!resendDirty || resendStatus.state === 'saving'}
            status={resendStatus}
          />
        </ProviderCard>

        <ProviderCard
          title="SMTP / Hospedagem"
          icon={<Mail size={16} class="text-fg-subtle" />}
          active={provider === 'smtp'}
          complete={smtpComplete}
          onActivate={() => activateProvider('smtp')}
          activating={update.isPending}
          extraHeader={smtpTest ? <SmtpTestBadge result={smtpTest} /> : undefined}
        >
          <div class="text-[0.6875rem] text-fg-subtle leading-relaxed">
            Servidor SMTP da hospedagem ou domínio. Use os dados fornecidos pelo seu provedor
            (cPanel, Hostgator, Locaweb, etc).
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
            <div>
              <div class="text-xs font-medium text-fg-muted mb-1">
                Servidor SMTP <span class="text-danger" aria-label="obrigatório">*</span>
              </div>
              <input
                type="text"
                value={draft['smtp.host'] ?? ''}
                onInput={(e) => patch('smtp.host', (e.target as HTMLInputElement).value)}
                placeholder="mail.seudominio.com.br"
                class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
              />
            </div>
            <Input
              label="Porta"
              type="number"
              value={draft['smtp.port'] ?? '587'}
              onInput={(e) => patch('smtp.port', (e.target as HTMLInputElement).value)}
              placeholder="587"
            />
          </div>

          <div>
            <div class="text-xs font-medium text-fg-muted mb-1">SSL/TLS</div>
            <select
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
              value={draft['smtp.secure'] ?? 'false'}
              onChange={(e) => patch('smtp.secure', (e.target as HTMLSelectElement).value)}
            >
              <option value="false">Não (STARTTLS na 587)</option>
              <option value="true">Sim (SSL na 465)</option>
            </select>
          </div>

          <div>
            <div class="text-xs font-medium text-fg-muted mb-1">
              Usuário / Login <span class="text-danger" aria-label="obrigatório">*</span>
            </div>
            <input
              type="text"
              value={draft['smtp.user'] ?? ''}
              onInput={(e) => patch('smtp.user', (e.target as HTMLInputElement).value)}
              placeholder="contato@seudominio.com.br"
              autoComplete="off"
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <div class="text-xs font-medium text-fg-muted mb-1">
              Senha <span class="text-danger" aria-label="obrigatório">*</span>
            </div>
            <div class="flex items-stretch gap-2">
              <input
                type={smtpPassVisible ? 'text' : 'password'}
                value={draft['smtp.pass'] ?? ''}
                onInput={(e) => patch('smtp.pass', (e.target as HTMLInputElement).value)}
                placeholder="Senha do e-mail"
                autoComplete="new-password"
                class="flex-1 h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setSmtpPassVisible((v) => !v)}
                aria-label={smtpPassVisible ? 'Ocultar' : 'Mostrar'}
              >
                {smtpPassVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Nome do remetente"
              value={draft['smtp.from_name'] ?? ''}
              onInput={(e) => patch('smtp.from_name', (e.target as HTMLInputElement).value)}
              placeholder="BeyondHub"
            />
            <Input
              label="E-mail do remetente"
              type="email"
              value={draft['smtp.from_email'] ?? ''}
              onInput={(e) => patch('smtp.from_email', (e.target as HTMLInputElement).value)}
              placeholder="contato@seudominio.com.br"
            />
          </div>

          {provider === 'smtp' && (
            <FromPreview
              from={smtpFrom(draft)}
            />
          )}

          <CardFooter
            saveLabel="Salvar SMTP"
            onSave={saveSmtp}
            saving={smtpStatus.state === 'saving'}
            disabled={!smtpDirty || smtpStatus.state === 'saving'}
            status={smtpStatus}
            extraButton={
              <Button
                size="sm"
                variant="secondary"
                onClick={handleTestSmtp}
                disabled={testSmtp.isPending || smtpDirty}
              >
                <Send size={12} /> {testSmtp.isPending ? 'Testando…' : 'Testar conexão'}
              </Button>
            }
          />
        </ProviderCard>
      </div>

      {testEmailOpen && (
        <TestEmailModal
          provider={provider}
          onClose={() => setTestEmailOpen(false)}
        />
      )}
    </div>
  )
}

function ProviderCard({
  title, icon, active, complete, onActivate, activating, extraHeader, children,
}: {
  title: string
  icon: preact.JSX.Element
  active: boolean
  complete: boolean
  onActivate: () => void
  activating: boolean
  extraHeader?: preact.JSX.Element | undefined
  children: preact.ComponentChildren
}) {
  return (
    <Card class={active ? 'border-success/60 ring-1 ring-success/30' : ''}>
      <CardHeader>
        <CardTitle>
          <span class="inline-flex flex-wrap items-center gap-2">
            {icon}
            {title}
            {active
              ? <Badge tone="accent">ATIVO</Badge>
              : <Badge tone="neutral">INATIVO</Badge>}
            {complete
              ? <Badge tone="info" solid>CONFIGURADO</Badge>
              : <Badge tone="warning" solid>INCOMPLETO</Badge>}
            {extraHeader}
          </span>
        </CardTitle>
        {!active && (
          <Button size="sm" variant="primary" onClick={onActivate} disabled={activating}>
            <Power size={12} /> Ativar
          </Button>
        )}
      </CardHeader>
      <div class="space-y-3">{children}</div>
    </Card>
  )
}

function FromPreview({ from }: { from: string }) {
  return (
    <div class="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[0.6875rem] text-fg-muted">
      <AtSign size={12} class="shrink-0 text-fg-subtle" />
      <span class="shrink-0">Remetente final:</span>
      <code class="flex-1 truncate text-[0.6875rem] text-fg font-mono">{from}</code>
    </div>
  )
}

function SmtpTestBadge({ result }: { result: SmtpTestResult }) {
  const ago = formatAgo(result.at)
  if (result.ok) {
    return (
      <span
        class="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-fg-on-brand"
        title={`Verificado em ${new Date(result.at).toLocaleString('pt-BR')}`}
      >
        <CheckCircle size={10} /> Verificado {ago}
      </span>
    )
  }
  return (
    <span
      class="inline-flex items-center gap-1 rounded-md bg-danger px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-white"
      title={result.error ?? 'Falha no último teste'}
    >
      <AlertCircle size={10} /> Falhou {ago}
    </span>
  )
}

function CardFooter({
  saveLabel, onSave, saving, disabled, status, extraButton,
}: {
  saveLabel: string
  onSave: () => void
  saving: boolean
  disabled: boolean
  status: CardStatus
  extraButton?: preact.JSX.Element
}) {
  return (
    <div class="flex items-center gap-2 pt-1">
      <Button
        size="sm"
        variant="primary"
        onClick={onSave}
        disabled={disabled}
      >
        <Save size={12} /> {saving ? 'Salvando…' : saveLabel}
      </Button>
      {extraButton}
      <div class="text-xs min-h-[1rem] flex-1">
        {status.state === 'success' && (
          <span class="text-accent inline-flex items-center gap-1">
            <CheckCircle size={12} /> {status.message}
          </span>
        )}
        {status.state === 'error' && (
          <span class="text-danger inline-flex items-center gap-1">
            <AlertCircle size={12} /> {status.message}
          </span>
        )}
      </div>
    </div>
  )
}

function TestEmailModal({
  provider, onClose,
}: {
  provider: Provider
  onClose: () => void
}) {
  const test = useTestEmail()
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)

  function send() {
    setError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setError('Informe um e-mail válido')
      return
    }
    test.mutate(to.trim(), {
      onSuccess: () => { toast('E-mail de teste enviado', 'success'); onClose() },
      onError: (e: unknown) => setError((e as Error).message || 'Falha ao enviar'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Enviar e-mail de teste"
      size="sm"
    >
      <div class="space-y-3">
        <p class="text-xs text-fg-muted">
          Um e-mail de validação será enviado via <strong>{provider === 'resend' ? 'Resend' : 'SMTP'}</strong> ao
          endereço informado, usando o remetente atualmente configurado.
        </p>
        <Input
          label="E-mail destinatário"
          type="email"
          placeholder="voce@exemplo.com"
          value={to}
          onInput={(e) => setTo((e.target as HTMLInputElement).value)}
          autofocus
        />
        {error && <div class="text-xs text-danger">{error}</div>}
        <div class="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={send} disabled={test.isPending}>
            <Send size={12} /> {test.isPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') {
    return v.replace(/^"|"$/g, '')
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return '' }
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? fallback : trimmed
}

function resendFrom(draft: Record<string, string>): string {
  const name = nonEmpty(draft['notification.sender_name'], 'BeyondHub')
  const domain = nonEmpty(draft['notification.email_domain'], 'beyondhub.com.br')
  return `${name} <noreply@${domain}>`
}

function smtpFrom(draft: Record<string, string>): string {
  const name = nonEmpty(draft['smtp.from_name'], 'BeyondHub')
  const fromEmail = (draft['smtp.from_email'] ?? '').trim()
  const userEmail = (draft['smtp.user'] ?? '').trim()
  const email = fromEmail !== '' ? fromEmail : userEmail !== '' ? userEmail : '—'
  return `${name} <${email}>`
}

function loadSmtpTest(): SmtpTestResult | null {
  try {
    const raw = localStorage.getItem(SMTP_TEST_LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SmtpTestResult
    if (typeof parsed?.at !== 'number' || typeof parsed?.ok !== 'boolean') return null
    return parsed
  } catch {
    return null
  }
}

function saveSmtpTest(r: SmtpTestResult) {
  try { localStorage.setItem(SMTP_TEST_LS_KEY, JSON.stringify(r)) } catch { /* noop */ }
}

function clearSmtpTest() {
  try { localStorage.removeItem(SMTP_TEST_LS_KEY) } catch { /* noop */ }
}

function formatAgo(at: number): string {
  const diff = Math.max(0, Date.now() - at)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'agora'
  const min = Math.floor(sec / 60)
  if (min < 60) return `há ${min}min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `há ${hr}h`
  const day = Math.floor(hr / 24)
  return `há ${day}d`
}
