// Componente reusável: botão verde "Enviar WhatsApp" + modal de envio in-app.
//
// Toda mensagem sai pelo backend `/atendimento/tickets/:leadId/messages`,
// nunca via wa.me/WhatsApp Web. Histórico fica unificado em /app/conversations,
// equipe vê o atendimento, lifecycle (claim/transfer/notes) funciona normal.
//
// Uso:
//   import { SendWhatsAppButton } from '@/components/WhatsappSend'
//   <SendWhatsAppButton leadId={lead.id} whatsapp={lead.whatsapp} />
//
// Variantes:
//   - <SendWhatsAppButton ... /> → botão completo "Enviar WhatsApp"
//   - <SendWhatsAppButton ... compact /> → ícone-only (kanban/listas estreitas)
//   - <WhatsappChoiceModal ... /> → controle manual do modal (já está aberto)

import { useState, useEffect } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { MessageCircle, Send, Cloud, Smartphone, Clock, AlertTriangle, ChevronRight, ArrowLeft } from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { useTemplates, type MessageTemplateItem } from '@/hooks/useTemplates'
import { useLead } from '@/hooks/useLeads'
import { useSendMessage, useSenderChannels, type SenderChannel } from '@/hooks/useChat'
import { useCloudApiTemplates, parseTemplateComponents, type CloudApiTemplate, type ParsedTemplate } from '@/hooks/useCloudApi'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

// Cor oficial WhatsApp = #25d366
const WPP_BG = 'bg-[#25d366]'
const WPP_HOVER = 'hover:bg-[#1ebe5a]'

interface SendWhatsAppButtonProps {
  leadId: number
  whatsapp: string | null | undefined
  /** ícone-only (sem label) — usar em listas estreitas / kanban card */
  compact?: boolean
  /** customização adicional de classes (ex.: para alterar tamanho, posição) */
  class?: string
  /** callback após envio bem-sucedido (opcional) */
  onSent?: () => void
}

export function SendWhatsAppButton({ leadId, whatsapp, compact, class: className, onSent }: SendWhatsAppButtonProps) {
  const [open, setOpen] = useState(false)
  const noPhone = !whatsapp || !whatsapp.replace(/\D/g, '')

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={noPhone}
        title={noPhone ? 'Lead sem WhatsApp cadastrado' : 'Enviar mensagem WhatsApp via Conversas'}
        aria-label="Enviar WhatsApp"
        class={cn(
          'inline-flex items-center justify-center gap-2 rounded-md text-white font-medium transition-colors shadow-sm',
          WPP_BG, WPP_HOVER,
          'disabled:opacity-50 disabled:cursor-not-allowed',
          compact ? 'h-8 w-8 p-0' : 'h-9 px-3 text-xs',
          className,
        )}
      >
        <WhatsappIcon size={compact ? 16 : 14} />
        {!compact && 'Enviar WhatsApp'}
      </button>
      {open && (
        <WhatsappChoiceModal
          leadId={leadId}
          whatsapp={whatsapp ?? null}
          onClose={() => setOpen(false)}
          onSent={onSent}
        />
      )}
    </>
  )
}

// Ícone WhatsApp em SVG (lucide não tem oficial). Renderiza idêntico ao logotipo.
export function WhatsappIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M16.04 5.33c-5.94 0-10.77 4.83-10.77 10.77 0 1.9.5 3.76 1.44 5.4L5.33 26.67l5.32-1.4a10.74 10.74 0 0 0 5.39 1.45h.01c5.94 0 10.77-4.83 10.77-10.77 0-2.88-1.12-5.58-3.16-7.61a10.7 10.7 0 0 0-7.62-3.01zm0 19.74h-.01a8.95 8.95 0 0 1-4.56-1.25l-.33-.19-3.16.83.84-3.08-.21-.34a8.93 8.93 0 0 1-1.37-4.74c0-4.94 4.02-8.96 8.96-8.96 2.4 0 4.65.93 6.34 2.62a8.91 8.91 0 0 1 2.62 6.34c0 4.94-4.02 8.96-8.96 8.96zm4.91-6.71c-.27-.13-1.6-.79-1.84-.88-.25-.09-.43-.13-.61.13-.18.27-.71.88-.87 1.06-.16.18-.32.2-.59.07-.27-.13-1.14-.42-2.17-1.34-.8-.71-1.34-1.59-1.5-1.86-.16-.27-.02-.42.12-.55.12-.12.27-.32.4-.48.13-.16.18-.27.27-.45.09-.18.04-.34-.02-.48-.07-.13-.61-1.46-.83-2-.22-.53-.45-.46-.61-.47-.16-.01-.34-.01-.52-.01-.18 0-.48.07-.73.34-.25.27-.95.93-.95 2.27 0 1.34.98 2.63 1.11 2.81.13.18 1.92 2.93 4.65 4.11.65.28 1.16.45 1.55.58.65.21 1.24.18 1.71.11.52-.08 1.6-.65 1.83-1.28.23-.63.23-1.17.16-1.28-.07-.11-.25-.18-.52-.31z"/>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────
// WhatsappChoiceModal — escolher template e enviar via Conversas (in-app)
// ─────────────────────────────────────────────────────────────────────

interface WhatsappChoiceModalProps {
  leadId: number
  whatsapp: string | null
  onClose: () => void
  onSent?: (() => void) | undefined
}

// Fluxo em 3 passos:
//   1. Escolher o NÚMERO de origem (sempre mostrado, mesmo com 1 canal).
//   2. Escolher modelo / mensagem livre — depende do canal:
//        • Evolution → modelos internos (texto livre, gratuito).
//        • Cloud API → dentro da janela 24h: texto livre + modelos HSM aprovados;
//                       fora da janela: SÓ modelos HSM aprovados (regra Meta).
//   3. Compor (editar texto ou preencher variáveis do template HSM) e enviar.
export function WhatsappChoiceModal({ leadId, whatsapp, onClose, onSent }: WhatsappChoiceModalProps) {
  const { data: lead } = useLead(leadId)
  const { data: channelsData, isLoading: chLoading } = useSenderChannels(leadId)
  const { data: evoData } = useTemplates({ channel: 'whatsapp' })
  const { data: cloudData } = useCloudApiTemplates()
  const send = useSendMessage(leadId)
  const [, navigate] = useLocation()

  const channels = channelsData?.channels ?? []
  const [channelId, setChannelId] = useState<string | null>(null)
  const channel = channels.find((c) => c.id === channelId) ?? null

  // Pré-seleciona o canal de ENTRADA do lead (o número pelo qual ele falou por
  // último), sugerido pelo backend — assim a resposta sai pelo mesmo número que
  // o lead usou. O operador ainda pode trocar (botão de trocar número).
  useEffect(() => {
    if (channelId) return
    const suggested = channelsData?.suggestedChannelId
    if (suggested && channels.some((c) => c.id === suggested)) setChannelId(suggested)
  }, [channelsData])
  const isCloud = channel?.provider === 'cloud_api'
  const windowOpen = channel?.window?.open ?? false

  const evoTemplates = (evoData?.templates ?? []).filter((t) => t.active)
  const cloudTemplates = (cloudData?.templates ?? []).filter((t) => t.status === 'APPROVED')

  // Composição
  const [selectedEvo, setSelectedEvo] = useState<MessageTemplateItem | null>(null)
  const [selectedCloud, setSelectedCloud] = useState<CloudApiTemplate | null>(null)
  const [isFreeForm, setIsFreeForm] = useState(false)
  const [draft, setDraft] = useState('')
  const [tplVars, setTplVars] = useState<Record<string, string>>({})

  const noPhone = !whatsapp || !whatsapp.replace(/\D/g, '')

  function applyVars(text: string): string {
    if (!lead) return text
    const map: Record<string, string> = {
      nome: lead.nome ?? '', empresa: lead.empresa ?? '', whatsapp: lead.whatsapp ?? '',
      email: lead.email ?? '', segmento: lead.segmento ?? '', cidade: lead.cidade ?? '',
    }
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m: string, k: string) => map[k] ?? '')
  }

  function resetComposition() {
    setSelectedEvo(null); setSelectedCloud(null); setIsFreeForm(false); setDraft(''); setTplVars({})
  }

  function pickEvoTemplate(t: MessageTemplateItem) {
    resetComposition(); setSelectedEvo(t); setDraft(applyVars(t.body))
  }
  function pickFreeForm() {
    resetComposition(); setIsFreeForm(true)
  }
  function pickCloudTemplate(t: CloudApiTemplate) {
    resetComposition(); setSelectedCloud(t)
    const form = getTemplateForm(parseTemplateComponents(t.components))
    // pré-preenche a 1ª variável de texto do corpo com o nome do lead (saudações).
    const init: Record<string, string> = {}
    const firstBodyText = form.fields.find((f) => f.component === 'body' && f.kind === 'text')
    form.fields.forEach((f) => { init[f.key] = f.kind === 'text' && f === firstBodyText ? (lead?.nome ?? '') : '' })
    setTplVars(init)
  }

  function backToTemplates() { resetComposition() }
  function backToChannels() { resetComposition(); setChannelId(null) }

  const isComposing = selectedEvo !== null || selectedCloud !== null || isFreeForm

  // Render do preview do template HSM com as variáveis preenchidas
  const cloudParsed = selectedCloud ? parseTemplateComponents(selectedCloud.components) : null
  const cloudForm = cloudParsed ? getTemplateForm(cloudParsed) : null
  function renderCloudPreview(): string {
    if (!cloudParsed) return ''
    return renderTemplateText(cloudParsed.body, 'body', tplVars)
  }
  function renderCloudHeaderPreview(): string {
    if (!cloudParsed?.header || cloudParsed.header.format !== 'TEXT' || !cloudParsed.header.text) return ''
    return renderTemplateText(cloudParsed.header.text, 'header', tplVars)
  }

  function handleSend(opts: { andOpenConversation?: boolean }) {
    if (noPhone) { toast('Lead sem WhatsApp cadastrado', 'warning'); return }
    if (!channelId) { toast('Escolha o número de envio', 'warning'); return }

    let input: Parameters<typeof send.mutate>[0]

    if (selectedCloud && cloudParsed && cloudForm) {
      // Toda variável (header/body, texto ou mídia) precisa de valor — senão a Meta rejeita.
      const missing = cloudForm.fields.some((f) => !(tplVars[f.key] || '').trim())
      if (missing) { toast('Preencha todas as variáveis do modelo', 'warning'); return }
      const components = buildSendComponents(cloudForm, tplVars)
      input = {
        body: renderCloudPreview(),
        mediaType: 'template',
        isInternal: false,
        channelId,
        template: { name: selectedCloud.name, language: selectedCloud.language, components },
      }
    } else {
      const body = draft.trim()
      if (!body) { toast('Mensagem vazia', 'warning'); return }
      input = { body, mediaType: 'text', isInternal: false, channelId }
    }

    send.mutate(input, {
      onSuccess: () => {
        toast(opts.andOpenConversation ? 'Mensagem enviada' : 'Mensagem enviada — abra Conversas pra acompanhar', 'success')
        onSent?.(); onClose()
        if (opts.andOpenConversation) navigate(`/conversations?leadId=${leadId}`)
      },
      onError: (e: unknown) => toast((e as Error).message || 'Falha ao enviar', 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={
        <span class="inline-flex items-center gap-2">
          <span class={cn('size-6 rounded-full grid place-items-center text-white', WPP_BG)}>
            <WhatsappIcon size={14} />
          </span>
          Enviar WhatsApp
        </span> as any
      }
      description={whatsapp ? `Para: ${whatsapp} · envio via Conversas` : 'Sem WhatsApp cadastrado'}
      size="md"
      footer={
        isComposing ? (
          <>
            <Button variant="ghost" size="sm" onClick={backToTemplates} disabled={send.isPending}>
              <ArrowLeft size={12} /> Voltar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleSend({ andOpenConversation: true })} disabled={send.isPending || noPhone}>
              <MessageCircle size={12} /> Enviar e abrir conversa
            </Button>
            <button
              type="button"
              onClick={() => handleSend({ andOpenConversation: false })}
              disabled={send.isPending || noPhone}
              class={cn('inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-white transition-colors', WPP_BG, WPP_HOVER, 'disabled:opacity-50 disabled:cursor-not-allowed')}
            >
              <Send size={12} /> {send.isPending ? 'Enviando…' : 'Enviar'}
            </button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
        )
      }
    >
      {noPhone && (
        <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-fg mb-3">
          Esse lead não tem WhatsApp cadastrado. Edite o cadastro pra adicionar antes de enviar.
        </div>
      )}

      {/* PASSO 1 — escolher número de origem */}
      {!channelId && (
        <div class="space-y-2">
          <div class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider">Número de origem</div>
          {chLoading ? (
            <div class="text-xs text-fg-muted text-center py-4">Carregando números…</div>
          ) : channels.length === 0 ? (
            <div class="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-fg">
              Você não tem um número de WhatsApp vinculado. Peça ao administrador para configurar uma instância ou conexão Cloud API.
            </div>
          ) : (
            channels.map((c) => <ChannelRow key={c.id} channel={c} suggested={c.id === channelsData?.suggestedChannelId} onPick={() => setChannelId(c.id)} disabled={noPhone} />)
          )}
        </div>
      )}

      {/* PASSO 2 — escolher modelo / mensagem livre */}
      {channelId && !isComposing && channel && (
        <div class="space-y-2">
          <ChannelHeader channel={channel} canSwitch={channels.length > 1} onSwitch={backToChannels} />

          {isCloud && (
            <div class={cn('rounded-md border p-2.5 text-xs flex items-start gap-2', windowOpen ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10')}>
              {windowOpen ? <Clock size={14} class="mt-0.5 text-success shrink-0" /> : <AlertTriangle size={14} class="mt-0.5 text-warning shrink-0" />}
              <div class="text-fg">
                {windowOpen
                  ? <>Janela de 24h <strong>aberta</strong>{channel.window?.minutesRemaining != null ? ` · ${formatWindow(channel.window.minutesRemaining)} restantes` : ''}. Você pode enviar mensagem livre ou um modelo aprovado.</>
                  : <>Janela de 24h <strong>fechada</strong>. Pelo WhatsApp Oficial, fora das 24h só é possível enviar um <strong>modelo (template) aprovado</strong> pela Meta.</>}
              </div>
            </div>
          )}

          {/* Mensagem livre: Evolution sempre; Cloud só com janela aberta */}
          {(!isCloud || windowOpen) && (
            <button type="button" class="w-full text-left rounded-md border border-border bg-surface-2 hover:bg-surface-3 p-3 transition-colors disabled:opacity-50" onClick={pickFreeForm} disabled={noPhone}>
              <div class="text-sm font-medium text-fg">Mensagem livre</div>
              <div class="text-xs text-fg-muted">Digitar texto sem usar modelo</div>
            </button>
          )}

          {/* Modelos */}
          {isCloud ? (
            cloudTemplates.length === 0 ? (
              <div class="text-xs text-fg-muted text-center py-4">Nenhum modelo aprovado pela Meta. Crie e aprove em <strong>WhatsApp Oficial</strong>.</div>
            ) : (
              <>
                <div class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider pt-2">Modelos aprovados (Meta)</div>
                {cloudTemplates.map((t) => {
                  const p = parseTemplateComponents(t.components)
                  return (
                    <button key={t.id} type="button" class="w-full text-left rounded-md border border-border bg-surface hover:bg-surface-2 p-3 transition-colors disabled:opacity-50" onClick={() => pickCloudTemplate(t)} disabled={noPhone}>
                      <div class="text-sm font-medium text-fg flex items-center gap-2">{t.name} <span class="text-[0.625rem] font-normal text-fg-subtle uppercase">{t.language}</span></div>
                      <div class="text-xs text-fg-muted line-clamp-2">{p.body}</div>
                    </button>
                  )
                })}
              </>
            )
          ) : (
            evoTemplates.length === 0 ? (
              <div class="text-xs text-fg-muted text-center py-4">Nenhum modelo de WhatsApp cadastrado. Crie em <strong>Modelos</strong>.</div>
            ) : (
              <>
                <div class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider pt-2">Modelos</div>
                {evoTemplates.map((t) => (
                  <button key={t.id} type="button" class="w-full text-left rounded-md border border-border bg-surface hover:bg-surface-2 p-3 transition-colors disabled:opacity-50" onClick={() => pickEvoTemplate(t)} disabled={noPhone}>
                    <div class="text-sm font-medium text-fg">{t.name}</div>
                    <div class="text-xs text-fg-muted line-clamp-2">{applyVars(t.body)}</div>
                  </button>
                ))}
              </>
            )
          )}
        </div>
      )}

      {/* PASSO 3 — compor */}
      {isComposing && (
        <div class="space-y-2">
          {/* Template HSM Cloud: variáveis + preview */}
          {selectedCloud && cloudParsed && cloudForm ? (
            <>
              <div class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider">Modelo HSM: {selectedCloud.name}</div>
              {cloudForm.fields.length > 0 ? (
                <div class="space-y-2">
                  {cloudForm.fields.map((f) => (
                    <div key={f.key}>
                      <label class="text-[0.6875rem] text-fg-subtle">{f.label}</label>
                      <Input
                        value={tplVars[f.key] ?? ''}
                        onInput={(e) => setTplVars({ ...tplVars, [f.key]: (e.target as HTMLInputElement).value })}
                        placeholder={f.kind === 'media' ? 'https://… (link público do arquivo)' : `Valor para ${f.token ? `{{${f.token}}}` : `posição ${f.index + 1}`}`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div class="text-[0.6875rem] text-fg-subtle">Este modelo não tem variáveis.</div>
              )}
              <div class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider pt-1">Pré-visualização</div>
              <div class="rounded-md border border-border bg-surface-2 p-3 text-sm text-fg whitespace-pre-wrap">
                {renderCloudHeaderPreview() && <div class="font-semibold mb-1">{renderCloudHeaderPreview()}</div>}
                {renderCloudPreview()}
              </div>
              {cloudParsed.footer && <div class="text-xs text-fg-subtle">{cloudParsed.footer}</div>}
            </>
          ) : (
            <>
              <div class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider">{selectedEvo ? `Modelo: ${selectedEvo.name}` : 'Mensagem livre'}</div>
              <Textarea rows={8} value={draft} onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)} placeholder="Digite ou edite a mensagem antes de enviar…" autoFocus />
              <div class="text-[0.6875rem] text-fg-subtle">
                Variáveis suportadas: <code>{'{{nome}}'}</code>, <code>{'{{empresa}}'}</code>, <code>{'{{whatsapp}}'}</code>, <code>{'{{email}}'}</code>, <code>{'{{segmento}}'}</code>, <code>{'{{cidade}}'}</code>.
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

// Linha de seleção de canal (passo 1)
function ChannelRow({ channel, suggested, onPick, disabled }: { channel: SenderChannel; suggested: boolean; onPick: () => void; disabled: boolean }) {
  const isCloud = channel.provider === 'cloud_api'
  return (
    <button type="button" onClick={onPick} disabled={disabled} class="w-full text-left rounded-md border border-border bg-surface hover:bg-surface-2 p-3 transition-colors disabled:opacity-50 flex items-center gap-3">
      <span class={cn('size-8 rounded-full grid place-items-center shrink-0', isCloud ? 'bg-info/15 text-info' : 'bg-success/15 text-success')}>
        {isCloud ? <Cloud size={16} /> : <Smartphone size={16} />}
      </span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-fg flex items-center gap-2">
          {channel.label}
          {suggested && <span class="text-[0.5625rem] font-semibold uppercase rounded px-1 py-0.5 bg-info/15 text-info">Sugerido</span>}
        </div>
        <div class="text-xs text-fg-muted">{channel.number ?? '—'} · {isCloud ? 'WhatsApp Oficial (Cloud API)' : 'WhatsApp (Evolution)'}</div>
      </div>
      {isCloud && channel.window && (
        <span class={cn('text-[0.625rem] font-medium rounded px-1.5 py-0.5 shrink-0', channel.window.open ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
          {channel.window.open ? 'Janela aberta' : 'Fora da janela'}
        </span>
      )}
      <ChevronRight size={14} class="text-fg-subtle shrink-0" />
    </button>
  )
}

// Cabeçalho do canal escolhido (passo 2/3) com opção de trocar
function ChannelHeader({ channel, canSwitch, onSwitch }: { channel: SenderChannel; canSwitch: boolean; onSwitch: () => void }) {
  const isCloud = channel.provider === 'cloud_api'
  return (
    <div class="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 mb-1">
      <span class={cn('size-6 rounded-full grid place-items-center shrink-0', isCloud ? 'bg-info/15 text-info' : 'bg-success/15 text-success')}>
        {isCloud ? <Cloud size={12} /> : <Smartphone size={12} />}
      </span>
      <div class="min-w-0 flex-1 text-xs">
        <span class="text-fg font-medium">{channel.label}</span>
        <span class="text-fg-muted"> · {channel.number ?? '—'}</span>
      </div>
      {canSwitch && <button type="button" onClick={onSwitch} class="text-[0.6875rem] text-info hover:underline shrink-0">Trocar número</button>}
    </div>
  )
}

function formatWindow(minutes: number): string {
  if (minutes >= 60) { const h = Math.floor(minutes / 60); const m = minutes % 60; return m ? `${h}h${m}min` : `${h}h` }
  return `${minutes}min`
}

// ─── Variáveis de template HSM (Meta) ───────────────────
// A Meta aceita placeholders no HEADER (texto ou mídia) e no BODY, em formato
// posicional ({{1}}), nomeado ({{nome}}) ou — como em templates legados/quebrados
// — vazio ({{}}). Cada placeholder PRECISA de um parâmetro no envio, senão a Meta
// rejeita ("number of parameters does not match"). Aqui extraímos todos e
// montamos os componentes de envio corretos.

type TplComponentKind = 'header' | 'body'
interface TplField {
  key: string                 // identificador único (ex.: "body:1", "body:pos0", "header:media")
  label: string
  component: TplComponentKind
  kind: 'text' | 'media'
  mediaFormat?: string        // IMAGE | VIDEO | DOCUMENT
  token: string               // conteúdo entre {{ }} ("", "1", "nome")
  index: number               // ordem de aparição dentro do componente
}

const PLACEHOLDER_RE = /\{\{\s*([^}]*?)\s*\}\}/g

// A Meta só conta como PARÂMETRO os placeholders posicionais ({{1}}) ou nomeados
// ({{nome}}). Texto como "{{}}" (vazio) ou "{{ algo com espaço }}" é literal e NÃO
// é variável — mandar parâmetro para ele causa erro #132000 ("number of params
// does not match"). Esta função decide o que é variável de verdade.
function classifyToken(token: string): 'numeric' | 'named' | null {
  if (/^\d+$/.test(token)) return 'numeric'
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token)) return 'named'
  return null // literal — ignorar
}

function placeholderKey(component: TplComponentKind, token: string): string {
  return `${component}:${token}`
}

function extractTextFields(text: string, component: TplComponentKind): TplField[] {
  const fields: TplField[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  let i = -1
  PLACEHOLDER_RE.lastIndex = 0
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    const token = (m[1] ?? '').trim()
    if (classifyToken(token) === null) continue // {{}} / texto literal → não é variável
    i++
    const key = placeholderKey(component, token)
    if (seen.has(key)) continue // {{1}} repetido = mesma variável
    seen.add(key)
    fields.push({
      key, component, kind: 'text', token, index: i,
      label: `${component === 'header' ? 'Cabeçalho' : 'Mensagem'} {{${token}}}`,
    })
  }
  return fields
}

interface TemplateForm { fields: TplField[]; named: boolean }

function getTemplateForm(parsed: ParsedTemplate): TemplateForm {
  const fields: TplField[] = []
  if (parsed.header) {
    if (parsed.header.format === 'TEXT' && parsed.header.text) {
      fields.push(...extractTextFields(parsed.header.text, 'header'))
    } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(parsed.header.format)) {
      const fmt = parsed.header.format
      fields.push({ key: 'header:media', label: `URL do ${fmt.toLowerCase()} do cabeçalho`, component: 'header', kind: 'media', mediaFormat: fmt, token: 'media', index: 0 })
    }
  }
  fields.push(...extractTextFields(parsed.body, 'body'))
  const named = fields.some((f) => f.kind === 'text' && f.token !== '' && !/^\d+$/.test(f.token))
  return { fields, named }
}

// Substitui os placeholders VÁLIDOS pelos valores (para o preview). Placeholders
// literais ({{}} etc.) ficam como estão — é o que a Meta envia.
function renderTemplateText(text: string, component: TplComponentKind, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (full, raw) => {
    const token = (raw ?? '').trim()
    if (classifyToken(token) === null) return full // literal
    const key = placeholderKey(component, token)
    return values[key] || `{{${token}}}`
  })
}

// Monta os `components` de ENVIO (formato Meta) a partir dos valores preenchidos.
function buildSendComponents(form: TemplateForm, values: Record<string, string>): unknown[] {
  const comps: unknown[] = []
  const param = (f: TplField) => {
    if (f.kind === 'media') {
      const fmt = (f.mediaFormat || 'IMAGE').toLowerCase()
      return { type: fmt, [fmt]: { link: values[f.key] || '' } }
    }
    const p: Record<string, unknown> = { type: 'text', text: values[f.key] || '' }
    if (form.named && f.token) p.parameter_name = f.token
    return p
  }
  const ordered = (list: TplField[]) => {
    // posicional numérico → ordena por número; senão mantém ordem de aparição
    const allNumeric = list.every((f) => f.kind === 'text' && /^\d+$/.test(f.token))
    return allNumeric ? [...list].sort((a, b) => Number(a.token) - Number(b.token)) : list
  }
  const headerFields = form.fields.filter((f) => f.component === 'header')
  if (headerFields.length) comps.push({ type: 'header', parameters: ordered(headerFields).map(param) })
  const bodyFields = form.fields.filter((f) => f.component === 'body')
  if (bodyFields.length) comps.push({ type: 'body', parameters: ordered(bodyFields).map(param) })
  return comps
}
