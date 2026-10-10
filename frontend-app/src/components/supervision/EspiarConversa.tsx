// Supervisão › Espiar: a conversa como o atendente vê, só para ler.
//
// Nada aqui interage com a conversa: não há caixa de resposta, não marca como
// lida, não consulta o número no WhatsApp, não assume e não aparece para o
// contato nem para o atendente. A leitura vem de GET /supervision/espiar/:id,
// que usa o mesmo recorte da Supervisão. Para agir, "Entrar na conversa" leva à
// tela normal de Conversas — lá vale tudo como sempre.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useQuery } from '@tanstack/react-query'
import { X, Eye, ExternalLink, RefreshCw } from '@/components/ui/icon-set'
import { Button } from '@/components/ui/Button'
import { api, ApiError } from '@/lib/apiClient'
import { GaleriaDeMidiaProvider } from '@/components/media/MediaViewer'
import { mediaKindOf, type MediaItem } from '@/components/media/mediaKind'
import { MessageBubble, formatDayLabel, dayKey } from '@/routes/pages/ConversationsPage'
import type { ChatMessage } from '@/hooks/useChat'

interface ConversaEspiada {
  id: number
  nome: string
  whatsapp: string
  isGroup: boolean
  unreadMessages: number
  lastMessageAt: string | null
  canal: string | null
  etapa: string | null
  funil: { id: number; nome: string } | null
  assignedUser: { id: number; name: string } | null
  team: { id: number; name: string } | null
}
interface RespostaEspiar { conversa: ConversaEspiada; messages: ChatMessage[]; hasMore: boolean }

export function EspiarConversa({ leadId, onClose }: { leadId: number; onClose: () => void }) {
  // A 1ª leitura de cada abertura vai para a auditoria (inicio=1); as demais não.
  const primeira = useRef(true)
  const q = useQuery({
    queryKey: ['supervision', 'espiar', leadId],
    queryFn: () => {
      const inicio = primeira.current ? '&inicio=1' : ''
      primeira.current = false
      return api.get<RespostaEspiar>(`/supervision/espiar/${leadId}?limit=80${inicio}`)
    },
    // Ao vivo: a conversa continua andando enquanto se espia.
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  })

  // Mensagens mais antigas, puxadas por "Carregar anteriores".
  const [antigas, setAntigas] = useState<ChatMessage[]>([])
  const [temMaisAntigas, setTemMaisAntigas] = useState<boolean | null>(null)
  const [carregando, setCarregando] = useState(false)
  const recentes = q.data?.messages ?? []
  const mensagens = useMemo(() => {
    const vistos = new Set(recentes.map((m) => m.id))
    return [...antigas.filter((m) => !vistos.has(m.id)), ...recentes]
  }, [antigas, recentes])
  const maisAntigas = temMaisAntigas ?? q.data?.hasMore ?? false

  async function carregarAnteriores() {
    const primeiraMsg = mensagens[0]
    if (!primeiraMsg) return
    setCarregando(true)
    try {
      const r = await api.get<RespostaEspiar>(`/supervision/espiar/${leadId}?limit=80&before=${primeiraMsg.id}`)
      setAntigas((a) => [...r.messages, ...a])
      setTemMaisAntigas(r.hasMore)
    } finally {
      setCarregando(false)
    }
  }

  // Desce para o fim ao abrir e quando chega mensagem nova — só se a pessoa já
  // estava perto do fim (não arranca quem subiu para ler o começo).
  const rolagem = useRef<HTMLDivElement | null>(null)
  const ultimaId = recentes[recentes.length - 1]?.id
  const jaDesceu = useRef(false)
  useEffect(() => {
    const el = rolagem.current
    if (!el || !ultimaId) return
    const pertoDoFim = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (!jaDesceu.current || pertoDoFim) {
      el.scrollTop = el.scrollHeight
      jaDesceu.current = true
    }
  }, [ultimaId])

  useEffect(() => {
    const fechar = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fechar)
    return () => window.removeEventListener('keydown', fechar)
  }, [onClose])

  const c = q.data?.conversa ?? null
  const midias = useMemo<MediaItem[]>(() => mensagens
    .filter((m) => m.mediaUrl && m.mediaType && m.mediaType !== 'text' && m.mediaType !== 'contact' && !m.isDeleted)
    .map((m) => ({
      id: m.id,
      kind: mediaKindOf(m.mediaType, m.mediaUrl!, m.mediaName),
      url: m.mediaUrl!,
      name: m.mediaName,
      sender: m.fromMe ? (m.senderName || 'Atendente') : (m.senderName || c?.nome || null),
      at: m.timestamp,
    })), [mensagens, c?.nome])
  const porId = useMemo(() => new Map(mensagens.map((m) => [m.id, m])), [mensagens])

  const dias = useMemo(() => {
    const out: { chave: string; itens: ChatMessage[] }[] = []
    for (const m of mensagens) {
      const chave = dayKey(m.timestamp)
      const ultimo = out[out.length - 1]
      if (ultimo && ultimo.chave === chave) ultimo.itens.push(m)
      else out.push({ chave, itens: [m] })
    }
    return out
  }, [mensagens])

  const erro = q.error instanceof ApiError ? q.error.message : q.error ? 'Não foi possível abrir a conversa.' : null

  return (
    <div class="fixed inset-0 flex justify-end" style={{ zIndex: 'var(--z-modal, 50)' }} role="dialog" aria-modal="true" aria-label="Espiar conversa">
      <button type="button" class="absolute inset-0 bg-black/40" aria-label="Fechar" onClick={onClose} />
      <div class="relative flex h-full w-full max-w-2xl flex-col bg-surface border-l border-border shadow-xl">
        <div class="flex items-start gap-3 border-b border-border p-3">
          <span class="size-9 rounded-md bg-accent/15 text-accent grid place-items-center shrink-0"><Eye size={16} /></span>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-sm truncate">{c?.nome || (q.isLoading ? 'Carregando…' : 'Conversa')}</div>
            {c && (
              <div class="text-2xs text-fg-muted flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                <span>{c.whatsapp}</span>
                <span>· Atendente: <b class="text-fg">{c.assignedUser?.name ?? 'ninguém'}</b></span>
                {c.team && <span>· {c.team.name}</span>}
                {c.funil && <span>· {c.funil.nome}{c.etapa ? ` › ${c.etapa}` : ''}</span>}
                {c.canal && <span>· {c.canal}</span>}
                {c.unreadMessages > 0 && <span class="text-warning">· {c.unreadMessages} não lida(s) pelo atendente</span>}
              </div>
            )}
          </div>
          <a href={`/app/conversations?leadId=${leadId}`} class="shrink-0">
            <Button size="sm" variant="secondary"><ExternalLink size={12} /> Entrar na conversa</Button>
          </a>
          <button type="button" class="size-8 grid place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-surface-3 shrink-0" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <div class="bg-surface-2 border-b border-border px-3 py-1.5 text-2xs text-fg-muted flex items-center gap-2">
          <Eye size={12} class="shrink-0" />
          Modo espiar — só leitura. Não marca como lida e nada aparece para o contato nem para o atendente.
          <span class="ml-auto inline-flex items-center gap-1">{q.isFetching && <RefreshCw size={10} class="animate-spin" />} ao vivo</span>
        </div>

        <GaleriaDeMidiaProvider items={midias}>
          <div ref={rolagem} class="flex-1 overflow-y-auto p-3 space-y-3">
            {erro && <div class="text-sm text-danger">{erro}</div>}
            {maisAntigas && mensagens.length > 0 && (
              <div class="flex justify-center">
                <Button size="sm" variant="ghost" onClick={carregarAnteriores} disabled={carregando}>
                  {carregando ? 'Carregando…' : 'Carregar anteriores'}
                </Button>
              </div>
            )}
            {!q.isLoading && !erro && mensagens.length === 0 && (
              <div class="text-sm text-fg-muted text-center py-10">Nenhuma mensagem nesta conversa.</div>
            )}
            {dias.map((dia) => (
              <section key={`${dia.chave}-${dia.itens[0]!.id}`} class="space-y-2" aria-label={formatDayLabel(dia.itens[0]!.timestamp)}>
                <div class="sticky top-0 z-10 flex justify-center py-1 pointer-events-none">
                  <span class="rounded-full bg-surface-3 px-2.5 py-0.5 text-2xs text-fg-muted shadow-sm">
                    {formatDayLabel(dia.itens[0]!.timestamp)}
                  </span>
                </div>
                {dia.itens.map((m) => (
                  <MessageBubble
                    key={m.id}
                    msg={m}
                    quoted={m.quotedMsgId ? porId.get(m.quotedMsgId) ?? null : null}
                    nomeContato={c?.isGroup ? null : c?.nome ?? null}
                    somenteLeitura
                  />
                ))}
              </section>
            ))}
          </div>
        </GaleriaDeMidiaProvider>
      </div>
    </div>
  )
}
