// Inadimplência e acordos: quem está em atraso, o que foi tratado e o que foi renegociado.
// Junta portal e acadêmico (backend: services/inadimplencia). Cobrar parte sempre do
// agente: o texto vai para a caixa da conversa, e nada é enviado sozinho.
import { useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, Download, Handshake, MessageSquare, PhoneOff, RefreshCw, Users, Wallet } from 'lucide-preact'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { useCan } from '@/hooks/usePermissions'
import { pedirRascunho } from '@/lib/rascunhoDaConversa'

const BASE = '/admin/inadimplencia'
const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const reais = (s: string) => { const n = Number(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const erroToast = (e: unknown) => toast((e as Error).message, 'danger')

interface Resumo {
  totalVencido: number; totalAtualizado: number; encargos: number; titulos: number; devedores: number; ticketMedio: number
  aging: Array<{ id: string; rotulo: string; qtd: number; valor: number; devedores: number }>
  porPortal: Array<{ portal: string; valor: number; qtd: number }>
  aVencer7Dias: { valor: number; qtd: number }
  acordos: { ativos: number; valorAtivo: number; quitados: number; cancelados: number; emAtraso: number; recuperado30d: number; pagamentos30d: number }
  aConferir: Array<{ id: number; nome: string; leadId: number | null; codigo: string; valor: number; motivo: string | null; em: string }>
  promessasVencidas: number; semContato: number
}
interface Devedor {
  leadId: number; nome: string; whatsapp: string | null; email: string | null; cursos: string[]; portais: string[]
  qtd: number; valor: number; atualizado: number; maiorAtraso: number; vencimentoMaisAntigo: string
  ultimoContato: { em: string; canal: string; resultado: string; por: string | null } | null
  promessa: { para: string; quebrada: boolean } | null; acordoAtivo: boolean
}
interface Item { chave: string; fonte: string; registrationId: number | null; codigo: string | null; titulo: string; curso: string | null; portal: string | null; meio: string | null; vencimento: string; diasAtraso: number; valor: number; multa: number; juros: number; atualizado: number; link: string | null }
interface Detalhe {
  lead: { id: number; nome: string | null; whatsapp: string | null; email: string | null }
  vencidos: Item[]; aVencer: Item[]
  contatos: Array<{ id: number; canal: string; resultado: string; promessaPara: string | null; nota: string | null; por: string | null; em: string }>
  acordos: Array<{ id: number; status: string; total: number; entrada: number; numParcelas: number; observacao: string | null; por: string | null; em: string; pagamentos: Array<{ id: number; ordem: number; meio: string; valor: number; vencimento: string; status: string; link: string | null; erro: string | null }> }>
}
interface AcordoLinha { id: number; fonte: 'portal' | 'academico'; nome: string; leadId: number | null; status: string; original: number; encargos: number; desconto: number; total: number; entrada: number; numParcelas: number; pago: number; emAtraso: boolean; podeCancelar: boolean; por: string | null; em: string; observacao: string | null }
interface Simulacao { original: number; encargos: number; desconto: number; total: number; entrada: number; parcelas: number[] }

const CANAL: Record<string, string> = { whatsapp: 'WhatsApp', telefone: 'Telefone', email: 'E-mail', presencial: 'Presencial', outro: 'Outro' }
const RESULTADO: Record<string, string> = { promessa_pagamento: 'Prometeu pagar', sem_resposta: 'Sem resposta', recado: 'Deixou recado', negociando: 'Negociando', recusou: 'Recusou', numero_errado: 'Número errado', pagou: 'Disse que pagou', outro: 'Outro' }
const SIT_ACORDO: Record<string, { rotulo: string; tom: 'success' | 'info' | 'neutral' }> = { ATIVO: { rotulo: 'Ativo', tom: 'info' }, QUITADO: { rotulo: 'Quitado', tom: 'success' }, CANCELADO: { rotulo: 'Cancelado', tom: 'neutral' } }

function Indicador({ icone, rotulo, valor, dica }: { icone: any; rotulo: string; valor: string; dica?: string }) {
  return (
    <Card class="space-y-1">
      <div class="flex items-center gap-2 text-fg-muted text-xs">{icone}<span>{rotulo}</span></div>
      <div class="text-xl font-semibold text-fg tabular-nums">{valor}</div>
      {dica && <div class="text-[11px] text-fg-subtle">{dica}</div>}
    </Card>
  )
}

/** Barras de uma cor só, com o valor escrito: a linha é a própria tabela. */
function Barras({ linhas, aoClicar }: { linhas: Array<{ id: string; rotulo: string; valor: number; qtd: number }>; aoClicar?: (id: string) => void }) {
  const maior = Math.max(1, ...linhas.map((l) => l.valor))
  return (
    <div class="grid gap-2">
      {linhas.map((l) => (
        <button key={l.id} type="button" disabled={!aoClicar} title={`${l.rotulo}: ${money(l.valor)} em ${l.qtd} título(s)`} onClick={() => aoClicar?.(l.id)} class="text-left rounded px-1 py-0.5 enabled:hover:bg-surface-2">
          <div class="flex items-baseline justify-between gap-3 text-xs">
            <span class="text-fg">{l.rotulo}</span>
            <span class="text-fg-muted tabular-nums">{money(l.valor)} · {l.qtd}</span>
          </div>
          <div class="h-1.5 mt-1 rounded bg-surface-2 overflow-hidden"><div class="h-full rounded-r bg-accent" style={`width:${l.valor > 0 ? Math.max(2, (l.valor / maior) * 100) : 0}%`} /></div>
        </button>
      ))}
    </div>
  )
}

export function InadimplenciaPage() {
  const [aba, setAba] = useState<'painel' | 'devedores' | 'acordos' | 'regras'>('painel')
  const [faixa, setFaixa] = useState('')
  const [portal, setPortal] = useState('')
  const [situacao, setSituacao] = useState('')
  const [aberto, setAberto] = useState<number | null>(null)
  const qc = useQueryClient()
  const resumo = useQuery({ queryKey: ['inad-resumo'], queryFn: () => api.get<Resumo>(`${BASE}/resumo`) })
  const r = resumo.data
  const irPara = (f: { faixa?: string; portal?: string; situacao?: string }) => { setFaixa(f.faixa ?? ''); setPortal(f.portal ?? ''); setSituacao(f.situacao ?? ''); setAba('devedores') }
  const ABAS = [['painel', 'Painel'], ['devedores', `Devedores${r ? ` (${r.devedores})` : ''}`], ['acordos', `Acordos${r ? ` (${r.acordos.ativos})` : ''}`], ['regras', 'Regras']] as const
  return (
    <Page title="Inadimplência e acordos" description="Quem está em atraso, o que já foi tratado e o que foi renegociado, no portal e no acadêmico."
      actions={<Button size="sm" variant="ghost" onClick={() => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('inad-') })}><RefreshCw size={14} /> Atualizar</Button>}>
      <div role="tablist" class="flex gap-1 border-b border-border overflow-x-auto">
        {ABAS.map(([id, rotulo]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
            class={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-[1px] ${aba === id ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:text-fg'}`}>{rotulo}</button>
        ))}
      </div>
      {aba === 'painel' && (resumo.isLoading || !r ? <Skeleton class="h-64" /> : <Painel r={r} irPara={irPara} />)}
      {aba === 'devedores' && <Devedores faixa={faixa} setFaixa={setFaixa} portal={portal} setPortal={setPortal} situacao={situacao} setSituacao={setSituacao} portais={r?.porPortal.map((p) => p.portal) ?? []} aging={r?.aging ?? []} abrir={setAberto} />}
      {aba === 'acordos' && <Acordos abrir={setAberto} />}
      {aba === 'regras' && <Regras />}
      {aberto != null && <FichaDoDevedor leadId={aberto} fechar={() => setAberto(null)} />}
    </Page>
  )
}

function AConferir({ itens }: { itens: Resumo['aConferir'] }) {
  const qc = useQueryClient()
  const pode = useCan('edu_inadimplencia', 'edit')
  const [item, setItem] = useState<Resumo['aConferir'][number] | null>(null)
  const [nota, setNota] = useState('')
  const m = useMutation({
    mutationFn: () => api.post(`${BASE}/conferir/${item!.id}`, { nota }),
    onSuccess: () => { toast('Marcado como conferido.', 'success'); setItem(null); setNota(''); void qc.invalidateQueries({ queryKey: ['inad-resumo'] }) },
    onError: erroToast,
  })
  if (!itens.length) return null
  return (
    <Card>
      <div class="flex items-center gap-2 text-xs font-semibold uppercase text-fg-muted mb-2"><AlertTriangle size={14} /> Pagamentos a conferir ({itens.length})</div>
      <ul class="grid gap-2 text-sm">{itens.map((i) => (
        <li key={i.id} class="flex flex-wrap items-center justify-between gap-2 border-b border-border last:border-0 pb-2 last:pb-0">
          <div><div class="text-fg">{i.nome} · {i.codigo} · <span class="tabular-nums">{money(i.valor)}</span></div><div class="text-xs text-fg-muted">{i.motivo}</div></div>
          {pode && <Button size="sm" variant="secondary" onClick={() => setItem(i)}>Marcar como conferido</Button>}
        </li>
      ))}</ul>
      <Modal open={!!item} onOpenChange={(o) => { if (!o) setItem(null) }} title="Como foi tratado?" size="sm"
        footer={<><Button variant="ghost" size="sm" onClick={() => setItem(null)}>Voltar</Button><Button variant="primary" size="sm" disabled={m.isPending || nota.trim().length < 3} onClick={() => m.mutate()}>Salvar</Button></>}>
        <Textarea label="Anotação" rows={2} value={nota} onInput={(e) => setNota((e.target as HTMLTextAreaElement).value)} />
      </Modal>
    </Card>
  )
}

function Painel({ r, irPara }: { r: Resumo; irPara: (f: { faixa?: string; portal?: string; situacao?: string }) => void }) {
  return (
    <div class="grid gap-3">
      <AConferir itens={r.aConferir} />
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Indicador icone={<AlertTriangle size={14} />} rotulo="Total vencido" valor={money(r.totalVencido)} dica={`${money(r.totalAtualizado)} com multa e juros`} />
        <Indicador icone={<Users size={14} />} rotulo="Devedores" valor={String(r.devedores)} dica={`${r.titulos} título(s) · média de ${money(r.ticketMedio)}`} />
        <Indicador icone={<CalendarClock size={14} />} rotulo="A vencer em 7 dias" valor={money(r.aVencer7Dias.valor)} dica={`${r.aVencer7Dias.qtd} título(s)`} />
        <Indicador icone={<Wallet size={14} />} rotulo="Recuperado em 30 dias" valor={money(r.acordos.recuperado30d)} dica={`${r.acordos.pagamentos30d} pagamento(s) de acordo`} />
      </div>
      <div class="grid lg:grid-cols-2 gap-3">
        <Card>
          <div class="text-xs font-semibold uppercase text-fg-muted mb-2">Tempo de atraso</div>
          <Barras linhas={r.aging} aoClicar={(id) => irPara({ faixa: id })} />
        </Card>
        <Card>
          <div class="text-xs font-semibold uppercase text-fg-muted mb-2">Vencido por origem</div>
          {r.porPortal.length ? <Barras linhas={r.porPortal.map((p) => ({ id: p.portal, rotulo: p.portal, valor: p.valor, qtd: p.qtd }))} aoClicar={(id) => irPara({ portal: id })} /> : <div class="text-sm text-fg-muted">Nada vencido.</div>}
        </Card>
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button type="button" class="text-left" onClick={() => irPara({ situacao: 'sem_contato' })}><Indicador icone={<PhoneOff size={14} />} rotulo="Sem contato" valor={String(r.semContato)} dica="devedores ainda não procurados" /></button>
        <button type="button" class="text-left" onClick={() => irPara({ situacao: 'promessa_quebrada' })}><Indicador icone={<AlertTriangle size={14} />} rotulo="Promessas vencidas" valor={String(r.promessasVencidas)} dica="a data prometida já passou" /></button>
        <Indicador icone={<Handshake size={14} />} rotulo="Acordos ativos" valor={String(r.acordos.ativos)} dica={`${money(r.acordos.valorAtivo)} · ${r.acordos.emAtraso} em atraso`} />
        <Indicador icone={<Handshake size={14} />} rotulo="Acordos quitados" valor={String(r.acordos.quitados)} dica={`${r.acordos.cancelados} cancelado(s)`} />
      </div>
    </div>
  )
}

function Devedores(p: { faixa: string; setFaixa: (v: string) => void; portal: string; setPortal: (v: string) => void; situacao: string; setSituacao: (v: string) => void; portais: string[]; aging: Resumo['aging']; abrir: (id: number) => void }) {
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState('atraso')
  const qs = useMemo(() => {
    const s = new URLSearchParams()
    if (busca.trim()) s.set('q', busca.trim())
    if (p.faixa) s.set('faixa', p.faixa)
    if (p.portal) s.set('portal', p.portal)
    if (p.situacao) s.set('situacao', p.situacao)
    s.set('ordem', ordem)
    return s.toString()
  }, [busca, p.faixa, p.portal, p.situacao, ordem])
  const q = useQuery({ queryKey: ['inad-devedores', qs], queryFn: () => api.get<{ devedores: Devedor[] }>(`${BASE}/devedores?${qs}`) })
  const exportar = async () => {
    const token = localStorage.getItem(env.authTokenKey)
    const r = await fetch(`${env.apiBase}${BASE}/devedores.csv?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' })
    if (!r.ok) { toast('Não foi possível exportar.', 'danger'); return }
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a'); a.href = url; a.download = 'inadimplencia.csv'; a.click(); URL.revokeObjectURL(url)
  }
  const lista = q.data?.devedores ?? []
  return (
    <div class="grid gap-3">
      <Card>
        <div class="flex flex-wrap items-end gap-2">
          <div class="w-64"><Input label="Buscar" placeholder="Nome, WhatsApp, e-mail ou curso" value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)} /></div>
          <div class="w-40"><Select label="Atraso" value={p.faixa} onChange={(e) => p.setFaixa((e.target as HTMLSelectElement).value)}><option value="">Todos</option>{p.aging.map((a) => <option key={a.id} value={a.id}>{a.rotulo}</option>)}</Select></div>
          <div class="w-52"><Select label="Origem" value={p.portal} onChange={(e) => p.setPortal((e.target as HTMLSelectElement).value)}><option value="">Todas</option>{p.portais.map((x) => <option key={x} value={x}>{x}</option>)}</Select></div>
          <div class="w-44"><Select label="Situação" value={p.situacao} onChange={(e) => p.setSituacao((e.target as HTMLSelectElement).value)}>
            <option value="">Todas</option><option value="sem_contato">Sem contato</option><option value="promessa">Com promessa</option><option value="promessa_quebrada">Promessa vencida</option><option value="acordo">Com acordo ativo</option>
          </Select></div>
          <div class="w-40"><Select label="Ordenar por" value={ordem} onChange={(e) => setOrdem((e.target as HTMLSelectElement).value)}><option value="atraso">Maior atraso</option><option value="valor">Maior valor</option><option value="nome">Nome</option></Select></div>
          <Button size="sm" variant="secondary" onClick={() => void exportar()}><Download size={14} /> Exportar CSV</Button>
        </div>
      </Card>
      <Card class="p-0">
        <div class="overflow-x-auto">
          <table class="w-full text-sm min-w-[56rem]">
            <thead><tr class="text-left text-xs text-fg-subtle border-b border-border">
              <th class="px-3 py-2 font-medium">Devedor</th><th class="px-2 py-2 font-medium">Curso</th><th class="px-2 py-2 font-medium text-right">Vencido</th><th class="px-2 py-2 font-medium text-right">Atualizado</th>
              <th class="px-2 py-2 font-medium text-right">Atraso</th><th class="px-2 py-2 font-medium">Último contato</th><th class="px-2 py-2 font-medium">Situação</th>
            </tr></thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={7} class="p-3"><Skeleton class="h-24" /></td></tr>}
              {!q.isLoading && !lista.length && <tr><td colSpan={7} class="p-6 text-center text-fg-muted">Nenhum devedor com estes filtros.</td></tr>}
              {lista.map((d) => (
                <tr key={d.leadId} class="border-b border-border last:border-0 cursor-pointer hover:bg-surface-2" onClick={() => p.abrir(d.leadId)}>
                  <td class="px-3 py-2"><div class="text-fg font-medium">{d.nome}</div><div class="text-xs text-fg-muted">{d.whatsapp ?? d.email ?? 'Sem contato cadastrado'}</div></td>
                  <td class="px-2 py-2 text-xs text-fg-muted">{d.cursos.join(', ') || '—'}<div class="text-fg-subtle">{d.portais.join(', ')}</div></td>
                  <td class="px-2 py-2 text-right tabular-nums">{money(d.valor)}<div class="text-xs text-fg-muted">{d.qtd} título(s)</div></td>
                  <td class="px-2 py-2 text-right tabular-nums">{money(d.atualizado)}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{d.maiorAtraso} d</td>
                  <td class="px-2 py-2 text-xs">{d.ultimoContato ? <>{RESULTADO[d.ultimoContato.resultado] ?? d.ultimoContato.resultado}<div class="text-fg-muted">{dia(d.ultimoContato.em)} · {CANAL[d.ultimoContato.canal] ?? d.ultimoContato.canal}</div></> : <span class="text-fg-muted">Nenhum</span>}</td>
                  <td class="px-2 py-2"><div class="flex flex-wrap gap-1">
                    {d.acordoAtivo && <Badge tone="info">Acordo</Badge>}
                    {d.promessa && <Badge tone={d.promessa.quebrada ? 'danger' : 'warning'}>{d.promessa.quebrada ? 'Promessa vencida' : `Promessa ${dia(d.promessa.para)}`}</Badge>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Acordos({ abrir }: { abrir: (id: number) => void }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [cancelar, setCancelar] = useState<AcordoLinha | null>(null)
  const [motivo, setMotivo] = useState('')
  const pode = useCan('edu_inadimplencia', 'edit')
  const q = useQuery({ queryKey: ['inad-acordos', status], queryFn: () => api.get<{ acordos: AcordoLinha[] }>(`${BASE}/acordos${status ? `?status=${status}` : ''}`) })
  const m = useMutation({
    mutationFn: () => api.post(`${BASE}/acordos/${cancelar!.id}/cancelar`, { motivo }),
    onSuccess: () => { toast('Acordo cancelado. Os títulos voltaram a ser dívida.', 'success'); setCancelar(null); setMotivo(''); void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('inad-') }) },
    onError: erroToast,
  })
  const lista = q.data?.acordos ?? []
  return (
    <div class="grid gap-3">
      <div class="w-44"><Select label="Situação" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}><option value="">Todos</option><option value="ATIVO">Ativos</option><option value="QUITADO">Quitados</option><option value="CANCELADO">Cancelados</option></Select></div>
      <Card class="p-0">
        <div class="overflow-x-auto">
          <table class="w-full text-sm min-w-[52rem]">
            <thead><tr class="text-left text-xs text-fg-subtle border-b border-border">
              <th class="px-3 py-2 font-medium">Acordo</th><th class="px-2 py-2 font-medium">Devedor</th><th class="px-2 py-2 font-medium text-right">Original</th><th class="px-2 py-2 font-medium text-right">Total</th>
              <th class="px-2 py-2 font-medium text-right">Recebido</th><th class="px-2 py-2 font-medium">Condição</th><th class="px-2 py-2 font-medium">Situação</th><th class="px-2 py-2" />
            </tr></thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={8} class="p-3"><Skeleton class="h-24" /></td></tr>}
              {!q.isLoading && !lista.length && <tr><td colSpan={8} class="p-6 text-center text-fg-muted">Nenhum acordo.</td></tr>}
              {lista.map((a) => (
                <tr key={`${a.fonte}-${a.id}`} class="border-b border-border last:border-0">
                  <td class="px-3 py-2">nº {a.id}<div class="text-xs text-fg-muted">{a.fonte === 'academico' ? 'Acadêmico' : 'Portal'} · {dia(a.em)}</div></td>
                  <td class="px-2 py-2">{a.leadId ? <button type="button" class="text-accent hover:underline text-left" onClick={() => abrir(a.leadId!)}>{a.nome}</button> : a.nome}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{money(a.original)}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{money(a.total)}{a.desconto > 0 && <div class="text-xs text-fg-muted">desconto {money(a.desconto)}</div>}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{a.fonte === 'portal' ? money(a.pago) : '—'}</td>
                  <td class="px-2 py-2 text-xs">{a.entrada > 0 ? `${money(a.entrada)} + ` : ''}{a.numParcelas}x<div class="text-fg-muted">{a.por}</div></td>
                  <td class="px-2 py-2"><div class="flex flex-wrap gap-1"><Badge tone={SIT_ACORDO[a.status]?.tom ?? 'neutral'}>{SIT_ACORDO[a.status]?.rotulo ?? a.status}</Badge>{a.emAtraso && <Badge tone="danger">Em atraso</Badge>}</div></td>
                  <td class="px-2 py-2 text-right">{pode && a.podeCancelar && <Button size="sm" variant="ghost" onClick={() => setCancelar(a)}>Cancelar</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={!!cancelar} onOpenChange={(o) => { if (!o) setCancelar(null) }} title={`Cancelar o acordo nº ${cancelar?.id ?? ''}?`} size="sm"
        footer={<><Button variant="ghost" size="sm" onClick={() => setCancelar(null)}>Voltar</Button><Button variant="danger" size="sm" disabled={m.isPending || motivo.trim().length < 3} onClick={() => m.mutate()}>Cancelar acordo</Button></>}>
        <p class="text-sm text-fg-muted mb-3">As cobranças do acordo serão canceladas e os títulos originais voltam a aparecer como dívida.</p>
        <Textarea label="Motivo" rows={2} value={motivo} onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} />
      </Modal>
    </div>
  )
}

function Regras() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['inad-regras'], queryFn: () => api.get<{ config: { multaPct: number; jurosMesPct: number; carenciaDias: number } }>(`${BASE}/regras`) })
  const m = useMutation({
    mutationFn: (b: { multaPct: number; jurosMesPct: number; carenciaDias: number }) => api.put(`${BASE}/regras`, b),
    onSuccess: () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('inad-') }),
  })
  const pode = useCan('edu_inadimplencia', 'edit')
  const c = q.data?.config
  const [f, setF] = useState<{ multaPct: string; jurosMesPct: string; carenciaDias: string } | null>(null)
  if (!c) return <Skeleton class="h-40" />
  const v = f ?? { multaPct: String(c.multaPct), jurosMesPct: String(c.jurosMesPct), carenciaDias: String(c.carenciaDias) }
  return (
    <Card class="max-w-xl">
      <div class="text-xs font-semibold uppercase text-fg-muted mb-3">Multa e juros por atraso</div>
      <div class="grid grid-cols-3 gap-3">
        <Input label="Multa (%)" disabled={!pode} value={v.multaPct} onInput={(e) => setF({ ...v, multaPct: (e.target as HTMLInputElement).value })} />
        <Input label="Juros ao mês (%)" disabled={!pode} value={v.jurosMesPct} onInput={(e) => setF({ ...v, jurosMesPct: (e.target as HTMLInputElement).value })} />
        <Input label="Carência (dias)" disabled={!pode} value={v.carenciaDias} onInput={(e) => setF({ ...v, carenciaDias: (e.target as HTMLInputElement).value })} />
      </div>
      <p class="text-xs text-fg-muted mt-3">Vale para o valor atualizado desta tela e para os acordos. Não altera boletos já emitidos: a multa cobrada neles é a configurada no Asaas.</p>
      {pode && <Button class="mt-3" size="sm" variant="primary" disabled={!f || m.isPending} onClick={() => m.mutate({ multaPct: reais(v.multaPct), jurosMesPct: reais(v.jurosMesPct), carenciaDias: Math.round(reais(v.carenciaDias)) }, { onSuccess: () => { toast('Regras salvas.', 'success'); setF(null) }, onError: erroToast })}>Salvar</Button>}
    </Card>
  )
}

function FichaDoDevedor({ leadId, fechar }: { leadId: number; fechar: () => void }) {
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const pode = useCan('edu_inadimplencia', 'edit')
  const q = useQuery({ queryKey: ['inad-ficha', leadId], queryFn: () => api.get<Detalhe>(`${BASE}/devedores/${leadId}`) })
  const [marcados, setMarcados] = useState<string[]>([])
  const [modo, setModo] = useState<'acordo' | 'contato' | null>(null)
  const [baixa, setBaixa] = useState<Item | null>(null)
  const [notaBaixa, setNotaBaixa] = useState('')
  const [via, setVia] = useState<Item | null>(null)
  const [dataVia, setDataVia] = useState(hoje())
  const atualizar = () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('inad-') })
  const mBaixa = useMutation({
    mutationFn: () => api.post(`${BASE}/baixa`, { chave: baixa!.chave, nota: notaBaixa }),
    onSuccess: () => { toast('Baixa registrada.', 'success'); setBaixa(null); setNotaBaixa(''); atualizar() }, onError: erroToast,
  })
  const mVia = useMutation({
    mutationFn: () => api.post(`${BASE}/titulos/${via!.chave.slice(2)}/segunda-via`, { vencimento: dataVia }),
    onSuccess: () => { toast('Nova cobrança gerada.', 'success'); setVia(null); atualizar() }, onError: erroToast,
  })
  const d = q.data
  const selecionados = d?.vencidos.filter((i) => marcados.includes(i.chave)) ?? []
  const cobrar = () => {
    if (!d) return
    const nome = (d.lead.nome ?? '').trim().split(/\s+/)[0]
    const base = selecionados.length ? selecionados : d.vencidos
    const itens = base.map((i) => `${i.titulo}, vencida em ${dia(i.vencimento)}: ${money(i.valor)}${i.link ? ` (${i.link})` : ''}`)
    pedirRascunho(d.lead.id, `Olá${nome ? `, ${nome}` : ''}! Identificamos pagamento(s) em aberto no seu curso:\n\n${itens.join('\n')}\n\nPodemos ajudar a regularizar?`)
    navigate(`/conversations?leadId=${d.lead.id}`)
  }
  return (
    <Modal open onOpenChange={(o) => { if (!o) fechar() }} title={d?.lead.nome ?? 'Devedor'} description={d ? [d.lead.whatsapp, d.lead.email].filter(Boolean).join(' · ') : undefined} size="xl">
      {!d ? <Skeleton class="h-64" /> : (
        <div class="grid gap-4">
          <div class="flex flex-wrap gap-2">
            {d.lead.whatsapp && <Button size="sm" variant="secondary" onClick={cobrar}><MessageSquare size={14} /> Levar cobrança à conversa</Button>}
            {pode && <Button size="sm" variant="secondary" onClick={() => setModo(modo === 'contato' ? null : 'contato')}>Registrar contato</Button>}
            {pode && <Button size="sm" variant="primary" disabled={!selecionados.length} title={selecionados.length ? undefined : 'Marque os títulos vencidos'} onClick={() => setModo(modo === 'acordo' ? null : 'acordo')}><Handshake size={14} /> Fazer acordo</Button>}
          </div>
          {modo === 'contato' && <FormContato leadId={leadId} aoFechar={() => { setModo(null); atualizar() }} />}
          {modo === 'acordo' && selecionados.length > 0 && <FormAcordo leadId={leadId} itens={selecionados} aoFechar={() => { setModo(null); setMarcados([]); atualizar() }} />}

          <section>
            <h3 class="text-xs font-semibold uppercase text-fg-muted mb-2">Vencidos</h3>
            {!d.vencidos.length ? <p class="text-sm text-fg-muted">Nenhum título vencido.</p> : (
              <div class="overflow-x-auto rounded-md border border-border">
                <table class="w-full text-xs min-w-[44rem]">
                  <thead><tr class="text-left text-fg-subtle border-b border-border">
                    <th class="px-2 py-1.5 w-8" /><th class="px-2 py-1.5 font-medium">Título</th><th class="px-2 py-1.5 font-medium">Vencimento</th><th class="px-2 py-1.5 font-medium text-right">Atraso</th>
                    <th class="px-2 py-1.5 font-medium text-right">Valor</th><th class="px-2 py-1.5 font-medium text-right">Multa + juros</th><th class="px-2 py-1.5 font-medium text-right">Atualizado</th><th class="px-2 py-1.5" />
                  </tr></thead>
                  <tbody>
                    {d.vencidos.map((i) => (
                      <tr key={i.chave} class="border-b border-border last:border-0">
                        <td class="px-2 py-1.5"><input type="checkbox" aria-label={`Selecionar ${i.titulo}`} checked={marcados.includes(i.chave)} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setMarcados((m) => (v ? [...m, i.chave] : m.filter((x) => x !== i.chave))) }} /></td>
                        <td class="px-2 py-1.5 text-fg">{i.titulo}<div class="text-fg-muted">{[i.curso, i.codigo, i.meio].filter(Boolean).join(' · ')}</div></td>
                        <td class="px-2 py-1.5 tabular-nums">{dia(i.vencimento)}</td>
                        <td class="px-2 py-1.5 text-right tabular-nums">{i.diasAtraso} d</td>
                        <td class="px-2 py-1.5 text-right tabular-nums">{money(i.valor)}</td>
                        <td class="px-2 py-1.5 text-right tabular-nums">{money(i.multa + i.juros)}</td>
                        <td class="px-2 py-1.5 text-right tabular-nums">{money(i.atualizado)}</td>
                        <td class="px-2 py-1.5"><div class="flex justify-end gap-1">
                          {i.link && <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(i.link!).then(() => toast('Link copiado', 'success')) }}>Link</Button>}
                          {pode && i.fonte === 'titulo' && <Button size="sm" variant="ghost" onClick={() => { setDataVia(hoje()); setVia(i) }}>2ª via</Button>}
                          {pode && <Button size="sm" variant="ghost" onClick={() => setBaixa(i)}>Baixa</Button>}
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {d.aVencer.length > 0 && (
            <section>
              <h3 class="text-xs font-semibold uppercase text-fg-muted mb-2">A vencer</h3>
              <ul class="text-xs grid gap-1">{d.aVencer.map((i) => <li key={i.chave} class="flex justify-between gap-3"><span>{i.titulo} · {dia(i.vencimento)}</span><span class="tabular-nums">{money(i.valor)}</span></li>)}</ul>
            </section>
          )}

          {d.acordos.length > 0 && (
            <section>
              <h3 class="text-xs font-semibold uppercase text-fg-muted mb-2">Acordos</h3>
              <div class="grid gap-2">{d.acordos.map((a) => (
                <div key={a.id} class="rounded-md border border-border p-2 text-xs">
                  <div class="flex flex-wrap items-center gap-2"><strong>nº {a.id}</strong><Badge tone={SIT_ACORDO[a.status]?.tom ?? 'neutral'}>{SIT_ACORDO[a.status]?.rotulo ?? a.status}</Badge><span class="tabular-nums">{money(a.total)}</span><span class="text-fg-muted">{a.por} · {dia(a.em)}</span></div>
                  {a.observacao && <div class="text-fg-muted mt-1 whitespace-pre-line">{a.observacao}</div>}
                  <ul class="mt-1 grid gap-0.5">{a.pagamentos.map((p) => <li key={p.id} class="flex justify-between gap-3"><span>{p.ordem}. {p.meio} · {dia(p.vencimento)} · {p.status}{p.erro && p.status === 'prevista' ? ` (${p.erro})` : ''}</span><span class="tabular-nums">{money(p.valor)}</span></li>)}</ul>
                </div>
              ))}</div>
            </section>
          )}

          <section>
            <h3 class="text-xs font-semibold uppercase text-fg-muted mb-2">Histórico de contatos</h3>
            {!d.contatos.length ? <p class="text-sm text-fg-muted">Nenhum contato registrado.</p> : (
              <ul class="grid gap-2 text-xs">{d.contatos.map((c) => (
                <li key={c.id} class="border-l-2 border-border pl-2">
                  <div class="text-fg">{RESULTADO[c.resultado] ?? c.resultado} · {CANAL[c.canal] ?? c.canal}{c.promessaPara ? ` · para ${dia(c.promessaPara)}` : ''}</div>
                  {c.nota && <div class="text-fg-muted whitespace-pre-line">{c.nota}</div>}
                  <div class="text-fg-subtle">{c.por} · {new Date(c.em).toLocaleString('pt-BR')}</div>
                </li>
              ))}</ul>
            )}
          </section>
        </div>
      )}
      <Modal open={!!baixa} onOpenChange={(o) => { if (!o) setBaixa(null) }} title="Registrar pagamento fora do gateway" size="sm"
        footer={<><Button variant="ghost" size="sm" onClick={() => setBaixa(null)}>Voltar</Button><Button variant="primary" size="sm" disabled={mBaixa.isPending || notaBaixa.trim().length < 3} onClick={() => mBaixa.mutate()}>Dar baixa</Button></>}>
        <p class="text-sm text-fg-muted mb-3">{baixa?.titulo}: {baixa ? money(baixa.valor) : ''}. A cobrança aberta no gateway será cancelada.</p>
        <Textarea label="Como foi pago" rows={2} value={notaBaixa} onInput={(e) => setNotaBaixa((e.target as HTMLTextAreaElement).value)} />
      </Modal>
      <Modal open={!!via} onOpenChange={(o) => { if (!o) setVia(null) }} title="Gerar 2ª via" size="sm"
        footer={<><Button variant="ghost" size="sm" onClick={() => setVia(null)}>Voltar</Button><Button variant="primary" size="sm" disabled={mVia.isPending} onClick={() => mVia.mutate()}>Gerar</Button></>}>
        <p class="text-sm text-fg-muted mb-3">A cobrança atual será cancelada e outra será criada com a nova data, pelo valor original.</p>
        <Input label="Novo vencimento" type="date" min={hoje()} value={dataVia} onInput={(e) => setDataVia((e.target as HTMLInputElement).value)} />
      </Modal>
    </Modal>
  )
}

function FormContato({ leadId, aoFechar }: { leadId: number; aoFechar: () => void }) {
  const [canal, setCanal] = useState('whatsapp')
  const [resultado, setResultado] = useState('sem_resposta')
  const [promessaPara, setPromessa] = useState('')
  const [nota, setNota] = useState('')
  const m = useMutation({
    mutationFn: () => api.post(`${BASE}/contatos`, { leadId, canal, resultado, promessaPara: promessaPara || null, nota }),
    onSuccess: () => { toast('Contato registrado.', 'success'); aoFechar() }, onError: erroToast,
  })
  return (
    <div class="rounded-md border border-border p-3 grid gap-2">
      <div class="flex flex-wrap gap-2 items-end">
        <div class="w-36"><Select label="Canal" value={canal} onChange={(e) => setCanal((e.target as HTMLSelectElement).value)}>{Object.entries(CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        <div class="w-44"><Select label="Resultado" value={resultado} onChange={(e) => setResultado((e.target as HTMLSelectElement).value)}>{Object.entries(RESULTADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        {resultado === 'promessa_pagamento' && <div class="w-40"><Input label="Data prometida" type="date" min={hoje()} value={promessaPara} onInput={(e) => setPromessa((e.target as HTMLInputElement).value)} /></div>}
      </div>
      <Textarea label="Anotação" rows={2} value={nota} onInput={(e) => setNota((e.target as HTMLTextAreaElement).value)} />
      <div><Button size="sm" variant="primary" disabled={m.isPending} onClick={() => m.mutate()}>Salvar contato</Button></div>
    </div>
  )
}

function FormAcordo({ leadId, itens, aoFechar }: { leadId: number; itens: Item[]; aoFechar: () => void }) {
  const academico = itens.some((i) => i.fonte === 'aca')
  const [semEncargos, setSemEncargos] = useState(false)
  const [desconto, setDesconto] = useState('')
  const [entrada, setEntrada] = useState('')
  const [dataEntrada, setDataEntrada] = useState(hoje())
  const [meioEntrada, setMeioEntrada] = useState('pix')
  const [numParcelas, setNum] = useState('3')
  const [meioParcelas, setMeioParcelas] = useState('boleto')
  const [primeiro, setPrimeiro] = useState(() => { const d = new Date(`${hoje()}T12:00:00`); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10) })
  const [motivo, setMotivo] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const corpo = { leadId, itens: itens.map((i) => i.chave), semEncargos, desconto: reais(desconto), entrada: reais(entrada), numParcelas: Number(numParcelas) }
  const sim = useQuery({
    queryKey: ['inad-sim', JSON.stringify(corpo)], retry: false,
    queryFn: () => api.post<Simulacao>(`${BASE}/acordos/simular`, corpo),
  })
  const m = useMutation({
    mutationFn: () => api.post<{ acordoId: number; falhas: string[] }>(`${BASE}/acordos`, { ...corpo, dataEntrada, meioEntrada, meioParcelas, primeiroVencimento: primeiro, motivo }),
    onSuccess: (r) => {
      setConfirmar(false)
      if (r.falhas.length) toast(`Acordo nº ${r.acordoId} salvo, com atenção: ${r.falhas.join(' · ')}`, 'danger')
      else toast(`Acordo nº ${r.acordoId} fechado.`, 'success')
      aoFechar()
    },
    onError: (e: unknown) => { setConfirmar(false); erroToast(e) },
  })
  const s = sim.data
  return (
    <div class="rounded-md border border-border p-3 grid gap-3">
      <div class="text-xs font-semibold uppercase text-fg-muted">Acordo com {itens.length} título(s)</div>
      <div class="flex flex-wrap gap-2 items-end">
        {!academico && <label class="flex items-center gap-2 h-9 text-xs"><input type="checkbox" checked={semEncargos} onChange={(e) => setSemEncargos((e.target as HTMLInputElement).checked)} /> Isentar multa e juros</label>}
        {!academico && <div class="w-32"><Input label="Desconto (R$)" value={desconto} onInput={(e) => setDesconto((e.target as HTMLInputElement).value)} /></div>}
        <div class="w-32"><Input label="Entrada (R$)" value={entrada} onInput={(e) => setEntrada((e.target as HTMLInputElement).value)} /></div>
        {!academico && reais(entrada) > 0 && <div class="w-32"><Select label="Forma da entrada" value={meioEntrada} onChange={(e) => setMeioEntrada((e.target as HTMLSelectElement).value)}><option value="pix">Pix</option><option value="boleto">Boleto</option><option value="credit_card">Cartão</option></Select></div>}
        {!academico && reais(entrada) > 0 && <div class="w-40"><Input label="Data da entrada" type="date" min={hoje()} value={dataEntrada} onInput={(e) => setDataEntrada((e.target as HTMLInputElement).value)} /></div>}
      </div>
      <div class="flex flex-wrap gap-2 items-end">
        <div class="w-24"><Input label="Parcelas" type="number" min={1} max={48} value={numParcelas} onInput={(e) => setNum((e.target as HTMLInputElement).value)} /></div>
        {!academico && <div class="w-32"><Select label="Forma" value={meioParcelas} onChange={(e) => setMeioParcelas((e.target as HTMLSelectElement).value)}><option value="boleto">Boleto</option><option value="pix">Pix</option></Select></div>}
        <div class="w-40"><Input label="1ª parcela em" type="date" min={hoje()} value={primeiro} onInput={(e) => setPrimeiro((e.target as HTMLInputElement).value)} /></div>
      </div>
      {sim.error && <div class="text-xs text-danger">{(sim.error as Error).message}</div>}
      {s && (
        <div class="text-xs grid gap-0.5 rounded bg-surface-2 p-2 tabular-nums">
          <div class="flex justify-between"><span>Valor original</span><span>{money(s.original)}</span></div>
          <div class="flex justify-between"><span>Multa e juros</span><span>{money(s.encargos)}</span></div>
          {s.desconto > 0 && <div class="flex justify-between"><span>Desconto</span><span>-{money(s.desconto)}</span></div>}
          <div class="flex justify-between font-semibold text-fg"><span>Total do acordo</span><span>{money(s.total)}</span></div>
          <div class="text-fg-muted">{s.entrada > 0 ? `Entrada de ${money(s.entrada)} + ` : ''}{s.parcelas.length}x de {money(s.parcelas[0] ?? 0)}</div>
        </div>
      )}
      <Textarea label="Motivo ou observação" rows={2} value={motivo} onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} />
      <div><Button size="sm" variant="primary" disabled={!s || m.isPending || motivo.trim().length < 3} onClick={() => setConfirmar(true)}>Fechar acordo</Button></div>
      <ConfirmDialog open={confirmar} onOpenChange={setConfirmar} title={`Fechar acordo de ${s ? money(s.total) : ''}?`} description="As cobranças antigas serão canceladas e as novas serão criadas no gateway. O Asaas não avisa o aluno da criação: envie os links pela conversa. Lembretes de vencimento e atraso continuam." confirmLabel="Fechar acordo" onConfirm={() => m.mutate()} />
    </div>
  )
}
