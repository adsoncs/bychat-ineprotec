import { useState } from 'preact/hooks'
import { Send, AlertCircle, CheckCircle, Plug, Trash2, ExternalLink, HelpCircle } from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import {
  useTelegramConnection,
  useConnectTelegram,
  useDisconnectTelegram,
  useTelegramSendTest,
} from '@/hooks/useTelegram'
import { toast } from '@/lib/toast'

export function TelegramPage() {
  const { data, isLoading } = useTelegramConnection()
  const [connectOpen, setConnectOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const disconnect = useDisconnectTelegram()

  return (
    <Page
      title="Telegram"
      description="Receba e envie mensagens do Telegram dentro da caixa de entrada unificada."
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
            <Button variant="primary" size="sm" onClick={() => setConnectOpen(true)}>
              <Plug size={14} /> Conectar bot
            </Button>
          )}
        </>
      }
    >
      {isLoading && <Skeleton class="h-32 w-full" />}

      {!isLoading && data?.connected && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span class="inline-flex items-center gap-2">
                <Send size={16} class="text-fg-muted" />
                @{data.botUsername}
              </span>
            </CardTitle>
            <Badge tone={data.active ? 'success' : 'neutral'}>
              {data.active ? <><CheckCircle size={10} class="mr-0.5 inline" /> Ativo</> : 'Inativo'}
            </Badge>
          </CardHeader>
          <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 text-xs">
            <Field label="Bot" value={data.botName ?? '—'} />
            <Field label="Username" value={`@${data.botUsername ?? ''}`} mono />
            <Field label="Webhook URL" value={data.webhookUrl ?? '—'} mono />
            <Field
              label="Conectado em"
              value={data.connectedAt ? new Date(data.connectedAt).toLocaleString() : '—'}
            />
          </div>
        </Card>
      )}

      {!isLoading && !data?.connected && (
        <Card>
          <div class="space-y-3">
            <h3 class="text-sm font-semibold text-fg">Como conectar</h3>
            <ol class="space-y-1.5 text-xs text-fg-muted">
              <li>1. No Telegram, fale com <strong>@BotFather</strong> e use <code>/newbot</code></li>
              <li>2. Defina nome e username (precisa terminar em <code>bot</code>)</li>
              <li>3. Copie o <strong>HTTP API token</strong> que o BotFather mostra</li>
              <li>4. Clique em "Conectar bot" acima e cole o token</li>
              <li>5. Pronto — o webhook é registrado automaticamente</li>
            </ol>
            <a
              href="https://core.telegram.org/bots#how-do-i-create-a-bot"
              target="_blank"
              rel="noreferrer"
              class="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <ExternalLink size={12} /> Documentação oficial
            </a>
          </div>
        </Card>
      )}

      {connectOpen && <ConnectModal onClose={() => setConnectOpen(false)} />}
      {testOpen && <SendTestModal onClose={() => setTestOpen(false)} />}
      {disconnectOpen && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDisconnectOpen(false)}
          title="Desconectar bot do Telegram?"
          description="O webhook será removido. As conversas existentes ficam preservadas; só não receberemos novas mensagens até reconectar."
          destructive
          confirmLabel="Desconectar"
          loading={disconnect.isPending}
          onConfirm={() =>
            disconnect.mutate(undefined, {
              onSuccess: () => {
                toast('Bot desconectado', 'success')
                setDisconnectOpen(false)
              },
              onError: (e: unknown) => {
                toast((e as Error).message, 'danger')
                setDisconnectOpen(false)
              },
            })
          }
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Telegram?"
        problem={<>
          Pra públicos que preferem Telegram (mais comum em B2B, comunidades técnicas, fora do
          Brasil), o sistema integra como mais um canal. Mesma caixa de Conversas, mesmo histórico
          de lead, mesmo CRM — só que conversando pelo Telegram.
        </>}
        steps={[
          {
            title: '🤖 Crie um bot no @BotFather',
            body: <>No Telegram, abra <code>@BotFather</code>, mande <code>/newbot</code>, escolha um nome e um username (termina em "Bot"). Ele te dá um <strong>token</strong> — copie.</>,
          },
          {
            title: '🔌 Cole o token aqui',
            body: <>Botão <strong>Conectar bot</strong>: cole o token. O sistema valida com a API do Telegram, configura webhook automaticamente, e a integração entra no ar.</>,
          },
          {
            title: '💬 Conversas chegam em "Conversas"',
            body: <>Quando alguém mandar mensagem pro seu bot (ex.: <code>/start</code>), vira ticket. O vendedor responde por lá — Telegram aparece junto com WhatsApp, sem separação.</>,
          },
          {
            title: '🧪 Envie teste',
            body: <>Botão <strong>Enviar teste</strong> manda uma mensagem pra um chat_id que você indicar. Bom pra confirmar que o bot está respondendo antes de divulgar.</>,
          },
          {
            title: '🚫 Desconectar',
            body: <>Botão <strong>Desconectar</strong> remove o webhook. O bot continua existindo no Telegram (mas sem receber mensagens no sistema). Pra reativar, basta reconectar com o mesmo token.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Vantagens',
          body: <>Telegram permite <strong>botões inline</strong> (mais ricos que WhatsApp comum), enviar arquivos grandes, mensagens longas sem corte. Em comunidades, é onde o público técnico/cripto/internacional vive.</>,
        }}
      />
    </Page>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div class="text-3xs uppercase tracking-wider text-fg-muted">{label}</div>
      <div class={`truncate text-fg ${mono ? 'font-mono text-2xs' : 'text-sm'}`}>{value}</div>
    </div>
  )
}

function ConnectModal({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState('')
  const connect = useConnectTelegram()
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Conectar bot do Telegram"
      description="Cole o HTTP API token recebido do @BotFather."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={connect.isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!token.trim()) {
                toast('Token obrigatório', 'danger')
                return
              }
              connect.mutate(token.trim(), {
                onSuccess: (resp) => {
                  toast(`Conectado a @${resp.botUsername}`, 'success')
                  onClose()
                },
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })
            }}
            disabled={connect.isPending}
          >
            {connect.isPending ? 'Validando…' : 'Conectar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Bot token"
          placeholder="123456789:AAH..."
          value={token}
          onInput={(e) => setToken((e.target as HTMLInputElement).value)}
          hint="Formato: <bot_id>:<segredo>. Token nunca é exibido após salvar."
        />
        <div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <AlertCircle size={14} class="mt-0.5 shrink-0 text-warning" />
          <span class="text-fg-muted">
            O token concede acesso completo ao bot. Trate como uma senha — quem tem o token consegue
            enviar mensagens em nome do bot e ler todas as DMs recebidas.
          </span>
        </div>
      </div>
    </Modal>
  )
}

function SendTestModal({ onClose }: { onClose: () => void }) {
  const [chatId, setChatId] = useState('')
  const [text, setText] = useState('Teste de conexão Telegram')
  const send = useTelegramSendTest()
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Enviar mensagem de teste"
      description="Envie um texto para um chat (precisa que o destinatário tenha conversado com o bot pelo menos uma vez)."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={send.isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!chatId.trim()) {
                toast('chat_id obrigatório', 'danger')
                return
              }
              send.mutate(
                { chatId: chatId.trim(), text },
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
        <Input
          label="chat_id"
          placeholder="123456789"
          value={chatId}
          onInput={(e) => setChatId((e.target as HTMLInputElement).value)}
          hint="ID numérico do chat (peça ao usuário enviar /start no seu bot)"
        />
        <Input
          label="Mensagem"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
      </div>
    </Modal>
  )
}
