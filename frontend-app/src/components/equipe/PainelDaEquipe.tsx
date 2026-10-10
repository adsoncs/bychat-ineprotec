// Painel da Equipe (chat interno).
//
// Desktop: painel à direita (400px) por cima da página, que continua no lugar
// e segue aberto ao navegar; dá para minimizar a conversa numa bolinha no
// canto. Celular: tela cheia. Página /app/equipe: lista + conversa lado a lado.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { cn } from '@/lib/cn'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { ApiError, api } from '@/lib/apiClient'
import { TopbarUtil } from '@/components/shell/TopbarUtil'
import { ICON_SIZE } from '@/components/ui/Icon'
import {
  MessagesSquare, X, ArrowLeft, Minus, Plus, Search, BellOff, Bell, Users2, Hash, Users, ExternalLink, Pencil, Check,
} from '@/components/ui/icon-set'
import {
  buscarNasConversas, useAcoesDaEquipe, useConversasDaEquipe, useDetalhesDaConversa, useMensagensDaConversa,
  usePessoasDaEquipe, useResumoDaEquipe, type ConversaEquipe, type MensagemEquipe, type PessoaEquipe,
} from '@/hooks/useEquipe'
import { useEquipeStore, type AbaDaEquipe } from '@/stores/equipe'
import { useUserStore } from '@/stores/user'
import { useCan, useIsModuleActive } from '@/hooks/usePermissions'
import { MensagemDaEquipe } from './MensagemDaEquipe'
import { EscreverNaEquipe } from './EscreverNaEquipe'

export function useEquipeLigada(): boolean {
  const ativo = useIsModuleActive('equipe')
  const pode = useCan('equipe', 'view')
  return ativo === true && pode
}

const STATUS: Record<string, { cor: string; rotulo: string }> = {
  available: { cor: 'bg-success', rotulo: 'Disponível' },
  away: { cor: 'bg-warning', rotulo: 'Ausente' },
  busy: { cor: 'bg-danger', rotulo: 'Ocupado' },
  offline: { cor: 'bg-fg-muted', rotulo: 'Offline' },
}
function Presenca({ p, class: c }: { p: Pick<PessoaEquipe, 'online' | 'workStatus'> | null | undefined; class?: string | undefined }) {
  if (!p) return null
  const s = p.online ? (STATUS[p.workStatus ?? 'available'] ?? STATUS.available!) : STATUS.offline!
  return <span class={cn('block size-2.5 rounded-full ring-2 ring-surface', s.cor, c)} title={s.rotulo} />
}
const rotuloPresenca = (p: PessoaEquipe | null | undefined) => !p ? '' : p.online ? (STATUS[p.workStatus ?? 'available']?.rotulo ?? 'Online') : 'Offline'

function quando(iso: string) {
  const d = new Date(iso)
  const hoje = new Date()
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const ontem = new Date(hoje.getTime() - 86400_000)
  if (d.toDateString() === ontem.toDateString()) return 'ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
function rotuloDoDia(iso: string) {
  const d = new Date(iso)
  const hoje = new Date()
  if (d.toDateString() === hoje.toDateString()) return 'Hoje'
  if (d.toDateString() === new Date(hoje.getTime() - 86400_000).toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
}

function IconeDaConversa({ c }: { c: ConversaEquipe }) {
  if (c.tipo === 'direta') {
    return (
      <span class="relative shrink-0">
        <Avatar name={c.nome} seed={c.outro?.id} size="lg" round />
        <Presenca p={c.outro} class="absolute -bottom-0.5 -right-0.5" />
      </span>
    )
  }
  const Icone = c.tipo === 'equipe' ? Hash : c.tipo === 'lead' ? Users : Users2
  return <span class="size-10 shrink-0 grid place-items-center rounded-full bg-accent/15 text-accent"><Icone size={18} /></span>
}

// ─── Ícone do topo ─────────────────────────────────────────────────────────

export function BotaoDaEquipe() {
  const ligada = useEquipeLigada()
  const { data } = useResumoDaEquipe(ligada)
  const { aberto, abrir, fechar } = useEquipeStore()
  if (!ligada) return null
  const n = data?.naoLidas ?? 0
  return (
    <TopbarUtil
      titulo={n ? `Equipe — ${n} mensagem(ns) não lida(s)${data?.mencoes ? `, ${data.mencoes} menção(ões)` : ''}` : 'Equipe (chat interno)'}
      onClick={() => (aberto ? fechar() : abrir(useEquipeStore.getState().conversaId))}
      badge={n}
      tom={data?.mencoes ? 'warning' : undefined}
    >
      <MessagesSquare size={ICON_SIZE.md} />
    </TopbarUtil>
  )
}

// ─── Lista ─────────────────────────────────────────────────────────────────

const ABAS: Array<{ id: AbaDaEquipe; rotulo: string }> = [
  { id: 'pessoas', rotulo: 'Pessoas' },
  { id: 'grupos', rotulo: 'Grupos' },
  { id: 'leads', rotulo: 'Leads' },
]
const abaDe = (c: ConversaEquipe): AbaDaEquipe => (c.tipo === 'direta' ? 'pessoas' : c.tipo === 'lead' ? 'leads' : 'grupos')

function ListaDeConversas(props: { ativa: number | null; onAbrir: (id: number, destaque?: number) => void; onNova: () => void }) {
  const { data, isLoading } = useConversasDaEquipe()
  const { aba: abaEscolhida, setAba } = useEquipeStore()
  const [q, setQ] = useState('')
  const [achados, setAchados] = useState<Awaited<ReturnType<typeof buscarNasConversas>>['resultados']>([])
  const [filtro, setFiltro] = useState<'todas' | 'naoLidas'>('todas')
  useEffect(() => {
    if (q.trim().length < 2) { setAchados([]); return }
    const t = setTimeout(() => { buscarNasConversas(q.trim()).then((r) => setAchados(r.resultados)).catch(() => {}) }, 300)
    return () => clearTimeout(t)
  }, [q])
  const todas = data?.conversas ?? []
  // A aba Leads só aparece quando existe alguma conversa sobre lead.
  const abas = ABAS.filter((a) => a.id !== 'leads' || todas.some((c) => c.tipo === 'lead'))
  const aba = abas.some((a) => a.id === abaEscolhida) ? abaEscolhida : 'pessoas'
  const naoLidasDa = (a: AbaDaEquipe) => todas.filter((c) => abaDe(c) === a && !c.silenciada).reduce((n, c) => n + c.naoLidas, 0)
  // Buscando, procura em todas as abas.
  const buscando = !!q.trim()
  const filtradas = todas
    .filter((c) => buscando || abaDe(c) === aba)
    .filter((c) => !buscando || c.nome.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((c) => filtro === 'todas' || c.naoLidas > 0)
  // Em Grupos: minhas equipes, grupos livres e (admin/gerente) outras equipes.
  const secoes: Array<{ titulo: string | null; dica?: string; itens: ConversaEquipe[] }> = buscando || aba !== 'grupos'
    ? [{ titulo: null, itens: filtradas }]
    : [
        { titulo: 'Minhas equipes', itens: filtradas.filter((c) => c.tipo === 'equipe' && !c.observando) },
        { titulo: 'Grupos', itens: filtradas.filter((c) => c.tipo === 'grupo') },
        { titulo: 'Outras equipes', dica: 'Você vê e escreve nestes canais sem fazer parte da equipe.', itens: filtradas.filter((c) => c.observando).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) },
      ].filter((x) => x.itens.length)
  const nomeDe = new Map(todas.map((c) => [c.id, c.nome]))
  const vazio = aba === 'pessoas' ? 'Nenhuma conversa individual ainda. Toque em Nova para falar com alguém.'
    : aba === 'grupos' ? 'Nenhum grupo ainda. Os canais das suas equipes aparecem aqui.'
    : 'Nenhuma conversa sobre lead.'

  return (
    <div class="flex h-full flex-col">
      <div class="p-2 space-y-2 border-b border-border">
        <div class="flex gap-1.5">
          <div class="relative flex-1">
            <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={q} placeholder="Buscar conversa ou mensagem" class="w-full rounded-full border border-border bg-surface-2 pl-8 pr-3 py-1.5 text-sm" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          </div>
          <Button size="sm" onClick={props.onNova} title={aba === 'grupos' ? 'Novo grupo' : 'Nova conversa'}><Plus size={14} /> Nova</Button>
        </div>
        {!buscando && (
          <div class="flex border-b border-border -mx-2 px-2" role="tablist">
            {abas.map((a) => {
              const n = naoLidasDa(a.id)
              return (
                <button key={a.id} type="button" role="tab" aria-selected={aba === a.id}
                  class={cn('flex flex-1 items-center justify-center gap-1.5 -mb-px border-b-2 px-2 py-1.5 text-sm', aba === a.id ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg')}
                  onClick={() => setAba(a.id)}>
                  {a.rotulo}
                  {n > 0 && <span class="rounded-full bg-accent px-1.5 text-2xs font-bold text-fg-on-brand">{n > 99 ? '99+' : n}</span>}
                </button>
              )
            })}
          </div>
        )}
        <div class="flex gap-1 text-xs">
          {(['todas', 'naoLidas'] as const).map((f) => (
            <button key={f} type="button" class={cn('rounded-full px-2.5 py-0.5', filtro === f ? 'bg-accent text-fg-on-brand' : 'bg-surface-2 text-fg-muted hover:text-fg')} onClick={() => setFiltro(f)}>
              {f === 'todas' ? 'Todas' : 'Não lidas'}
            </button>
          ))}
        </div>
      </div>
      <div class="flex-1 overflow-y-auto">
        {isLoading && <div class="p-4 text-sm text-fg-muted">Carregando…</div>}
        {!isLoading && !filtradas.length && !achados.length && (
          <div class="p-6 text-center text-sm text-fg-muted space-y-2">
            <MessagesSquare size={28} class="mx-auto opacity-50" />
            <div>{buscando ? 'Nada encontrado.' : filtro === 'naoLidas' ? 'Tudo lido por aqui.' : vazio}</div>
          </div>
        )}
        {secoes.map((sec) => (
          <div key={sec.titulo ?? 'todas'}>
            {sec.titulo && <div class="px-3 pt-3 pb-1 text-2xs font-semibold uppercase text-fg-muted" title={sec.dica}>{sec.titulo}</div>}
            {sec.itens.map((c) => <ItemDaLista key={c.id} c={c} ativa={props.ativa === c.id} onAbrir={() => props.onAbrir(c.id)} />)}
          </div>
        ))}
        {achados.length > 0 && (
          <div class="border-t border-border">
            <div class="px-3 pt-2 pb-1 text-2xs font-semibold uppercase text-fg-muted">Mensagens</div>
            {achados.map((r) => (
              <button key={r.id} type="button" class="block w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => props.onAbrir(r.conversaId, r.id)}>
                <div class="text-2xs text-fg-muted">{nomeDe.get(r.conversaId) ?? 'Conversa'} · {r.autor} · {quando(r.em)}</div>
                <div class="text-sm truncate">{r.trecho}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ItemDaLista({ c, ativa, onAbrir }: { c: ConversaEquipe; ativa: boolean; onAbrir: () => void }) {
  return (
    <button type="button" class={cn('flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2 border-b border-border/50', ativa && 'bg-accent/10')} onClick={onAbrir}>
      <IconeDaConversa c={c} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class={cn('truncate text-sm', c.naoLidas ? 'font-semibold text-fg' : 'text-fg')}>{c.nome}</span>
          {c.silenciada && <BellOff size={11} class="shrink-0 text-fg-muted" />}
          <span class="ml-auto shrink-0 text-2xs text-fg-muted">{c.ultima ? quando(c.ultima.em) : ''}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class={cn('truncate text-xs', c.naoLidas ? 'text-fg' : 'text-fg-muted')}>
            {c.ultima ? `${c.ultima.autor && c.tipo !== 'direta' ? `${c.ultima.autor}: ` : c.ultima.autor === 'Você' ? 'Você: ' : ''}${c.ultima.texto}` : c.tipo === 'equipe' ? 'Canal da equipe' : 'Sem mensagens'}
          </span>
          {c.mencoes > 0 && <span class="ml-auto shrink-0 rounded-full bg-warning px-1.5 text-2xs font-bold text-white">@</span>}
          {c.naoLidas > 0 && <span class={cn('shrink-0 rounded-full px-1.5 text-2xs font-bold', c.silenciada ? 'bg-surface-3 text-fg-muted' : 'bg-accent text-fg-on-brand', !c.mencoes && 'ml-auto')}>{c.naoLidas}</span>}
        </div>
      </div>
    </button>
  )
}

// ─── Nova conversa ─────────────────────────────────────────────────────────

function NovaConversa(props: { onAbrir: (id: number) => void; onVoltar: () => void }) {
  const { data } = usePessoasDaEquipe()
  const { criarConversa } = useAcoesDaEquipe()
  const [q, setQ] = useState('')
  // Na aba Grupos, "Nova" já começa criando grupo.
  const [grupo, setGrupo] = useState(() => useEquipeStore.getState().aba === 'grupos')
  const [nome, setNome] = useState('')
  const [marcados, setMarcados] = useState<number[]>([])
  const pessoas = (data?.pessoas ?? []).filter((p) => !q || p.nome.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase()))

  async function abrirDireta(userId: number) {
    try { props.onAbrir((await criarConversa.mutateAsync({ tipo: 'direta', userId })).id) } catch (e) { toast(e instanceof ApiError ? e.message : 'Falha ao abrir a conversa.', 'danger') }
  }
  async function criarGrupo() {
    try { props.onAbrir((await criarConversa.mutateAsync({ tipo: 'grupo', nome: nome.trim(), membros: marcados })).id) } catch (e) { toast(e instanceof ApiError ? e.message : 'Falha ao criar o grupo.', 'danger') }
  }

  return (
    <div class="flex h-full flex-col">
      <div class="p-2 space-y-2 border-b border-border">
        <div class="flex gap-1 text-xs">
          <button type="button" class={cn('rounded-full px-2.5 py-0.5', !grupo ? 'bg-accent text-fg-on-brand' : 'bg-surface-2 text-fg-muted')} onClick={() => setGrupo(false)}>Conversa direta</button>
          <button type="button" class={cn('rounded-full px-2.5 py-0.5', grupo ? 'bg-accent text-fg-on-brand' : 'bg-surface-2 text-fg-muted')} onClick={() => setGrupo(true)}>Novo grupo</button>
        </div>
        {grupo && <Input value={nome} placeholder="Nome do grupo (ex.: Secretaria + Financeiro)" onInput={(e) => setNome((e.target as HTMLInputElement).value)} />}
        <div class="relative">
          <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input value={q} autoFocus placeholder="Buscar pessoa" class="w-full rounded-full border border-border bg-surface-2 pl-8 pr-3 py-1.5 text-sm" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </div>
      </div>
      <div class="flex-1 overflow-y-auto">
        {pessoas.map((p) => {
          const marcado = marcados.includes(p.id)
          return (
            <button key={p.id} type="button" class={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2', marcado && 'bg-accent/10')}
              onClick={() => (grupo ? setMarcados((m) => (marcado ? m.filter((x) => x !== p.id) : [...m, p.id])) : void abrirDireta(p.id))}>
              <span class="relative"><Avatar name={p.nome} seed={p.id} size="md" round /><Presenca p={p} class="absolute -bottom-0.5 -right-0.5" /></span>
              <span class="min-w-0 flex-1"><span class="block truncate text-sm">{p.nome}</span><span class="block text-2xs text-fg-muted">{rotuloPresenca(p)} · {p.role.toLowerCase()}</span></span>
              {grupo && <span class={cn('size-4 rounded border grid place-items-center', marcado ? 'bg-accent border-accent text-fg-on-brand' : 'border-border')}>{marcado && <Check size={10} />}</span>}
            </button>
          )
        })}
        {!pessoas.length && <div class="p-4 text-sm text-fg-muted">Ninguém encontrado.</div>}
      </div>
      {grupo && (
        <div class="border-t border-border p-2 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={props.onVoltar}>Cancelar</Button>
          <Button size="sm" disabled={!nome.trim() || !marcados.length} loading={criarConversa.isPending} onClick={() => void criarGrupo()}>Criar grupo ({marcados.length})</Button>
        </div>
      )}
      <div class="px-3 py-2 text-2xs text-fg-muted border-t border-border">Os canais das equipes aparecem sozinhos na sua lista, com os membros de cada equipe.</div>
    </div>
  )
}

// ─── Detalhes ──────────────────────────────────────────────────────────────

function Detalhes(props: { conversaId: number; onSaiu: () => void }) {
  const { data } = useDetalhesDaConversa(props.conversaId)
  const pessoasQ = usePessoasDaEquipe()
  const { silenciar, removerMembro, adicionarMembros, renomear } = useAcoesDaEquipe()
  const meuId = Number(useUserStore((s) => s.user?.id ?? 0))
  const [, navigate] = useLocation()
  const [editandoNome, setEditandoNome] = useState(false)
  const [nome, setNome] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  if (!data) return <div class="p-4 text-sm text-fg-muted">Carregando…</div>
  const fora = (pessoasQ.data?.pessoas ?? []).filter((p) => !data.membros.some((m) => m.id === p.id))
  const erro = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Não foi possível concluir.', 'danger')

  return (
    <div class="h-full overflow-y-auto p-3 space-y-4">
      {data.tipo === 'grupo' && (
        <div class="space-y-1">
          {editandoNome ? (
            <div class="flex gap-1.5">
              <Input value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} />
              <Button size="sm" onClick={() => renomear.mutate({ conversaId: data.id, nome }, { onSuccess: () => setEditandoNome(false), onError: erro })}>Salvar</Button>
            </div>
          ) : (
            <div class="flex items-center gap-2">
              <div class="text-base font-semibold">{data.nome}</div>
              {data.souAdmin && <button type="button" class="text-fg-muted hover:text-fg" aria-label="Renomear" onClick={() => { setNome(data.nome ?? ''); setEditandoNome(true) }}><Pencil size={13} /></button>}
            </div>
          )}
          {data.descricao && <div class="text-xs text-fg-muted">{data.descricao}</div>}
        </div>
      )}
      {data.tipo === 'lead' && data.lead && (
        <Button variant="secondary" size="sm" onClick={() => navigate(`/leads/${data.lead!.id}`)}><ExternalLink size={12} /> Abrir lead: {data.lead.nome}</Button>
      )}
      {data.tipo === 'equipe' && <div class="text-xs text-fg-muted">Canal da equipe. Os membros acompanham a equipe — mude-os em Equipes.</div>}
      {data.observando && <div class="rounded-md bg-surface-2 px-2.5 py-2 text-xs text-fg-muted">Você não faz parte desta equipe: por ser admin ou gerente, você vê e escreve aqui, mas não recebe avisos deste canal.</div>}

      {data.souMembro && (
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={data.silenciada} onChange={(e) => silenciar.mutate({ conversaId: data.id, silenciada: (e.target as HTMLInputElement).checked })} />
          {data.silenciada ? <BellOff size={14} /> : <Bell size={14} />} Silenciar esta conversa
        </label>
      )}

      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <div class="text-2xs font-semibold uppercase text-fg-muted">{data.membros.length} participante(s)</div>
          {data.tipo === 'grupo' && data.souAdmin && <button type="button" class="text-2xs text-accent" onClick={() => setAdicionando((v) => !v)}>{adicionando ? 'Fechar' : '+ Adicionar'}</button>}
        </div>
        {adicionando && (
          <div class="max-h-48 overflow-y-auto rounded-md border border-border">
            {fora.map((p) => (
              <button key={p.id} type="button" class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-2" onClick={() => adicionarMembros.mutate({ conversaId: data.id, userIds: [p.id] }, { onError: erro })}>
                <Avatar name={p.nome} seed={p.id} size="sm" round /> {p.nome}
              </button>
            ))}
            {!fora.length && <div class="p-2 text-xs text-fg-muted">Todos já participam.</div>}
          </div>
        )}
        {data.membros.map((m) => (
          <div key={m.id} class="flex items-center gap-2 py-1">
            <span class="relative"><Avatar name={m.nome} seed={m.id} size="md" round /><Presenca p={m} class="absolute -bottom-0.5 -right-0.5" /></span>
            <span class="min-w-0 flex-1"><span class="block truncate text-sm">{m.nome}{m.id === meuId ? ' (você)' : ''}</span><span class="block text-2xs text-fg-muted">{rotuloPresenca(m)}{m.papel === 'admin' ? ' · administra' : ''}</span></span>
            {data.tipo === 'grupo' && data.souAdmin && m.id !== meuId && (
              <button type="button" class="text-2xs text-fg-muted hover:text-danger" onClick={() => removerMembro.mutate({ conversaId: data.id, userId: m.id }, { onError: erro })}>remover</button>
            )}
          </div>
        ))}
      </div>
      {(data.tipo === 'grupo' || data.tipo === 'lead') && data.souMembro && (
        <Button variant="secondary" size="sm" onClick={() => removerMembro.mutate({ conversaId: data.id, userId: meuId }, { onSuccess: props.onSaiu, onError: erro })}>
          {data.tipo === 'lead' ? 'Deixar de acompanhar' : 'Sair do grupo'}
        </Button>
      )}
    </div>
  )
}

// ─── Conversa aberta ───────────────────────────────────────────────────────

function ConversaAberta(props: { conversaId: number; destaqueId: number | null }) {
  const id = props.conversaId
  const meuId = Number(useUserStore((s) => s.user?.id ?? 0))
  const meuPapel = useUserStore((s) => s.user?.role ?? '')
  const det = useDetalhesDaConversa(id)
  const msgsQ = useMensagensDaConversa(id)
  const { marcarLida } = useAcoesDaEquipe()
  const [antigas, setAntigas] = useState<MensagemEquipe[]>([])
  const [temAntigas, setTemAntigas] = useState<boolean | null>(null)
  const [respondendo, setRespondendo] = useState<MensagemEquipe | null>(null)
  const [editando, setEditando] = useState<MensagemEquipe | null>(null)
  const [destaque, setDestaque] = useState<number | null>(props.destaqueId)
  const rolagem = useRef<HTMLDivElement | null>(null)
  // "Novas mensagens": onde a pessoa tinha parado quando abriu.
  const [corte, setCorte] = useState<number | null>(null)

  useEffect(() => { setAntigas([]); setTemAntigas(null); setRespondendo(null); setEditando(null); setCorte(null); setDestaque(props.destaqueId) }, [id])
  useEffect(() => { if (corte === null && msgsQ.data) setCorte(msgsQ.data.ultimaLidaId ?? 0) }, [msgsQ.data, corte])

  const recentes = msgsQ.data?.mensagens ?? []
  const mensagens = useMemo(() => {
    const vistos = new Set(recentes.map((m) => m.id))
    return [...antigas.filter((m) => !vistos.has(m.id)), ...recentes]
  }, [antigas, recentes])
  const ultimaId = recentes[recentes.length - 1]?.id

  // Lida: ao abrir e a cada mensagem nova com a aba na frente.
  useEffect(() => {
    if (!ultimaId || !det.data?.souMembro || document.hidden) return
    marcarLida.mutate(id)
  }, [ultimaId, det.data?.souMembro])

  // Desce ao fim ao abrir e quando chega mensagem — só se estava perto do fim.
  const desceu = useRef(false)
  useEffect(() => { desceu.current = false }, [id])
  useEffect(() => {
    const el = rolagem.current
    if (!el || !ultimaId) return
    if (destaque) {
      const alvo = document.getElementById(`equipe-msg-${destaque}`)
      if (alvo) { alvo.scrollIntoView({ block: 'center' }); setTimeout(() => setDestaque(null), 2500); desceu.current = true; return }
    }
    const perto = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    if (!desceu.current || perto) { el.scrollTop = el.scrollHeight; desceu.current = true }
  }, [ultimaId, destaque])

  async function carregarAntigas() {
    const primeira = mensagens[0]
    if (!primeira) return
    const r = await api.get<{ mensagens: MensagemEquipe[]; temMais: boolean }>(`/equipe/conversas/${id}/mensagens?limit=60&before=${primeira.id}`)
    setAntigas((a) => [...r.mensagens, ...a])
    setTemAntigas(r.temMais)
  }
  function irPara(msgId: number) {
    const alvo = document.getElementById(`equipe-msg-${msgId}`)
    if (alvo) { alvo.scrollIntoView({ behavior: 'smooth', block: 'center' }); setDestaque(msgId); setTimeout(() => setDestaque(null), 2000) }
  }

  if (det.isError) return <div class="p-4 text-sm text-danger">Conversa não encontrada.</div>
  const maisAntigas = temAntigas ?? msgsQ.data?.temMais ?? false

  return (
    <div class="flex h-full flex-col min-h-0">
      <div ref={rolagem} class="flex-1 overflow-y-auto px-3 py-2">
        {maisAntigas && <div class="flex justify-center py-1"><Button size="sm" variant="ghost" onClick={() => void carregarAntigas()}>Carregar anteriores</Button></div>}
        {msgsQ.isLoading && <div class="p-4 text-sm text-fg-muted">Carregando…</div>}
        {!msgsQ.isLoading && !mensagens.length && (
          <div class="p-6 text-center text-sm text-fg-muted">Nenhuma mensagem ainda. Diga oi 👋 ou use o <b>+</b> para mandar um lead, uma transferência ou uma tarefa.</div>
        )}
        {mensagens.map((m, i) => {
          const ant = mensagens[i - 1]
          const novoDia = !ant || new Date(ant.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
          const agrupada = !novoDia && !!ant && !ant.sistema && !m.sistema && ant.autor?.id === m.autor?.id && new Date(m.createdAt).getTime() - new Date(ant.createdAt).getTime() < 5 * 60_000
          const divisor = corte !== null && corte > 0 && ant && ant.id <= corte && m.id > corte && !m.minha
          return (
            <div key={m.id}>
              {novoDia && <div class="flex justify-center py-2"><span class="rounded-full bg-surface-2 px-2.5 py-0.5 text-2xs text-fg-muted capitalize">{rotuloDoDia(m.createdAt)}</span></div>}
              {divisor && <div class="flex items-center gap-2 py-1 text-2xs font-semibold text-accent"><span class="h-px flex-1 bg-accent/40" />Novas mensagens<span class="h-px flex-1 bg-accent/40" /></div>}
              <MensagemDaEquipe
                msg={m}
                conversaId={id}
                agrupada={agrupada && !divisor}
                destaque={destaque === m.id}
                podeApagarAlheia={meuPapel === 'SUPERADMIN' || meuPapel === 'ADMIN'}
                onResponder={() => { setEditando(null); setRespondendo(m) }}
                onEditar={() => { setRespondendo(null); setEditando(m) }}
                onIrPara={irPara}
              />
            </div>
          )
        })}
      </div>
      {det.data && (
        <EscreverNaEquipe
          conversa={det.data}
          meuId={meuId}
          respondendo={respondendo}
          editando={editando}
          onCancelar={() => { setRespondendo(null); setEditando(null) }}
          onEnviou={() => { setRespondendo(null); setEditando(null); desceu.current = false }}
        />
      )}
    </div>
  )
}

// ─── Cabeçalho + telas ─────────────────────────────────────────────────────

function Cabecalho(props: { pagina: boolean }) {
  const { tela, conversaId, irPara, fechar, minimizar, abrir } = useEquipeStore()
  const det = useDetalhesDaConversa(tela === 'conversa' || tela === 'detalhes' ? conversaId : null)
  const lista = useConversasDaEquipe()
  const [, navigate] = useLocation()
  const c = lista.data?.conversas.find((x) => x.id === conversaId)
  const voltar = tela === 'detalhes' ? () => irPara('conversa') : () => abrir(null)
  const titulo = tela === 'lista' ? 'Equipe' : tela === 'nova' ? 'Nova conversa' : tela === 'detalhes' ? 'Detalhes' : (c?.nome ?? det.data?.nome ?? 'Conversa')
  const sub = tela === 'conversa'
    ? (c?.tipo === 'direta' ? rotuloPresenca(c.outro) : det.data ? `${det.data.membros.length} participante(s)` : '')
    : tela === 'lista' ? 'Chat interno da equipe' : ''
  return (
    <div class="flex items-center gap-1.5 border-b border-border px-2 py-2 bg-surface">
      {tela !== 'lista' && (
        <button
          type="button"
          // Na página cheia, a conversa fica ao lado da lista no desktop: o voltar só faz sentido no celular.
          class={cn('size-8 grid place-items-center rounded-md hover:bg-surface-2', props.pagina && tela === 'conversa' && 'lg:hidden')}
          aria-label="Voltar"
          onClick={voltar}
        ><ArrowLeft size={16} /></button>
      )}
      {tela === 'lista' && <span class="size-8 grid place-items-center text-accent"><MessagesSquare size={18} /></span>}
      <button type="button" class="min-w-0 flex-1 text-left" disabled={tela !== 'conversa'} onClick={() => irPara('detalhes')}>
        <div class="truncate text-sm font-semibold">{titulo}</div>
        {sub && <div class="truncate text-2xs text-fg-muted">{sub}{tela === 'conversa' ? ' · detalhes' : ''}</div>}
      </button>
      {!props.pagina && (
        <>
          {tela === 'conversa' && <button type="button" class="hidden lg:grid size-8 place-items-center rounded-md hover:bg-surface-2 text-fg-muted" title="Minimizar" aria-label="Minimizar" onClick={minimizar}><Minus size={16} /></button>}
          <button type="button" class="hidden lg:grid size-8 place-items-center rounded-md hover:bg-surface-2 text-fg-muted" title="Abrir em tela cheia" aria-label="Abrir em tela cheia" onClick={() => { navigate(`/equipe${conversaId ? `?c=${conversaId}` : ''}`); fechar() }}><ExternalLink size={14} /></button>
          <button type="button" class="size-8 grid place-items-center rounded-md hover:bg-surface-2 text-fg-muted" title="Fechar" aria-label="Fechar" onClick={fechar}><X size={16} /></button>
        </>
      )}
    </div>
  )
}

function Telas(props: { pagina: boolean }) {
  const { tela, conversaId, destaqueId, abrir, irPara } = useEquipeStore()
  if (tela === 'nova') return <NovaConversa onAbrir={(id) => abrir(id)} onVoltar={() => abrir(null)} />
  if (tela === 'detalhes' && conversaId) return <Detalhes conversaId={conversaId} onSaiu={() => abrir(null)} />
  if (tela === 'conversa' && conversaId) return <ConversaAberta conversaId={conversaId} destaqueId={destaqueId} />
  return props.pagina
    ? <div class="h-full grid place-items-center text-sm text-fg-muted">Escolha uma conversa</div>
    : <ListaDeConversas ativa={conversaId} onAbrir={(id, d) => abrir(id, d ?? null)} onNova={() => irPara('nova')} />
}

/** O painel flutuante (montado uma vez no AppShell). */
export function PainelDaEquipe() {
  const ligada = useEquipeLigada()
  const { aberto, fechar } = useEquipeStore()
  const [location] = useLocation()
  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) fechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aberto])
  // Na página cheia da Equipe o painel não abre por cima dela. O shell fica fora
  // da base do roteador, então o caminho pode vir com ou sem o "/app".
  const naPagina = /^(\/app)?\/equipe(\/|$|\?)/.test(location) || /\/app\/equipe(\/|$)/.test(window.location.pathname)
  if (!ligada || !aberto || naPagina) return null
  return (
    <div class="fixed inset-0 lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[400px] flex flex-col bg-surface lg:border-l border-border shadow-2xl" style={{ zIndex: 'var(--z-popover, 50)' }} role="complementary" aria-label="Equipe — chat interno">
      <Cabecalho pagina={false} />
      <div class="flex-1 min-h-0"><Telas pagina={false} /></div>
    </div>
  )
}

/** Conversa minimizada: bolinha no canto (desktop). */
export function EquipeMinimizada() {
  const ligada = useEquipeLigada()
  const { minimizado, conversaId, abrir } = useEquipeStore()
  const { data } = useConversasDaEquipe(ligada && minimizado)
  if (!ligada || !minimizado || !conversaId) return null
  const c = data?.conversas.find((x) => x.id === conversaId)
  return (
    <div class="hidden lg:flex fixed bottom-4 right-4 items-center gap-1" style={{ zIndex: 'var(--z-popover, 50)' }}>
      <button type="button" class="relative flex items-center gap-2 rounded-full bg-surface border border-border shadow-xl pl-1 pr-3 py-1 hover:bg-surface-2" onClick={() => abrir(conversaId)} title="Abrir conversa">
        {c ? <IconeDaConversa c={c} /> : <MessagesSquare size={18} />}
        <span class="max-w-[10rem] truncate text-sm">{c?.nome ?? 'Conversa'}</span>
        {!!c?.naoLidas && <span class="absolute -top-1 -right-1 rounded-full bg-accent px-1.5 text-2xs font-bold text-fg-on-brand">{c.naoLidas}</span>}
      </button>
      <button type="button" class="size-6 grid place-items-center rounded-full bg-surface border border-border text-fg-muted hover:text-fg" aria-label="Fechar" onClick={() => useEquipeStore.setState({ minimizado: false })}><X size={12} /></button>
    </div>
  )
}

/** Página /app/equipe: lista + conversa lado a lado (no celular, uma de cada vez). */
export function PaginaDaEquipe() {
  const { tela, conversaId, abrir, irPara } = useEquipeStore()
  useEffect(() => {
    const c = Number(new URLSearchParams(window.location.search).get('c'))
    if (c) abrir(c); else useEquipeStore.setState({ tela: 'lista', aberto: false })
    return () => useEquipeStore.setState({ aberto: false })
  }, [])
  const mostraConversa = tela !== 'lista'
  return (
    <div class="h-[calc(100dvh-7rem)] min-h-[420px] rounded-lg border border-border bg-surface overflow-hidden flex">
      <div class={cn('w-full lg:w-80 lg:border-r border-border flex-col min-h-0', mostraConversa ? 'hidden lg:flex' : 'flex')}>
        <div class="flex items-center gap-2 border-b border-border px-3 py-2"><MessagesSquare size={16} class="text-accent" /><span class="text-sm font-semibold">Conversas</span></div>
        <div class="flex-1 min-h-0"><ListaDeConversas ativa={conversaId} onAbrir={(id, d) => abrir(id, d ?? null)} onNova={() => irPara('nova')} /></div>
      </div>
      <div class={cn('flex-1 min-w-0 flex-col min-h-0', mostraConversa ? 'flex' : 'hidden lg:flex')}>
        {mostraConversa && <Cabecalho pagina />}
        <div class="flex-1 min-h-0"><Telas pagina /></div>
      </div>
    </div>
  )
}
