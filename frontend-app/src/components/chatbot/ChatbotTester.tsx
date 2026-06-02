import { useState, useRef, useEffect, useMemo } from 'preact/hooks'
import { Bot, Send, RotateCcw, User as UserIcon, AlertCircle, CheckCircle } from 'lucide-preact'
import { useChatQuestions, useChatbot, type ChatQuestion } from '@/hooks/useChatbots'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'

type Speaker = 'bot' | 'user' | 'system'

interface Msg {
  speaker: Speaker
  text: string
  ts: number
}

interface Props {
  chatbotId: number
}

export function ChatbotTester({ chatbotId }: Props) {
  const { data: bot } = useChatbot(chatbotId)
  const { data: qData, isLoading } = useChatQuestions(chatbotId)
  const questions = useMemo(
    () => (qData?.questions ?? []).filter((q) => q.active),
    [qData],
  )

  const [step, setStep] = useState(0) // index na fila de perguntas ativas
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [done, setDone] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Reseta sempre que o chatbotId muda
  useEffect(() => {
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId, questions.length])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length])

  function pushBot(text: string) {
    setMessages((m) => [...m, { speaker: 'bot', text, ts: Date.now() }])
  }
  function pushUser(text: string) {
    setMessages((m) => [...m, { speaker: 'user', text, ts: Date.now() }])
  }
  function pushSystem(text: string) {
    setMessages((m) => [...m, { speaker: 'system', text, ts: Date.now() }])
  }

  function reset() {
    setMessages([])
    setStep(0)
    setAnswers({})
    setDraft('')
    setDone(false)
    if (bot?.greetingMessage) {
      // adicionando com delay para dar sensação de digitando
      setTimeout(() => pushBot(bot.greetingMessage!), 200)
      if (questions.length > 0) {
        setTimeout(() => pushBot(questions[0]!.text), 800)
      }
    } else if (questions.length > 0) {
      setTimeout(() => pushBot(questions[0]!.text), 200)
    }
  }

  function validate(q: ChatQuestion, value: string): string | null {
    if (q.required && !value.trim()) return 'Resposta obrigatória.'
    if (!value.trim()) return null
    if (q.type === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'E-mail inválido.'
    }
    if (q.type === 'number') {
      if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return 'Número inválido.'
    }
    if (q.type === 'phone') {
      const digits = value.replace(/\D/g, '')
      if (digits.length < 10) return 'Telefone com poucos dígitos.'
    }
    if (q.type === 'cpf') {
      const d = value.replace(/\D/g, '')
      if (d.length !== 11) return 'CPF deve ter 11 dígitos.'
    }
    if (q.type === 'cnpj') {
      const d = value.replace(/\D/g, '')
      if (d.length !== 14) return 'CNPJ deve ter 14 dígitos.'
    }
    if (q.type === 'cep') {
      const d = value.replace(/\D/g, '')
      if (d.length !== 8) return 'CEP deve ter 8 dígitos.'
    }
    if (q.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) && !/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return 'Data inválida (YYYY-MM-DD ou DD/MM/YYYY).'
    }
    if (q.type === 'select' && Array.isArray(q.options)) {
      const opts = q.options as string[]
      if (!opts.includes(value)) return `Escolha uma das opções: ${opts.join(', ')}`
    }
    if (q.type === 'multi_select' && Array.isArray(q.options)) {
      const opts = q.options as string[]
      const chosen = value.split(',').map((s) => s.trim()).filter(Boolean)
      const invalid = chosen.find((c) => !opts.includes(c))
      if (invalid) return `Opção inválida: ${invalid}`
    }
    return null
  }

  function handleSubmit() {
    if (done) return
    const value = draft.trim()
    const q = questions[step]
    if (!q) return
    const err = validate(q, value)
    if (err) {
      pushSystem(err)
      return
    }
    pushUser(value || '(em branco)')
    setAnswers((a) => ({ ...a, [q.fieldKey]: value }))
    setDraft('')

    const next = step + 1
    if (next < questions.length) {
      setStep(next)
      const nq = questions[next]!
      setTimeout(() => pushBot(nq.text), 400)
    } else {
      setStep(next)
      setDone(true)
      const completion = bot?.completionMessage ?? '✅ Conversa concluída.'
      setTimeout(() => pushBot(completion), 400)
    }
  }

  function pickOption(opt: string) {
    setDraft(opt)
  }

  if (isLoading) return <Skeleton class="h-64 w-full" />

  if (questions.length === 0) {
    return (
      <div class="rounded-md border border-dashed border-border p-6 text-center">
        <Bot size={20} class="text-fg-subtle mx-auto mb-2" />
        <div class="text-sm text-fg-muted">Adicione perguntas antes de testar.</div>
      </div>
    )
  }

  const currentQ = questions[step]
  const isOptionsType = currentQ && (currentQ.type === 'select' || currentQ.type === 'multi_select')
  const options = isOptionsType && Array.isArray(currentQ.options) ? (currentQ.options as string[]) : []

  return (
    <div class="rounded-md border border-border bg-surface flex flex-col h-96 max-h-[80dvh]">
      <header class="flex items-center justify-between gap-2 p-2 border-b border-border">
        <div class="text-xs text-fg-muted inline-flex items-center gap-1.5">
          <Bot size={12} class="text-accent" />
          Simulação local — não envia mensagens reais
        </div>
        <Button size="sm" variant="ghost" onClick={reset}>
          <RotateCcw size={11} /> Reiniciar
        </Button>
      </header>

      <div ref={scrollRef} class="flex-1 overflow-y-auto p-3 space-y-2 bg-surface-2">
        {messages.map((m, i) => (
          <Bubble key={i} msg={m} />
        ))}
        {done && (
          <div class="rounded-md border border-success/40 bg-success/10 p-2 text-xs text-success inline-flex items-center gap-1">
            <CheckCircle size={11} /> Conversa concluída · {Object.keys(answers).length} resposta(s) capturada(s)
          </div>
        )}
      </div>

      {!done && currentQ && (
        <div class="border-t border-border p-2 space-y-2">
          {isOptionsType && options.length > 0 && (
            <div class="flex flex-wrap gap-1">
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  class="text-[0.6875rem] px-2 py-1 rounded border border-border bg-surface hover:border-accent hover:text-accent transition-colors"
                  onClick={() => pickOption(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          <div class="flex items-end gap-2">
            <textarea
              class="flex-1 min-h-[2.25rem] max-h-24 px-3 py-2 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent resize-none"
              placeholder="Digite sua resposta…"
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              rows={1}
            />
            <Button size="md" variant="primary" onClick={handleSubmit}>
              <Send size={12} />
            </Button>
          </div>
        </div>
      )}

      {done && Object.keys(answers).length > 0 && (
        <details class="border-t border-border p-2 bg-surface">
          <summary class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle cursor-pointer">
            Respostas capturadas (debug)
          </summary>
          <pre class="text-[0.6875rem] text-fg-muted mt-1 overflow-x-auto">{JSON.stringify(answers, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}

function Bubble({ msg }: { msg: Msg }) {
  if (msg.speaker === 'system') {
    return (
      <div class="text-[0.6875rem] text-danger inline-flex items-center gap-1 px-2">
        <AlertCircle size={11} /> {msg.text}
      </div>
    )
  }
  const isBot = msg.speaker === 'bot'
  return (
    <div class={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
      <div class={`max-w-[80%] rounded-lg px-3 py-2 text-sm flex items-start gap-2 ${
        isBot
          ? 'bg-surface border border-border text-fg rounded-bl-sm'
          : 'bg-accent text-fg-on-brand rounded-br-sm'
      }`}>
        {isBot && <Bot size={11} class="text-fg-muted mt-0.5 shrink-0" />}
        <span class="whitespace-pre-wrap break-words">{msg.text}</span>
        {!isBot && <UserIcon size={11} class="opacity-80 mt-0.5 shrink-0" />}
      </div>
    </div>
  )
}
