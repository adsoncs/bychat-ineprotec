/**
 * "Pesquisar mensagens" dentro da conversa — o painel da direita do WhatsApp
 * Web. Procura no histórico INTEIRO (não só no que está carregado na tela),
 * lista da mais nova para a mais antiga com a data de cada uma e, ao escolher
 * um resultado, a conversa vai até a mensagem e grifa o termo — o painel e os
 * resultados continuam ali, para ir ao próximo.
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import { CalendarDays, ChevronDown, ChevronUp, Loader2, Search, X } from '@/components/ui/icon-set'
import { cn } from '@/lib/cn'
import { recorte } from '@/lib/buscaTexto'
import { useBuscaNaConversa, useValorAssentado } from '@/hooks/useBuscaConversas'
import { dataCurta, Grifado, IconeMidia, prefixoMensagem } from './buscaUi'

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function PainelBuscaConversa({ leadId, nome, grupo, termo, onTermo, alvoId, onIrPara, onFechar }: {
  leadId: number
  nome: string
  grupo: boolean
  termo: string
  onTermo: (t: string) => void
  /** Resultado aberto agora (a mensagem destacada na conversa). */
  alvoId: number | null
  onIrPara: (id: number) => void
  onFechar: () => void
}) {
  const [dia, setDia] = useState<string | null>(null)
  const [escolhendoDia, setEscolhendoDia] = useState(false)
  const assentado = useValorAssentado(termo, 220)
  const busca = useBuscaNaConversa(leadId, assentado, dia)
  const resultados = busca.data?.pages.flatMap((p) => p.mensagens) ?? []
  const total = busca.data?.pages[0]?.total ?? 0
  const ativo = !!assentado.trim() || !!dia
  const idx = alvoId === null ? -1 : resultados.findIndex((m) => m.id === alvoId)

  const inputRef = useRef<HTMLInputElement>(null)
  // Abre com o termo selecionado: digitar troca a pesquisa em vez de emendar.
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const lista = useRef<HTMLUListElement>(null)
  // O resultado aberto fica à vista na lista (navegando por ↑ ↓ ele sairia dela).
  useEffect(() => {
    if (alvoId === null) return
    lista.current?.querySelector(`[data-msg="${alvoId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [alvoId])

  const fim = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = fim.current
    if (!el || !busca.hasNextPage) return
    const obs = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && !busca.isFetchingNextPage) void busca.fetchNextPage()
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [busca.hasNextPage, busca.isFetchingNextPage, resultados.length])

  /** +1 = mais antiga (desce na lista), -1 = mais nova. */
  async function andar(passo: 1 | -1) {
    if (!resultados.length) return
    const alvo = idx < 0 ? 0 : idx + passo
    if (alvo < 0) return
    if (alvo >= resultados.length) {
      if (!busca.hasNextPage) return
      const r = await busca.fetchNextPage()
      const nova = r.data?.pages.flatMap((p) => p.mensagens)[alvo]
      if (nova) onIrPara(nova.id)
      return
    }
    onIrPara(resultados[alvo]!.id)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFechar() }
    else if (e.key === 'Enter') { e.preventDefault(); void andar(e.shiftKey ? -1 : 1) }
    else if (e.key === 'ArrowDown' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault(); lista.current?.querySelector<HTMLElement>('button')?.focus()
    }
  }

  function onKeyDownLista(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const itens = [...(lista.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    const i = itens.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    const prox = itens[i + (e.key === 'ArrowDown' ? 1 : -1)]
    if (prox) prox.focus()
    else if (e.key === 'ArrowUp') inputRef.current?.focus()
  }

  return (
    <div class="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <header class="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3">
        <button
          type="button"
          onClick={onFechar}
          class="grid size-8 place-items-center rounded-full text-fg-muted hover:bg-surface-3 hover:text-fg"
          aria-label="Fechar pesquisa"
          title="Fechar (Esc)"
        >
          <X size={18} />
        </button>
        <h2 class="text-sm font-medium text-fg">Pesquisar mensagens</h2>
      </header>

      <div class="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
        <div class="flex items-center gap-1.5">
          <div class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface-3 px-3">
            <Search size={15} class="shrink-0 text-fg-muted" />
            <input
              ref={inputRef}
              type="text"
              value={termo}
              onInput={(e) => onTermo((e.target as HTMLInputElement).value)}
              placeholder="Pesquisar…"
              aria-label={`Pesquisar mensagens com ${nome}`}
              class="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
            />
            {termo && (
              <button type="button" onClick={() => { onTermo(''); inputRef.current?.focus() }} class="grid size-5 place-items-center rounded text-fg-muted hover:text-fg" aria-label="Limpar">
                <X size={13} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEscolhendoDia((v) => !v)}
            class={cn('grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-3 hover:text-fg', (dia || escolhendoDia) && 'busca-secao bg-surface-3')}
            aria-label="Pesquisar por data"
            title="Pesquisar por data"
            aria-pressed={!!dia || escolhendoDia}
          >
            <CalendarDays size={17} />
          </button>
        </div>

        {(escolhendoDia || dia) && (
          <div class="flex items-center gap-2 text-xs">
            <span class="text-fg-muted">Dia</span>
            <input
              type="date"
              value={dia ?? ''}
              max={new Date().toLocaleDateString('sv-SE')}
              onInput={(e) => setDia((e.target as HTMLInputElement).value || null)}
              class="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg [color-scheme:light_dark]"
            />
            {dia && (
              <button type="button" onClick={() => { setDia(null); setEscolhendoDia(false) }} class="text-2xs text-fg-muted underline hover:text-fg">
                limpar data
              </button>
            )}
          </div>
        )}

        {ativo && !busca.isLoading && (
          <div class="flex items-center justify-between gap-2 text-2xs text-fg-muted">
            <span aria-live="polite">
              {total === 0
                ? 'Nenhuma mensagem encontrada'
                : idx >= 0
                  ? `${idx + 1} de ${total}`
                  : `${total} ${total === 1 ? 'mensagem encontrada' : 'mensagens encontradas'}`}
            </span>
            {total > 0 && (
              <span class="flex items-center gap-0.5">
                <button type="button" onClick={() => void andar(-1)} disabled={idx <= 0} class="grid size-7 place-items-center rounded-md hover:bg-surface-3 hover:text-fg disabled:opacity-35" aria-label="Mais recente" title="Mais recente (Shift+Enter)">
                  <ChevronUp size={16} />
                </button>
                <button type="button" onClick={() => void andar(1)} disabled={idx >= total - 1} class="grid size-7 place-items-center rounded-md hover:bg-surface-3 hover:text-fg disabled:opacity-35" aria-label="Mais antiga" title="Mais antiga (Enter)">
                  <ChevronDown size={16} />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        {!ativo && (
          <p class="px-6 py-10 text-center text-sm text-fg-muted">
            Pesquise mensagens com <span class="text-fg">{nome}</span>.
          </p>
        )}
        {ativo && busca.isLoading && (
          <p class="flex items-center justify-center gap-2 py-10 text-xs text-fg-muted"><Loader2 size={14} class="animate-spin" /> Procurando…</p>
        )}
        {ativo && resultados.length > 0 && (
          <ul ref={lista} onKeyDown={onKeyDownLista}>
            {resultados.map((m) => {
              const texto = m.body || m.mediaName || ''
              const aberto = m.id === alvoId
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    data-msg={m.id}
                    onClick={() => onIrPara(m.id)}
                    aria-current={aberto || undefined}
                    class={cn(
                      'block w-full border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none',
                      aberto && 'bg-surface-3',
                    )}
                  >
                    <span class="flex items-baseline justify-between gap-2 text-3xs text-fg-muted">
                      <span>{dataCurta(m.timestamp)}</span>
                      {dataCurta(m.timestamp).includes(':') ? null : <span>{hora(m.timestamp)}</span>}
                    </span>
                    <span class="mt-1 line-clamp-2 text-[0.84rem] leading-snug text-fg">
                      <IconeMidia tipo={m.mediaType} />
                      <span class="text-fg-muted">{prefixoMensagem(m, grupo)}</span>
                      <Grifado texto={recorte(texto, assentado, 40)} termo={assentado} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {busca.hasNextPage && (
          <div ref={fim} class="flex justify-center p-3 text-2xs text-fg-muted">
            {busca.isFetchingNextPage && <Loader2 size={12} class="animate-spin" />}
          </div>
        )}
      </div>
    </div>
  )
}
