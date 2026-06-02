import { useEffect, useMemo, useState } from 'preact/hooks'
import { Send, AlertCircle, CheckCircle, Plug, Trash2, ExternalLink, Webhook, Copy, Clock, Settings, HelpCircle } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import {
  useInstagramConnection,
  useDisconnectInstagram,
  useDisconnectInstagramBusinessLogin,
  useInstagramOAuthStartUrl,
  useInstagramOAuthConfig,
  useSaveInstagramOAuthConfig,
  useInstagramSendTest,
  useInstagramWebhookInfo,
  useInstagramRecentRecipients,
} from '@/hooks/useInstagram'
import { useUserStore } from '@/stores/user'
import { InstagramSignupModal } from '@/components/InstagramSignupModal'
import { toast } from '@/lib/toast'

function InstagramLogo({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="shrink-0"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}

export function InstagramPage() {
  const { data, isLoading } = useInstagramConnection()
  const [signupOpen, setSignupOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const disconnect = useDisconnectInstagram()
  const disconnectV2 = useDisconnectInstagramBusinessLogin()
  const oauthStart = useInstagramOAuthStartUrl()
  const user = useUserStore((s) => s.user)
  const isAdmin = !!user && (user.role === 'admin' || user.role === 'superadmin' || user.role === 'SUPERADMIN' || user.role === 'ADMIN')
  const [configOpen, setConfigOpen] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  // Processa retorno do OAuth (?connected=1 / ?error=...). Limpa a URL após.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const connected = sp.get('connected')
    const error = sp.get('error')
    if (!connected && !error) return
    if (connected) toast('Instagram conectado com sucesso', 'success')
    if (error) toast(error, 'danger', 6000)
    sp.delete('connected')
    sp.delete('error')
    const qs = sp.toString()
    const newUrl = window.location.pathname + (qs ? `?${qs}` : '')
    window.history.replaceState({}, '', newUrl)
  }, [])

  /** Fluxo novo (Login API for Business): pede a URL com state CSRF ao backend e redireciona. */
  function startBusinessLoginConnect() {
    oauthStart.mutate(undefined, {
      onSuccess: ({ url }) => window.location.assign(url),
      onError: (e: unknown) => {
        const msg = (e as Error).message
        if (/IG_APP_ID|app_id|app_secret/i.test(msg) && isAdmin) {
          setConfigOpen(true)
          toast('Configure o app Meta antes de conectar', 'warning', 4000)
        } else {
          toast(msg, 'danger')
        }
      },
    })
  }

  function startConnect() {
    setSignupOpen(true)
  }

  const isV2 = data?.flow === 'instagram_business_login'

  return (
    <Page
      title="Instagram"
      description="DMs do Instagram via Messenger Platform — responda direto pelo /app."
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          {data?.connected ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setTestOpen(true)}>
                <Send size={14} /> Enviar teste
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDisconnectOpen(true)}>
                <Trash2 size={14} /> Desconectar
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={startBusinessLoginConnect}>
              <InstagramLogo size={14} /> Conectar com Instagram
            </Button>
          )}
        </>
      }
    >
      {isLoading && <Skeleton class="h-32 w-full" />}

      {/* Configuração OAuth (admin) — só pro fluxo novo Login API for Business */}
      {!isLoading && isAdmin && (
        <OAuthConfigCard onConfigure={() => setConfigOpen(true)} />
      )}

      {/* Webhook info — sempre visível para colar no painel do Meta App */}
      {!isLoading && <WebhookInfoCard />}

      {configOpen && (
        <OAuthConfigModal onClose={() => setConfigOpen(false)} />
      )}

      {!isLoading && data?.connected && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span class="inline-flex items-center gap-2">
                {data.profilePictureUrl ? (
                  <img src={data.profilePictureUrl} alt="" class="size-6 rounded-full" />
                ) : (
                  <InstagramLogo size={16} />
                )}
                @{data.igUsername}
              </span>
            </CardTitle>
            <div class="flex items-center gap-2">
              {isV2 && <Badge tone="accent">Login direto</Badge>}
              <Badge tone={data.active ? 'success' : 'neutral'}>
                {data.active ? <><CheckCircle size={10} class="mr-0.5 inline" /> Ativo</> : 'Inativo'}
              </Badge>
            </div>
          </CardHeader>
          <TokenExpiryAlert
            tokenExpiresAt={data.tokenExpiresAt ?? null}
            tokenType={data.tokenType ?? null}
            onReconnect={isV2 ? startBusinessLoginConnect : startConnect}
          />
          <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 text-xs">
            <Field label="Username" value={`@${data.igUsername ?? ''}`} mono />
            <Field label="IG User ID" value={data.igUserId ?? '—'} mono />
            {isV2 ? (
              <>
                {data.igName && <Field label="Nome" value={data.igName} />}
                <Field label="Tipo de conta" value={data.accountType ?? '—'} />
              </>
            ) : (
              <>
                <Field label="Página Facebook" value={data.pageName ?? '—'} />
                <Field label="Page ID" value={data.pageId ?? '—'} mono />
              </>
            )}
          </div>
          {isV2 && data.scopes && data.scopes.length > 0 && (
            <div class="mt-3 pt-3 border-t border-border">
              <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle mb-1">Permissões concedidas</div>
              <div class="flex flex-wrap gap-1">
                {data.scopes.map((s) => (
                  <code key={s} class="text-[0.625rem] px-1.5 py-0.5 rounded bg-surface-3 text-fg-muted">{s}</code>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {!isLoading && !data?.connected && (
        <>
          <Card class="border-accent/40 bg-accent/5">
            <div class="flex items-start gap-4">
              <div class="size-12 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 grid place-items-center text-white shrink-0">
                <InstagramLogo size={22} />
              </div>
              <div class="flex-1 min-w-0 space-y-3">
                <div>
                  <h3 class="text-base font-semibold text-fg">Conectar com Instagram</h3>
                  <p class="text-xs text-fg-muted mt-0.5">
                    Login direto pelo Instagram — você não precisa de Facebook nem Página.
                    Funciona com qualquer conta <strong>Business</strong> ou <strong>Creator</strong>.
                  </p>
                </div>
                <ul class="text-xs text-fg-muted space-y-1">
                  <li class="flex gap-1.5"><CheckCircle size={12} class="text-success mt-0.5 shrink-0" /> 1 clique → autoriza no Instagram → conectado</li>
                  <li class="flex gap-1.5"><CheckCircle size={12} class="text-success mt-0.5 shrink-0" /> Token long-lived (60 dias), renovação automática</li>
                  <li class="flex gap-1.5"><CheckCircle size={12} class="text-success mt-0.5 shrink-0" /> DMs, comentários, publicação e insights</li>
                </ul>
                <div class="flex items-center gap-2 pt-1">
                  <Button variant="primary" size="md" onClick={startBusinessLoginConnect}>
                    <InstagramLogo size={14} /> Conectar com Instagram
                  </Button>
                  <a
                    href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login"
                    target="_blank"
                    rel="noreferrer"
                    class="text-xs text-accent hover:underline inline-flex items-center gap-1"
                  >
                    <ExternalLink size={12} /> Como funciona
                  </a>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div class="space-y-3">
              <div class="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 class="text-sm font-semibold text-fg">Conectar via Facebook (legado)</h3>
                  <p class="text-[0.6875rem] text-fg-muted mt-0.5">
                    Para contas que precisam permanecer vinculadas a uma Página do Facebook ou usar token de System User.
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={startConnect}>
                  <Plug size={14} /> Conectar via Facebook
                </Button>
              </div>
              <details class="text-xs text-fg-muted">
                <summary class="cursor-pointer text-fg-muted hover:text-fg">Pré-requisitos do fluxo legado</summary>
                <ul class="mt-2 space-y-1.5 pl-1">
                  <li>• Conta Instagram <strong>Business/Creator</strong> vinculada a uma Página do Facebook</li>
                  <li>• App Meta com produto <strong>Instagram messaging</strong> habilitado</li>
                  <li>• Permissões <code>instagram_business_basic</code> + <code>instagram_business_manage_messages</code> aprovadas no app review</li>
                  <li>• Webhook configurado (URL + Verify Token acima)</li>
                </ul>
              </details>
            </div>
          </Card>

          <div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <AlertCircle size={14} class="mt-0.5 shrink-0 text-warning" />
            <span class="text-fg-muted">
              Sem app review aprovado pelo Meta, só contas de testers configurados conseguem autorizar.
              Solicite o review dos scopes <code>instagram_business_*</code> antes de ativar para clientes finais.
            </span>
          </div>
        </>
      )}

      <InstagramSignupModal open={signupOpen} onOpenChange={setSignupOpen} />
      {testOpen && <SendTestModal onClose={() => setTestOpen(false)} />}
      {disconnectOpen && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDisconnectOpen(false)}
          title="Desconectar Instagram?"
          description={
            isV2
              ? 'O token será descartado. Para voltar a receber mensagens, conecte novamente.'
              : 'O webhook será desinscrito. As conversas existentes ficam preservadas; só não receberemos novas DMs até reconectar.'
          }
          destructive
          confirmLabel="Desconectar"
          loading={isV2 ? disconnectV2.isPending : disconnect.isPending}
          onConfirm={() => {
            const m = isV2 ? disconnectV2 : disconnect
            m.mutate(undefined, {
              onSuccess: () => {
                toast('Instagram desconectado', 'success')
                setDisconnectOpen(false)
              },
              onError: (e: unknown) => {
                toast((e as Error).message, 'danger')
                setDisconnectOpen(false)
              },
            })
          }}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Instagram?"
        problem={<>
          DMs do Instagram são uma <strong>fonte enorme de leads</strong> — alguém vê seu post,
          curte, segue, manda mensagem. Sem integração, vendedor abre o app no celular, esquece de
          responder, e o lead esfria. Aqui você recebe e responde DMs <strong>na mesma caixa de
          Conversas</strong> que WhatsApp e Telegram.
        </>}
        steps={[
          {
            title: '🔗 Conta de Instagram Business obrigatória',
            body: <>Conta pessoal não funciona — converta antes pra <strong>Conta Comercial</strong> ou <strong>Conta de Criador</strong> nas configurações do Instagram (grátis). Vincule-a a uma página do Facebook se ainda não estiver.</>,
          },
          {
            title: '🔌 Conecte com o Instagram',
            body: <>Botão <strong>Conectar com Instagram</strong>: abre o fluxo OAuth oficial da Meta (Login API for Business). Você loga no Facebook, autoriza a página + conta IG, e em poucos passos a integração está ativa.</>,
          },
          {
            title: '💬 Recebe DMs em "Conversas"',
            body: <>Toda DM nova vira ticket. Inclui story replies, mensagens nos comentários (quando o usuário marca o ícone de mensagem), e mensagens vindas de anúncios de mensagem.</>,
          },
          {
            title: '⚙️ Configuração OAuth (admin)',
            body: <>Se você é admin da plataforma, configure App ID + App Secret do app do Meta em <strong>Configurações OAuth</strong>. Pra contas individuais que vão conectar, normalmente já está pronto.</>,
          },
          {
            title: '🧪 Teste o envio',
            body: <>Botão <strong>Enviar teste</strong> manda DM pra um username que você indicar. Útil pra confirmar que tem permissão de enviar (Instagram limita o quanto e quando você pode iniciar DM).</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Janela de mensagem',
          body: <>O Instagram tem regra de <strong>24h</strong>: você só pode responder dentro de 24h da última mensagem do usuário. Fora dessa janela, precisa esperar ele mandar mensagem ou usar um <em>human agent tag</em> (uso restrito). Por isso a velocidade de resposta importa muito aqui.</>,
        }}
      />
    </Page>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div class={`truncate text-fg ${mono ? 'font-mono text-[0.6875rem]' : 'text-sm'}`}>{value}</div>
    </div>
  )
}

function TokenExpiryAlert({
  tokenExpiresAt,
  tokenType,
  onReconnect,
}: {
  tokenExpiresAt: number | null
  tokenType: string | null
  onReconnect: () => void
}) {
  // 0 ou null = nunca expira (System User token)
  if (!tokenExpiresAt) {
    if (tokenType === 'SYSTEM') {
      return (
        <div class="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 p-2 text-[0.6875rem] text-fg-muted my-2">
          <CheckCircle size={12} class="text-success shrink-0" />
          Token permanente (System User) — não expira.
        </div>
      )
    }
    return null
  }
  const now = Date.now()
  const diffMs = tokenExpiresAt - now
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))

  if (diffMs <= 0) {
    return (
      <div class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-2.5 text-xs my-2">
        <AlertCircle size={14} class="mt-0.5 shrink-0 text-danger" />
        <div class="flex-1">
          <div class="font-medium text-fg">Token expirou</div>
          <div class="text-fg-muted mt-0.5">As DMs pararam de chegar. Reconecte para gerar um novo token.</div>
        </div>
        <Button size="sm" variant="primary" onClick={onReconnect}>Reconectar</Button>
      </div>
    )
  }

  if (days <= 7) {
    return (
      <div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs my-2">
        <Clock size={14} class="mt-0.5 shrink-0 text-warning" />
        <div class="flex-1">
          <div class="font-medium text-fg">
            Token expira em {days} dia{days === 1 ? '' : 's'}
          </div>
          <div class="text-fg-muted mt-0.5">
            Reconecte agora para evitar interrupção das DMs ({new Date(tokenExpiresAt).toLocaleString()}).
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={onReconnect}>Reconectar</Button>
      </div>
    )
  }

  return (
    <div class="flex items-center gap-2 rounded-md border border-border bg-surface p-2 text-[0.6875rem] text-fg-muted my-2">
      <Clock size={12} class="shrink-0" />
      Token expira em {days} dias ({new Date(tokenExpiresAt).toLocaleDateString()}).
    </div>
  )
}

function OAuthConfigCard({ onConfigure }: { onConfigure: () => void }) {
  const { data, isLoading } = useInstagramOAuthConfig()
  if (isLoading || !data) return null

  if (data.isConfigured) {
    return (
      <Card class="mb-3 border-success/30 bg-success/5">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-start gap-2 min-w-0">
            <CheckCircle size={16} class="text-success shrink-0 mt-0.5" />
            <div class="min-w-0">
              <div class="text-sm font-medium text-fg">App Meta configurado</div>
              <div class="text-[0.6875rem] text-fg-muted mt-0.5 truncate">
                App ID: <code class="font-mono">{data.appId}</code>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onConfigure}>
            <Settings size={14} /> Editar
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card class="mb-3 border-warning/40 bg-warning/10">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="flex items-start gap-2 min-w-0 flex-1">
          <AlertCircle size={16} class="text-warning shrink-0 mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm font-medium text-fg">App Meta ainda não configurado</div>
            <div class="text-[0.6875rem] text-fg-muted mt-0.5">
              Cole o App ID + App Secret do produto <strong>"API setup with Instagram login"</strong> pra liberar o botão de conectar.
            </div>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={onConfigure}>
          <Settings size={14} /> Configurar agora
        </Button>
      </div>
    </Card>
  )
}

function OAuthConfigModal({ onClose }: { onClose: () => void }) {
  const { data } = useInstagramOAuthConfig()
  const save = useSaveInstagramOAuthConfig()
  const [appId, setAppId] = useState(data?.appId ?? '')
  const [appSecret, setAppSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState(data?.redirectUri ?? '')

  // sync quando data carrega
  useEffect(() => {
    if (data?.appId && !appId) setAppId(data.appId)
    if (data?.redirectUri && !redirectUri) setRedirectUri(data.redirectUri)
  }, [data, appId, redirectUri])

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => toast(`${label} copiado`, 'success', 1500))
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Configuração do app Meta"
      description="Valores do produto Instagram → API setup with Instagram login no Meta for Developers."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!appId.trim()) { toast('App ID obrigatório', 'danger'); return }
              if (!redirectUri.trim()) { toast('Redirect URI obrigatório', 'danger'); return }
              save.mutate(
                { appId: appId.trim(), appSecret: appSecret.trim() || undefined, redirectUri: redirectUri.trim() },
                {
                  onSuccess: () => { toast('Configuração salva', 'success'); onClose() },
                  onError: (e: unknown) => toast((e as Error).message, 'danger'),
                },
              )
            }}
            disabled={save.isPending}
          >
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Instagram App ID"
          value={appId}
          onInput={(e) => setAppId((e.target as HTMLInputElement).value)}
          placeholder="1036003888188984"
          hint="Meta App Dashboard → seu app → Instagram → API setup with Instagram login → Instagram App ID."
        />
        <Input
          label="Instagram App Secret"
          type="password"
          value={appSecret}
          onInput={(e) => setAppSecret((e.target as HTMLInputElement).value)}
          placeholder={data?.hasSecret ? '••••••••• (já configurado — preencha só pra trocar)' : 'cole o App Secret'}
          hint="Mesmo lugar do App ID. Não é exibido após salvar."
        />
        <Input
          label="OAuth Redirect URI"
          value={redirectUri}
          onInput={(e) => setRedirectUri((e.target as HTMLInputElement).value)}
          hint="Tem que bater EXATAMENTE com a URI cadastrada no painel do Meta."
        />

        <div class="pt-2 border-t border-border space-y-2">
          <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">
            Cadastrar no painel do Meta
          </div>
          <ConfigCopyRow label="OAuth Redirect URI" value={redirectUri} onCopy={() => copy(redirectUri, 'Redirect URI')} />
          {data && (
            <>
              <ConfigCopyRow label="Deauthorize Callback" value={data.deauthorizeUrl} onCopy={() => copy(data.deauthorizeUrl, 'Deauthorize URL')} />
              <ConfigCopyRow label="Data Deletion" value={data.dataDeletionUrl} onCopy={() => copy(data.dataDeletionUrl, 'Data Deletion URL')} />
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ConfigCopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div>
      <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle mb-0.5">{label}</div>
      <div class="flex gap-2 items-center">
        <code class="flex-1 px-2 py-1 rounded-md bg-surface border border-border text-[0.6875rem] font-mono text-fg break-all">
          {value}
        </code>
        <Button size="sm" variant="secondary" onClick={onCopy}>
          <Copy size={12} />
        </Button>
      </div>
    </div>
  )
}

function WebhookInfoCard() {
  const { data, isLoading } = useInstagramWebhookInfo()
  if (isLoading || !data) return null
  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => toast(`${label} copiado`, 'success', 1_500))
  }
  return (
    <Card class="mb-3">
      <div class="flex items-start gap-2">
        <Webhook size={16} class="text-fg-subtle shrink-0 mt-0.5" />
        <div class="flex-1 min-w-0 space-y-3">
          <div>
            <div class="text-sm font-medium text-fg">Configuração do webhook</div>
            <div class="text-[0.6875rem] text-fg-muted mt-0.5">
              Cole estes dois valores no painel do Meta App em <strong>Webhooks → Instagram</strong>{' '}
              antes de conectar a conta.
            </div>
          </div>
          <div>
            <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle mb-1">Callback URL</div>
            <div class="flex gap-2 items-center">
              <code class="flex-1 px-2 py-1.5 rounded-md bg-surface border border-border text-[0.6875rem] font-mono text-fg break-all">
                {data.webhookUrl}
              </code>
              <Button size="sm" variant="secondary" onClick={() => copy(data.webhookUrl, 'URL')}>
                <Copy size={12} /> Copiar
              </Button>
            </div>
          </div>
          <div>
            <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle mb-1">Verify Token</div>
            <div class="flex gap-2 items-center">
              <code class="flex-1 px-2 py-1.5 rounded-md bg-surface border border-border text-[0.6875rem] font-mono text-fg break-all">
                {data.verifyToken}
              </code>
              <Button size="sm" variant="secondary" onClick={() => copy(data.verifyToken, 'Verify token')}>
                <Copy size={12} /> Copiar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

function SendTestModal({ onClose }: { onClose: () => void }) {
  const { data: recList, isLoading: loadingRec } = useInstagramRecentRecipients(true)
  const recipients = useMemo(() => recList?.recipients ?? [], [recList])
  const [mode, setMode] = useState<'recent' | 'manual'>('recent')
  const [pickedIgsid, setPickedIgsid] = useState('')
  const [manualIgsid, setManualIgsid] = useState('')
  const [text, setText] = useState('Teste de conexão Instagram')
  const send = useInstagramSendTest()

  // Default: primeiro recipient quando carrega
  const defaultIgsid = useMemo(() => recipients[0]?.igsid ?? '', [recipients])
  const igsid = mode === 'recent' ? (pickedIgsid || defaultIgsid) : manualIgsid.trim()

  // Quando não há recipients recentes, fallback automático para manual
  const noneRecent = !loadingRec && recipients.length === 0
  const effectiveMode = noneRecent ? 'manual' : mode

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Enviar DM de teste"
      description="Janela de 24h: só conseguimos iniciar a conversa com quem te escreveu antes."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={send.isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!igsid) {
                toast('Escolha um destinatário', 'danger')
                return
              }
              send.mutate(
                { recipientId: igsid, text },
                {
                  onSuccess: (r) => {
                    toast(`Enviado (id ${r.messageId})`, 'success')
                    onClose()
                  },
                  onError: (e: unknown) => toast((e as Error).message, 'danger'),
                },
              )
            }}
            disabled={send.isPending}
          >
            {send.isPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        {!noneRecent && (
          <div class="flex gap-2 text-xs">
            <button
              type="button"
              class={`px-2.5 py-1 rounded-md border transition ${effectiveMode === 'recent' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-muted hover:bg-surface-2'}`}
              onClick={() => setMode('recent')}
            >
              Conversas recentes
            </button>
            <button
              type="button"
              class={`px-2.5 py-1 rounded-md border transition ${effectiveMode === 'manual' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-muted hover:bg-surface-2'}`}
              onClick={() => setMode('manual')}
            >
              IGSID manual
            </button>
          </div>
        )}

        {effectiveMode === 'recent' ? (
          loadingRec ? (
            <Skeleton class="h-9 w-full" />
          ) : (
            <Select
              label="Destinatário"
              value={pickedIgsid || defaultIgsid}
              onChange={(e) => setPickedIgsid((e.target as HTMLSelectElement).value)}
              hint="Lista dos últimos leads que mandaram DM."
            >
              {recipients.map((r) => (
                <option value={r.igsid} key={r.igsid}>
                  {r.name} — {r.igsid}
                </option>
              ))}
            </Select>
          )
        ) : (
          <Input
            label="IGSID do destinatário"
            placeholder="17841400000000000"
            value={manualIgsid}
            onInput={(e) => setManualIgsid((e.target as HTMLInputElement).value)}
            hint={noneRecent ? 'Nenhuma DM recebida ainda — só dá pra testar com um IGSID que você já tenha de outra fonte.' : 'Use só se souber o IGSID exato.'}
          />
        )}

        <Input
          label="Mensagem"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
      </div>
    </Modal>
  )
}
