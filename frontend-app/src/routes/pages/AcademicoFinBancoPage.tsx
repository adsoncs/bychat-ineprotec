import { useState } from 'preact/hooks'
import { Landmark, FileText, Repeat, CalendarOff, Plus, Download, Trash2, TrendingUp } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  useContasFin, useContasBanco, useIndexadores, useFeriados, useRecorrentes, useRemessas, useParcelasAberto, useFinBancoMut, baixarRemessa,
} from '@/hooks/useAcaFinBanco'

type Tab = 'cadastros' | 'recorrentes' | 'remessas' | 'indexadores'
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const PERIODOS = ['MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']

export function AcademicoFinBancoPage() {
  const [tab, setTab] = useState<Tab>('cadastros')
  return (
    <Page title="Financeiro Bancário" description="Plano de contas, contas bancárias, cobranças recorrentes e remessa/retorno CNAB.">
      <div class="flex gap-1 border-b border-border flex-wrap">
        {([['cadastros', 'Contas & bancos'], ['recorrentes', 'Cobranças recorrentes'], ['remessas', 'Remessas CNAB'], ['indexadores', 'Indexadores & feriados']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'cadastros' && <CadastrosTab />}
      {tab === 'recorrentes' && <RecorrentesTab />}
      {tab === 'remessas' && <RemessasTab />}
      {tab === 'indexadores' && <IndexadoresTab />}
    </Page>
  )
}

function CadastrosTab() {
  const contasFin = useContasFin()
  const contasBanco = useContasBanco()
  const mut = useFinBancoMut()
  const [cf, setCf] = useState({ codigo: '', nome: '', tipo: 'RECEITA' })
  const [cb, setCb] = useState({ nome: '', bancoCodigo: '', agencia: '', conta: '', carteira: '', cnab: '400', cedente: '', documentoCedente: '' })

  return (
    <div class="grid md:grid-cols-2 gap-4 mt-3">
      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><FileText size={16} /> Plano de contas</div>
        <div class="grid grid-cols-[80px_1fr_110px] gap-2">
          <Input placeholder="Código" value={cf.codigo} onInput={(e: any) => setCf({ ...cf, codigo: e.currentTarget.value })} />
          <Input placeholder="Nome da conta" value={cf.nome} onInput={(e: any) => setCf({ ...cf, nome: e.currentTarget.value })} />
          <Select value={cf.tipo} onChange={(e: any) => setCf({ ...cf, tipo: e.currentTarget.value })}><option value="RECEITA">Receita</option><option value="DESPESA">Despesa</option></Select>
        </div>
        <Button size="sm" variant="secondary" disabled={!cf.codigo || !cf.nome || mut.criarContaFin.isPending} onClick={() => mut.criarContaFin.mutate(cf, { onSuccess: () => setCf({ codigo: '', nome: '', tipo: 'RECEITA' }) })}><Plus size={14} /> Adicionar</Button>
        {contasFin.isLoading ? <Skeleton class="h-16 w-full" /> : (
          <div class="divide-y divide-border text-sm">
            {(contasFin.data ?? []).map((c) => <div key={c.id} class="py-1.5 flex gap-2"><code class="text-xs">{c.codigo}</code><span class="flex-1">{c.nome}</span><Badge tone={c.tipo === 'RECEITA' ? 'success' : 'warning'}>{c.tipo === 'RECEITA' ? 'Receita' : 'Despesa'}</Badge></div>)}
          </div>
        )}
      </Card>

      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><Landmark size={16} /> Contas bancárias</div>
        <div class="grid grid-cols-2 gap-2">
          <Input placeholder="Nome/apelido" value={cb.nome} onInput={(e: any) => setCb({ ...cb, nome: e.currentTarget.value })} />
          <Input placeholder="Banco (cód.)" value={cb.bancoCodigo} onInput={(e: any) => setCb({ ...cb, bancoCodigo: e.currentTarget.value })} />
          <Input placeholder="Agência" value={cb.agencia} onInput={(e: any) => setCb({ ...cb, agencia: e.currentTarget.value })} />
          <Input placeholder="Conta" value={cb.conta} onInput={(e: any) => setCb({ ...cb, conta: e.currentTarget.value })} />
          <Input placeholder="Carteira" value={cb.carteira} onInput={(e: any) => setCb({ ...cb, carteira: e.currentTarget.value })} />
          <Select value={cb.cnab} onChange={(e: any) => setCb({ ...cb, cnab: e.currentTarget.value })}><option value="400">CNAB 400</option><option value="240">CNAB 240</option></Select>
          <Input placeholder="Cedente" value={cb.cedente} onInput={(e: any) => setCb({ ...cb, cedente: e.currentTarget.value })} />
          <Input placeholder="CNPJ cedente" value={cb.documentoCedente} onInput={(e: any) => setCb({ ...cb, documentoCedente: e.currentTarget.value })} />
        </div>
        <Button size="sm" variant="secondary" disabled={!cb.nome || !cb.bancoCodigo || mut.criarContaBanco.isPending} onClick={() => mut.criarContaBanco.mutate(cb, { onSuccess: () => setCb({ nome: '', bancoCodigo: '', agencia: '', conta: '', carteira: '', cnab: '400', cedente: '', documentoCedente: '' }) })}><Plus size={14} /> Adicionar</Button>
        {contasBanco.isLoading ? <Skeleton class="h-16 w-full" /> : (
          <div class="divide-y divide-border text-sm">
            {(contasBanco.data ?? []).map((c) => <div key={c.id} class="py-1.5 flex gap-2"><span class="flex-1">{c.nome} <span class="text-xs text-fg-muted">· {c.bancoCodigo} ag {c.agencia || '—'}</span></span><Badge tone="neutral">CNAB {c.cnab}</Badge></div>)}
          </div>
        )}
      </Card>
    </div>
  )
}

function RecorrentesTab() {
  const recs = useRecorrentes()
  const mut = useFinBancoMut()
  const [f, setF] = useState({ contratoId: '', descricao: '', valor: '', periodo: 'MENSAL', diaVencimento: '10' })
  const [preview, setPreview] = useState<{ total: number } | null>(null)

  const add = () => {
    if (!f.contratoId || !f.descricao || !f.valor) return
    mut.criarRecorrente.mutate({ contratoId: Number(f.contratoId), descricao: f.descricao, valorCentavos: Math.round(parseFloat(f.valor.replace(',', '.')) * 100), periodo: f.periodo, diaVencimento: Number(f.diaVencimento) }, { onSuccess: () => setF({ contratoId: '', descricao: '', valor: '', periodo: 'MENSAL', diaVencimento: '10' }) })
  }
  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold text-fg flex items-center gap-2"><Repeat size={16} /> Nova cobrança recorrente</div>
          <Button size="sm" variant="ghost" onClick={() => mut.gerarRecorrencias.mutate({ dryRun: true }, { onSuccess: (d) => setPreview({ total: d.total }) })}>Pré-visualizar geração</Button>
        </div>
        <div class="grid sm:grid-cols-5 gap-2">
          <Input placeholder="Contrato ID" value={f.contratoId} onInput={(e: any) => setF({ ...f, contratoId: e.currentTarget.value })} />
          <Input class="sm:col-span-2" placeholder="Descrição" value={f.descricao} onInput={(e: any) => setF({ ...f, descricao: e.currentTarget.value })} />
          <Input placeholder="Valor (R$)" value={f.valor} onInput={(e: any) => setF({ ...f, valor: e.currentTarget.value })} />
          <Select value={f.periodo} onChange={(e: any) => setF({ ...f, periodo: e.currentTarget.value })}>{PERIODOS.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
        </div>
        <div class="flex items-center gap-2">
          <Input class="!w-28" type="number" placeholder="Dia venc." value={f.diaVencimento} onInput={(e: any) => setF({ ...f, diaVencimento: e.currentTarget.value })} />
          <Button size="sm" variant="secondary" disabled={!f.contratoId || !f.descricao || !f.valor || mut.criarRecorrente.isPending} onClick={add}><Plus size={14} /> Adicionar</Button>
        </div>
        <p class="text-xs text-fg-muted">O <b>Contrato ID</b> é o id do contrato financeiro do aluno (visível no Financeiro). Use “Gerar parcelas” para criar as parcelas devidas.</p>
        {preview && <div class="flex items-center gap-2 text-sm"><Badge tone="warning">{preview.total} recorrência(s) a gerar</Badge>{preview.total > 0 && <Button size="sm" variant="primary" loading={mut.gerarRecorrencias.isPending} onClick={() => mut.gerarRecorrencias.mutate({ dryRun: false }, { onSuccess: () => setPreview(null) })}>Gerar parcelas agora</Button>}</div>}
      </Card>

      {recs.isLoading ? <Skeleton class="h-20 w-full" /> : (recs.data ?? []).length === 0 ? <EmptyState icon={<Repeat size={26} />} title="Sem recorrências" description="Cadastre uma cobrança recorrente acima." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {(recs.data ?? []).map((r) => (
            <div key={r.id} class="px-4 py-3 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{r.alunoNome} · {r.descricao}</span><span class="block text-xs text-fg-muted">{brl(r.valorCentavos)} · {r.periodo} · dia {r.diaVencimento} · próxima {new Date(r.proximaGeracao).toLocaleDateString('pt-BR')}</span></span>
              <Button size="sm" variant="ghost" onClick={() => mut.updateRecorrente.mutate({ id: r.id, ativo: !r.ativo })}>{r.ativo ? 'Pausar' : 'Ativar'}</Button>
              {!r.ativo && <Badge tone="neutral">pausada</Badge>}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function RemessasTab() {
  const parcelas = useParcelasAberto(true)
  const contas = useContasBanco()
  const remessas = useRemessas()
  const mut = useFinBancoMut()
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [contaId, setContaId] = useState('')
  const [retorno, setRetorno] = useState('')
  const [resultRetorno, setResultRetorno] = useState<{ baixadas: number; naoEncontradas: number } | null>(null)

  const toggle = (id: number) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n) }
  const linhas = parcelas.data?.parcelas ?? []

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="text-sm font-semibold text-fg flex items-center gap-2"><FileText size={16} /> Gerar remessa (títulos em aberto)</div>
          <div class="flex items-center gap-2">
            <Select value={contaId} onChange={(e: any) => setContaId(e.currentTarget.value)} class="!w-48"><option value="">Conta bancária…</option>{(contas.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome} (CNAB {c.cnab})</option>)}</Select>
            <Button size="sm" variant="primary" disabled={!contaId || sel.size === 0 || mut.gerarRemessa.isPending} onClick={() => mut.gerarRemessa.mutate({ contaBancariaId: Number(contaId), parcelaIds: [...sel] }, { onSuccess: () => setSel(new Set()) })}>Gerar remessa ({sel.size})</Button>
          </div>
        </div>
        {parcelas.isLoading ? <Skeleton class="h-24 w-full" /> : linhas.length === 0 ? <p class="text-sm text-fg-muted">Nenhum título em aberto sem remessa.</p> : (
          <div class="divide-y divide-border max-h-72 overflow-auto text-sm">
            {linhas.map((p) => (
              <label key={p.id} class="py-1.5 flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                <span class="flex-1">{p.alunoNome} <span class="text-xs text-fg-muted">· {p.nroParcela}ª {p.tipo} · vence {new Date(p.dataVencimento).toLocaleDateString('pt-BR')}</span></span>
                <span class="text-fg-muted">{brl(p.valorBrutoCentavos)}</span>
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Remessas geradas</div>
        {remessas.isLoading ? <Skeleton class="h-16 w-full" /> : (remessas.data ?? []).length === 0 ? <p class="text-sm text-fg-muted">Nenhuma remessa gerada.</p> : (
          <div class="divide-y divide-border text-sm">
            {(remessas.data ?? []).map((r) => (
              <div key={r.id} class="py-2 flex items-center gap-2">
                <span class="flex-1">{r.nomeArquivo} <span class="text-xs text-fg-muted">· {r.qtdTitulos} título(s) · {brl(r.valorTotalCentavos)} · CNAB {r.layout}</span></span>
                <Badge tone="neutral">{r.status}</Badge>
                <Button size="sm" variant="secondary" onClick={() => baixarRemessa(r.id, r.nomeArquivo).catch(() => {})}><Download size={13} /> Baixar</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Processar retorno (baixa)</div>
        <Textarea rows={4} value={retorno} onInput={(e: any) => setRetorno(e.currentTarget.value)} placeholder="Cole aqui o conteúdo do arquivo de retorno CNAB (.RET)" />
        <div class="flex items-center gap-2">
          <Button size="sm" variant="primary" disabled={!retorno.trim() || mut.processarRetorno.isPending} onClick={() => mut.processarRetorno.mutate({ conteudo: retorno }, { onSuccess: (d) => { setResultRetorno(d); setRetorno('') } })}>Processar retorno</Button>
          {resultRetorno && <span class="text-sm text-fg-muted">{resultRetorno.baixadas} baixada(s) · {resultRetorno.naoEncontradas} não encontrada(s)</span>}
        </div>
      </Card>
    </div>
  )
}

function IndexadoresTab() {
  const indexadores = useIndexadores()
  const feriados = useFeriados()
  const mut = useFinBancoMut()
  const [nomeIdx, setNomeIdx] = useState('')
  const [fer, setFer] = useState({ data: '', nome: '' })
  const [val, setVal] = useState<Record<number, { competencia: string; valorPct: string }>>({})

  return (
    <div class="grid md:grid-cols-2 gap-4 mt-3">
      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><TrendingUp size={16} /> Indexadores</div>
        <div class="flex gap-2"><Input placeholder="Novo indexador (ex: IGPM)" value={nomeIdx} onInput={(e: any) => setNomeIdx(e.currentTarget.value)} /><Button size="sm" variant="secondary" disabled={!nomeIdx || mut.criarIndexador.isPending} onClick={() => mut.criarIndexador.mutate({ nome: nomeIdx }, { onSuccess: () => setNomeIdx('') })}><Plus size={14} /></Button></div>
        {indexadores.isLoading ? <Skeleton class="h-16 w-full" /> : (indexadores.data ?? []).map((idx) => (
          <div key={idx.id} class="border border-border rounded-md p-2 space-y-1">
            <div class="text-sm font-medium text-fg">{idx.nome}</div>
            <div class="flex flex-wrap gap-1 text-xs">{idx.valores.map((v) => <span key={v.id} class="px-2 py-0.5 bg-surface-2 rounded">{v.competencia}: {v.valorPct}%</span>)}</div>
            <div class="flex gap-1">
              <Input class="!w-28" placeholder="AAAA-MM" value={val[idx.id]?.competencia ?? ''} onInput={(e: any) => setVal({ ...val, [idx.id]: { ...(val[idx.id] || { valorPct: '' }), competencia: e.currentTarget.value } })} />
              <Input class="!w-24" placeholder="%" value={val[idx.id]?.valorPct ?? ''} onInput={(e: any) => setVal({ ...val, [idx.id]: { ...(val[idx.id] || { competencia: '' }), valorPct: e.currentTarget.value } })} />
              <Button size="sm" variant="ghost" onClick={() => { const v = val[idx.id]; if (v?.competencia && v?.valorPct) mut.addValorIndexador.mutate({ id: idx.id, competencia: v.competencia, valorPct: Number(v.valorPct) }, { onSuccess: () => setVal({ ...val, [idx.id]: { competencia: '', valorPct: '' } }) }) }}>Lançar</Button>
            </div>
          </div>
        ))}
      </Card>

      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><CalendarOff size={16} /> Feriados financeiros</div>
        <div class="flex gap-2"><Input type="date" value={fer.data} onInput={(e: any) => setFer({ ...fer, data: e.currentTarget.value })} /><Input placeholder="Nome" value={fer.nome} onInput={(e: any) => setFer({ ...fer, nome: e.currentTarget.value })} /><Button size="sm" variant="secondary" disabled={!fer.data || !fer.nome || mut.criarFeriado.isPending} onClick={() => mut.criarFeriado.mutate({ data: fer.data, nome: fer.nome }, { onSuccess: () => setFer({ data: '', nome: '' }) })}><Plus size={14} /></Button></div>
        {feriados.isLoading ? <Skeleton class="h-16 w-full" /> : (
          <div class="divide-y divide-border text-sm">
            {(feriados.data ?? []).map((f) => <div key={f.id} class="py-1.5 flex items-center gap-2"><span class="flex-1">{new Date(f.data).toLocaleDateString('pt-BR')} · {f.nome}</span><Button size="sm" variant="ghost" onClick={() => mut.delFeriado.mutate(f.id)}><Trash2 size={13} /></Button></div>)}
          </div>
        )}
        <p class="text-xs text-fg-muted">Vencimentos que caem em fim de semana ou feriado são ajustados para o próximo dia útil.</p>
      </Card>
    </div>
  )
}
