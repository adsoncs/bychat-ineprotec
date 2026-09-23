/**
 * Seletor de emojis das Conversas — no molde do WhatsApp Web.
 *
 * Antes eram ~60 emojis fixos, em 4 grupos, com uma busca que só achava as
 * poucas palavras escritas à mão. Agora é o catálogo Unicode inteiro (até o
 * Emoji 14 — ver scripts/gerar-emojis-pt.py) com nome e palavras-chave em
 * PORTUGUÊS, abas por categoria, recentes, tom de pele e busca que ignora
 * acento ("coracao" acha ❤️).
 *
 * Os dados (~47 KB comprimidos) só carregam quando o seletor abre pela
 * primeira vez: quem não usa emoji não paga por eles.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import * as Popover from '@radix-ui/react-popover'
import { Smile, Search, X } from '@/components/ui/icon-set'
import { cn } from '@/lib/cn'

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
}

/** [emoji, nome, palavras-chave, categoria, tons?] — formato do emojis-pt.json */
type Linha = [string, string, string, number, string[]?]
interface Emoji { e: string; nome: string; busca: string; cat: number; tons?: string[] }

const CATEGORIAS = [
  { id: 0, rotulo: 'Smileys e pessoas', icone: '😀' },
  { id: 1, rotulo: 'Animais e natureza', icone: '🐻' },
  { id: 2, rotulo: 'Comida e bebida', icone: '🍔' },
  { id: 3, rotulo: 'Atividades', icone: '⚽' },
  { id: 4, rotulo: 'Viagens e lugares', icone: '🚗' },
  { id: 5, rotulo: 'Objetos', icone: '💡' },
  { id: 6, rotulo: 'Símbolos', icone: '🔣' },
  { id: 7, rotulo: 'Bandeiras', icone: '🏳️' },
] as const
const RECENTES = -1

// Mão levantada em cada tom, do padrão (amarelo) ao 5.
const TONS = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿']
const NOMES_TOM = ['Padrão', 'Pele clara', 'Pele morena clara', 'Pele morena', 'Pele morena escura', 'Pele escura']

// Enquanto a pessoa ainda não usou nada: os mais comuns em atendimento.
const PADRAO_RECENTES = ['👍', '❤️', '🙏', '😂', '😊', '🎉', '🔥', '✅', '🤝', '😍', '👏', '😅', '🙂', '😉', '👋', '💪']
const MAX_RECENTES = 24
const K_RECENTES = 'emoji.recentes'
const K_TOM = 'emoji.tom'

// Fonte de emoji do sistema explícita: sem ela, alguns Windows desenham parte
// dos emojis em preto e branco (fonte de texto).
const FONTE_EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif'

// O catálogo grava alguns emojis com o seletor de variação U+FE0F (👍️) e a
// lista fixa sem ele (👍): sem normalizar, os dois não se reconhecem e o
// "Mais usados" perdia nome e tom de pele.
const chave = (e: string) => e.replace(/\uFE0F/g, '')

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

let cache: Emoji[] | null = null
async function carregar(): Promise<Emoji[]> {
  if (cache) return cache
  const mod = await import('./emoji/emojis-pt.json')
  const linhas = ((mod as any).default ?? mod).e as Linha[]
  cache = linhas.map(([e, nome, tags, cat, tons]) => ({
    e, nome, cat, busca: semAcento(`${nome} ${tags}`), ...(tons ? { tons } : {}),
  }))
  return cache
}

function ler<T>(k: string, padrao: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : padrao } catch { return padrao }
}
function gravar(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* modo privado: segue sem memória */ }
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [aberto, setAberto] = useState(false)
  const [lista, setLista] = useState<Emoji[] | null>(cache)
  const [busca, setBusca] = useState('')
  const [tom, setTom] = useState<number>(() => ler(K_TOM, 0))
  const [escolhendoTom, setEscolhendoTom] = useState(false)
  const [recentes, setRecentes] = useState<string[]>(() => ler(K_RECENTES, [] as string[]))
  const [ativa, setAtiva] = useState<number>(RECENTES)
  const [foco, setFoco] = useState<Emoji | null>(null)
  const areaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (aberto && !lista) void carregar().then(setLista)
    if (!aberto) { setBusca(''); setEscolhendoTom(false); setFoco(null) }
  }, [aberto, lista])

  const porEmoji = useMemo(() => new Map((lista ?? []).map((x) => [chave(x.e), x])), [lista])
  const comTom = (x: Emoji) => (tom > 0 && x.tons ? x.tons[tom - 1]! : x.e)

  // Busca: nome que começa com o termo vem antes de palavra que começa com
  // ele, que vem antes de "contém". Cada palavra digitada precisa casar.
  const resultado = useMemo(() => {
    const q = semAcento(busca.trim())
    if (!q || !lista) return null
    const termos = q.split(/\s+/).filter(Boolean)
    const nota = (x: Emoji) => {
      if (!termos.every((t) => x.busca.includes(t))) return -1
      const nome = semAcento(x.nome)
      if (nome.startsWith(q)) return 0
      if (nome.split(' ').some((p) => p.startsWith(termos[0]!))) return 1
      if (x.busca.split(' ').some((p) => p.startsWith(termos[0]!))) return 2
      return 3
    }
    return lista
      .map((x) => [x, nota(x)] as const)
      .filter(([, n]) => n >= 0)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 240)
      .map(([x]) => x)
  }, [busca, lista])

  const secoes = useMemo(() => {
    if (!lista) return []
    // Recentes primeiro, completados pelos mais usados — no começo a pessoa usou
    // um ou dois, e a faixa não pode encolher para isso.
    const vistos = new Set<string>()
    const rec = [...recentes, ...PADRAO_RECENTES]
      .filter((e) => { const k = chave(e); if (vistos.has(k)) return false; vistos.add(k); return true })
      .slice(0, MAX_RECENTES)
      .map((e) => porEmoji.get(chave(e)) ?? { e, nome: '', busca: '', cat: RECENTES })
    return [
      { id: RECENTES, rotulo: recentes.length ? 'Recentes' : 'Mais usados', itens: rec },
      ...CATEGORIAS.map((c) => ({ id: c.id as number, rotulo: c.rotulo, itens: lista.filter((x) => x.cat === c.id) })),
    ]
  }, [lista, recentes, porEmoji])

  function escolher(x: Emoji) {
    const e = comTom(x)
    onSelect(e)
    // Recente guarda o emoji base: o tom vale para todos, e muda junto.
    const base = chave(x.e)
    const novo = [base, ...recentes.filter((r) => chave(r) !== base)].slice(0, MAX_RECENTES)
    setRecentes(novo)
    gravar(K_RECENTES, novo)
  }

  function irPara(id: number) {
    setBusca('')
    const el = areaRef.current?.querySelector<HTMLElement>(`[data-cat="${id}"]`)
    // Salto direto, como no WhatsApp Web: animar de Bandeiras até Recentes leva
    // mais de um segundo e a aba ativa fica piscando pelo caminho.
    if (el && areaRef.current) areaRef.current.scrollTo({ top: el.offsetTop - 4 })
    setAtiva(id)
  }

  // Aba ativa acompanha a rolagem.
  function aoRolar() {
    const area = areaRef.current
    if (!area || resultado) return
    const topo = area.scrollTop + 8
    let atual = RECENTES
    for (const el of area.querySelectorAll<HTMLElement>('[data-cat]')) {
      if (el.offsetTop <= topo) atual = Number(el.dataset.cat)
    }
    if (atual !== ativa) setAtiva(atual)
  }

  // Função de render, não componente: definido aqui dentro como componente, o
  // Preact o trataria como tipo novo a cada render e recriaria os ~1.800 botões
  // a cada passada do mouse (o rodapé atualiza no hover).
  const grade = (itens: Emoji[]) => (
    <div class="grid grid-cols-9 gap-0.5">
      {itens.map((x) => (
        <button
          key={x.e}
          type="button"
          class="grid size-9 place-items-center rounded-md text-[22px] leading-none transition-transform hover:scale-110 hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
          style={{ fontFamily: FONTE_EMOJI }}
          onClick={() => escolher(x)}
          onMouseEnter={() => setFoco(x)}
          onFocus={() => setFoco(x)}
          title={x.nome || undefined}
          aria-label={x.nome || x.e}
        >
          {comTom(x)}
        </button>
      ))}
    </div>
  )

  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger asChild>
        <button
          type="button"
          class="size-9 shrink-0 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg grid place-items-center"
          aria-label="Emoji"
        >
          <Smile size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          class="flex h-[26rem] w-[23rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface-2 shadow-xl"
          style={{ zIndex: 'var(--z-popover)' }}
          // Inserir o emoji devolve o foco à caixa de texto — sem isto o seletor
          // fechava a cada emoji. Como no WhatsApp Web, fica aberto para vários
          // seguidos; fecha com clique fora ou Esc.
          onFocusOutside={(e: Event) => e.preventDefault()}
          // O foco vai para a busca, como no WhatsApp Web: abrir e já digitar.
          onOpenAutoFocus={(e: Event) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('input')?.focus()
          }}
        >
          {/* Abas de categoria */}
          <div class="flex shrink-0 items-center justify-between border-b border-border px-1.5 pt-1">
            {[{ id: RECENTES, rotulo: 'Recentes', icone: '🕘' }, ...CATEGORIAS].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => irPara(c.id)}
                title={c.rotulo}
                aria-label={c.rotulo}
                class={cn(
                  'relative grid h-9 flex-1 place-items-center text-lg leading-none transition-opacity',
                  ativa === c.id && !resultado ? 'opacity-100' : 'opacity-50 grayscale hover:opacity-80 hover:grayscale-0',
                )}
                style={{ fontFamily: FONTE_EMOJI }}
              >
                {c.icone}
                {ativa === c.id && !resultado && <span class="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>

          {/* Busca + tom de pele */}
          <div class="flex shrink-0 items-center gap-1.5 px-2 py-2">
            <div class="relative flex-1">
              <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input
                type="text"
                placeholder="Pesquisar emoji"
                class="h-8 w-full rounded-full border border-border bg-surface pl-8 pr-7 text-xs text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                value={busca}
                onInput={(e) => { setBusca((e.target as HTMLInputElement).value); areaRef.current?.scrollTo({ top: 0 }) }}
                onKeyDown={(e) => {
                  // Enter escolhe o primeiro resultado — digitar "joia" + Enter.
                  if (e.key === 'Enter' && resultado?.[0]) { e.preventDefault(); escolher(resultado[0]) }
                }}
              />
              {busca && (
                <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca"
                  class="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-fg-muted hover:bg-surface-3 hover:text-fg">
                  <X size={11} />
                </button>
              )}
            </div>
            <div class="relative">
              <button
                type="button"
                onClick={() => setEscolhendoTom((v) => !v)}
                title={`Tom de pele: ${NOMES_TOM[tom]}`}
                aria-label="Tom de pele"
                aria-expanded={escolhendoTom}
                class="grid size-8 place-items-center rounded-full text-lg hover:bg-surface-3"
                style={{ fontFamily: FONTE_EMOJI }}
              >
                {TONS[tom]}
              </button>
              {escolhendoTom && (
                <div class="absolute right-0 top-9 z-10 flex gap-0.5 rounded-full border border-border bg-surface p-1 shadow-lg">
                  {TONS.map((t, i) => (
                    <button key={t} type="button" title={NOMES_TOM[i]} aria-label={NOMES_TOM[i]}
                      onClick={() => { setTom(i); gravar(K_TOM, i); setEscolhendoTom(false) }}
                      class={cn('grid size-8 place-items-center rounded-full text-lg hover:bg-surface-3', i === tom && 'bg-surface-3 ring-1 ring-accent')}
                      style={{ fontFamily: FONTE_EMOJI }}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Emojis */}
          <div ref={areaRef} onScroll={aoRolar} class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {!lista ? (
              <div class="grid grid-cols-9 gap-0.5 pt-1">
                {Array.from({ length: 45 }, (_, i) => <div key={i} class="size-9 animate-pulse rounded-md bg-surface-3/60" />)}
              </div>
            ) : resultado ? (
              resultado.length === 0 ? (
                <p class="py-10 text-center text-xs text-fg-muted">Nenhum emoji encontrado para “{busca.trim()}”</p>
              ) : (
                <>
                  <div class="px-1 pb-1 text-2xs font-medium text-fg-muted">Resultados</div>
                  {grade(resultado)}
                </>
              )
            ) : (
              secoes.map((s) => (
                // Sem content-visibility: a altura estimada das seções fora da
                // tela deslocava o destino das abas (Bandeiras parava em Objetos).
                <section key={s.id} data-cat={s.id} class="pb-2">
                  <div class="sticky top-0 z-[1] bg-surface-2/95 px-1 py-1 text-2xs font-medium text-fg-muted backdrop-blur-sm">{s.rotulo}</div>
                  {grade(s.itens)}
                </section>
              ))
            )}
          </div>

          {/* Rodapé: qual é o emoji sob o mouse */}
          <div class="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-fg-muted">
            {foco ? (
              <>
                <span class="text-xl leading-none" style={{ fontFamily: FONTE_EMOJI }}>{comTom(foco)}</span>
                <span class="truncate first-letter:uppercase">{foco.nome}</span>
              </>
            ) : (
              <span>{lista ? `${lista.length.toLocaleString('pt-BR')} emojis · busque em português` : 'Carregando…'}</span>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
