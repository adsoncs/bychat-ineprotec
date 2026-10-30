import { useMemo, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, Search, X } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select, Switch } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import type { KanbanLead } from '@/hooks/useKanban'
import { useKanbanCardStore } from '@/stores/kanbanCard'
import { GRUPOS_DE_BLOCOS, useCatalogoDeDados, valorDoDado, type DadoInfo } from '@/components/kanban/kanbanCardCatalogo'

type Aba = 'dados' | 'blocos'

/** Lead de exemplo para quando o quadro está vazio — a prévia nunca fica em branco. */
const LEAD_EXEMPLO: KanbanLead = {
  id: 0, empresa: 'Empresa Exemplo', nome: 'Maria Souza', whatsapp: '5562999990000', email: 'maria@exemplo.com',
  scores: { geral: 72 }, status: '', source: 'whatsapp', completed: false,
  createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), updatedAt: new Date().toISOString(),
  annotation: 'Prefere contato à tarde', customFields: {}, outcome: null, tags: [],
  _activityCount: 2, _metaFormName: null, segmento: 'Educação', cidade: 'Goiânia', aiScore: 82, aiScoreLabel: 'hot',
  uid: 'L-000123', assignedUser: { id: 0, name: 'Ana Lima' },
}

/**
 * Personalizar card do Kanban — preferência DESTE agente, salva no navegador.
 *
 * A prévia usa um lead de verdade do quadro (o que tem mais dados preenchidos
 * vem primeiro), porque é com os dados reais que se percebe se o card ficou
 * comprido demais. Linhas sem valor aparecem marcadas "sem dado" na prévia,
 * para o agente ver onde cairiam; no quadro, linha vazia não aparece.
 */
export function KanbanCardSettings({ open, onOpenChange, leads, renderPrevia }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Leads do quadro, para a prévia. */
  leads: KanbanLead[]
  renderPrevia: (lead: KanbanLead) => ComponentChildren
}) {
  const st = useKanbanCardStore()
  const catalogo = useCatalogoDeDados()
  const [aba, setAba] = useState<Aba>('dados')
  const [busca, setBusca] = useState('')
  const [leadPrevia, setLeadPrevia] = useState<number | null>(null)

  // Prévia: os leads com mais dados escolhidos preenchidos primeiro.
  const opcoesPrevia = useMemo(() => {
    const pontos = (l: KanbanLead) => st.dados.filter((d) => !!valorDoDado(l, d).text).length
    return [...leads].sort((a, b) => pontos(b) - pontos(a)).slice(0, 40)
  }, [leads, st.dados])
  const lead = opcoesPrevia.find((l) => l.id === leadPrevia) ?? opcoesPrevia[0] ?? LEAD_EXEMPLO

  const porId = useMemo(() => new Map(catalogo.map((d) => [d.id, d])), [catalogo])
  const escolhidos = st.dados.map((id) => porId.get(id)).filter((d): d is DadoInfo => !!d)
  const termo = busca.trim().toLowerCase()
  const disponiveis = catalogo.filter((d) => !termo || d.label.toLowerCase().includes(termo) || d.grupo.toLowerCase().includes(termo))
  const grupos = (['Lead', 'Educacional', 'Campos personalizados'] as const)
    .map((g) => ({ g, itens: disponiveis.filter((d) => d.grupo === g) }))
    .filter((x) => x.itens.length > 0)
  const ocultosCount = st.ocultos.length

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Personalizar card"
      description="Escolha o que aparece nos cards do Kanban. Vale só para você, neste navegador."
      size="xl"
      unconstrained
      footer={
        <div class="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => { st.restaurar(); setLeadPrevia(null) }}>
            <RotateCcw size={13} /> Restaurar padrão
          </Button>
          <Button variant="primary" size="sm" onClick={() => onOpenChange(false)}>Pronto</Button>
        </div>
      }
    >
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div class="min-w-0 space-y-4">
          <div class="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
            <AbaBotao ativa={aba === 'dados'} onClick={() => setAba('dados')}>
              Dados do lead{escolhidos.length > 0 && <Contagem n={escolhidos.length} />}
            </AbaBotao>
            <AbaBotao ativa={aba === 'blocos'} onClick={() => setAba('blocos')}>
              Partes do card{ocultosCount > 0 && <Contagem n={ocultosCount} rotulo="ocultas" />}
            </AbaBotao>
          </div>

          {aba === 'dados' ? (
            <div class="space-y-4">
              <section>
                <div class="mb-1.5 flex items-center justify-between gap-2">
                  <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted">No card, nesta ordem</h3>
                  <div class="inline-flex shrink-0 rounded-md border border-border p-0.5 text-2xs" role="radiogroup" aria-label="Como mostrar o nome do dado">
                    {(['texto', 'icone'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={st.rotulos === r}
                        onClick={() => st.setRotulos(r)}
                        class={cn('whitespace-nowrap rounded px-2 py-0.5 transition-colors', st.rotulos === r ? 'bg-accent text-fg-on-brand' : 'text-fg-muted hover:text-fg')}
                      >
                        {r === 'texto' ? 'Com nome' : 'Só ícone'}
                      </button>
                    ))}
                  </div>
                </div>
                {escolhidos.length === 0 ? (
                  <p class="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-fg-muted">
                    Nenhum dado extra. Adicione abaixo o que você quer ver em cada card.
                  </p>
                ) : (
                  <ul class="divide-y divide-border rounded-md border border-border">
                    {escolhidos.map((d, i) => (
                      <li key={d.id} class="flex items-center gap-2 px-2.5 py-1.5" title={`${d.label} — ${d.grupo}`}>
                        <span class="w-4 shrink-0 text-right text-3xs tabular-nums text-fg-muted">{i + 1}</span>
                        <d.icon size={14} class="shrink-0 text-fg-muted" />
                        <span class="min-w-0 flex-1 truncate text-sm">{d.label}</span>
                        <BotaoIcone rotulo="Subir" disabled={i === 0} onClick={() => st.moverDado(d.id, -1)}><ArrowUp size={13} /></BotaoIcone>
                        <BotaoIcone rotulo="Descer" disabled={i === escolhidos.length - 1} onClick={() => st.moverDado(d.id, 1)}><ArrowDown size={13} /></BotaoIcone>
                        <BotaoIcone rotulo="Tirar do card" onClick={() => st.removerDado(d.id)} perigo><X size={13} /></BotaoIcone>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Adicionar</h3>
                <label class="relative mb-2 block">
                  <Search size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                  <input
                    type="search"
                    value={busca}
                    onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
                    placeholder="Buscar dado (ex.: polo, cidade, curso)…"
                    class="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
                <div class="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {grupos.length === 0 && <p class="text-xs text-fg-muted">Nada encontrado para "{busca}".</p>}
                  {grupos.map(({ g, itens }) => (
                    <div key={g}>
                      <div class="mb-1 text-3xs font-semibold uppercase tracking-wide text-fg-muted">{g}</div>
                      <div class="grid gap-1 sm:grid-cols-2">
                        {itens.map((d) => {
                          const ja = st.dados.includes(d.id)
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => (ja ? st.removerDado(d.id) : st.adicionarDado(d.id))}
                              aria-pressed={ja}
                              class={cn(
                                'flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors',
                                ja ? 'border-accent bg-accent/10 text-fg' : 'border-border text-fg-muted hover:border-accent hover:text-fg',
                              )}
                            >
                              <d.icon size={14} class="shrink-0" />
                              <span class="min-w-0 flex-1 truncate">{d.label}</span>
                              {ja ? <Check size={13} class="shrink-0 text-accent" /> : <Plus size={13} class="shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div class="space-y-4">
              {GRUPOS_DE_BLOCOS.map((g) => (
                <section key={g.titulo}>
                  <h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">{g.titulo}</h3>
                  <ul class="divide-y divide-border rounded-md border border-border">
                    {g.blocos.map((b) => (
                      <li key={b.id} class="flex items-center gap-3 px-2.5 py-2">
                        <b.icon size={14} class="shrink-0 text-fg-muted" />
                        <span class="min-w-0 flex-1">
                          <span class="block text-sm">{b.label}</span>
                          <span class="block truncate text-2xs text-fg-muted">{b.descricao}</span>
                        </span>
                        <Switch checked={!st.ocultos.includes(b.id)} onChange={() => st.alternarBloco(b.id)} ariaLabel={`Mostrar ${b.label}`} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <p class="text-2xs text-fg-muted">
                O nome, o canal e os botões de ação ficam sempre no card. A faixa vermelha de lead parado e a verde/vermelha de ganho/perdido também — cor ali é decisão, não enfeite.
              </p>
            </div>
          )}
        </div>

        {/* Prévia ao vivo. Fica ao lado no computador e abaixo no celular. */}
        <aside class="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <div class="rounded-lg border border-border bg-surface-2 p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="text-xs font-semibold uppercase tracking-wide text-fg-muted">Prévia</span>
              {opcoesPrevia.length > 1 && (
                <Select
                  class="!h-7 max-w-[11rem] !text-2xs"
                  value={String(lead.id)}
                  onChange={(e) => setLeadPrevia(Number((e.target as HTMLSelectElement).value))}
                  aria-label="Lead da prévia"
                >
                  {opcoesPrevia.map((l) => <option key={l.id} value={l.id}>{l.nome ?? l.empresa ?? `#${l.id}`}</option>)}
                </Select>
              )}
            </div>
            {/* Mesma largura da coluna do quadro: o que cabe aqui cabe lá. */}
            <div class="mx-auto w-full max-w-[18rem]">{renderPrevia(lead)}</div>
            <p class="mt-2 text-3xs text-fg-muted">
              {lead === LEAD_EXEMPLO ? 'Lead de exemplo — o quadro está vazio. ' : ''}
              Na prévia, dado sem valor aparece como "sem dado"; no quadro a linha some. No modo Compacto o card mostra só o cabeçalho.
            </p>
          </div>
        </aside>
      </div>
    </Modal>
  )
}

function AbaBotao({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      class={cn(
        '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        ativa ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function Contagem({ n, rotulo }: { n: number; rotulo?: string }) {
  return (
    <span class="whitespace-nowrap rounded-full bg-accent/15 px-1.5 text-3xs font-semibold text-accent tabular-nums">
      {n}{rotulo ? ` ${rotulo}` : ''}
    </span>
  )
}

function BotaoIcone({ rotulo, onClick, disabled, perigo, children }: {
  rotulo: string; onClick: () => void; disabled?: boolean; perigo?: boolean; children: ComponentChildren
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={rotulo}
      aria-label={rotulo}
      class={cn(
        'grid size-7 shrink-0 place-items-center rounded text-fg-muted transition-colors hover:bg-surface-3 disabled:opacity-30 disabled:hover:bg-transparent',
        perigo ? 'hover:text-danger' : 'hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}
