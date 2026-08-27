// HomeScreenSettings — Configurações › Tela inicial.
//
// Monta as telas de entrada como uma pilha de blocos e diz quem vê cada uma.
// Precedência na hora de resolver: exceção do usuário > regra do papel > Visão
// Geral de fábrica. Nada aqui concede acesso: atalho de módulo sem permissão
// some para quem não pode ver, e KPI vem recortado pelo escopo do usuário.

import { useEffect, useMemo, useState } from 'preact/hooks'
import { ArrowDown, ArrowUp, Home, Info, Plus, Trash2, X } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { flattenItems } from '@/modules/sidebar.config'
import { WIDGET_CATALOG } from '@/components/widgets/WidgetCatalog'
import {
  useHomeScreensAdmin, useSaveHomeScreen, useDeleteHomeScreen, useSaveAssignments,
  type HomeBlock, type HomeBlockType, type HomeLink, type HomeScreen,
} from '@/hooks/useHomeScreen'
import { cn } from '@/lib/cn'
import { useUserStore } from '@/stores/user'

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Superadmin',
  ADMIN: 'Admin',
  MANAGER: 'Gestor',
  AGENT: 'Agente',
  VIEWER: 'Visualizador',
}

const BLOCK_LABEL: Record<HomeBlockType, { label: string; help: string }> = {
  notice: { label: 'Aviso', help: 'Bloco de texto com links de acesso rápido.' },
  kpis: { label: 'Indicadores', help: 'KPIs escolhidos, já recortados pelo acesso de quem olha.' },
  shortcuts: { label: 'Atalhos', help: 'Cartões de acesso rápido a telas do sistema.' },
  my_day: { label: 'Meu dia', help: 'Fila de trabalho pessoal: atividades, reuniões, atrasos e leads parados.' },
  leaderboard: { label: 'Placar', help: 'Ranking de negócios ganhos no período.' },
}

/** Destinos possíveis para links/atalhos — o mesmo catálogo do menu lateral. */
const DESTINOS: HomeLink[] = flattenItems()
  .map((i) => ({
    label: i.label,
    path: i.href.replace('/app', ''),
    // item sem `permission` não tem módulo que o proteja: a chave não pode ir
    // como `undefined` (exactOptionalPropertyTypes), tem que ficar ausente.
    ...(i.permission ? { moduleId: i.permission } : {}),
  }))
  .filter((d, idx, arr) => d.path && arr.findIndex((x) => x.path === d.path) === idx)

const novoId = () => `b${Math.random().toString(36).slice(2, 9)}`

function LinkPicker({ value, onChange }: { value: HomeLink[]; onChange: (v: HomeLink[]) => void }) {
  const [escolhido, setEscolhido] = useState('')
  const disponiveis = DESTINOS.filter((d) => !value.some((v) => v.path === d.path))

  return (
    <div>
      <div class="flex flex-wrap gap-1.5 mb-2">
        {value.map((l) => (
          <span key={l.path} class="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-fg">
            {l.label}
            <button type="button" onClick={() => onChange(value.filter((v) => v.path !== l.path))} class="text-fg-muted hover:text-danger">
              <X size={12} />
            </button>
          </span>
        ))}
        {value.length === 0 && <span class="text-xs text-fg-muted">Nenhum destino escolhido.</span>}
      </div>
      <div class="flex gap-2">
        <Select value={escolhido} onChange={(e: any) => setEscolhido(e.currentTarget.value)} class="flex-1">
          <option value="">Adicionar destino…</option>
          {disponiveis.map((d) => <option key={d.path} value={d.path}>{d.label}</option>)}
        </Select>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const d = DESTINOS.find((x) => x.path === escolhido)
            if (!d) return
            onChange([...value, d])
            setEscolhido('')
          }}
        >
          <Plus size={14} />
        </Button>
      </div>
    </div>
  )
}

function MetricPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [escolhido, setEscolhido] = useState('')
  const disponiveis = WIDGET_CATALOG.filter((w) => !value.includes(w.metric))

  return (
    <div>
      <div class="flex flex-wrap gap-1.5 mb-2">
        {value.map((m) => {
          const meta = WIDGET_CATALOG.find((w) => w.metric === m)
          return (
            <span key={m} class="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-fg">
              {meta?.title || m}
              <button type="button" onClick={() => onChange(value.filter((v) => v !== m))} class="text-fg-muted hover:text-danger">
                <X size={12} />
              </button>
            </span>
          )
        })}
        {value.length === 0 && <span class="text-xs text-fg-muted">Nenhum indicador escolhido.</span>}
      </div>
      <div class="flex gap-2">
        <Select value={escolhido} onChange={(e: any) => setEscolhido(e.currentTarget.value)} class="flex-1">
          <option value="">Adicionar indicador…</option>
          {disponiveis.map((w) => <option key={w.metric} value={w.metric}>{w.title}</option>)}
        </Select>
        <Button variant="secondary" size="sm" onClick={() => { if (escolhido) { onChange([...value, escolhido]); setEscolhido('') } }}>
          <Plus size={14} />
        </Button>
      </div>
    </div>
  )
}

function BlockEditor({ block, onChange }: { block: HomeBlock; onChange: (b: HomeBlock) => void }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...block, config: { ...block.config, ...patch } })

  return (
    <div class="space-y-3">
      <Input
        label="Título do bloco"
        value={block.config.title || ''}
        onInput={(e: any) => set({ title: e.currentTarget.value })}
        placeholder={BLOCK_LABEL[block.type].label}
      />

      {block.type === 'notice' && (
        <>
          <Textarea
            label="Texto"
            rows={4}
            value={block.config.text || ''}
            onInput={(e: any) => set({ text: e.currentTarget.value })}
            hint="Aparece para todo mundo que recebe esta tela."
          />
          <Select label="Aparência" value={block.config.variant || 'info'} onChange={(e: any) => set({ variant: e.currentTarget.value })}>
            <option value="info">Informação</option>
            <option value="warning">Atenção</option>
            <option value="success">Positivo</option>
          </Select>
          <div>
            <label class="mb-1 block text-xs font-medium text-fg">Links de acesso rápido</label>
            <LinkPicker value={block.config.links || []} onChange={(links) => set({ links })} />
          </div>
        </>
      )}

      {block.type === 'shortcuts' && (
        <div>
          <label class="mb-1 block text-xs font-medium text-fg">Destinos</label>
          <LinkPicker value={block.config.items || []} onChange={(items) => set({ items })} />
        </div>
      )}

      {block.type === 'kpis' && (
        <>
          <div>
            <label class="mb-1 block text-xs font-medium text-fg">Indicadores</label>
            <MetricPicker value={block.config.metrics || []} onChange={(metrics) => set({ metrics })} />
          </div>
          <Select label="Período" value={String(block.config.period || 30)} onChange={(e: any) => set({ period: Number(e.currentTarget.value) })}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
          </Select>
          <p class="text-xs text-fg-muted">
            Os números respeitam o acesso de cada um: agente vê a própria carteira, gestor o setor, admin a empresa toda.
          </p>
        </>
      )}

      {block.type === 'my_day' && (
        <Select
          label="Considerar lead parado após"
          value={String(block.config.staleHours || 24)}
          onChange={(e: any) => set({ staleHours: Number(e.currentTarget.value) })}
        >
          <option value="4">4 horas</option>
          <option value="24">24 horas</option>
          <option value="48">48 horas</option>
          <option value="72">72 horas</option>
        </Select>
      )}

      {block.type === 'leaderboard' && (
        <>
          <Select label="Período" value={String(block.config.days || 30)} onChange={(e: any) => set({ days: Number(e.currentTarget.value) })}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
          </Select>
          <Select label="Ordenar por" value={block.config.metric || 'revenue'} onChange={(e: any) => set({ metric: e.currentTarget.value })}>
            <option value="revenue">Receita ganha</option>
            <option value="won">Negócios ganhos</option>
          </Select>
          <Input
            label="Quantas posições"
            type="number"
            min={1}
            max={20}
            value={String(block.config.limit || 5)}
            onInput={(e: any) => set({ limit: Number(e.currentTarget.value) })}
          />
          <p class="text-xs text-fg-muted">
            Quem tem acesso só à própria carteira enxerga apenas a própria linha — o placar não contorna a permissão.
          </p>
        </>
      )}
    </div>
  )
}

export function HomeScreenSettings() {
  const { data, isLoading } = useHomeScreensAdmin()
  const salvarTela = useSaveHomeScreen()
  const removerTela = useDeleteHomeScreen()
  const salvarAtribuicoes = useSaveAssignments()

  const [selecionada, setSelecionada] = useState<number | 'nova' | null>(null)
  const [draft, setDraft] = useState<{ name: string; description: string; blocks: HomeBlock[]; builtin: string | null }>({ name: '', description: '', blocks: [], builtin: null })
  const [novoBloco, setNovoBloco] = useState<HomeBlockType>('notice')
  const [papeis, setPapeis] = useState<Record<string, number | null>>({})
  const [excecoes, setExcecoes] = useState<{ userId: number; screenId: number | null }[]>([])
  const [novaExcecao, setNovaExcecao] = useState('')

  const telas = data?.screens ?? []
  const roles = data?.roles ?? ['SUPERADMIN', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER']

  useEffect(() => {
    if (!data) return
    const porPapel: Record<string, number | null> = {}
    for (const r of data.roles) porPapel[r] = data.assignments.find((a) => a.role === r)?.screenId ?? null
    setPapeis(porPapel)
    setExcecoes(data.assignments.filter((a) => a.userId != null).map((a) => ({ userId: a.userId as number, screenId: a.screenId })))
  }, [data])

  const abrir = (s: HomeScreen) => {
    setSelecionada(s.id)
    setDraft({
      name: s.name,
      description: s.description || '',
      blocks: Array.isArray(s.blocks) ? s.blocks : [],
      builtin: s.builtin ?? null,
    })
  }
  const abrirNova = () => {
    setSelecionada('nova')
    setDraft({ name: '', description: '', blocks: [], builtin: null })
  }

  const nativas = data?.nativas ?? []
  const nativaEscolhida = nativas.find((n) => n.key === draft.builtin) ?? null

  /** Escolher um painel pronto troca o conteúdo da tela: blocos e painel são
   *  excludentes, então limpa o que estava montado em vez de guardar um resto
   *  invisível. Vem com um nome sugerido, que o admin pode trocar. */
  const escolherNativa = (key: string) => {
    if (!key) { setDraft({ ...draft, builtin: null }); return }
    const n = nativas.find((x) => x.key === key)
    setDraft({
      ...draft,
      builtin: key,
      blocks: [],
      name: draft.name.trim() || n?.nome || draft.name,
      description: draft.description.trim() || n?.descricao || draft.description,
    })
  }

  const moverBloco = (i: number, dir: -1 | 1) => {
    const arr = [...draft.blocks]
    const j = i + dir
    if (j < 0 || j >= arr.length) return
    const a = arr[i]!, b = arr[j]!
    arr[i] = b; arr[j] = a
    setDraft({ ...draft, blocks: arr })
  }

  const salvar = async () => {
    if (!draft.name.trim()) { toast('Dê um nome à tela', 'danger'); return }
    try {
      await salvarTela.mutateAsync({
        ...(selecionada !== 'nova' && selecionada != null ? { id: selecionada } : {}),
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        blocks: draft.blocks,
        builtin: draft.builtin,
      })
      toast('Tela salva', 'success')
      setSelecionada(null)
    } catch (e: any) {
      toast(e?.message || 'Falha ao salvar', 'danger')
    }
  }

  const excluir = async (s: HomeScreen) => {
    const usada = Object.values(papeis).includes(s.id) || excecoes.some((x) => x.screenId === s.id)
    const aviso = usada
      ? `"${s.name}" está atribuída a alguém. Quem usa essa tela volta para a Visão Geral. Remover?`
      : `Remover a tela "${s.name}"?`
    if (!window.confirm(aviso)) return
    try {
      await removerTela.mutateAsync(s.id)
      toast('Tela removida', 'success')
      if (selecionada === s.id) setSelecionada(null)
    } catch (e: any) {
      toast(e?.message || 'Falha ao remover', 'danger')
    }
  }

  const salvarQuemVe = async () => {
    try {
      await salvarAtribuicoes.mutateAsync({ roles: papeis, users: excecoes })
      toast('Atribuições salvas', 'success')
    } catch (e: any) {
      toast(e?.message || 'Falha ao salvar atribuições', 'danger')
    }
  }

  const usuariosDisponiveis = useMemo(
    () => (data?.users ?? []).filter((u) => !excecoes.some((e) => e.userId === u.id)),
    [data?.users, excecoes],
  )

  // Qual tela ESTE administrador recebe — mesma precedência do backend
  // (exceção > cargo > Visão Geral). Sem isto o cenário mais confuso do módulo
  // passa despercebido: quem configura mexe nas telas, não vê nada mudar na
  // própria entrada e conclui que o salvamento está quebrado, quando na verdade
  // o cargo dele é que ficou em "Visão Geral (padrão)".
  const eu = useUserStore((s) => s.user)
  const minhaTela = useMemo(() => {
    if (!eu) return null
    const excecao = excecoes.find((x) => String(x.userId) === String(eu.id))
    const screenId = excecao ? excecao.screenId : papeis[eu.role] ?? null
    return {
      origem: excecao && excecao.screenId != null ? ('exceção sua' as const) : ('cargo' as const),
      tela: screenId == null ? null : telas.find((s) => s.id === screenId) ?? null,
    }
  }, [eu, excecoes, papeis, telas])

  if (isLoading) return <div class="space-y-3"><Skeleton class="h-32 w-full" /><Skeleton class="h-48 w-full" /></div>

  return (
    <div class="space-y-6">
      <Card>
        <div class="flex items-start gap-3">
          <Home size={18} class="mt-0.5 text-accent shrink-0" />
          <div class="text-sm text-fg-muted">
            <p class="text-fg font-medium mb-1">Tela inicial</p>
            <p>
              É o que cada pessoa vê ao entrar no sistema. Monte a tela empilhando blocos e diga qual papel recebe qual tela.
              Sem tela atribuída, o papel continua caindo na <strong>Visão Geral</strong>.
            </p>
          </div>
        </div>
      </Card>

      {/* ── Telas ─────────────────────────────────────────── */}
      <Card>
        <div class="mb-3 flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-fg">Telas</h3>
          <Button size="sm" variant="secondary" onClick={abrirNova}><Plus size={14} /> Nova tela</Button>
        </div>

        {telas.length === 0 && selecionada !== 'nova' && (
          <p class="text-sm text-fg-muted">Nenhuma tela criada — todo mundo entra pela Visão Geral.</p>
        )}

        <ul class="divide-y divide-border">
          {telas.map((s) => (
            <li key={s.id} class="flex items-center justify-between gap-3 py-2">
              <button class="min-w-0 text-left" onClick={() => abrir(s)}>
                <div class="truncate text-sm text-fg">{s.name}</div>
                <div class="truncate text-xs text-fg-muted">
                  {s.builtin
                    ? `Painel pronto · ${(data?.nativas ?? []).find((n) => n.key === s.builtin)?.nome ?? s.builtin}`
                    : (Array.isArray(s.blocks) ? s.blocks : []).map((b) => BLOCK_LABEL[b.type]?.label).filter(Boolean).join(' · ') || 'sem blocos'}
                </div>
              </button>
              <div class="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => abrir(s)}>Editar</Button>
                {!s.isSystem && (
                  <Button size="sm" variant="ghost" onClick={() => void excluir(s)}><Trash2 size={14} class="text-danger" /></Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* ── Editor ────────────────────────────────────────── */}
      {selecionada !== null && (
        <Card>
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-fg">{selecionada === 'nova' ? 'Nova tela' : 'Editando tela'}</h3>
            <div class="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelecionada(null)}>Cancelar</Button>
              <Button size="sm" onClick={() => void salvar()} disabled={salvarTela.isPending}>Salvar tela</Button>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <Input label="Nome" value={draft.name} onInput={(e: any) => setDraft({ ...draft, name: e.currentTarget.value })} placeholder="Ex.: Tela do Agente" hint="Só aparece aqui, para você achar a tela na lista — quem usa o sistema sempre vê “Visão Geral”." />
            <Input label="Descrição" value={draft.description} onInput={(e: any) => setDraft({ ...draft, description: e.currentTarget.value })} placeholder="Aparece abaixo do título" />
          </div>

          {/* Conteúdo da tela: painel pronto OU pilha de blocos — nunca os dois.
              O seletor vem antes de tudo porque a escolha muda o editor inteiro. */}
          {nativas.length > 0 && (
            <div class="mt-4">
              <Select
                label="Conteúdo da tela"
                value={draft.builtin ?? ''}
                onChange={(e: any) => escolherNativa(e.currentTarget.value)}
                hint="Painel pronto é uma tela inteira do produto; montada com blocos você escolhe cada pedaço."
              >
                <option value="">Montar com blocos</option>
                {nativas.map((n) => (
                  <option key={n.key} value={n.key}>Painel pronto — {n.nome}</option>
                ))}
              </Select>
            </div>
          )}

          {nativaEscolhida && (
            <div class="mt-3 rounded-lg border border-border bg-surface-2/50 p-3">
              <div class="text-sm font-medium text-fg">{nativaEscolhida.nome}</div>
              <div class="mt-0.5 text-xs text-fg-muted">{nativaEscolhida.descricao}</div>
              {nativaEscolhida.abreDado && (
                <div class="mt-2 text-xs text-warning">{nativaEscolhida.abreDado}</div>
              )}
            </div>
          )}

          <div class={nativaEscolhida ? 'hidden' : 'mt-4 space-y-3'}>
            {draft.blocks.map((b, i) => (
              <div key={b.id} class="rounded-lg border border-border p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <span class="text-sm font-medium text-fg">{BLOCK_LABEL[b.type].label}</span>
                    <span class="ml-2 text-xs text-fg-muted">{BLOCK_LABEL[b.type].help}</span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => moverBloco(i, -1)} disabled={i === 0}><ArrowUp size={14} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => moverBloco(i, 1)} disabled={i === draft.blocks.length - 1}><ArrowDown size={14} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, blocks: draft.blocks.filter((x) => x.id !== b.id) })}>
                      <Trash2 size={14} class="text-danger" />
                    </Button>
                  </div>
                </div>
                <BlockEditor
                  block={b}
                  onChange={(nb) => setDraft({ ...draft, blocks: draft.blocks.map((x) => (x.id === b.id ? nb : x)) })}
                />
              </div>
            ))}

            {draft.blocks.length === 0 && <p class="text-sm text-fg-muted">Adicione o primeiro bloco abaixo.</p>}

            <div class="flex gap-2">
              <Select value={novoBloco} onChange={(e: any) => setNovoBloco(e.currentTarget.value)} class="flex-1">
                {(Object.keys(BLOCK_LABEL) as HomeBlockType[]).map((t) => (
                  <option key={t} value={t}>{BLOCK_LABEL[t].label} — {BLOCK_LABEL[t].help}</option>
                ))}
              </Select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDraft({ ...draft, blocks: [...draft.blocks, { id: novoId(), type: novoBloco, config: {} }] })}
              >
                <Plus size={14} /> Adicionar bloco
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ── Quem vê o quê ─────────────────────────────────── */}
      <Card>
        <div class="mb-3 flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-fg">Quem vê o quê</h3>
          <Button size="sm" onClick={() => void salvarQuemVe()} disabled={salvarAtribuicoes.isPending}>Salvar atribuições</Button>
        </div>

        {minhaTela && (
          <div
            class={cn(
              'mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
              minhaTela.tela
                ? 'border-border bg-surface-2 text-fg-muted'
                : 'border-warning/40 bg-warning/10 text-fg',
            )}
          >
            <Info size={14} class="mt-0.5 shrink-0" />
            {minhaTela.tela ? (
              <span>
                A sua entrada hoje é <strong>{minhaTela.tela.name}</strong> (por {minhaTela.origem}).
              </span>
            ) : (
              <span>
                Você entra como <strong>{ROLE_LABEL[eu!.role] || eu!.role}</strong> e esse cargo está em{' '}
                <strong>Visão Geral (padrão)</strong> — por isso a <em>sua</em> tela inicial não muda por mais que você edite as
                telas aqui. Escolha uma na linha abaixo e salve.
              </span>
            )}
          </div>
        )}

        <div class="space-y-2">
          {roles.map((r) => (
            <div key={r} class="flex items-center justify-between gap-3">
              <span class="text-sm text-fg w-40 shrink-0">
                {ROLE_LABEL[r] || r}
                {eu?.role === r && <span class="ml-1 text-xs text-fg-muted">(você)</span>}
              </span>
              <Select
                class="flex-1"
                value={papeis[r] == null ? '' : String(papeis[r])}
                onChange={(e: any) => setPapeis({ ...papeis, [r]: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
              >
                <option value="">Visão Geral (padrão)</option>
                {telas.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
          ))}
        </div>

        <div class="mt-5 border-t border-border pt-4">
          <h4 class="text-xs font-semibold text-fg mb-1">Exceções por pessoa</h4>
          <p class="text-xs text-fg-muted mb-3">Vence a regra do cargo — para quem precisa de uma tela diferente do resto do time.</p>

          <div class="space-y-2">
            {excecoes.map((ex) => {
              const u = data?.users.find((x) => x.id === ex.userId)
              return (
                <div key={ex.userId} class="flex items-center justify-between gap-3">
                  <span class="text-sm text-fg w-40 shrink-0 truncate">{u?.name || `#${ex.userId}`}</span>
                  <Select
                    class="flex-1"
                    value={ex.screenId == null ? '' : String(ex.screenId)}
                    onChange={(e: any) => setExcecoes(excecoes.map((x) => x.userId === ex.userId ? { ...x, screenId: e.currentTarget.value ? Number(e.currentTarget.value) : null } : x))}
                  >
                    <option value="">Seguir o cargo</option>
                    {telas.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => setExcecoes(excecoes.filter((x) => x.userId !== ex.userId))}>
                    <X size={14} />
                  </Button>
                </div>
              )
            })}
            {excecoes.length === 0 && <p class="text-xs text-fg-muted">Nenhuma exceção.</p>}
          </div>

          <div class="mt-3 flex gap-2">
            <Select value={novaExcecao} onChange={(e: any) => setNovaExcecao(e.currentTarget.value)} class="flex-1">
              <option value="">Adicionar pessoa…</option>
              {usuariosDisponiveis.map((u) => <option key={u.id} value={u.id}>{u.name} — {ROLE_LABEL[u.role] || u.role}</option>)}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (!novaExcecao) return
                setExcecoes([...excecoes, { userId: Number(novaExcecao), screenId: telas[0]?.id ?? null }])
                setNovaExcecao('')
              }}
            >
              <Plus size={14} />
            </Button>
          </div>
        </div>

        <p class={cn('mt-4 text-xs text-fg-muted')}>
          Atribuir uma tela não dá acesso a nada: atalho de módulo que a pessoa não pode ver some da tela dela, e os
          indicadores vêm limitados ao que o cargo enxerga.
        </p>
      </Card>
    </div>
  )
}
