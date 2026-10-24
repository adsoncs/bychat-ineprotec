// Telas iniciais do comercial: Diretoria, Gerente e Agente.
//
// Um componente, três visões. Os números saem todos de /home-screen/comercial
// (services/painelComercial.ts), com as mesmas regras nas três:
//   - conversa que não é lead não entra em nenhum KPI;
//   - matrícula = lead que ENTROU na etapa de matrícula do funil;
//   - pagamento = proposta ganha ou inscrição paga (outra coisa).
// O agente vê tudo dos colegas no placar, menos valores em R$ — o servidor já
// manda esses campos vazios, a tela só não mostra o que não veio.

import { useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  AlertTriangle, Award, CheckCircle2, Clock, CreditCard, Crown, Filter, Flame, GraduationCap, Inbox, ListChecks,
  MessageSquare, Settings, Sparkles, Target, Timer, TrendingUp, Trophy, UserPlus, Users, Wallet, XCircle, Zap,
} from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { KpiCard } from '@/components/ui/KpiCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { PeriodPicker, PeriodIncompleteHint, usePeriod } from '@/components/ui/PeriodPicker'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { useUserStore } from '@/stores'
import {
  usePainelComercial, useConfigPainelComercial, useSalvarConfigPainelComercial,
  type EtapaDoFunil, type KpisComercial, type LinhaAgente, type PainelComercial, type VisaoComercial,
  type ConfigPainelComercial,
} from '@/hooks/usePainelComercial'

// ── Formatos ─────────────────────────────────────────────────────────────

const fmtMoeda = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const fmtNum = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR'))
const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
/** Minutos úteis → "12 min" / "2h 10min" / "1d 3h". */
function fmtMin(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v < 60) return `${Math.round(v)} min`
  const h = Math.floor(v / 60), m = Math.round(v % 60)
  if (h < 24) return m ? `${h}h ${m}min` : `${h}h`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
/** Variação % entre dois números (null quando não há base). */
function delta(atual: number | null | undefined, antes: number | null | undefined): { value: number } | undefined {
  if (atual == null || antes == null || antes === 0) return undefined
  return { value: Math.round(((atual - antes) / antes) * 100) }
}
/** Variação em pontos percentuais, para taxas. */
function deltaPp(atual: number | null | undefined, antes: number | null | undefined): { value: number; label: string } | undefined {
  if (atual == null || antes == null) return undefined
  return { value: Math.round((atual - antes) * 10) / 10, label: 'p.p.' }
}

const CONQUISTAS: Record<string, { nome: string; dica: string; icone: preact.JSX.Element; cor: string }> = {
  lider:       { nome: 'Líder',        dica: 'Mais pontos do time no período',                       icone: <Crown size={14} />,        cor: 'var(--color-warning)' },
  relampago:   { nome: 'Relâmpago',    dica: '1ª resposta (mediana) dentro da meta',                  icone: <Zap size={14} />,          cor: 'var(--color-info)' },
  fechador:    { nome: 'Fechador',     dica: '5 ou mais matrículas no período',                        icone: <GraduationCap size={14} />, cor: 'var(--color-success)' },
  meta_batida: { nome: 'Meta batida',  dica: '100% da meta atingida',                                  icone: <Target size={14} />,       cor: 'var(--color-success)' },
  em_dia:      { nome: 'Em dia',       dica: 'Nenhuma atividade atrasada e ninguém esperando resposta', icone: <CheckCircle2 size={14} />, cor: 'var(--color-accent)' },
  conversor:   { nome: 'Conversor',    dica: 'Conversão 20% acima da média do time',                    icone: <TrendingUp size={14} />,   cor: 'var(--color-violet)' },
  sequencia:   { nome: 'Em sequência', dica: '3 ou mais dias seguidos com matrícula',                   icone: <Flame size={14} />,        cor: 'var(--color-orange)' },
}

function Conquista({ k, compacta = false }: { k: string; compacta?: boolean }) {
  const c = CONQUISTAS[k]
  if (!c) return null
  return (
    <span
      title={`${c.nome} — ${c.dica}`}
      class="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-2xs font-medium"
      style={{ color: c.cor }}
    >
      {c.icone}
      {!compacta && <span class="text-fg">{c.nome}</span>}
    </span>
  )
}

// ── Peças visuais ────────────────────────────────────────────────────────

function Secao({ titulo, sub, acoes, children }: { titulo: string; sub?: string; acoes?: preact.ComponentChildren; children: preact.ComponentChildren }) {
  return (
    <section class="space-y-2">
      <div class="flex items-end justify-between gap-2 flex-wrap">
        <div>
          <h2 class="text-sm font-semibold text-fg">{titulo}</h2>
          {sub && <p class="text-2xs text-fg-muted">{sub}</p>}
        </div>
        {acoes}
      </div>
      {children}
    </section>
  )
}

/** Barras horizontais simples: rótulo, barra proporcional, número. */
function Barras({ itens, cor = 'var(--color-accent)', vazio }: { itens: { nome: string; valor: number; extra?: string }[]; cor?: string; vazio: string }) {
  const max = Math.max(1, ...itens.map((i) => i.valor))
  if (!itens.length) return <p class="text-xs text-fg-muted py-4 text-center">{vazio}</p>
  return (
    <div class="space-y-1.5">
      {itens.map((i) => (
        <div key={i.nome} class="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-xs">
          <span class="truncate text-fg" title={i.nome}>{i.nome}</span>
          <span class="h-2 rounded-full bg-surface-3 overflow-hidden">
            <span class="block h-full rounded-full" style={{ width: `${(i.valor / max) * 100}%`, background: cor }} />
          </span>
          <span class="tabular text-fg-muted whitespace-nowrap">{fmtNum(i.valor)}{i.extra ? ` · ${i.extra}` : ''}</span>
        </div>
      ))}
    </div>
  )
}

/** Colunas diárias: leads (claro) com matrículas e pagamentos sobrepostos. */
function SerieDiaria({ serie }: { serie: PainelComercial['serie'] }) {
  const max = Math.max(1, ...serie.map((d) => d.leads))
  const H = 120
  const largura = 100 / Math.max(1, serie.length)
  return (
    <div>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" class="w-full h-32" role="img" aria-label="Leads, matrículas e pagamentos por dia">
        {serie.map((d, i) => {
          const x = i * largura
          const hL = (d.leads / max) * (H - 4)
          const hM = (d.matriculas / max) * (H - 4)
          const hP = (d.pagamentos / max) * (H - 4)
          return (
            <g key={d.dia}>
              <title>{`${d.dia.split('-').reverse().slice(0, 2).join('/')}: ${d.leads} leads · ${d.matriculas} matrículas · ${d.pagamentos} pagamentos`}</title>
              <rect x={x + largura * 0.1} y={H - hL} width={largura * 0.8} height={hL} fill="var(--color-accent)" opacity="0.22" />
              <rect x={x + largura * 0.15} y={H - hP} width={largura * 0.35} height={hP} fill="var(--color-violet)" />
              <rect x={x + largura * 0.5} y={H - hM} width={largura * 0.35} height={hM} fill="var(--color-success)" />
            </g>
          )
        })}
      </svg>
      <div class="flex justify-between text-3xs text-fg-muted mt-1">
        <span>{serie[0]?.dia.split('-').reverse().slice(0, 2).join('/')}</span>
        <span class="flex gap-3">
          <span class="inline-flex items-center gap-1"><i class="inline-block w-2 h-2 rounded-sm" style={{ background: 'var(--color-accent)', opacity: 0.4 }} />Leads</span>
          <span class="inline-flex items-center gap-1"><i class="inline-block w-2 h-2 rounded-sm" style={{ background: 'var(--color-success)' }} />Matrículas</span>
          <span class="inline-flex items-center gap-1"><i class="inline-block w-2 h-2 rounded-sm" style={{ background: 'var(--color-violet)' }} />Pagamentos</span>
        </span>
        <span>{serie[serie.length - 1]?.dia.split('-').reverse().slice(0, 2).join('/')}</span>
      </div>
    </div>
  )
}

/** Funil etapa a etapa: quantos estão nela agora, quantos passaram no período e quantos destes chegaram à matrícula. */
function FunilDetalhado({ funil }: { funil: PainelComercial['funil'][number] }) {
  const max = Math.max(1, ...funil.etapas.map((e) => e.entradas))
  return (
    <Card>
      <div class="text-xs font-semibold text-fg mb-2">{funil.nome}</div>
      <div class="space-y-1">
        <div class="grid grid-cols-[minmax(0,11rem)_1fr_4.5rem_4.5rem_5.5rem] gap-2 text-3xs uppercase tracking-wider text-fg-muted">
          <span>Etapa</span><span>Passaram no período</span><span class="text-right">Agora</span><span class="text-right">No período</span><span class="text-right" title="Dos que passaram por esta etapa no período, quantos chegaram à matrícula">→ Matrícula</span>
        </div>
        {funil.etapas.map((e: EtapaDoFunil) => (
          <div key={e.key} class={cn('grid grid-cols-[minmax(0,11rem)_1fr_4.5rem_4.5rem_5.5rem] gap-2 items-center text-xs', e.terminal && 'opacity-80')}>
            <span class="truncate flex items-center gap-1.5" title={e.nome}>
              <i class="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: e.cor }} />
              <span class={cn(e.matricula && 'font-semibold text-success')}>{e.nome}</span>
            </span>
            <span class="h-2.5 rounded bg-surface-3 overflow-hidden">
              <span class="block h-full rounded" style={{ width: `${(e.entradas / max) * 100}%`, background: e.matricula ? 'var(--color-success)' : e.cor }} />
            </span>
            <span class="tabular text-right text-fg-muted">{fmtNum(e.agora)}</span>
            <span class="tabular text-right">{fmtNum(e.entradas)}</span>
            <span class={cn('tabular text-right', e.chegaramAMatricula != null && e.chegaramAMatricula >= 30 ? 'text-success' : 'text-fg-muted')}>
              {e.terminal ? '' : fmtPct(e.chegaramAMatricula)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Anel({ pct, tamanho = 96, cor = 'var(--color-accent)', children }: { pct: number; tamanho?: number; cor?: string; children?: preact.ComponentChildren }) {
  const r = 42, c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, pct))
  return (
    <div class="relative inline-flex items-center justify-center" style={{ width: tamanho, height: tamanho }}>
      <svg viewBox="0 0 100 100" class="absolute inset-0 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-surface-3)" stroke-width="9" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={cor} stroke-width="9" stroke-linecap="round" stroke-dasharray={`${(p / 100) * c} ${c}`} />
      </svg>
      <div class="relative text-center leading-tight">{children}</div>
    </div>
  )
}

// ── KPIs ─────────────────────────────────────────────────────────────────

function LinhaDeKpis({ k, a, serie, metaMin, carregando, mostrarReceita }: {
  k: KpisComercial | undefined; a: KpisComercial | undefined; serie: PainelComercial['serie']; metaMin: number; carregando: boolean; mostrarReceita: boolean
}) {
  return (
    <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
      <KpiCard label="Leads novos" icon={<UserPlus size={16} />} tone="accent" loading={carregando}
        value={fmtNum(k?.leads)} trend={delta(k?.leads, a?.leads)} sparkline={serie.map((d) => d.leads)}
        hint="Só leads — conversas que não viraram lead ficam fora" />
      <KpiCard label="Contatados" icon={<MessageSquare size={16} />} tone="info" loading={carregando}
        value={fmtPct(k?.taxaContato)} trend={deltaPp(k?.taxaContato, a?.taxaContato)}
        hint={`${fmtNum(k?.contatados)} receberam mensagem nossa`} />
      <KpiCard label="1ª resposta" icon={<Timer size={16} />} tone="orange" loading={carregando} menorEhMelhor
        value={fmtMin(k?.tempoResposta)} trend={delta(k?.tempoResposta, a?.tempoResposta)}
        hint={k?.tempoResposta == null ? 'Amostra insuficiente' : `Mediana em horário útil · ${fmtPct(k?.dentroDaMeta)} em até ${metaMin} min`} />
      <KpiCard label="Matrículas" icon={<GraduationCap size={16} />} tone="success" loading={carregando}
        value={fmtNum(k?.matriculas)} trend={delta(k?.matriculas, a?.matriculas)} sparkline={serie.map((d) => d.matriculas)}
        hint="Leads que entraram na etapa de matrícula" />
      <KpiCard label="Conversão" icon={<TrendingUp size={16} />} tone="violet" loading={carregando}
        value={fmtPct(k?.conversao)} trend={deltaPp(k?.conversao, a?.conversao)}
        hint="Matrículas ÷ leads novos do período" />
      <KpiCard label="Pagamentos realizados" icon={<CreditCard size={16} />} tone="violet" loading={carregando}
        value={fmtNum(k?.pagamentos)} trend={delta(k?.pagamentos, a?.pagamentos)} sparkline={serie.map((d) => d.pagamentos)}
        hint="Propostas ganhas + inscrições pagas" />
      {mostrarReceita ? (
        <KpiCard label="Receita paga" icon={<Wallet size={16} />} tone="success" loading={carregando}
          value={fmtMoeda(k?.receita)} trend={delta(k?.receita, a?.receita)}
          hint={`Ticket médio ${fmtMoeda(k?.ticketMedio)}`} />
      ) : null}
      <KpiCard label="Ciclo até a matrícula" icon={<Clock size={16} />} tone="neutral" loading={carregando} menorEhMelhor
        value={k?.cicloMedioDias == null ? '—' : `${k.cicloMedioDias.toLocaleString('pt-BR')} d`} trend={delta(k?.cicloMedioDias, a?.cicloMedioDias)}
        hint="Mediana: da chegada do lead à matrícula" />
    </div>
  )
}

function Fila({ fila, semResponsavel }: { fila: PainelComercial['fila']; semResponsavel: PainelComercial['semResponsavel'] }) {
  const [, navigate] = useLocation()
  const itens = [
    { rotulo: 'Esperando resposta', valor: fila.semResposta, icone: <Inbox size={16} />, alerta: fila.semResposta > 0, ir: '/conversations' },
    { rotulo: 'Parados além do prazo', valor: fila.parados, icone: <AlertTriangle size={16} />, alerta: fila.parados > 0, ir: '/kanban' },
    { rotulo: 'Atividades atrasadas', valor: fila.atrasadas, icone: <ListChecks size={16} />, alerta: fila.atrasadas > 0, ir: '/activities' },
    { rotulo: 'Leads em andamento', valor: fila.ativos, icone: <Users size={16} />, alerta: false, ir: '/kanban' },
    ...(semResponsavel ? [{ rotulo: 'Sem responsável', valor: semResponsavel.ativos, icone: <UserPlus size={16} />, alerta: semResponsavel.ativos > 0, ir: '/leads' }] : []),
  ]
  return (
    <div class="grid gap-2 grid-cols-2 md:grid-cols-5">
      {itens.map((i) => (
        <button key={i.rotulo} onClick={() => navigate(i.ir)}
          class={cn('flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-surface',
            i.alerta ? 'border-warning/50 bg-warning/5' : 'border-border bg-surface-2')}>
          <span class={i.alerta ? 'text-warning' : 'text-fg-muted'}>{i.icone}</span>
          <span>
            <span class="block text-lg font-bold tabular leading-none">{fmtNum(i.valor)}</span>
            <span class="block text-2xs text-fg-muted mt-1">{i.rotulo}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

// ── Placar / time ────────────────────────────────────────────────────────

type Criterio = 'pontos' | 'matriculas' | 'conversao' | 'meta' | 'pagamentos' | 'contato' | 'resposta' | 'atividades'
const CRITERIOS: { id: Criterio; nome: string }[] = [
  { id: 'pontos', nome: 'Pontos' },
  { id: 'matriculas', nome: 'Matrículas' },
  { id: 'conversao', nome: 'Conversão' },
  { id: 'meta', nome: '% da meta' },
  { id: 'pagamentos', nome: 'Pagamentos' },
  { id: 'contato', nome: 'Contatados' },
  { id: 'resposta', nome: '1ª resposta' },
  { id: 'atividades', nome: 'Atividades' },
]
function valorDoCriterio(l: LinhaAgente, c: Criterio): number | null {
  switch (c) {
    case 'pontos': return l.pontos
    case 'matriculas': return l.matriculas
    case 'conversao': return l.conversao
    case 'meta': return l.meta?.atingimento ?? null
    case 'pagamentos': return l.pagamentos
    case 'contato': return l.taxaContato
    case 'resposta': return l.tempoResposta
    case 'atividades': return l.atividades
  }
}
function fmtCriterio(l: LinhaAgente, c: Criterio): string {
  const v = valorDoCriterio(l, c)
  if (c === 'conversao' || c === 'meta' || c === 'contato') return fmtPct(v)
  if (c === 'resposta') return fmtMin(v)
  return fmtNum(v)
}

function Placar({ agentes, destaque }: { agentes: LinhaAgente[]; destaque: boolean }) {
  const [criterio, setCriterio] = useState<Criterio>('pontos')
  const ordenados = useMemo(() => {
    const menor = criterio === 'resposta'
    return [...agentes].sort((a, b) => {
      const va = valorDoCriterio(a, criterio), vb = valorDoCriterio(b, criterio)
      if (va == null && vb == null) return b.pontos - a.pontos
      if (va == null) return 1
      if (vb == null) return -1
      return menor ? va - vb : vb - va
    })
  }, [agentes, criterio])
  const max = Math.max(1, ...ordenados.map((l) => valorDoCriterio(l, criterio) ?? 0))
  return (
    <Card>
      <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div class="flex items-center gap-2">
          <Trophy size={18} class="text-warning" />
          <span class="text-sm font-semibold">Placar do time</span>
        </div>
        <div class="flex flex-wrap gap-1">
          {CRITERIOS.map((c) => (
            <button key={c.id} onClick={() => setCriterio(c.id)}
              class={cn('rounded-full px-2.5 py-0.5 text-2xs border transition-colors',
                criterio === c.id ? 'bg-accent text-white border-accent' : 'border-border text-fg-muted hover:text-fg')}>
              {c.nome}
            </button>
          ))}
        </div>
      </div>
      <ol class="space-y-1.5">
        {ordenados.map((l, i) => {
          const v = valorDoCriterio(l, criterio)
          const largura = criterio === 'resposta' ? (v == null ? 0 : Math.max(8, 100 - (v / max) * 92)) : ((v ?? 0) / max) * 100
          return (
            <li key={l.userId} class={cn('grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5',
              l.eu && destaque ? 'bg-accent/10 ring-1 ring-accent/40' : 'hover:bg-surface')}>
              <span class={cn('text-center font-bold tabular', i === 0 ? 'text-warning text-base' : i < 3 ? 'text-fg' : 'text-fg-muted text-xs')}>
                {i === 0 ? <Crown size={18} class="inline" /> : `${i + 1}º`}
              </span>
              <span class="min-w-0">
                <span class="flex items-center gap-1.5 text-xs">
                  <span class={cn('truncate', l.eu && 'font-semibold')}>{l.nome}{l.eu ? ' (você)' : ''}</span>
                  {l.conquistas.filter((c) => c !== 'lider').slice(0, 4).map((c) => <Conquista key={c} k={c} compacta />)}
                </span>
                <span class="mt-1 block h-1.5 rounded-full bg-surface-3 overflow-hidden">
                  <span class="block h-full rounded-full bg-accent" style={{ width: `${largura}%` }} />
                </span>
              </span>
              <span class="text-right">
                <span class="block text-sm font-bold tabular">{fmtCriterio(l, criterio)}</span>
                <span class="block text-3xs text-fg-muted">{l.matriculas} mat · {fmtPct(l.conversao)} · {l.pontos} pts</span>
              </span>
            </li>
          )
        })}
      </ol>
      {!ordenados.length && <p class="text-xs text-fg-muted text-center py-4">Ninguém com movimento no período.</p>}
    </Card>
  )
}

/** Tabela do time com tudo — e o destaque de onde cada um está abaixo da média (coaching). */
function TabelaDoTime({ agentes, media, mostrarReceita, onAgente }: {
  agentes: LinhaAgente[]; media: PainelComercial['mediaDoTime']; mostrarReceita: boolean; onAgente?: ((id: number) => void) | undefined
}) {
  const [ordem, setOrdem] = useState<{ k: keyof LinhaAgente; desc: boolean }>({ k: 'matriculas', desc: true })
  const linhas = useMemo(() => [...agentes].sort((a, b) => {
    const va = a[ordem.k] as unknown as number | null, vb = b[ordem.k] as unknown as number | null
    const x = (va ?? -Infinity) as number, y = (vb ?? -Infinity) as number
    return ordem.desc ? y - x : x - y
  }), [agentes, ordem])
  const abaixo = (v: number | null, ref: number | null | undefined, menorEhMelhor = false) =>
    v != null && ref != null && (menorEhMelhor ? v > ref * 1.3 : v < ref * 0.7)
  const Th = ({ k, children, title }: { k: keyof LinhaAgente; children: preact.ComponentChildren; title?: string }) => (
    <th class="px-2 py-1.5 text-right font-medium cursor-pointer select-none whitespace-nowrap hover:text-fg" title={title}
      onClick={() => setOrdem((o) => ({ k, desc: o.k === k ? !o.desc : true }))}>
      {children}{ordem.k === k ? (ordem.desc ? ' ↓' : ' ↑') : ''}
    </th>
  )
  return (
    <Card class="overflow-x-auto">
      <table class="w-full text-xs min-w-[900px]">
        <thead class="text-3xs uppercase tracking-wider text-fg-muted border-b border-border">
          <tr>
            <th class="px-2 py-1.5 text-left font-medium">Agente</th>
            <Th k="leads">Leads</Th>
            <Th k="taxaContato" title="Leads novos que receberam mensagem nossa">Contato</Th>
            <Th k="tempoResposta" title="Mediana da 1ª resposta em horário útil">1ª resp.</Th>
            <Th k="matriculas">Matríc.</Th>
            <Th k="conversao">Conv.</Th>
            <Th k="pagamentos">Pagam.</Th>
            {mostrarReceita && <Th k="receita">Receita</Th>}
            <Th k="perdidos">Perdidos</Th>
            <Th k="atividades" title="Atividades concluídas no período">Ativid.</Th>
            <Th k="atrasadas">Atrasadas</Th>
            <Th k="semResposta" title="Conversas esperando resposta agora">Esperando</Th>
            <Th k="parados" title="Leads parados além do prazo da etapa">Parados</Th>
            <th class="px-2 py-1.5 text-right font-medium">Meta</th>
            <Th k="pontos">Pontos</Th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.userId} class="border-b border-border/60 hover:bg-surface">
              <td class="px-2 py-1.5">
                <button class="text-left hover:underline" onClick={() => onAgente?.(l.userId)} disabled={!onAgente}>
                  <span class="font-medium">{l.nome}</span>
                  {l.equipe && <span class="block text-3xs text-fg-muted">{l.equipe}</span>}
                </button>
              </td>
              <td class="px-2 text-right tabular">{fmtNum(l.leads)}</td>
              <td class={cn('px-2 text-right tabular', abaixo(l.taxaContato, 90) && 'text-danger')}>{fmtPct(l.taxaContato)}</td>
              <td class={cn('px-2 text-right tabular', abaixo(l.tempoResposta, media?.tempoResposta, true) && 'text-danger')}>{fmtMin(l.tempoResposta)}</td>
              <td class="px-2 text-right tabular font-semibold">{fmtNum(l.matriculas)}</td>
              <td class={cn('px-2 text-right tabular', abaixo(l.conversao, media?.conversao) && 'text-danger')}>{fmtPct(l.conversao)}</td>
              <td class="px-2 text-right tabular">{fmtNum(l.pagamentos)}</td>
              {mostrarReceita && <td class="px-2 text-right tabular">{fmtMoeda(l.receita)}</td>}
              <td class="px-2 text-right tabular">{fmtNum(l.perdidos)}</td>
              <td class="px-2 text-right tabular">{fmtNum(l.atividades)}</td>
              <td class={cn('px-2 text-right tabular', l.atrasadas > 0 && 'text-warning')}>{fmtNum(l.atrasadas)}</td>
              <td class={cn('px-2 text-right tabular', l.semResposta > 0 && 'text-warning')}>{fmtNum(l.semResposta)}</td>
              <td class={cn('px-2 text-right tabular', l.parados > 0 && 'text-warning')}>{fmtNum(l.parados)}</td>
              <td class="px-2 text-right tabular">
                {l.meta?.atingimento != null ? (
                  <span title={l.meta.projecao != null ? `Projeção: ${l.meta.metrica === 'revenue' ? fmtMoeda(l.meta.projecao) : fmtNum(l.meta.projecao)}` : undefined}
                    class={cn(l.meta.atingimento >= 100 ? 'text-success font-semibold' : '')}>
                    {fmtPct(l.meta.atingimento)}
                  </span>
                ) : '—'}
              </td>
              <td class="px-2 text-right tabular font-semibold">{fmtNum(l.pontos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="text-3xs text-fg-muted mt-2">
        Em vermelho: abaixo da média do time (conversão 30% menor, 1ª resposta 30% mais lenta, contato abaixo de 90%). É por onde começar a conversa de coaching.
      </p>
    </Card>
  )
}

function Missao({ missao }: { missao: NonNullable<PainelComercial['missao']> }) {
  return (
    <Card>
      <div class="flex items-center gap-2 mb-2">
        <Users size={16} class="text-accent" />
        <span class="text-sm font-semibold">Missão do time</span>
        <span class="ml-auto text-xs text-fg-muted">{fmtNum(missao.atual)} de {fmtNum(missao.alvo)} vendas ganhas</span>
      </div>
      <div class="h-3 rounded-full bg-surface-3 overflow-hidden">
        <div class="h-full rounded-full bg-gradient-to-r from-accent to-success" style={{ width: `${Math.min(100, missao.atingimento)}%` }} />
      </div>
      <div class="flex justify-between text-2xs text-fg-muted mt-1">
        <span>{fmtPct(missao.atingimento)} da meta da operação</span>
        <span>Projeção: {fmtNum(Math.round(missao.projecao))}</span>
      </div>
    </Card>
  )
}

// ── Filtros ──────────────────────────────────────────────────────────────

function Filtros({ dados, visao, funis, setFunis, teamId, setTeamId, userId, setUserId, origem, setOrigem }: {
  dados: PainelComercial | undefined; visao: VisaoComercial
  funis: number[]; setFunis: (v: number[]) => void
  teamId: number | null; setTeamId: (v: number | null) => void
  userId: number | null; setUserId: (v: number | null) => void
  origem: string | null; setOrigem: (v: string | null) => void
}) {
  const opcoes = dados?.filtros.funis ?? []
  const ativos = funis.length ? funis : opcoes.filter((f) => f.deVenda).map((f) => f.id)
  const alterna = (id: number) => {
    const novo = ativos.includes(id) ? ativos.filter((x) => x !== id) : [...ativos, id]
    setFunis(novo.length ? novo : [])
  }
  return (
    <div class="flex flex-wrap items-center gap-2">
      <Filter size={14} class="text-fg-muted" />
      {opcoes.map((f) => (
        <button key={f.id} onClick={() => alterna(f.id)} title={f.temMatricula ? undefined : 'Funil sem etapa de matrícula configurada'}
          class={cn('rounded-full border px-2.5 py-0.5 text-2xs transition-colors',
            ativos.includes(f.id) ? 'bg-accent/10 border-accent text-accent font-medium' : 'border-border text-fg-muted hover:text-fg')}>
          {f.nome}
        </button>
      ))}
      {visao !== 'agente' && (
        <>
          <select class="rounded-md border border-border bg-surface-2 px-2 py-1 text-2xs" value={teamId ?? ''}
            onChange={(e) => setTeamId(Number((e.target as HTMLSelectElement).value) || null)}>
            <option value="">Todas as equipes</option>
            {(dados?.filtros.equipes ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select class="rounded-md border border-border bg-surface-2 px-2 py-1 text-2xs" value={userId ?? ''}
            onChange={(e) => setUserId(Number((e.target as HTMLSelectElement).value) || null)}>
            <option value="">Todos os agentes</option>
            {(dados?.agentes ?? []).map((a) => <option key={a.userId} value={a.userId}>{a.nome}</option>)}
          </select>
        </>
      )}
      <select class="rounded-md border border-border bg-surface-2 px-2 py-1 text-2xs" value={origem ?? ''}
        onChange={(e) => setOrigem((e.target as HTMLSelectElement).value || null)}>
        <option value="">Todas as origens</option>
        {(dados?.filtros.origens ?? []).map((o) => <option key={o} value={o}>{leadSourceLabel(o)}</option>)}
      </select>
    </div>
  )
}

// ── Configuração (admin) ─────────────────────────────────────────────────

const PONTOS_ROTULO: Record<string, string> = {
  matricula: 'Por matrícula', pagamento: 'Por pagamento realizado', atendido: 'Por lead contatado',
  respostaRapida: '1ª resposta dentro da meta', atividade: 'Por atividade concluída',
}

function ConfigModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data } = useConfigPainelComercial(open)
  const salvar = useSalvarConfigPainelComercial()
  const [rascunho, setRascunho] = useState<ConfigPainelComercial['config'] | null>(null)
  const cfg: ConfigPainelComercial['config'] | null = rascunho ?? (data ? {
    funis: data.funis.filter((f) => f.deVenda).map((f) => f.id),
    etapasMatricula: Object.fromEntries(data.funis.map((f) => [String(f.id), f.matricula])),
    etapasPerda: Object.fromEntries(data.funis.map((f) => [String(f.id), f.perda])),
    pontos: data.config.pontos,
  } : null)
  const muda = (fn: (c: ConfigPainelComercial['config']) => ConfigPainelComercial['config']) => cfg && setRascunho(fn(cfg))
  const alternaEtapa = (campo: 'etapasMatricula' | 'etapasPerda', fid: number, key: string) => muda((c) => {
    const atual = c[campo][String(fid)] ?? []
    return { ...c, [campo]: { ...c[campo], [String(fid)]: atual.includes(key) ? atual.filter((k) => k !== key) : [...atual, key] } }
  })
  return (
    <Modal open={open} onOpenChange={(v) => { if (!v) setRascunho(null); onOpenChange(v) }} size="xl"
      title="Configurar as telas do comercial"
      description="Quais funis são de venda, qual etapa significa Matriculado (e Perdido) em cada um, e quanto vale cada ação no placar."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button disabled={!cfg || salvar.isPending} onClick={async () => {
          if (!cfg) return
          try { await salvar.mutateAsync(cfg); toast('Configuração salva', 'success'); setRascunho(null); onOpenChange(false) }
          catch { toast('Não foi possível salvar', 'danger') }
        }}>Salvar</Button>
      </>}>
      {!data || !cfg ? <Skeleton class="h-40 w-full" /> : (
        <div class="space-y-4">
          {data.funis.map((f) => {
            const deVenda = (cfg.funis ?? []).includes(f.id)
            return (
              <div key={f.id} class="rounded-lg border border-border p-3">
                <label class="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={deVenda}
                    onChange={() => muda((c) => ({ ...c, funis: deVenda ? (c.funis ?? []).filter((x) => x !== f.id) : [...(c.funis ?? []), f.id] }))} />
                  {f.nome}
                  <span class="text-2xs text-fg-muted font-normal">{deVenda ? 'entra no painel por padrão' : 'fora do padrão (dá para marcar no filtro)'}</span>
                </label>
                <div class="mt-2 grid gap-2 md:grid-cols-2">
                  {(['etapasMatricula', 'etapasPerda'] as const).map((campo) => (
                    <div key={campo}>
                      <div class="text-3xs uppercase tracking-wider text-fg-muted mb-1">{campo === 'etapasMatricula' ? 'Etapa de matrícula' : 'Etapa de perda'}</div>
                      <div class="flex flex-wrap gap-1">
                        {f.etapas.map((s) => {
                          const on = (cfg[campo][String(f.id)] ?? []).includes(s.key)
                          return (
                            <button key={s.key} onClick={() => alternaEtapa(campo, f.id, s.key)}
                              class={cn('rounded-full border px-2 py-0.5 text-2xs',
                                on ? (campo === 'etapasMatricula' ? 'bg-success/15 border-success text-success' : 'bg-danger/10 border-danger text-danger') : 'border-border text-fg-muted')}>
                              {s.nome}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          <div class="rounded-lg border border-border p-3">
            <div class="text-sm font-medium mb-2">Pontos do placar</div>
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.keys(data.pontosPadrao).map((k) => (
                <label key={k} class="flex items-center justify-between gap-2 text-xs">
                  <span>{PONTOS_ROTULO[k] ?? k}</span>
                  <input type="number" min={0} max={1000} class="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 text-right"
                    value={cfg.pontos[k] ?? data.pontosPadrao[k]}
                    onInput={(e) => muda((c) => ({ ...c, pontos: { ...c.pontos, [k]: Number((e.target as HTMLInputElement).value) || 0 } }))} />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Visões ───────────────────────────────────────────────────────────────

function Quebras({ d }: { d: PainelComercial }) {
  return (
    <div class="grid gap-3 lg:grid-cols-3">
      <Card>
        <div class="text-xs font-semibold mb-2">Origem dos leads → matrícula</div>
        <Barras vazio="Sem leads no período"
          itens={d.porOrigem.map((o) => ({ nome: leadSourceLabel(o.nome), valor: o.leads, extra: `${o.matriculas} mat · ${fmtPct(o.conversao)}` }))} />
      </Card>
      <Card>
        <div class="text-xs font-semibold mb-2">Pagamentos por curso</div>
        <Barras vazio="Sem pagamentos no período" cor="var(--color-violet)"
          itens={d.porCurso.map((c) => ({ nome: c.nome, valor: c.pagamentos, ...(d.visao !== 'agente' || c.receita ? { extra: fmtMoeda(c.receita) } : {}) }))} />
      </Card>
      <Card>
        <div class="text-xs font-semibold mb-2">Motivos de perda</div>
        <Barras vazio="Nenhuma perda no período" cor="var(--color-danger)"
          itens={d.motivosDePerda.map((m) => ({ nome: m.nome, valor: m.c }))} />
      </Card>
    </div>
  )
}

function Projecao({ d, mostrarReceita }: { d: PainelComercial; mostrarReceita: boolean }) {
  if (!d.projecao) return null
  const restam = d.periodo.dias - d.periodo.decorridos
  return (
    <Card>
      <div class="flex items-center gap-2 flex-wrap text-xs">
        <Sparkles size={16} class="text-accent" />
        <span class="font-semibold">No ritmo atual, o período fecha com</span>
        <span class="rounded-md bg-success/10 text-success px-2 py-0.5 font-semibold">{fmtNum(d.projecao.matriculas)} matrículas</span>
        <span class="rounded-md bg-violet/10 px-2 py-0.5 font-semibold" style={{ color: 'var(--color-violet)' }}>{fmtNum(d.projecao.pagamentos)} pagamentos</span>
        {mostrarReceita && <span class="rounded-md bg-accent/10 text-accent px-2 py-0.5 font-semibold">{fmtMoeda(d.projecao.receita)}</span>}
        <span class="text-fg-muted ml-auto">{d.periodo.decorridos} de {d.periodo.dias} dias · faltam {restam}</span>
      </div>
    </Card>
  )
}

function VisaoGestao({ d, carregando, onAgente }: { d: PainelComercial | undefined; carregando: boolean; onAgente: (id: number) => void }) {
  if (!d) return <Skeleton class="h-96 w-full" />
  const gerente = d.visao === 'gerente'
  const blocoFila = (
    <Secao titulo="Fila de agora" sub="Não depende do período: o que precisa de ação hoje. Clique para abrir.">
      <Fila fila={d.fila} semResponsavel={d.semResponsavel} />
    </Secao>
  )
  return (
    <div class="space-y-5">
      {gerente && blocoFila}
      <Secao titulo="Resultado do período" sub="Comparado com o período anterior de mesma duração.">
        <LinhaDeKpis k={d.kpis} a={d.anterior} serie={d.serie} metaMin={d.metaDeRespostaMin} carregando={carregando} mostrarReceita />
      </Secao>
      <Projecao d={d} mostrarReceita />
      {d.missao && <Missao missao={d.missao} />}
      {!gerente && blocoFila}
      <Secao titulo="Dia a dia">
        <Card><SerieDiaria serie={d.serie} /></Card>
      </Secao>
      <Secao titulo={gerente ? 'Equipe, agente a agente' : 'Time comercial'} sub="Clique no nome para filtrar a tela por agente. Ordene clicando no cabeçalho.">
        <TabelaDoTime agentes={d.agentes} media={d.mediaDoTime} mostrarReceita onAgente={onAgente} />
      </Secao>
      <Secao titulo="Funil etapa a etapa" sub="Agora = leads na etapa hoje · No período = passaram por ela · → Matrícula = desses, quantos se matricularam.">
        <div class="grid gap-3 xl:grid-cols-2">
          {d.funil.map((f) => <FunilDetalhado key={f.id} funil={f} />)}
        </div>
      </Secao>
      <Quebras d={d} />
      <div class="grid gap-3 lg:grid-cols-2">
        <Placar agentes={d.agentes} destaque={false} />
        {d.mediaDoTime && (
          <Card>
            <div class="text-xs font-semibold mb-3">Média do time</div>
            <div class="grid grid-cols-2 gap-3 text-center">
              <div><div class="text-xl font-bold tabular">{fmtPct(d.mediaDoTime.conversao)}</div><div class="text-2xs text-fg-muted">Conversão</div></div>
              <div><div class="text-xl font-bold tabular">{fmtMin(d.mediaDoTime.tempoResposta)}</div><div class="text-2xs text-fg-muted">1ª resposta</div></div>
              <div><div class="text-xl font-bold tabular">{fmtNum(d.mediaDoTime.matriculas)}</div><div class="text-2xs text-fg-muted">Matrículas por agente</div></div>
              <div><div class="text-xl font-bold tabular">{fmtNum(Math.round(d.mediaDoTime.pontos))}</div><div class="text-2xs text-fg-muted">Pontos por agente</div></div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function VisaoAgente({ d, carregando }: { d: PainelComercial | undefined; carregando: boolean }) {
  const [, navigate] = useLocation()
  if (!d) return <Skeleton class="h-96 w-full" />
  const eu = d.eu
  const ranking = [...d.agentes].sort((a, b) => b.pontos - a.pontos)
  const posicao = eu ? ranking.findIndex((l) => l.userId === eu.userId) + 1 : 0
  const acima = posicao > 1 ? ranking[posicao - 2] : null
  const restam = Math.max(0, d.periodo.dias - d.periodo.decorridos)
  const meta = eu?.meta
  const falta = meta?.alvo != null && meta.atual != null ? Math.max(0, meta.alvo - meta.atual) : null
  const porDia = falta != null && restam > 0 ? falta / restam : null
  const unidade = (v: number | null | undefined) => (meta?.metrica === 'revenue' ? fmtMoeda(v) : meta?.metrica === 'conversion' ? fmtPct(v) : fmtNum(v))
  const nomeMeta = meta?.metrica === 'revenue' ? 'receita' : meta?.metrica === 'conversion' ? 'conversão' : 'vendas ganhas'

  return (
    <div class="space-y-5">
      {/* Herói: posição, pontos, conquistas */}
      <Card class="bg-gradient-to-br from-accent/10 via-surface-2 to-surface-2">
        <div class="flex flex-wrap items-center gap-5">
          <Anel pct={meta?.atingimento ?? 0} tamanho={112} cor={meta?.atingimento != null && meta.atingimento >= 100 ? 'var(--color-success)' : 'var(--color-accent)'}>
            {meta ? (<>
              <div class="text-xl font-extrabold tabular">{fmtPct(meta.atingimento)}</div>
              <div class="text-3xs text-fg-muted">da meta</div>
            </>) : (<>
              <div class="text-xl font-extrabold tabular">{fmtNum(eu?.matriculas ?? 0)}</div>
              <div class="text-3xs text-fg-muted">matrículas</div>
            </>)}
          </Anel>
          <div class="flex-1 min-w-[220px] space-y-1">
            <div class="text-lg font-bold">Olá, {eu?.nome.split(' ')[0] ?? 'tudo bem'}!</div>
            <div class="flex items-center gap-2 text-sm">
              <Trophy size={16} class="text-warning" />
              {posicao ? <span><b>{posicao}º</b> de {ranking.length} no placar · <b>{fmtNum(eu?.pontos)}</b> pontos</span> : <span>Sem pontos ainda neste período</span>}
            </div>
            {acima && eu && (
              <div class="text-xs text-fg-muted">
                Faltam <b class="text-fg">{fmtNum(acima.pontos - eu.pontos + 1)} pontos</b> para passar {acima.nome.split(' ')[0]} — uma matrícula vale {d.pontos['matricula'] ?? 10}.
              </div>
            )}
            {posicao === 1 && <div class="text-xs text-success font-medium">Você lidera o time. Segure a posição!</div>}
            {meta && falta != null && (
              <div class="text-xs text-fg-muted">
                Meta de {nomeMeta}: {unidade(meta.atual)} de {unidade(meta.alvo)}
                {falta > 0 && restam > 0 && porDia != null ? <> · faltam <b class="text-fg">{unidade(falta)}</b> ({unidade(Math.ceil(porDia * 10) / 10)} por dia)</> : null}
                {meta.projecao != null && <> · projeção {unidade(meta.projecao)}</>}
              </div>
            )}
            {eu?.comissaoPrevista ? <div class="text-xs text-fg-muted">Comissão do mês: <b class="text-fg">{fmtMoeda(eu.comissaoPrevista)}</b></div> : null}
          </div>
          <div class="flex flex-wrap gap-1.5 max-w-sm">
            {(eu?.conquistas ?? []).map((c) => <Conquista key={c} k={c} />)}
            {eu && eu.sequencia > 0 && !eu.conquistas.includes('sequencia') && (
              <span class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-2xs text-fg-muted"><Flame size={14} />{eu.sequencia} dia(s) seguidos</span>
            )}
            {!eu?.conquistas.length && <span class="text-2xs text-fg-muted">Conquistas aparecem aqui: resposta rápida, 5 matrículas, meta batida, sequência…</span>}
          </div>
        </div>
      </Card>

      {/* Meu dia */}
      <Secao titulo="Meu dia" sub="O que precisa de você agora.">
        <div class="grid gap-2 grid-cols-2 md:grid-cols-4">
          {[
            { r: 'Esperando sua resposta', v: d.fila.semResposta, i: <Inbox size={16} />, ir: '/conversations' },
            { r: 'Atividades atrasadas', v: d.fila.atrasadas, i: <ListChecks size={16} />, ir: '/activities' },
            { r: 'Leads parados', v: d.fila.parados, i: <AlertTriangle size={16} />, ir: '/kanban' },
            { r: 'Leads em andamento', v: d.fila.ativos, i: <Users size={16} />, ir: '/kanban' },
          ].map((x) => (
            <button key={x.r} onClick={() => navigate(x.ir)}
              class={cn('flex items-center gap-3 rounded-lg border p-3 text-left hover:bg-surface', x.v > 0 && x.r !== 'Leads em andamento' ? 'border-warning/50 bg-warning/5' : 'border-border bg-surface-2')}>
              <span class={x.v > 0 && x.r !== 'Leads em andamento' ? 'text-warning' : 'text-fg-muted'}>{x.i}</span>
              <span><span class="block text-lg font-bold tabular leading-none">{fmtNum(x.v)}</span><span class="block text-2xs text-fg-muted mt-1">{x.r}</span></span>
            </button>
          ))}
        </div>
      </Secao>

      <Secao titulo="Meus números" sub="Comparados com o período anterior.">
        <LinhaDeKpis k={d.kpis} a={d.anterior} serie={d.serie} metaMin={d.metaDeRespostaMin} carregando={carregando} mostrarReceita />
        {d.mediaDoTime && eu && (
          <div class="flex flex-wrap gap-3 text-2xs text-fg-muted">
            <span>Sua conversão {fmtPct(eu.conversao)} × time {fmtPct(d.mediaDoTime.conversao)}</span>
            <span>Sua 1ª resposta {fmtMin(eu.tempoResposta)} × time {fmtMin(d.mediaDoTime.tempoResposta)}</span>
            <span>Suas matrículas {fmtNum(eu.matriculas)} × média {fmtNum(d.mediaDoTime.matriculas)}</span>
          </div>
        )}
      </Secao>

      {d.missao && <Missao missao={d.missao} />}

      <div class="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Placar agentes={d.agentes} destaque />
        <Card>
          <div class="flex items-center gap-2 mb-2"><Award size={16} class="text-warning" /><span class="text-sm font-semibold">Como ganhar pontos</span></div>
          <ul class="space-y-1.5 text-xs">
            {Object.entries(d.pontos).filter(([, v]) => v > 0).map(([k, v]) => (
              <li key={k} class="flex justify-between gap-2"><span>{PONTOS_ROTULO[k] ?? k}</span><b class="tabular">+{v}</b></li>
            ))}
          </ul>
          <div class="mt-3 pt-3 border-t border-border space-y-1">
            {Object.entries(CONQUISTAS).map(([k, c]) => (
              <div key={k} class="flex items-center gap-2 text-2xs">
                <span style={{ color: c.cor }}>{c.icone}</span><b>{c.nome}</b><span class="text-fg-muted">{c.dica}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Secao titulo="Meu funil" sub="Onde estão os seus leads e quantos chegam à matrícula a partir de cada etapa.">
        <div class="grid gap-3 xl:grid-cols-2">
          {d.funil.map((f) => <FunilDetalhado key={f.id} funil={f} />)}
        </div>
      </Secao>
      <Quebras d={d} />
    </div>
  )
}

// ── Tela ─────────────────────────────────────────────────────────────────

const TITULOS: Record<VisaoComercial, string> = { diretoria: 'Comercial · Visão geral', gerente: 'Comercial · Minha equipe', agente: 'Meu painel' }

export function PainelComercialHome({ visao, titulo }: { visao: VisaoComercial; titulo?: string }) {
  const user = useUserStore((s) => s.user)
  const admin = user?.role === 'SUPERADMIN' || user?.role === 'ADMIN'
  const { range, preset, customFrom, customTo, setPreset, setCustom } = usePeriod(`home-comercial-${visao}`)
  const [funis, setFunis] = useState<number[]>([])
  const [teamId, setTeamId] = useState<number | null>(null)
  const [userId, setUserId] = useState<number | null>(null)
  const [origem, setOrigem] = useState<string | null>(null)
  const [config, setConfig] = useState(false)

  const { data, isLoading, isFetching, error } = usePainelComercial({
    dateFrom: range.dateFrom, dateTo: range.dateTo, funis, teamId, userId, origem, visao: admin ? visao : undefined,
  })
  const semMatricula = data?.funisNoRecorte.filter((f) => f.semEtapaDeMatricula) ?? []

  return (
    <Page title={titulo || TITULOS[visao]}
      actions={
        <div class="flex items-center gap-2">
          {isFetching && !isLoading && <span class="text-2xs text-fg-muted">atualizando…</span>}
          <PeriodPicker preset={preset} customFrom={customFrom} customTo={customTo} onPreset={setPreset} onCustom={setCustom} label="Período" />
          {admin && <Button variant="ghost" size="sm" onClick={() => setConfig(true)} title="Funis, etapa de matrícula e pontos"><Settings size={16} /></Button>}
        </div>
      }>
      <div class="space-y-4">
        <PeriodIncompleteHint show={range.incomplete} />
        <Filtros dados={data} visao={visao} funis={funis} setFunis={setFunis} teamId={teamId} setTeamId={setTeamId}
          userId={userId} setUserId={setUserId} origem={origem} setOrigem={setOrigem} />
        {error && (
          <Card><div class="text-xs text-danger flex items-center gap-2"><XCircle size={16} />
            Não foi possível carregar o painel. Se persistir, peça a um administrador para conferir a tela inicial atribuída ao seu perfil.
          </div></Card>
        )}
        {semMatricula.length > 0 && (
          <Card><div class="text-xs text-warning flex items-center gap-2"><AlertTriangle size={16} />
            {semMatricula.map((f) => f.nome).join(', ')}: sem etapa de matrícula definida — matrículas desses funis não aparecem.
            {admin && <button class="underline" onClick={() => setConfig(true)}>Configurar</button>}
          </div></Card>
        )}
        {visao === 'agente'
          ? <VisaoAgente d={data} carregando={isLoading} />
          : <VisaoGestao d={data} carregando={isLoading} onAgente={(id) => setUserId(id)} />}
      </div>
      {admin && <ConfigModal open={config} onOpenChange={setConfig} />}
    </Page>
  )
}
