import { useState, useEffect, useMemo } from 'preact/hooks'
import {
  MessageSquare, Save, Send, CheckCircle, AlertCircle, Info, ExternalLink,
  Eye, EyeOff,
} from 'lucide-preact'
import { useSettings, useUpdateSettings, useTestSms } from '@/hooks/useSettings'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'

const SMS_KEYS = [
  'sms.provider', 'sms.comtele.api_key', 'sms.comtele.default_sender',
] as const

const SMS_TEST_LS_KEY = 'bh_sms_test_result'

interface SmsTestResult {
  ok: boolean
  at: number
  providerId?: string
  error?: string
}

export function SmsSettings() {
  const { data, isLoading } = useSettings()
  const update = useUpdateSettings()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [keyVisible, setKeyVisible] = useState(false)
  const [smsTest, setSmsTest] = useState<SmsTestResult | null>(() => loadSmsTest())

  const initial = useMemo(() => {
    const out: Record<string, string> = {}
    if (data) {
      for (const s of data.settings) {
        if ((SMS_KEYS as readonly string[]).includes(s.key)) out[s.key] = stringifyValue(s.value)
      }
    }
    out['sms.provider'] ??= 'comtele'
    return out
  }, [data])

  useEffect(() => {
    setDraft(initial)
    setDirty(false)
  }, [initial])

  function patch(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
    if (smsTest && key === 'sms.comtele.api_key') {
      setSmsTest(null)
      clearSmsTest()
    }
  }

  function handleSave() {
    update.mutate(draft, {
      onSuccess: () => { toast('Configurações salvas', 'success'); setDirty(false) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  if (isLoading) return <Skeleton class="h-48 w-full" />

  const apiKey = (draft['sms.comtele.api_key'] ?? '').trim()
  const configured = apiKey !== ''

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setTestOpen(true)}
          disabled={!configured || dirty}
          title={dirty ? 'Salve as alterações antes de testar' : 'Enviar SMS de teste'}
        >
          <Send size={12} /> Enviar teste
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || update.isPending}>
          <Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>

      <div class="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-xs text-fg-muted">
        <Info size={16} class="mt-0.5 shrink-0 text-info" />
        <div class="flex-1 leading-relaxed">
          Provedor SMS atual: <strong class="text-fg">Comtele</strong>{' '}
          (
          <a
            href="https://docs.comtele.com.br/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-accent inline-flex items-center gap-0.5 hover:underline"
          >
            docs
            <ExternalLink size={10} />
          </a>
          ). Cada SMS de workflow é enviado via{' '}
          <code class="rounded bg-surface-2 px-1 py-0.5 text-[0.6875rem] font-mono">POST /api/v2/send</code>{' '}
          com a API key abaixo no header{' '}
          <code class="rounded bg-surface-2 px-1 py-0.5 text-[0.6875rem] font-mono">auth-key</code>.
          Os números são normalizados (DDI 55 removido se presente; aceita formato livre).
        </div>
      </div>

      <Card class={configured ? 'border-success/60 ring-1 ring-success/30' : ''}>
        <CardHeader>
          <CardTitle>
            <span class="inline-flex flex-wrap items-center gap-2">
              <MessageSquare size={16} class="text-fg-subtle" /> Comtele
              {configured
                ? <Badge tone="success">CONFIGURADO</Badge>
                : <Badge tone="neutral">SEM CHAVE</Badge>}
              {smsTest && <SmsTestBadge result={smsTest} />}
            </span>
          </CardTitle>
          <span class="text-xs text-fg-subtle">Única opção suportada</span>
        </CardHeader>
        <div class="space-y-3 max-w-xl">
          <div>
            <div class="text-xs font-medium text-fg-muted mb-1">
              API Key (auth-key) <span class="text-danger" aria-label="obrigatório">*</span>
            </div>
            <div class="flex items-stretch gap-2">
              <input
                type={keyVisible ? 'text' : 'password'}
                value={draft['sms.comtele.api_key'] ?? ''}
                onInput={(e) => patch('sms.comtele.api_key', (e.target as HTMLInputElement).value)}
                placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                autoComplete="off"
                class="flex-1 h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-mono"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setKeyVisible((v) => !v)}
                aria-label={keyVisible ? 'Ocultar' : 'Mostrar'}
              >
                {keyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
            <div class="text-[0.6875rem] text-fg-subtle mt-1">
              Encontre em sms.comtele.com.br → Configurações → API.
            </div>
          </div>

          <Input
            label="Remetente padrão"
            value={draft['sms.comtele.default_sender'] ?? ''}
            onInput={(e) => patch('sms.comtele.default_sender', (e.target as HTMLInputElement).value)}
            placeholder="bychat"
            hint="ID interno usado em relatórios da Comtele. Não aparece para o destinatário (entrega via short codes próprios)."
          />
        </div>
      </Card>

      {testOpen && (
        <SendTestModal
          onClose={() => setTestOpen(false)}
          onResult={(r) => { setSmsTest(r); saveSmsTest(r) }}
        />
      )}
    </div>
  )
}

function SmsTestBadge({ result }: { result: SmsTestResult }) {
  const ago = formatAgo(result.at)
  if (result.ok) {
    return (
      <span
        class="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-success"
        title={`Verificado em ${new Date(result.at).toLocaleString('pt-BR')}${result.providerId ? ` (id ${result.providerId})` : ''}`}
      >
        <CheckCircle size={10} /> Verificado {ago}
      </span>
    )
  }
  return (
    <span
      class="inline-flex items-center gap-1 rounded-md bg-danger/15 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-danger"
      title={result.error ?? 'Falha no último teste'}
    >
      <AlertCircle size={10} /> Falhou {ago}
    </span>
  )
}

function SendTestModal({
  onClose, onResult,
}: {
  onClose: () => void
  onResult: (r: SmsTestResult) => void
}) {
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  const test = useTestSms()

  function handleSend() {
    if (!to.trim()) {
      toast('Telefone obrigatório', 'danger')
      return
    }
    const trimmed = message.trim()
    test.mutate({ to: to.trim(), message: trimmed === '' ? undefined : trimmed }, {
      onSuccess: (r) => {
        const result: SmsTestResult = {
          ok: true,
          at: Date.now(),
          ...(r.providerId ? { providerId: r.providerId } : {}),
        }
        onResult(result)
        toast(`SMS enviado${r.providerId ? ` (id: ${r.providerId})` : ''}`, 'success')
        onClose()
      },
      onError: (e: unknown) => {
        const err = (e as Error).message
        onResult({ ok: false, at: Date.now(), error: err })
        toast(err, 'danger')
      },
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Enviar SMS de teste"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={test.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSend} disabled={test.isPending}>
            {test.isPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Telefone"
          value={to}
          onInput={(e) => setTo((e.target as HTMLInputElement).value)}
          placeholder="5511999999999"
          hint="Inclua o código do país sem '+'"
        />
        <Textarea
          label="Mensagem (opcional)"
          value={message}
          onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
          rows={3}
          placeholder="Deixe em branco para usar mensagem padrão"
        />
        {test.isError && (
          <div class="text-xs text-danger inline-flex items-center gap-1">
            <AlertCircle size={12} /> {(test.error)?.message}
          </div>
        )}
        {test.isSuccess && (
          <div class="text-xs text-success inline-flex items-center gap-1">
            <CheckCircle size={12} /> Enviado com sucesso
          </div>
        )}
      </div>
    </Modal>
  )
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.replace(/^"|"$/g, '')
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return '' }
}

function loadSmsTest(): SmsTestResult | null {
  try {
    const raw = localStorage.getItem(SMS_TEST_LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SmsTestResult
    if (typeof parsed?.at !== 'number' || typeof parsed?.ok !== 'boolean') return null
    return parsed
  } catch {
    return null
  }
}

function saveSmsTest(r: SmsTestResult) {
  try { localStorage.setItem(SMS_TEST_LS_KEY, JSON.stringify(r)) } catch { /* noop */ }
}

function clearSmsTest() {
  try { localStorage.removeItem(SMS_TEST_LS_KEY) } catch { /* noop */ }
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
