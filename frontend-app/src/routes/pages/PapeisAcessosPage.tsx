// Configurações › Papéis e acessos — a tela do novo modelo de permissões.
// Spec "Papéis e Permissões — especificação"; plano /root/planos/papeis-permissoes.md.
//
// Uma pessoa tem UM papel + pacotes. O papel diz o que ela pode fazer
// (capacidades por área) e sobre quais registros (alcance por tipo de dado);
// pacote só soma capacidades, nunca retira. Papel de sistema (Superadmin e
// Administrador) não se edita — clona-se. A regra mora no backend
// (services/papeisMotor.ts); esta tela só monta e mostra.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { ShieldCheck, Users, Eye, Plus, Copy, Archive, Save, Package, Power, Lock, Search, AlertTriangle, Info, Trash2 } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input, Select, Checkbox, Switch } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { ApiError } from '@/lib/apiClient'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { useUserStore } from '@/stores/user'
import {
  usePapeis, usePapel, useCatalogoPapeis, usePessoasPapeis, usePacotes, useVerComo, useSombra,
  useCriarPapel, useSalvarPapel, useArquivarPapel, useSalvarPessoa, useSalvarPacote, useExcluirPacote, useLigarMotor,
  type Catalogo, type TipoAlcance, type NivelAlcance, type PapelBase, type Pacote,
} from '@/hooks/usePapeis'

const AREA_LABELS: Record<string, string> = {
  overview: 'Visão Geral',
  crm: 'CRM',
  automacao: 'Automação',
  captacao: 'Captação',
  marketing: 'Marketing',
  vendas: 'Vendas',
  canais: 'Canais',
  integracoes: 'Integrações',
  config: 'Configurações',
  admin: 'Administração',
  educacional: 'Educacional — telas',
}

const ACOES: Array<{ id: string; nome: string }> = [
  { id: 'view', nome: 'Ver' }, { id: 'create', nome: 'Criar' }, { id: 'edit', nome: 'Editar' }, { id: 'delete', nome: 'Excluir' },
]

const TIPO_LABELS: Record<TipoAlcance, string> = {
  LEADS: 'Leads, conversas e contatos',
  AGENDA: 'Agenda e reuniões',
  INSCRICOES: 'Inscrições e portais',
  FINANCEIRO: 'Financeiro',
  VISOES: 'Visões e relatórios',
}

const NIVEL_LABELS: Record<NivelAlcance, { nome: string; ajuda: string }> = {
  MEUS: { nome: 'Só os meus', ajuda: 'Só o que está atribuído à pessoa.' },
  EQUIPE: { nome: 'Os da minha equipe', ajuda: 'Os dela + tudo das equipes de que ela faz parte, inclusive a fila.' },
  LIDERADAS: { nome: 'Os meus e os das equipes que lidero', ajuda: 'Membro comum vê só os seus; líder vê também os da equipe.' },
  RECORTES: { nome: 'Recortes da equipe', ajuda: 'Os portais e números marcados para a equipe dela.' },
  TUDO: { nome: 'Tudo', ajuda: 'Todos os registros, de todas as equipes.' },
}

const BASE_LABELS: Record<PapelBase, string> = {
  SUPERADMIN: 'Superadmin', ADMIN: 'Administrador', MANAGER: 'Gestor', AGENT: 'Agente', VIEWER: 'Visualizador',
}

function erro(e: unknown) {
  toast(e instanceof ApiError ? e.message : 'Não foi possível salvar.', 'danger')
}

type Aba = 'papeis' | 'pessoas' | 'pacotes' | 'ver-como'

export function PapeisAcessosPage() {
  const [aba, setAba] = useState<Aba>('papeis')
  const abas: Array<{ id: Aba; nome: string; icon: preact.JSX.Element }> = [
    { id: 'papeis', nome: 'Papéis', icon: <ShieldCheck size={14} /> },
    { id: 'pessoas', nome: 'Pessoas', icon: <Users size={14} /> },
    { id: 'pacotes', nome: 'Pacotes', icon: <Package size={14} /> },
    { id: 'ver-como', nome: 'Ver como', icon: <Eye size={14} /> },
  ]
  return (
    <div class="flex flex-col gap-4">
      <MotorCard />
      <div class="flex gap-1 border-b border-border overflow-x-auto">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            class={cn(
              'inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
              aba === a.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {a.icon}{a.nome}
          </button>
        ))}
      </div>
      {aba === 'papeis' && <AbaPapeis />}
      {aba === 'pessoas' && <AbaPessoas />}
      {aba === 'pacotes' && <AbaPacotes />}
      {aba === 'ver-como' && <AbaVerComo />}
    </div>
  )
}

// ── Motor: qual regra vale hoje + modo sombra ────────────────────────────
function MotorCard() {
  const lista = usePapeis()
  const ehSuperadmin = useUserStore((s) => s.user?.role) === 'SUPERADMIN'
  const [verSombra, setVerSombra] = useState(false)
  const sombra = useSombra(verSombra)
  const ligar = useLigarMotor()
  const [confirmar, setConfirmar] = useState<null | boolean>(null)
  const ligado = !!lista.data?.motorLigado

  return (
    <Card class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-2">
            <Power size={16} />
            <span class="font-semibold text-sm">Motor de permissões</span>
            {lista.isLoading ? <Skeleton class="h-5 w-24" /> : ligado
              ? <Badge tone="success">Papéis valendo</Badge>
              : <Badge tone="warning">Regra antiga valendo</Badge>}
          </div>
          <p class="text-xs text-fg-muted">
            {ligado
              ? 'O acesso de cada pessoa vem do papel e dos pacotes desta tela. A aba Permissões antiga não decide mais nada.'
              : 'O acesso ainda vem da aba Permissões. Os papéis já reproduzem essa regra; o modo sombra mostra se há diferença.'}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => { setVerSombra(true); void sombra.refetch() }} loading={sombra.isFetching}>
            <Search size={14} /> Rodar modo sombra
          </Button>
          {ehSuperadmin && (
            <Switch checked={ligado} onChange={(v) => setConfirmar(v)} ariaLabel="Ligar o motor de papéis" disabled={lista.isLoading || ligar.isPending} />
          )}
        </div>
      </div>
      {verSombra && sombra.data && (
        <div class={cn('rounded-md px-3 py-2 text-xs flex items-start gap-2', sombra.data.total || sombra.data.semPapel ? 'bg-warning/10 text-fg' : 'bg-success/10 text-fg')}>
          {sombra.data.total || sombra.data.semPapel ? <AlertTriangle size={14} class="mt-0.5 text-warning" /> : <ShieldCheck size={14} class="mt-0.5 text-success" />}
          <div class="flex flex-col gap-1">
            <span>
              {sombra.data.pessoas} pessoa(s) comparadas: <b>{sombra.data.total}</b> divergência(s) entre a regra antiga e a dos papéis
              {sombra.data.semPapel ? <>, <b>{sombra.data.semPapel}</b> sem papel</> : null}.
            </span>
            {sombra.data.divergencias.slice(0, 8).map((d, i) => (
              <code key={i} class="text-2xs text-fg-muted break-all">{JSON.stringify(d)}</code>
            ))}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmar !== null}
        onOpenChange={(o) => { if (!o) setConfirmar(null) }}
        title={confirmar ? 'Ligar o motor de papéis?' : 'Voltar para a regra antiga?'}
        description={confirmar
          ? 'A partir de agora o acesso de todas as pessoas passa a vir dos papéis. Só liga se o modo sombra estiver sem divergências.'
          : 'O acesso volta a vir da aba Permissões. Os papéis ficam guardados e podem ser religados a qualquer momento.'}
        confirmLabel={confirmar ? 'Ligar' : 'Desligar'}
        destructive={!confirmar}
        loading={ligar.isPending}
        onConfirm={async () => {
          try {
            await ligar.mutateAsync({ ligado: !!confirmar })
            toast(confirmar ? 'Motor de papéis ligado.' : 'Regra antiga de volta.', 'success')
          } catch (e) { erro(e) }
          setConfirmar(null)
        }}
      />
    </Card>
  )
}

// ── Papéis ───────────────────────────────────────────────────────────────
function AbaPapeis() {
  const lista = usePapeis()
  const [sel, setSel] = useState<number | null>(null)
  const [arquivados, setArquivados] = useState(false)
  const [novo, setNovo] = useState(false)
  const papeis = (lista.data?.papeis ?? []).filter((p) => arquivados || !p.arquivado)

  useEffect(() => {
    if (sel == null && papeis.length) setSel(papeis[0]!.id)
  }, [papeis.length])

  if (lista.isLoading) return <Skeleton class="h-64 w-full" />

  return (
    <div class="flex gap-4 flex-col lg:flex-row">
      <aside class="lg:w-64 shrink-0 flex flex-col gap-2">
        <Button size="sm" onClick={() => setNovo(true)}><Plus size={14} /> Novo papel</Button>
        <nav class="flex flex-col gap-1">
          {papeis.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSel(p.id)}
              class={cn(
                'flex items-center justify-between gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors',
                sel === p.id ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                p.arquivado && 'opacity-60',
              )}
            >
              <span class="flex items-center gap-1.5 min-w-0">
                {p.sistema && <Lock size={12} class="shrink-0" />}
                <span class="truncate">{p.nome}</span>
              </span>
              <span class="text-2xs text-fg-muted shrink-0">{p.pessoas} pess.</span>
            </button>
          ))}
        </nav>
        <Checkbox label="Mostrar arquivados" checked={arquivados} onChange={(e) => setArquivados((e.target as HTMLInputElement).checked)} />
      </aside>
      <div class="flex-1 min-w-0">
        {sel != null ? <EditorPapel key={sel} id={sel} onClonado={setSel} /> : <EmptyState title="Nenhum papel" description="Crie o primeiro papel." />}
      </div>
      <NovoPapelModal open={novo} onOpenChange={setNovo} onCriado={setSel} />
    </div>
  )
}

function NovoPapelModal({ open, onOpenChange, onCriado, clonarDe }: { open: boolean; onOpenChange: (o: boolean) => void; onCriado: (id: number) => void; clonarDe?: number }) {
  const lista = usePapeis()
  const criar = useCriarPapel()
  const [nome, setNome] = useState('')
  const [origem, setOrigem] = useState<string>('')
  useEffect(() => { if (open) { setNome(''); setOrigem(clonarDe ? String(clonarDe) : '') } }, [open, clonarDe])

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Novo papel"
      description="Comece de um papel parecido e ajuste só o que muda."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" loading={criar.isPending} disabled={nome.trim().length < 2} onClick={async () => {
            try {
              const r = await criar.mutateAsync({ nome: nome.trim(), ...(origem ? { clonarDe: Number(origem) } : {}) })
              toast('Papel criado.', 'success')
              onCriado(r.id)
              onOpenChange(false)
            } catch (e) { erro(e) }
          }}>Criar</Button>
        </>
      }
    >
      <div class="flex flex-col gap-3">
        <Input label="Nome" value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} placeholder="Ex.: Secretaria, Financeiro, Polo" />
        <Select label="Começar a partir de" value={origem} onChange={(e) => setOrigem((e.target as HTMLSelectElement).value)}>
          <option value="">Papel vazio (só o que eu marcar)</option>
          {(lista.data?.papeis ?? []).filter((p) => !p.arquivado && p.papelBase !== 'SUPERADMIN').map((p) => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </Select>
      </div>
    </Modal>
  )
}

function EditorPapel({ id, onClonado }: { id: number; onClonado: (id: number) => void }) {
  const q = usePapel(id)
  const cat = useCatalogoPapeis()
  const salvar = useSalvarPapel()
  const arquivar = useArquivarPapel()
  const [sub, setSub] = useState<'caps' | 'alcance' | 'pessoas'>('caps')
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [base, setBase] = useState<PapelBase>('AGENT')
  const [caps, setCaps] = useState<Set<string>>(new Set())
  const [sep, setSep] = useState<Set<string>>(new Set())
  const [alc, setAlc] = useState<Partial<Record<TipoAlcance, NivelAlcance>>>({})
  const [clonar, setClonar] = useState(false)

  const original = useMemo(() => {
    const p = q.data
    if (!p) return null
    return {
      nome: p.nome, descricao: p.descricao ?? '', base: p.papelBase,
      caps: new Set(p.capacidades.map((c) => c.capacidade)),
      sep: new Set(p.capacidades.filter((c) => c.separacao).map((c) => c.capacidade)),
      alc: p.alcances,
    }
  }, [q.data])

  useEffect(() => {
    if (!original) return
    setNome(original.nome); setDescricao(original.descricao); setBase(original.base)
    setCaps(new Set(original.caps)); setSep(new Set(original.sep)); setAlc({ ...original.alc })
  }, [original])

  if (q.isLoading || !q.data || !original) return <Skeleton class="h-96 w-full" />
  const p = q.data
  const travado = p.sistema
  const igual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x))
  const mudouCaps = !igual(caps, original.caps) || !igual(sep, original.sep)
  const mudouAlc = JSON.stringify(alc) !== JSON.stringify(original.alc)
  const mudouDados = nome !== original.nome || descricao !== original.descricao || base !== original.base
  const sujo = mudouCaps || mudouAlc || mudouDados
  const ativos = p.usuarios.filter((u) => u.active)

  async function gravar() {
    try {
      const r = await salvar.mutateAsync({
        id,
        ...(mudouDados ? { nome, descricao, papelBase: base } : {}),
        ...(mudouCaps ? { capacidades: [...caps], separacao: [...sep].filter((c) => caps.has(c)) } : {}),
        ...(mudouAlc ? { alcances: alc } : {}),
      })
      toast(r.pessoasAfetadas ? `Papel salvo — vale já para ${r.pessoasAfetadas} pessoa(s).` : 'Papel salvo.', 'success')
    } catch (e) { erro(e) }
  }

  return (
    <Card class="flex flex-col gap-4">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="font-semibold text-base">{p.nome}</h3>
            {travado && <Badge tone="info"><Lock size={11} /> Papel do sistema</Badge>}
            {p.arquivado && <Badge tone="neutral">Arquivado</Badge>}
            {p.origem?.startsWith('espelho:') && <Badge tone="neutral" title="Criado automaticamente para reproduzir a configuração antiga">Espelho da regra antiga</Badge>}
          </div>
          <p class="text-xs text-fg-muted">
            {travado ? 'Não se edita: é o que garante que sempre exista alguém com acesso total. Clone para criar um papel parecido.' : (p.descricao || 'Sem descrição.')}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setClonar(true)}><Copy size={14} /> Clonar</Button>
          {!travado && (
            <Button variant="ghost" size="sm" loading={arquivar.isPending} onClick={async () => {
              try { const r = await arquivar.mutateAsync(id); toast(r.arquivado ? 'Papel arquivado.' : 'Papel reativado.', 'success') } catch (e) { erro(e) }
            }}><Archive size={14} /> {p.arquivado ? 'Reativar' : 'Arquivar'}</Button>
          )}
        </div>
      </div>

      {!travado && (
        <div class="grid gap-3 sm:grid-cols-3">
          <Input label="Nome" value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} />
          <Input label="Descrição" value={descricao} onInput={(e) => setDescricao((e.target as HTMLInputElement).value)} />
          <Select label="Nível técnico" hint="O que as telas antigas ainda leem enquanto a troca não termina." value={base} onChange={(e) => setBase((e.target as HTMLSelectElement).value as PapelBase)}>
            {(['ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const).map((r) => <option key={r} value={r}>{BASE_LABELS[r]}</option>)}
          </Select>
        </div>
      )}

      <div class="flex gap-1 border-b border-border">
        {([['caps', 'O que pode fazer'], ['alcance', 'Sobre quais registros'], ['pessoas', `Pessoas (${p.usuarios.length})`]] as const).map(([k, n]) => (
          <button key={k} type="button" onClick={() => setSub(k)} class={cn('px-3 h-8 text-sm border-b-2 -mb-px', sub === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg')}>{n}</button>
        ))}
      </div>

      {sub === 'caps' && (cat.data
        ? <EditorCapacidades catalogo={cat.data} caps={caps} setCaps={setCaps} sep={sep} setSep={setSep} travado={travado} />
        : <Skeleton class="h-64 w-full" />)}

      {sub === 'alcance' && (
        <div class="flex flex-col gap-3">
          {(cat.data?.tipos ?? (Object.keys(TIPO_LABELS) as TipoAlcance[])).map((t) => (
            <div key={t} class="grid gap-2 sm:grid-cols-[14rem_1fr] items-start">
              <span class="text-sm font-medium pt-2">{TIPO_LABELS[t]}</span>
              <Select
                value={alc[t] ?? 'MEUS'}
                disabled={travado}
                hint={NIVEL_LABELS[alc[t] ?? 'MEUS'].ajuda}
                onChange={(e) => setAlc({ ...alc, [t]: (e.target as HTMLSelectElement).value as NivelAlcance })}
              >
                {(cat.data?.niveis ?? (Object.keys(NIVEL_LABELS) as NivelAlcance[])).map((n) => <option key={n} value={n}>{NIVEL_LABELS[n].nome}</option>)}
              </Select>
            </div>
          ))}
          <p class="text-2xs text-fg-muted flex items-start gap-1"><Info size={12} class="mt-0.5" /> Os recortes (portais e números de cada equipe) se configuram em Cadastros › Equipes e em Educacional › Acesso por portal.</p>
        </div>
      )}

      {sub === 'pessoas' && (
        p.usuarios.length
          ? <ul class="flex flex-col gap-1 text-sm">{p.usuarios.map((u) => (
              <li key={u.id} class={cn('flex items-center justify-between gap-2', !u.active && 'opacity-60')}>
                <span>{u.name} <span class="text-fg-muted text-xs">{u.email}</span></span>
                {!u.active && <Badge tone="neutral">inativo</Badge>}
              </li>
            ))}</ul>
          : <p class="text-sm text-fg-muted">Ninguém tem este papel. Atribua na aba Pessoas.</p>
      )}

      {!travado && sujo && (
        <div class="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 bg-surface-2 border-t border-border flex items-center justify-between gap-3 flex-wrap rounded-b-lg">
          <span class="text-xs flex items-center gap-1.5">
            <AlertTriangle size={14} class="text-warning" />
            {ativos.length
              ? <>Esta alteração muda o acesso de <b>{ativos.length}</b> pessoa(s): {ativos.slice(0, 6).map((u) => u.name).join(', ')}{ativos.length > 6 ? '…' : ''}</>
              : 'Ninguém ativo tem este papel ainda — a alteração não muda o acesso de ninguém agora.'}
          </span>
          <div class="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setNome(original.nome); setDescricao(original.descricao); setBase(original.base); setCaps(new Set(original.caps)); setSep(new Set(original.sep)); setAlc({ ...original.alc }) }}>Descartar</Button>
            <Button size="sm" loading={salvar.isPending} onClick={() => void gravar()}><Save size={14} /> Salvar</Button>
          </div>
        </div>
      )}
      <NovoPapelModal open={clonar} onOpenChange={setClonar} onCriado={onClonado} clonarDe={id} />
    </Card>
  )
}

/** Capacidades por área: uma linha por módulo/tela com Ver/Criar/Editar/Excluir
 *  e, ao fim, as ações sensíveis com nome próprio. `sep` (separação de
 *  funções) só existe no papel — no pacote fica de fora. */
function EditorCapacidades({ catalogo, caps, setCaps, sep, setSep, travado }: {
  catalogo: Catalogo
  caps: Set<string>
  setCaps: (s: Set<string>) => void
  sep?: Set<string>
  setSep?: (s: Set<string>) => void
  travado?: boolean
}) {
  const [busca, setBusca] = useState('')
  const termo = busca.trim().toLowerCase()
  const porArea = useMemo(() => {
    const m = new Map<string, typeof catalogo.recursos>()
    for (const r of catalogo.recursos) {
      if (termo && !r.nome.toLowerCase().includes(termo)) continue
      m.set(r.area, [...(m.get(r.area) ?? []), r])
    }
    return [...m.entries()]
  }, [catalogo, termo])
  const nomeadas = catalogo.nomeadas.filter((n) => !termo || n.nome.toLowerCase().includes(termo))

  const alterna = (id: string, v: boolean) => {
    const n = new Set(caps)
    if (v) n.add(id); else n.delete(id)
    // Sem Ver não há o que criar/editar/excluir; com Criar/Editar/Excluir, Ver vem junto.
    const [rec, acao] = [id.slice(0, id.lastIndexOf('.')), id.slice(id.lastIndexOf('.') + 1)]
    if (v && acao !== 'view' && catalogo.recursos.some((r) => r.recurso === rec)) n.add(`${rec}.view`)
    if (!v && acao === 'view') for (const a of ACOES) n.delete(`${rec}.${a.id}`)
    setCaps(n)
  }

  return (
    <div class="flex flex-col gap-4">
      <Input placeholder="Buscar módulo ou tela…" value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)} />
      {porArea.map(([area, recs]) => (
        <div key={area} class="flex flex-col gap-1">
          <span class="text-xs font-semibold text-fg-muted uppercase tracking-wide">{AREA_LABELS[area] ?? area}</span>
          <Table>
            <THead><TR><TH>Módulo / tela</TH>{ACOES.map((a) => <TH key={a.id} align="center">{a.nome}</TH>)}</TR></THead>
            <TBody>
              {recs.map((r) => (
                <TR key={r.recurso}>
                  <TD>{r.nome}</TD>
                  {ACOES.map((a) => (
                    <TD key={a.id} align="center">
                      {r.acoes.includes(a.id)
                        ? <input type="checkbox" aria-label={`${r.nome}: ${a.nome}`} disabled={travado} checked={caps.has(`${r.recurso}.${a.id}`)} onChange={(e) => alterna(`${r.recurso}.${a.id}`, (e.target as HTMLInputElement).checked)} />
                        : <span class="text-fg-muted text-xs" title="Esta tela não tem esta ação">—</span>}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ))}
      {nomeadas.length > 0 && (
        <div class="flex flex-col gap-2">
          <span class="text-xs font-semibold text-fg-muted uppercase tracking-wide">Ações sensíveis</span>
          <div class="grid gap-2 sm:grid-cols-2">
            {nomeadas.map((n) => (
              <div key={n.id} class="flex items-start justify-between gap-2 rounded-md bg-surface-1 px-3 py-2">
                <Checkbox label={n.nome} hint={n.id} disabled={travado} checked={caps.has(n.id)} onChange={(e) => alterna(n.id, (e.target as HTMLInputElement).checked)} />
                {sep && setSep && n.separavel && caps.has(n.id) && (
                  <Checkbox
                    label="Separação"
                    hint="Quem fez não aprova"
                    disabled={travado}
                    checked={sep.has(n.id)}
                    onChange={(e) => { const s = new Set(sep); if ((e.target as HTMLInputElement).checked) s.add(n.id); else s.delete(n.id); setSep(s) }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pessoas ──────────────────────────────────────────────────────────────
function AbaPessoas() {
  const pessoas = usePessoasPapeis()
  const papeis = usePapeis()
  const pacotes = usePacotes()
  const salvar = useSalvarPessoa()
  const ehSuperadmin = useUserStore((s) => s.user?.role) === 'SUPERADMIN'
  const [busca, setBusca] = useState('')
  const [pacotesDe, setPacotesDe] = useState<number | null>(null)

  if (pessoas.isLoading || papeis.isLoading) return <Skeleton class="h-64 w-full" />
  const termo = busca.trim().toLowerCase()
  const lista = (pessoas.data?.pessoas ?? []).filter((u) => !termo || u.name.toLowerCase().includes(termo) || u.email.toLowerCase().includes(termo))
  const ativosPapeis = (papeis.data?.papeis ?? []).filter((p) => !p.arquivado)
  const nomePacote = new Map((pacotes.data?.pacotes ?? []).map((p) => [p.id, p.nome]))
  const pessoaPacotes = pessoas.data?.pessoas.find((u) => u.id === pacotesDe)

  return (
    <div class="flex flex-col gap-3">
      <Input placeholder="Buscar pessoa…" value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)} />
      <Table>
        <THead><TR><TH>Pessoa</TH><TH>Papel</TH><TH>Pacotes</TH></TR></THead>
        <TBody>
          {lista.map((u) => {
            const intocavel = !ehSuperadmin && u.role === 'SUPERADMIN'
            return (
              <TR key={u.id} class={cn(!u.active && 'opacity-60')}>
                <TD>
                  <div class="flex flex-col">
                    <span>{u.name}</span>
                    <span class="text-2xs text-fg-muted">{u.email}{!u.active && ' · inativo'}</span>
                  </div>
                </TD>
                <TD>
                  <Select
                    value={u.papelId ?? ''}
                    disabled={intocavel || salvar.isPending}
                    onChange={async (e) => {
                      const papelId = Number((e.target as HTMLSelectElement).value)
                      try { await salvar.mutateAsync({ userId: u.id, papelId }); toast(`${u.name}: papel trocado.`, 'success') } catch (er) { erro(er) }
                    }}
                  >
                    {u.papelId == null && <option value="">— sem papel —</option>}
                    {ativosPapeis
                      .filter((p) => ehSuperadmin || p.papelBase !== 'SUPERADMIN' || p.id === u.papelId)
                      .map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </Select>
                </TD>
                <TD>
                  <button type="button" class="text-left text-sm hover:underline disabled:no-underline disabled:opacity-60" disabled={intocavel} onClick={() => setPacotesDe(u.id)}>
                    {u.pacotes.length ? u.pacotes.map((id) => nomePacote.get(id) ?? `#${id}`).join(', ') : <span class="text-fg-muted">nenhum</span>}
                  </button>
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
      {pessoaPacotes && (
        <PacotesDaPessoaModal
          key={pessoaPacotes.id}
          nome={pessoaPacotes.name}
          atuais={pessoaPacotes.pacotes}
          pacotes={pacotes.data?.pacotes ?? []}
          salvando={salvar.isPending}
          onClose={() => setPacotesDe(null)}
          onSave={async (ids) => {
            try { await salvar.mutateAsync({ userId: pessoaPacotes.id, pacotes: ids }); toast('Pacotes salvos.', 'success'); setPacotesDe(null) } catch (e) { erro(e) }
          }}
        />
      )}
    </div>
  )
}

function PacotesDaPessoaModal({ nome, atuais, pacotes, salvando, onClose, onSave }: {
  nome: string; atuais: number[]; pacotes: Pacote[]; salvando: boolean; onClose: () => void; onSave: (ids: number[]) => void
}) {
  const [sel, setSel] = useState(new Set(atuais))
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Pacotes de ${nome}`}
      description="Pacote só soma capacidades ao papel — nunca retira."
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" loading={salvando} onClick={() => onSave([...sel])}>Salvar</Button>
      </>}
    >
      {pacotes.length
        ? <div class="flex flex-col gap-2">{pacotes.map((p) => (
            <Checkbox
              key={p.id}
              label={p.nome}
              hint={`${p.capacidades.length} capacidade(s)${p.descricao ? ` · ${p.descricao}` : ''}`}
              checked={sel.has(p.id)}
              onChange={(e) => { const n = new Set(sel); if ((e.target as HTMLInputElement).checked) n.add(p.id); else n.delete(p.id); setSel(n) }}
            />
          ))}</div>
        : <p class="text-sm text-fg-muted">Nenhum pacote criado. Crie na aba Pacotes.</p>}
    </Modal>
  )
}

// ── Pacotes ──────────────────────────────────────────────────────────────
function AbaPacotes() {
  const pacotes = usePacotes()
  const excluir = useExcluirPacote()
  const [editando, setEditando] = useState<Pacote | 'novo' | null>(null)
  const [apagar, setApagar] = useState<Pacote | null>(null)

  if (pacotes.isLoading) return <Skeleton class="h-48 w-full" />
  const lista = pacotes.data?.pacotes ?? []
  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <p class="text-xs text-fg-muted">Um pacote é um conjunto de capacidades somado a pessoas específicas, sem precisar de um papel novo.</p>
        <Button size="sm" onClick={() => setEditando('novo')}><Plus size={14} /> Novo pacote</Button>
      </div>
      {lista.length === 0 && <EmptyState title="Nenhum pacote" description="Exceções por pessoa viram pacotes aqui." />}
      <div class="grid gap-3 sm:grid-cols-2">
        {lista.map((p) => (
          <Card key={p.id} class="flex flex-col gap-2">
            <div class="flex items-start justify-between gap-2">
              <div class="flex flex-col min-w-0">
                <span class="font-medium text-sm truncate">{p.nome}</span>
                <span class="text-2xs text-fg-muted">{p.capacidades.length} capacidade(s) · {p.pessoas} pessoa(s)</span>
              </div>
              <div class="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditando(p)}>Editar</Button>
                <Button variant="ghost" size="sm" iconOnly aria-label="Excluir pacote" onClick={() => setApagar(p)}><Trash2 size={14} /></Button>
              </div>
            </div>
            {p.descricao && <p class="text-xs text-fg-muted">{p.descricao}</p>}
          </Card>
        ))}
      </div>
      {editando && <EditorPacoteModal pacote={editando === 'novo' ? null : editando} onClose={() => setEditando(null)} />}
      <ConfirmDialog
        open={!!apagar}
        onOpenChange={(o) => { if (!o) setApagar(null) }}
        title="Excluir pacote?"
        description={apagar?.pessoas ? `${apagar.pessoas} pessoa(s) perdem as capacidades deste pacote na hora.` : 'Ninguém usa este pacote.'}
        confirmLabel="Excluir"
        destructive
        loading={excluir.isPending}
        onConfirm={async () => {
          try { await excluir.mutateAsync(apagar!.id); toast('Pacote excluído.', 'success') } catch (e) { erro(e) }
          setApagar(null)
        }}
      />
    </div>
  )
}

function EditorPacoteModal({ pacote, onClose }: { pacote: Pacote | null; onClose: () => void }) {
  const cat = useCatalogoPapeis()
  const salvar = useSalvarPacote()
  const [nome, setNome] = useState(pacote?.nome ?? '')
  const [descricao, setDescricao] = useState(pacote?.descricao ?? '')
  const [caps, setCaps] = useState(new Set(pacote?.capacidades ?? []))
  return (
    <Modal
      open
      size="full"
      onOpenChange={(o) => { if (!o) onClose() }}
      title={pacote ? `Pacote: ${pacote.nome}` : 'Novo pacote'}
      description={pacote?.pessoas ? `Alterar muda o acesso de ${pacote.pessoas} pessoa(s).` : undefined}
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" loading={salvar.isPending} disabled={nome.trim().length < 2} onClick={async () => {
          try {
            await salvar.mutateAsync({ ...(pacote ? { id: pacote.id } : {}), nome: nome.trim(), descricao, capacidades: [...caps] })
            toast('Pacote salvo.', 'success'); onClose()
          } catch (e) { erro(e) }
        }}><Save size={14} /> Salvar</Button>
      </>}
    >
      <div class="flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
        <div class="grid gap-3 sm:grid-cols-2">
          <Input label="Nome" value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} />
          <Input label="Descrição" value={descricao} onInput={(e) => setDescricao((e.target as HTMLInputElement).value)} />
        </div>
        {cat.data ? <EditorCapacidades catalogo={cat.data} caps={caps} setCaps={setCaps} /> : <Skeleton class="h-64 w-full" />}
      </div>
    </Modal>
  )
}

// ── Ver como ─────────────────────────────────────────────────────────────
function AbaVerComo() {
  const pessoas = usePessoasPapeis()
  const cat = useCatalogoPapeis()
  const [userId, setUserId] = useState<number | null>(null)
  const v = useVerComo(userId)
  const nomeRecurso = new Map((cat.data?.recursos ?? []).map((r) => [r.recurso, r.nome]))

  return (
    <div class="flex flex-col gap-3">
      <Select label="Pessoa" value={userId ?? ''} onChange={(e) => setUserId(Number((e.target as HTMLSelectElement).value) || null)}>
        <option value="">Escolha uma pessoa…</option>
        {(pessoas.data?.pessoas ?? []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </Select>
      {userId != null && (v.isLoading ? <Skeleton class="h-40 w-full" /> : v.data && (
        <Card class="flex flex-col gap-3">
          <div class="flex items-center gap-2 flex-wrap text-sm">
            <span class="font-semibold">{v.data.pessoa.nome}</span>
            {v.data.papel ? <Badge tone="accent">{v.data.papel.nome}</Badge> : <Badge tone="warning" title="Sem papel a pessoa segue a regra antiga (aba Permissões)">sem papel — regra antiga</Badge>}
            {v.data.pacotes.map((p) => <Badge key={p} tone="neutral">+ {p}</Badge>)}
          </div>
          {!v.data.motorLigado && (
            <p class="text-2xs text-fg-muted flex items-start gap-1"><Info size={12} class="mt-0.5" /> Motor desligado: é o que esta pessoa veria com os papéis valendo.</p>
          )}
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-md bg-surface-1 px-3 py-2"><div class="text-2xs text-fg-muted">Módulos e telas no menu</div><div class="text-lg font-semibold">{v.data.modulosVisiveis.length}</div></div>
            <div class="rounded-md bg-surface-1 px-3 py-2"><div class="text-2xs text-fg-muted">Leads que enxerga</div><div class="text-lg font-semibold">{v.data.leads.toLocaleString('pt-BR')}</div></div>
            <div class="rounded-md bg-surface-1 px-3 py-2"><div class="text-2xs text-fg-muted">Inscrições que enxerga</div><div class="text-lg font-semibold">{v.data.inscricoes.toLocaleString('pt-BR')}</div></div>
          </div>
          <div class="flex flex-wrap gap-1">
            {v.data.modulosVisiveis.map((m) => <Badge key={m} tone="neutral">{nomeRecurso.get(m) ?? m}</Badge>)}
          </div>
        </Card>
      ))}
    </div>
  )
}
