/**
 * Resultado da busca da lista de conversas, no formato do WhatsApp Web: a lista
 * dá lugar a seções — Contatos, Conversas, Mensagens —, o termo aparece em
 * verde em cada linha e abrir um resultado NÃO apaga a busca (dá para ir de um
 * em um, como no app).
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import { Loader2, Search } from '@/components/ui/icon-set'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { recorte, semMarcacao } from '@/lib/buscaTexto'
import { formatarTelefone } from '@/lib/telefone'
import type { Ticket } from '@/hooks/useChat'
import { useBuscaConversas, type MensagemAchada } from '@/hooks/useBuscaConversas'
import { Avatar, dataCurta, Grifado, GrifadoNumero, IconeMidia, prefixoMensagem } from './buscaUi'

function Secao({ titulo, children }: { titulo: string; children: preact.ComponentChildren }) {
  return (
    <section aria-label={titulo}>
      <h3 class="busca-secao px-4 pb-1.5 pt-4 text-sm font-medium">{titulo}</h3>
      <ul>{children}</ul>
    </section>
  )
}

function Linha({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: preact.ComponentChildren }) {
  return (
    <li>
      <button
        type="button"
        data-resultado
        onClick={onClick}
        class={cn(
          'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none',
          ativo && 'bg-surface-3',
        )}
      >
        {children}
      </button>
    </li>
  )
}

function Canal({ c }: { c: Ticket['channel'] }) {
  if (!c) return null
  const rotulo = c.label || c.name || c.number
  if (!rotulo) return null
  return (
    <span class="inline-flex min-w-0 shrink items-center gap-1 text-3xs text-fg-muted">
      <span class="size-1.5 shrink-0 rounded-full" style={{ background: c.color || 'currentColor' }} />
      <span class="truncate">{rotulo}</span>
    </span>
  )
}

function LinhaContato({ t, termo, ativo, onAbrir }: { t: Ticket; termo: string; ativo: boolean; onAbrir: () => void }) {
  const numero = t.whatsapp ? formatarTelefone(t.whatsapp) : ''
  return (
    <Linha ativo={ativo} onClick={onAbrir}>
      <Avatar foto={t.profilePicUrl} nome={t.nome ?? t.whatsapp} />
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline justify-between gap-2">
          <span class="truncate text-[0.95rem] text-fg"><Grifado texto={t.nome || numero || 'Sem nome'} termo={termo} /></span>
          {t.lastMessageAt && <span class="shrink-0 text-3xs text-fg-muted">{dataCurta(t.lastMessageAt)}</span>}
        </span>
        <span class="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
          {numero && <span class="shrink-0 tabular-nums"><GrifadoNumero numero={numero} termo={termo} /></span>}
          {t.lastMessageAt ? <Canal c={t.channel} /> : <span class="truncate italic">Sem conversa ainda</span>}
        </span>
      </span>
    </Linha>
  )
}

function LinhaConversa({ t, termo, ativo, onAbrir }: { t: Ticket; termo: string; ativo: boolean; onAbrir: () => void }) {
  // Contato que entrou aqui pela empresa ou pelo e-mail: é isso que a linha
  // mostra, com o grifo — senão a pessoa não entende por que ele apareceu.
  const contexto = !t.isGroup ? [t.empresa, t.email].filter(Boolean).join(' · ') : ''
  const ultima = t.lastMessage?.body ? `${t.lastMessage.fromMe ? 'Você: ' : ''}${semMarcacao(t.lastMessage.body).replace(/\s+/g, ' ')}` : ''
  return (
    <Linha ativo={ativo} onClick={onAbrir}>
      <Avatar foto={t.profilePicUrl} nome={t.nome} grupo={!!t.isGroup} />
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline justify-between gap-2">
          <span class="truncate text-[0.95rem] text-fg"><Grifado texto={t.nome || 'Sem nome'} termo={termo} /></span>
          {t.lastMessageAt && (
            <span class={cn('shrink-0 text-3xs', t.unreadMessages > 0 ? 'busca-secao font-medium' : 'text-fg-muted')}>{dataCurta(t.lastMessageAt)}</span>
          )}
        </span>
        <span class="mt-0.5 flex items-center justify-between gap-2 text-xs text-fg-muted">
          <span class="truncate">{contexto ? <Grifado texto={contexto} termo={termo} /> : ultima || 'Sem mensagens'}</span>
          {t.unreadMessages > 0 && (
            <span class="grid h-[1.15rem] min-w-[1.15rem] shrink-0 place-items-center rounded-full bg-[#00a884] px-1 text-3xs font-semibold text-white">
              {t.unreadMessages}
            </span>
          )}
        </span>
      </span>
    </Linha>
  )
}

export function ResultadosBusca({ termo, ativo, onAbrir, onAbrirMensagem }: {
  termo: string
  /** Conversa aberta no painel — a linha dela fica marcada. */
  ativo: number | null
  onAbrir: (leadId: number) => void
  onAbrirMensagem: (m: MensagemAchada) => void
}) {
  const { contatos, conversas, mensagens, procuraMensagens } = useBuscaConversas(termo)
  const [msgAtiva, setMsgAtiva] = useState<number | null>(null)
  useEffect(() => setMsgAtiva(null), [termo])

  const listaContatos = contatos.data?.tickets ?? []
  const listaConversas = conversas.data ?? []
  const paginas = mensagens.data?.pages ?? []
  const listaMensagens = paginas.flatMap((p) => p.mensagens)
  const donos = Object.assign({}, ...paginas.map((p) => p.conversas)) as Record<number, NonNullable<(typeof paginas)[number]>['conversas'][number]>

  // Rolagem infinita das mensagens.
  const fim = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = fim.current
    if (!el || !mensagens.hasNextPage) return
    const obs = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && !mensagens.isFetchingNextPage) void mensagens.fetchNextPage()
    }, { rootMargin: '300px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [mensagens.hasNextPage, mensagens.isFetchingNextPage, listaMensagens.length])

  const carregandoTudo = (contatos.isLoading || conversas.isLoading) && !listaContatos.length && !listaConversas.length
  const nada = !carregandoTudo && !contatos.isFetching && !conversas.isFetching && !mensagens.isLoading
    && !listaContatos.length && !listaConversas.length && !listaMensagens.length

  /** ↑ ↓ andam pelos resultados; o foco volta para a busca acima do primeiro. */
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const itens = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-resultado]')]
    const i = itens.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    const prox = itens[i + (e.key === 'ArrowDown' ? 1 : -1)]
    if (prox) prox.focus()
    else if (e.key === 'ArrowUp') document.querySelector<HTMLInputElement>('[data-busca-lista] input')?.focus()
  }

  return (
    <div onKeyDown={onKeyDown} class="pb-3">
      {carregandoTudo && (
        <div class="flex flex-col gap-2 p-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} class="h-14 w-full" />)}
        </div>
      )}

      {listaContatos.length > 0 && (
        <Secao titulo="Contatos">
          {listaContatos.map((t) => (
            <LinhaContato key={t.id} t={t} termo={termo} ativo={ativo === t.id && msgAtiva === null} onAbrir={() => { setMsgAtiva(null); onAbrir(t.id) }} />
          ))}
        </Secao>
      )}

      {listaConversas.length > 0 && (
        <Secao titulo="Conversas">
          {listaConversas.map((t) => (
            <LinhaConversa key={t.id} t={t} termo={termo} ativo={ativo === t.id && msgAtiva === null} onAbrir={() => { setMsgAtiva(null); onAbrir(t.id) }} />
          ))}
        </Secao>
      )}

      {listaMensagens.length > 0 && (
        <Secao titulo="Mensagens">
          {listaMensagens.map((m) => {
            const c = donos[m.leadId]
            const texto = m.body || m.mediaName || ''
            return (
              <Linha key={m.id} ativo={msgAtiva === m.id} onClick={() => { setMsgAtiva(m.id); onAbrirMensagem(m) }}>
                <Avatar foto={c?.profilePicUrl} nome={c?.nome} grupo={!!c?.isGroup} />
                <span class="min-w-0 flex-1">
                  <span class="flex items-baseline justify-between gap-2">
                    <span class="truncate text-[0.95rem] text-fg">{c?.nome || (c?.whatsapp ? formatarTelefone(c.whatsapp) : 'Conversa')}</span>
                    <span class="shrink-0 text-3xs text-fg-muted">{dataCurta(m.timestamp)}</span>
                  </span>
                  <span class="mt-0.5 block truncate text-xs text-fg-muted">
                    <IconeMidia tipo={m.mediaType} />
                    {prefixoMensagem(m, !!c?.isGroup)}
                    <Grifado texto={recorte(texto, termo)} termo={termo} />
                  </span>
                </span>
              </Linha>
            )
          })}
        </Secao>
      )}

      {mensagens.hasNextPage && (
        <div ref={fim} class="flex justify-center p-3 text-2xs text-fg-muted">
          {mensagens.isFetchingNextPage && <><Loader2 size={12} class="mr-1.5 animate-spin" /> Carregando mais mensagens…</>}
        </div>
      )}
      {procuraMensagens && mensagens.isLoading && (listaContatos.length > 0 || listaConversas.length > 0) && (
        <p class="flex items-center justify-center gap-1.5 p-3 text-2xs text-fg-muted"><Loader2 size={12} class="animate-spin" /> Procurando nas mensagens…</p>
      )}
      {!procuraMensagens && !carregandoTudo && (
        <p class="px-4 pt-4 text-2xs text-fg-muted">Digite 3 letras ou mais para procurar também dentro das mensagens.</p>
      )}

      {nada && (
        <div class="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Search size={28} class="text-fg-muted" />
          <p class="text-sm text-fg">Nenhum resultado para “{termo.trim()}”</p>
          <p class="text-2xs text-fg-muted">Procuramos em nomes, números, empresas, e-mails{procuraMensagens ? ' e mensagens' : ''} das conversas que você pode ver.</p>
        </div>
      )}
    </div>
  )
}
