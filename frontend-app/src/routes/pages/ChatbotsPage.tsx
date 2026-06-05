import { useState } from 'preact/hooks'
import { Bot, Plus, Pencil, Trash2, ListChecks, Play, Code, Sparkles, Download, Upload, FileJson, Copy, Power, HelpCircle } from 'lucide-preact'
import {
  useChatbots,
  useCreateChatbot,
  useUpdateChatbot,
  useDeleteChatbot,
  useDuplicateChatbot,
  useChatbotEmbedCode,
  useImportChatbot,
  exportChatbot,
  type ChatbotItem,
  type ChatbotImportPayload,
} from '@/hooks/useChatbots'
import { useFunnels } from '@/hooks/useFunnels'
import { useTeams } from '@/hooks/useTeams'
import { useForms } from '@/hooks/useForms'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ChatbotQuestionsEditor } from '@/components/chatbot/ChatbotQuestionsEditor'
import { ChatbotTester } from '@/components/chatbot/ChatbotTester'
import { CHATBOT_TEMPLATES, type ChatbotTemplate } from '@/components/chatbot/ChatbotTemplates'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'
import { FlowEditorModal } from '@/components/FlowEditorModal'

const CHANNELS: { value: string; label: string; emoji: string }[] = [
  { value: 'chat',      label: 'Chat Web',  emoji: '💬' },
  { value: 'whatsapp',  label: 'WhatsApp',  emoji: '📱' },
  { value: 'both',      label: 'Ambos',     emoji: '🔀' },
  { value: 'instagram', label: 'Instagram', emoji: '📸' },
  { value: 'telegram',  label: 'Telegram',  emoji: '✈️' },
]

function channelMeta(value: string): { label: string; emoji: string } {
  return CHANNELS.find((c) => c.value === value) ?? { label: value, emoji: '🤖' }
}

const INACTIVITY_ACTIONS = [
  { value: 'notify', label: 'Enviar mensagem de reengajamento' },
  { value: 'close', label: 'Fechar conversa diretamente' },
  { value: 'notify_then_close', label: 'Reengajar e depois fechar' },
]

// Mensagens interativas editáveis do chatbot em modo Roteiro (scripted). As chaves
// batem com DEFAULT_SCRIPTED_MESSAGES no backend (scriptedChatbotFlow.ts).
const SCRIPTED_MSG_FIELDS: { key: string; label: string; vars?: string; placeholder: string }[] = [
  { key: 'invalidSelect', label: 'Opção não reconhecida', placeholder: 'Não entendi. 🙂 Por favor, responda com o número da opção.' },
  { key: 'invalidAnswer', label: 'Resposta inválida', vars: '{{erro}}', placeholder: '{{erro}}. Vamos tentar de novo:' },
  { key: 'slotPrompt', label: 'Pedir horário', vars: '{{titulo}} {{horarios}}', placeholder: '{{titulo}}:\n\n{{horarios}}\n\n_Responda com o número do horário._' },
  { key: 'invalidSlot', label: 'Horário não reconhecido', vars: '{{horarios}}', placeholder: 'Não entendi o horário. Responda com o número:\n\n{{horarios}}' },
  { key: 'slotTaken', label: 'Horário indisponível', vars: '{{erro}} {{horarios}}', placeholder: '{{erro}}. Escolha outro:\n\n{{horarios}}' },
  { key: 'bookingConfirmed', label: 'Reunião confirmada', vars: '{{horario}} {{nome}}', placeholder: '✅ Reunião agendada para *{{horario}}*! Você vai receber os detalhes por aqui. 🚀' },
  { key: 'noSlots', label: 'Sem horários disponíveis', placeholder: 'No momento não há horários disponíveis. Nossa equipe vai entrar em contato. 😊' },
  { key: 'noMeetingType', label: 'Agendamento não configurado', placeholder: 'Perfeito! Em breve entraremos em contato para agendar. 😊' },
  { key: 'bookingUnavailable', label: 'Agendamento indisponível', placeholder: 'Agendamento indisponível no momento. Nossa equipe entrará em contato.' },
  { key: 'qualifiedDone', label: 'Encerramento (qualificado, sem agenda)', placeholder: 'Obrigado! Em breve entraremos em contato. 😊' },
  { key: 'disqualifiedFallback', label: 'Encerramento (desqualificado, sem redirect)', placeholder: 'Obrigado pelas respostas! Em breve entraremos em contato. 😊' },
]

export function ChatbotsPage() {
  const { data, isLoading } = useChatbots()
  const [editing, setEditing] = useState<ChatbotItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [pickingTemplate, setPickingTemplate] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<ChatbotTemplate | null>(null)
  const [deleting, setDeleting] = useState<ChatbotItem | null>(null)
  const [questionsOf, setQuestionsOf] = useState<ChatbotItem | null>(null)
  const [testingOf, setTestingOf] = useState<ChatbotItem | null>(null)
  const [embedOf, setEmbedOf] = useState<ChatbotItem | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [exportingId, setExportingId] = useState<number | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const duplicate = useDuplicateChatbot()
  const toggle = useUpdateChatbot()

  function handleToggleActive(b: ChatbotItem) {
    toggle.mutate({ id: b.id, active: !b.active }, {
      onSuccess: () => toast(b.active ? 'Chatbot desativado' : 'Chatbot ativado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  async function handleExport(b: ChatbotItem) {
    setExportingId(b.id)
    try {
      await exportChatbot(b.id, b.name)
      toast('Backup baixado', 'success')
    } catch (e: unknown) {
      toast((e as Error).message || 'Falha ao exportar', 'danger')
    } finally {
      setExportingId(null)
    }
  }

  function handleDuplicate(b: ChatbotItem) {
    duplicate.mutate(b.id, {
      onSuccess: () => toast('Chatbot duplicado (inativo — revise antes de ativar)', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handlePickTemplate(t: ChatbotTemplate) {
    setPendingTemplate(t)
    setPickingTemplate(false)
    setCreating(true)
  }

  function handleCloseForm() {
    setCreating(false)
    setEditing(null)
    setPendingTemplate(null)
  }

  return (
    <Page
      title="Chatbots"
      description="Bots configurados por canal."
      actions={
        <div class="flex gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)} title="Importar chatbot a partir de um arquivo JSON exportado">
            <Upload size={14} /> Importar
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPickingTemplate(true)}>
            <Sparkles size={14} /> Usar modelo
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Novo chatbot
          </Button>
        </div>
      }
    >
      {isLoading && (
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-32 w-full" />)}
        </div>
      )}
      {!isLoading && data?.chatbots.length === 0 && (
        <EmptyState
          icon={<Bot size={24} />}
          title="Nenhum chatbot criado"
          action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Criar primeiro</Button>}
        />
      )}
      {!isLoading && data && data.chatbots.length > 0 && (
        <div class="flex flex-col gap-3">
          {data.chatbots.map((b) => {
            const ch = channelMeta(b.channel)
            return (
              <Card key={b.id} class="flex flex-col gap-3">
                <div class="flex items-start justify-between gap-2 flex-wrap">
                  <div class="flex items-center gap-3 min-w-0">
                    <span class="text-2xl shrink-0" aria-hidden="true">{ch.emoji}</span>
                    <div class="min-w-0">
                      <div class="text-sm font-semibold text-fg truncate">{b.name}</div>
                      <div class="text-[0.6875rem] text-fg-subtle truncate">
                        {ch.label} · {b._count.questions} {b._count.questions === 1 ? 'pergunta' : 'perguntas'}
                      </div>
                    </div>
                  </div>
                  <div class="flex gap-1.5 shrink-0 flex-wrap">
                    <button type="button" onClick={() => handleToggleActive(b)} class="cursor-pointer" disabled={toggle.isPending} title={b.active ? 'Desativar' : 'Ativar'}>
                      <Badge tone={b.active ? 'accent' : 'neutral'}>{b.active ? 'Ativo' : 'Inativo'}</Badge>
                    </button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleToggleActive(b)}
                      disabled={toggle.isPending}
                      aria-label={b.active ? 'Desativar chatbot' : 'Ativar chatbot'}
                      title={b.active ? 'Desativar' : 'Ativar'}
                    >
                      <Power size={12} /> {b.active ? 'Desativar' : 'Ativar'}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setTestingOf(b)} aria-label="Testar chatbot" title="Testar conversa">
                      <Play size={12} /> Testar
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEmbedOf(b)} aria-label="Código de embed" title="Código de embed">
                      <Code size={12} /> Embed
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setQuestionsOf(b)} aria-label="Editar perguntas" title="Editar perguntas">
                      <ListChecks size={12} /> Perguntas
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(b)} aria-label="Editar chatbot" title="Editar chatbot">
                      <Pencil size={12} /> Editar
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDuplicate(b)}
                      disabled={duplicate.isPending}
                      aria-label="Duplicar chatbot"
                      title="Duplicar"
                    >
                      <Copy size={12} /> Duplicar
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleExport(b)}
                      disabled={exportingId === b.id}
                      aria-label="Exportar JSON (backup)"
                      title="Exportar este chatbot como backup JSON"
                    >
                      <Download size={12} /> Exportar
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDeleting(b)}
                      aria-label="Excluir chatbot"
                      title="Excluir"
                      class="!text-danger border-danger/30 hover:bg-danger/10"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
                {b.greetingMessage && (
                  <p class="text-xs text-fg-muted leading-relaxed line-clamp-2 border-t border-border pt-2">
                    <strong class="text-fg">Saudação:</strong> {b.greetingMessage}
                  </p>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <ChatbotFormModal chatbot={editing} template={pendingTemplate} onClose={handleCloseForm} />
      )}
      {pickingTemplate && (
        <TemplatePickerModal
          onPick={handlePickTemplate}
          onClose={() => setPickingTemplate(false)}
        />
      )}
      {deleting && <DeleteChatbotDialog chatbot={deleting} onClose={() => setDeleting(null)} />}

      {questionsOf && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setQuestionsOf(null) }}
          title={`Perguntas — ${questionsOf.name}`}
          size="lg"
          footer={<Button variant="secondary" size="sm" onClick={() => setQuestionsOf(null)}>Fechar</Button>}
        >
          <ChatbotQuestionsEditor chatbotId={questionsOf.id} />
        </Modal>
      )}

      {testingOf && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setTestingOf(null) }}
          title={`Testar — ${testingOf.name}`}
          description="Simulação local da conversa, sem enviar mensagens reais."
          size="lg"
          footer={<Button variant="secondary" size="sm" onClick={() => setTestingOf(null)}>Fechar</Button>}
        >
          <ChatbotTester chatbotId={testingOf.id} />
        </Modal>
      )}

      {embedOf && <EmbedCodeModal chatbot={embedOf} onClose={() => setEmbedOf(null)} />}

      {importOpen && <ImportChatbotModal onClose={() => setImportOpen(false)} />}

      {showHowItWorks && (
        <HowItWorksModal
          onClose={() => setShowHowItWorks(false)}
          onUseTemplate={() => { setShowHowItWorks(false); setPickingTemplate(true) }}
          onCreate={() => { setShowHowItWorks(false); setCreating(true) }}
        />
      )}
    </Page>
  )
}

// ─── Modal de importação ────────────────────────────────────────

function ImportChatbotModal({ onClose }: { onClose: () => void }) {
  const importMut = useImportChatbot()
  const [payload, setPayload] = useState<ChatbotImportPayload | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [importQuestions, setImportQuestions] = useState(true)
  const [fileName, setFileName] = useState<string | null>(null)

  function loadFromText(text: string, source: string | null) {
    try {
      const data = JSON.parse(text)
      if (data?.kind !== 'bychat-chatbot-export' || !data?.chatbot) {
        throw new Error('Arquivo não é um export de chatbot do bychat.')
      }
      setPayload(data as ChatbotImportPayload)
      setParseError(null)
      setFileName(source)
      const original = String(data.chatbot.name ?? 'Chatbot')
      setName(`${original} (importado)`)
    } catch (e: unknown) {
      setPayload(null)
      setParseError((e as Error).message || 'JSON inválido')
    }
  }

  function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => loadFromText(String(reader.result ?? ''), f.name)
    reader.onerror = () => { setParseError('Falha ao ler o arquivo.'); setPayload(null) }
    reader.readAsText(f)
  }

  function submit() {
    if (!payload) return
    if (!name.trim()) { toast('Informe um nome para o chatbot.', 'warning'); return }
    importMut.mutate(
      { payload, name: name.trim(), importQuestions },
      {
        onSuccess: (r) => {
          const unresolved = Object.keys(r.unresolvedReferences || {})
          if (unresolved.length > 0) {
            toast(
              `Chatbot importado, mas algumas referências não foram encontradas (${unresolved.join(', ')}). Ajuste manualmente.`,
              'warning',
            )
          } else {
            toast(`Chatbot importado · ${r.importedQuestions} pergunta(s)`, 'success')
          }
          onClose()
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  const questionCount = Array.isArray(payload?.questions) ? payload.questions.length : 0
  const refs = payload?.references ?? {}

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Importar chatbot"
      description="Carregue um arquivo JSON exportado anteriormente. Você define o novo nome — todas as configurações (prompts, perguntas, scoring, inatividade) são restauradas."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={importMut.isPending}>Cancelar</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={importMut.isPending || !payload || !name.trim()}
          >
            {importMut.isPending ? 'Importando…' : 'Importar e salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <label class="block">
          <span class="text-xs font-medium text-fg-muted block mb-1.5">Arquivo JSON</span>
          <div class="rounded-md border-2 border-dashed border-border bg-surface-2 p-4 text-center cursor-pointer hover:border-accent transition-colors">
            <FileJson size={28} class="mx-auto text-fg-subtle mb-2" />
            <input
              type="file"
              accept="application/json,.json"
              onChange={onFile}
              class="block mx-auto text-xs text-fg-muted"
            />
            {fileName && <div class="text-[0.6875rem] text-fg-subtle mt-1.5">{fileName}</div>}
          </div>
        </label>

        {parseError && (
          <div class="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
            {parseError}
          </div>
        )}

        {payload && (
          <>
            <div class="rounded-md border border-border bg-surface-2 p-3 text-xs space-y-1">
              <div class="text-fg-muted">
                Original: <strong class="text-fg">{String(payload.chatbot.name ?? '—')}</strong>
              </div>
              <div class="text-fg-subtle">
                Canal: {String(payload.chatbot.channel ?? '—')} · {questionCount} pergunta{questionCount === 1 ? '' : 's'}
              </div>
              {(refs.funnel || refs.team) && (
                <div class="text-[0.6875rem] text-fg-subtle pt-1 border-t border-border mt-1.5">
                  Referências:{' '}
                  {refs.funnel?.name && <span>funil <strong class="text-fg-muted">{refs.funnel.name}</strong> · </span>}
                  {refs.team?.name   && <span>equipe <strong class="text-fg-muted">{refs.team.name}</strong></span>}
                </div>
              )}
              {payload.exportedAt && (
                <div class="text-[0.6875rem] text-fg-subtle">
                  Exportado em: {new Date(payload.exportedAt).toLocaleString('pt-BR')}
                </div>
              )}
            </div>

            <Input
              label="Novo nome do chatbot *"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder="Ex.: Captação de Leads 2026"
              hint="Você está criando um chatbot novo — este nome aparece na lista."
            />

            <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
              <input
                type="checkbox"
                class="size-4 cursor-pointer accent-accent"
                checked={importQuestions}
                onChange={(e) => setImportQuestions((e.target as HTMLInputElement).checked)}
              />
              Importar também as {questionCount} pergunta{questionCount === 1 ? '' : 's'}
            </label>
          </>
        )}
      </div>
    </Modal>
  )
}

function EmbedCodeModal({ chatbot, onClose }: { chatbot: ChatbotItem; onClose: () => void }) {
  const { data, isLoading } = useChatbotEmbedCode(chatbot.id)
  const [copied, setCopied] = useState(false)

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      toast('Copiado', 'success')
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Código de embed — ${chatbot.name}`}
      description="Cole o código antes do </body> da sua página."
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {data && (
        <div class="space-y-3">
          <div class="relative rounded-md bg-zinc-900 border border-zinc-800 p-4">
            <button
              type="button"
              onClick={() => copy(data.snippet)}
              class="absolute top-2 right-2 inline-flex items-center gap-1 h-7 px-3 rounded-md text-[0.6875rem] font-medium bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700 transition-colors"
            >
              <Code size={10} /> {copied ? 'Copiado!' : 'Copiar'}
            </button>
            <pre class="text-[0.75rem] font-mono text-zinc-100 whitespace-pre-wrap break-all m-0 pr-20">
              {data.snippet}
            </pre>
          </div>
          <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info">
            <strong>Web Component com Shadow DOM.</strong> O widget aparece no canto inferior direito da página, sem conflito de CSS.
          </div>
          {data.baseUrl && (
            <a
              href={`${data.baseUrl}/api/chatbots/embed/preview/${chatbot.id}`}
              target="_blank"
              rel="noreferrer"
              class="text-xs text-accent hover:underline inline-flex items-center gap-1"
            >
              Abrir preview ↗
            </a>
          )}
        </div>
      )}
    </Modal>
  )
}

type Tab = 'general' | 'prompts' | 'inactivity'

function ChatbotFormModal({ chatbot, template, onClose }: { chatbot: ChatbotItem | null; template?: ChatbotTemplate | null; onClose: () => void }) {
  const isEdit = !!chatbot
  const [tab, setTab] = useState<Tab>('general')
  const tplDefaults = template?.defaults
  const [form, setForm] = useState({
    name: chatbot?.name ?? tplDefaults?.name ?? '',
    channel: chatbot?.channel ?? tplDefaults?.channel ?? 'chat',
    mode: chatbot?.mode ?? 'ai',
    formId: chatbot?.formId ? String(chatbot.formId) : '',
    useFlow: chatbot?.useFlow ?? false,
    postChatAi: chatbot?.postChatAi ?? false,
    postChatPrompt: chatbot?.postChatPrompt ?? '',
    scriptedMessages: (chatbot?.scriptedMessages ?? {}) as Record<string, string>,
    funnelId: chatbot?.funnelId ? String(chatbot.funnelId) : '',
    defaultTeamId: chatbot?.defaultTeamId ? String(chatbot.defaultTeamId) : '',
    active: chatbot?.active ?? true,
    systemPrompt: chatbot?.systemPrompt ?? tplDefaults?.systemPrompt ?? '',
    extractionPrompt: chatbot?.extractionPrompt ?? tplDefaults?.extractionPrompt ?? '',
    analysisPrompt: chatbot?.analysisPrompt ?? tplDefaults?.analysisPrompt ?? '',
    greetingMessage: chatbot?.greetingMessage ?? tplDefaults?.greetingMessage ?? '',
    completionMessage: chatbot?.completionMessage ?? tplDefaults?.completionMessage ?? '',
    inactivityEnabled: chatbot?.inactivityEnabled ?? false,
    inactivityAction: chatbot?.inactivityAction ?? 'notify',
    inactivityTimeoutMin: chatbot?.inactivityTimeoutMin ?? 60,
    inactivityCheckIntervalMin: chatbot?.inactivityCheckIntervalMin ?? 5,
    inactivityMessage: chatbot?.inactivityMessage ?? '',
    inactivityMaxRetries: chatbot?.inactivityMaxRetries ?? 2,
    inactivityCloseAfterMin: chatbot?.inactivityCloseAfterMin ?? 1440,
  })
  const { data: funnels } = useFunnels()
  const { data: teamsData } = useTeams()
  const { data: formsData } = useForms()
  const create = useCreateChatbot()
  const update = useUpdateChatbot()
  const loading = create.isPending || update.isPending

  function patch<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  // Editor visual do Formulário do WhatsApp (Flow).
  const [flowEditorOpen, setFlowEditorOpen] = useState(false)

  function handleSubmit() {
    if (!form.name.trim()) { toast('Nome é obrigatório', 'danger'); return }
    const payload = {
      name: form.name.trim(),
      channel: form.channel,
      mode: form.mode,
      formId: form.mode === 'scripted' && form.formId ? Number(form.formId) : null,
      useFlow: form.mode === 'scripted' ? form.useFlow : false,
      postChatAi: form.mode === 'scripted' ? form.postChatAi : false,
      postChatPrompt: form.mode === 'scripted' ? (form.postChatPrompt || null) : null,
      scriptedMessages: form.mode === 'scripted' ? form.scriptedMessages : null,
      funnelId: form.funnelId ? Number(form.funnelId) : null,
      defaultTeamId: form.defaultTeamId ? Number(form.defaultTeamId) : null,
      active: form.active,
      systemPrompt: form.systemPrompt,
      extractionPrompt: form.extractionPrompt,
      analysisPrompt: form.analysisPrompt,
      greetingMessage: form.greetingMessage,
      completionMessage: form.completionMessage,
      inactivityEnabled: form.inactivityEnabled,
      inactivityAction: form.inactivityAction,
      inactivityTimeoutMin: form.inactivityTimeoutMin,
      inactivityCheckIntervalMin: form.inactivityCheckIntervalMin,
      inactivityMessage: form.inactivityMessage,
      inactivityMaxRetries: form.inactivityMaxRetries,
      inactivityCloseAfterMin: form.inactivityCloseAfterMin,
    }
    if (isEdit) {
      update.mutate({ id: chatbot.id, ...payload }, {
        onSuccess: () => { toast('Chatbot atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Chatbot criado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar "${chatbot.name}"` : 'Novo chatbot'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <nav class="flex gap-1 mb-4 border-b border-border">
        {[
          { id: 'general' as Tab, label: 'Geral' },
          { id: 'prompts' as Tab, label: 'Prompts IA' },
          { id: 'inactivity' as Tab, label: 'Inatividade' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            class={cn(
              'px-3 h-9 text-sm font-medium border-b-2 transition-colors',
              tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'general' && (
        <div class="space-y-3">
          {!isEdit && template && (
            <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info flex items-center gap-2">
              <Sparkles size={14} />
              <span>Modelo <strong>{template.emoji} {template.name}</strong> aplicado. Você pode ajustar livremente antes de salvar.</span>
            </div>
          )}
          <Input label="Nome" value={form.name} onInput={(e) => patch('name', (e.target as HTMLInputElement).value)} />
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Select
              label="Motor"
              value={form.mode}
              onChange={(e) => patch('mode', (e.target as HTMLSelectElement).value)}
              hint="IA = conversa livre + scoring. Roteiro = jornada determinística de um formulário (mesmas perguntas, qualificação e agendamento)."
            >
              <option value="ai">🤖 IA (conversa livre)</option>
              <option value="scripted">🧭 Roteiro de formulário</option>
            </Select>
            {form.mode === 'scripted' && (
              <Select
                label="Formulário vinculado"
                value={form.formId}
                onChange={(e) => patch('formId', (e.target as HTMLSelectElement).value)}
                hint="O chatbot conduz exatamente este formulário (perguntas, condicionais e agendamento)."
              >
                <option value="">— Selecione o formulário —</option>
                {formsData?.forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            )}
          </div>
          {form.mode === 'scripted' && (
            <div class="rounded-md border border-border bg-surface-2 p-3 space-y-2">
              <label class="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={form.useFlow}
                  onChange={(e) => patch('useFlow', (e.target as HTMLInputElement).checked)}
                />
                <span class="text-sm text-fg">
                  Coletar dados via WhatsApp Flow (formulário único)
                  <span class="block text-xs text-fg-muted">
                    Em vez de pergunta por pergunta, envia um formulário nativo do WhatsApp (uma tela) e
                    recebe todas as respostas de uma vez. Só funciona em número Cloud API. Edite e publique o
                    formulário no botão abaixo. Sem Flow publicado, cai automaticamente no fluxo normal.
                  </span>
                </span>
              </label>
              <Button type="button" variant="secondary" size="sm" onClick={() => {
                if (!form.formId) { toast('Selecione o formulário vinculado primeiro.', 'danger'); return }
                setFlowEditorOpen(true)
              }} disabled={!form.formId}>
                Editar formulário do WhatsApp (Flow)
              </Button>
            </div>
          )}
          {flowEditorOpen && form.formId && (
            <FlowEditorModal formId={Number(form.formId)} onClose={() => setFlowEditorOpen(false)} />
          )}
          {form.mode === 'scripted' && (
            <div class="rounded-md border border-border bg-surface-2 p-3 space-y-2">
              <label class="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={form.postChatAi}
                  onChange={(e) => patch('postChatAi', (e.target as HTMLInputElement).checked)}
                />
                <span class="text-sm text-fg">
                  Atendimento por IA após concluir o roteiro
                  <span class="block text-xs text-fg-muted">
                    Quando o lead já concluiu (ou foi desqualificado) e volta a mandar mensagem, a IA
                    responde com o contexto do desfecho (ex.: reconhecendo o agendamento) em vez de ficar
                    sem resposta. Não recomeça o formulário.
                  </span>
                </span>
              </label>
              {form.postChatAi && (
                <Textarea
                  label="Instruções da IA pós-atendimento (opcional)"
                  rows={4}
                  value={form.postChatPrompt}
                  placeholder="Ex.: Você atende pela Faculdade X. Reconheça o agendamento do lead, tire dúvidas sobre cursos, polos e processo seletivo, e ofereça remarcar se necessário. Tom cordial e objetivo."
                  onInput={(e) => patch('postChatPrompt', (e.target as HTMLTextAreaElement).value)}
                  hint="Vazio = usa o prompt de IA do chatbot. O sistema injeta automaticamente o nome do lead e o desfecho (agendou / concluiu / desqualificado)."
                />
              )}
            </div>
          )}
          {form.mode === 'scripted' && (
            <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info flex items-center gap-2">
              <Sparkles size={14} class="shrink-0" />
              <span>No modo Roteiro, as perguntas, a qualificação e o agendamento vêm do formulário vinculado. As mensagens de IA e a saudação acima são ignoradas (a saudação, se preenchida, substitui o texto de boas-vindas do formulário).</span>
            </div>
          )}
          {form.mode === 'scripted' && (
            <details class="rounded-md border border-border bg-surface-2 p-3">
              <summary class="cursor-pointer text-sm font-medium text-fg">Mensagens da conversa (editáveis)</summary>
              <p class="mt-1 mb-3 text-[0.6875rem] text-fg-muted">Deixe em branco para usar o texto padrão. Use as variáveis indicadas entre chaves.</p>
              <div class="space-y-3">
                {SCRIPTED_MSG_FIELDS.map((m) => (
                  <Textarea
                    key={m.key}
                    label={m.label + (m.vars ? `  ·  ${m.vars}` : '')}
                    value={form.scriptedMessages[m.key] ?? ''}
                    placeholder={m.placeholder}
                    rows={2}
                    onInput={(e) => {
                      const v = (e.target as HTMLTextAreaElement).value
                      setForm((f) => ({ ...f, scriptedMessages: { ...f.scriptedMessages, [m.key]: v } }))
                    }}
                  />
                ))}
              </div>
            </details>
          )}
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Select label="Canal" value={form.channel} onChange={(e) => patch('channel', (e.target as HTMLSelectElement).value)}>
              {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>)}
            </Select>
            <Select
              label="Funil de destino"
              value={form.funnelId}
              onChange={(e) => patch('funnelId', (e.target as HTMLSelectElement).value)}
              hint="Leads gerados por este chatbot vão para o funil selecionado"
            >
              <option value="">Funil padrão</option>
              {funnels?.funnels.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}{f.isDefault ? ' (padrão)' : ''} — {f._count.stages} etapas
                </option>
              ))}
            </Select>
          </div>
          <Select
            label="Setor padrão (atendimento humano)"
            value={form.defaultTeamId}
            onChange={(e) => patch('defaultTeamId', (e.target as HTMLSelectElement).value)}
            hint="Leads gerados por este chatbot vão direto para a fila do setor"
          >
            <option value="">— Sem setor (vai para fila geral) —</option>
            {teamsData?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Textarea label="Mensagem de saudação" value={form.greetingMessage} onInput={(e) => patch('greetingMessage', (e.target as HTMLTextAreaElement).value)} rows={3} />
          <Textarea label="Mensagem de conclusão" value={form.completionMessage} onInput={(e) => patch('completionMessage', (e.target as HTMLTextAreaElement).value)} rows={3} />
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={form.active} onChange={(e) => patch('active', (e.target as HTMLInputElement).checked)} />
            Chatbot ativo
          </label>
        </div>
      )}

      {tab === 'prompts' && (
        <div class="space-y-3">
          <Textarea
            label="System prompt"
            hint="Persona, regras de conversa, tom de voz. Use {{attendant_name}} e {{brand_name}} para variáveis."
            value={form.systemPrompt}
            onInput={(e) => patch('systemPrompt', (e.target as HTMLTextAreaElement).value)}
            rows={6}
          />
          <Textarea
            label="Prompt de extração"
            hint="O que o bot deve extrair da conversa em JSON estruturado."
            value={form.extractionPrompt}
            onInput={(e) => patch('extractionPrompt', (e.target as HTMLTextAreaElement).value)}
            rows={4}
          />
          <Textarea
            label="Prompt de análise"
            hint="Como o bot deve analisar/resumir a conversa ao final."
            value={form.analysisPrompt}
            onInput={(e) => patch('analysisPrompt', (e.target as HTMLTextAreaElement).value)}
            rows={4}
          />
        </div>
      )}

      {tab === 'inactivity' && (
        <div class="space-y-3">
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={form.inactivityEnabled}
              onChange={(e) => patch('inactivityEnabled', (e.target as HTMLInputElement).checked)}
            />
            Reengajamento por inatividade ativo
          </label>
          <Select label="Ação ao detectar inatividade" value={form.inactivityAction ?? 'notify'} onChange={(e) => patch('inactivityAction', (e.target as HTMLSelectElement).value)} disabled={!form.inactivityEnabled}>
            {INACTIVITY_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </Select>
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Timeout (min)"
              type="number"
              min="5"
              value={form.inactivityTimeoutMin ?? 60}
              onInput={(e) => patch('inactivityTimeoutMin', Number((e.target as HTMLInputElement).value))}
              disabled={!form.inactivityEnabled}
              hint="Minutos sem resposta para considerar inativo"
            />
            <Input
              label="Intervalo check (min)"
              type="number"
              min="1"
              value={form.inactivityCheckIntervalMin ?? 5}
              onInput={(e) => patch('inactivityCheckIntervalMin', Number((e.target as HTMLInputElement).value))}
              disabled={!form.inactivityEnabled}
              hint="De quantos em quantos minutos verificar"
            />
            <Input
              label="Max tentativas"
              type="number"
              min="0"
              max="10"
              value={form.inactivityMaxRetries ?? 2}
              onInput={(e) => patch('inactivityMaxRetries', Number((e.target as HTMLInputElement).value))}
              disabled={!form.inactivityEnabled}
              hint="Reengajamentos antes de desistir"
            />
            <Input
              label="Fechar após (min)"
              type="number"
              min="60"
              value={form.inactivityCloseAfterMin ?? 1440}
              onInput={(e) => patch('inactivityCloseAfterMin', Number((e.target as HTMLInputElement).value))}
              disabled={!form.inactivityEnabled}
              hint="Inatividade total para fechar (1440 = 24h)"
            />
          </div>
          <Textarea
            label="Mensagem de reengajamento"
            value={form.inactivityMessage}
            onInput={(e) => patch('inactivityMessage', (e.target as HTMLTextAreaElement).value)}
            rows={3}
            disabled={!form.inactivityEnabled}
            placeholder="Ex.: Oi {{nome}}, posso te ajudar a continuar?"
          />
        </div>
      )}
    </Modal>
  )
}

function TemplatePickerModal({ onPick, onClose }: { onPick: (t: ChatbotTemplate) => void; onClose: () => void }) {
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Escolha um modelo"
      description="Comece com prompts e mensagens pré-prontas. Você pode ajustar tudo antes de salvar."
      size="xl"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>}
    >
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        {CHATBOT_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            class="text-left rounded-lg border border-border bg-surface p-3 hover:border-accent hover:bg-surface-3 transition-colors flex gap-3 group"
            onClick={() => onPick(t)}
          >
            <span class="text-2xl shrink-0">{t.emoji}</span>
            <div class="min-w-0">
              <div class="text-sm font-medium text-fg truncate">{t.name}</div>
              <div class="text-xs text-fg-muted line-clamp-2 mt-0.5">{t.description}</div>
              <div class="mt-2">
                <Badge tone="neutral">{t.defaults.channel}</Badge>
              </div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  )
}

function DeleteChatbotDialog({ chatbot, onClose }: { chatbot: ChatbotItem; onClose: () => void }) {
  const del = useDeleteChatbot()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${chatbot.name}"`}
      description="O chatbot vai para a lixeira e pode ser restaurado."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(chatbot.id, {
        onSuccess: () => { toast('Chatbot movido para a lixeira', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

function HowItWorksModal({
  onClose,
  onUseTemplate,
  onCreate,
}: {
  onClose: () => void
  onUseTemplate: () => void
  onCreate: () => void
}) {
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Como funcionam os Chatbots?"
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-4 text-sm">
        <div class="rounded-lg p-4 bg-accent/10 border border-accent/30">
          <div class="font-semibold text-fg mb-1">O problema que ele resolve</div>
          <div class="text-xs text-fg-muted leading-relaxed">
            Lead chega no WhatsApp às 23h, no fim de semana, ou enquanto seu vendedor está em reunião —
            e ninguém responde. O chatbot atende sozinho, <strong>coleta as informações que importam</strong>{' '}
            (nome, e-mail, interesse, orçamento) e entrega o lead já qualificado pro vendedor humano continuar.
          </div>
        </div>

        <div class="space-y-3">
          <Step n={1} title="🧩 Comece por um modelo (ou do zero)">
            Em <strong>Usar modelo</strong> você escolhe um chatbot pronto (qualificação de lead, agendamento,
            atendimento inicial, etc.) e adapta. Ou clique em <strong>Novo chatbot</strong> pra montar do zero.
          </Step>
          <Step n={2} title="❓ Configure as perguntas">
            Cada chatbot é uma lista de perguntas em sequência. Você define o texto, o tipo de resposta
            (livre, opções, e-mail, telefone, número), e onde a resposta vai parar (campo do lead, etiqueta, etc.).
          </Step>
          <Step n={3} title="📡 Conecte ao canal">
            Indique em qual canal o bot atende: <strong>WhatsApp</strong> (quando alguém manda mensagem nova),
            <strong> Landing Page</strong> (via código de embed), ou <strong>Site</strong> (widget de chat).
            Use <strong>Testar</strong> antes pra simular a conversa sem ir pro ar.
          </Step>
          <Step n={4} title="🚀 Ativar e atender">
            Ao ativar, o bot passa a responder automaticamente. Cada conversa que ele conduz vira um lead
            no CRM com as respostas registradas e (se você configurou) entra direto numa etapa do funil.
          </Step>
          <Step n={5} title="🤝 Entrega pro humano na hora certa">
            Quando o bot termina as perguntas (ou o lead pede pra falar com alguém), a conversa é transferida
            pra um vendedor — que vê todo o histórico do bot e continua de onde parou.
          </Step>
        </div>

        <div class="rounded-lg p-4 bg-info/10 border border-info/30">
          <div class="font-semibold text-fg mb-1">🛠️ Recursos úteis</div>
          <ul class="text-xs text-fg-muted leading-relaxed space-y-1 list-disc list-inside">
            <li><strong>Testar</strong>: simula a conversa direto no painel, sem gastar mensagem real</li>
            <li><strong>Embed</strong>: gera o código pra colar em site/landing page</li>
            <li><strong>Exportar / Importar</strong>: salva o chatbot como JSON pra duplicar entre contas</li>
            <li><strong>Duplicar</strong>: cria uma cópia inativa pra você ajustar antes de substituir o original</li>
          </ul>
        </div>

        <div class="flex flex-wrap gap-2 justify-end pt-2">
          <Button variant="secondary" size="sm" onClick={onUseTemplate}>
            <Sparkles size={14} /> Começar com modelo
          </Button>
          <Button variant="primary" size="sm" onClick={onCreate}>
            <Plus size={14} /> Criar do zero
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: preact.ComponentChildren }) {
  return (
    <div class="flex gap-3">
      <div class="shrink-0 size-9 rounded-full bg-accent text-fg-on-brand grid place-items-center text-sm font-bold">
        {n}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-fg mb-0.5">{title}</div>
        <div class="text-xs text-fg-muted leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
