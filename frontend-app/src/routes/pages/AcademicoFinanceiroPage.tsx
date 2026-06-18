import { useEffect, useMemo, useState } from 'preact/hooks'
import { Wallet, AlertTriangle, TrendingUp, Users, Download, CheckCircle2, Send, FileText, Search, Percent } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { useTurmas } from '@/hooks/useAcaCatalogo'
import { useFinResumo, useFinParcelas, useExtrato, useFinAcoes, useEncargosConfig, useEncargosConfigMut, useBloqueioConfigMut, useRenegociar, useReciboMut, useNfse, useNfseMut, useContratoTermo, useContratoTermoMut, exportFinanceiroCsv, money, type FinFiltros, type ParcelaLinha, type EncargosConfig, type BloqueioConfig } from '@/hooks/useAcaFinanceiroCentral'
import { abrirDocumentoPdf } from '@/hooks/useAcaSecretaria'
import { Handshake, Receipt, FileSpreadsheet, FileSignature } from 'lucide-preact'

const SIT_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'accent'> = { PAGA: 'success', ABERTA: 'warning', VENCIDA: 'danger', CANCELADA: 'neutral', RENEGOCIADA: 'accent' }
const SIT_LABEL: Record<string, string> = { PAGA: 'Paga', ABERTA: 'Em aberto', VENCIDA: 'Vencida', CANCELADA: 'Cancelada', RENEGOCIADA: 'Renegociada' }
const LIMIT = 50

function Kpi({ icon, label, value, hint, tone }: { icon: any; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card class="space-y-1">
      <div class="flex items-center gap-2 text-fg-muted text-xs">{icon}<span>{label}</span></div>
      <div class={`text-xl font-semibold ${tone ?? 'text-fg'}`}>{value}</div>
      {hint && <div class="text-[11px] text-fg-subtle">{hint}</div>}
    </Card>
  )
}

export function AcademicoFinanceiroPage() {
  const turmas = useTurmas()
  const [filtros, setFiltros] = useState<FinFiltros>({ page: 1, limit: LIMIT })
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [extratoAluno, setExtratoAluno] = useState<{ id: number; nome: string } | null>(null)
  const [cfgOpen, setCfgOpen] = useState(false)
  const [termoOpen, setTermoOpen] = useState(false)
  const [renegOpen, setRenegOpen] = useState(false)
  const [nfseParcela, setNfseParcela] = useState<{ id: number; nome: string } | null>(null)
  const recibo = useReciboMut()
  const resumo = useFinResumo(filtros)
  const parcelas = useFinParcelas(filtros)
  const acoes = useFinAcoes()
  const r = resumo.data

  const itens = parcelas.data?.itens ?? []
  const setF = (p: Partial<FinFiltros>) => { setFiltros((f) => ({ ...f, ...p, page: 1 })); setSel(new Set()) }
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selecionaveis = itens.filter((i) => i.situacao !== 'PAGA' && i.situacao !== 'CANCELADA')
  const allSel = selecionaveis.length > 0 && selecionaveis.every((i) => sel.has(i.id))
  const toggleAll = () => setSel(allSel ? new Set() : new Set(selecionaveis.map((i) => i.id)))
  const selIds = useMemo(() => [...sel], [sel])
  const selItens = itens.filter((i) => sel.has(i.id))
  const alunoUnico = selItens.length > 0 && new Set(selItens.map((i) => i.alunoId)).size === 1 ? selItens[0] : null

  const agingTotal = r ? r.aging.d0_30 + r.aging.d31_60 + r.aging.d61_90 + r.aging.d90 : 0
  const agingBar = (v: number) => (agingTotal > 0 ? Math.round((v / agingTotal) * 100) : 0)

  return (
    <Page title="Financeiro" description="Central de contas a receber — parcelas, inadimplência e cobrança." actions={
      <div class="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setTermoOpen(true)}><FileSignature size={14} /> Termo</Button>
        <Button variant="ghost" size="sm" onClick={() => setCfgOpen(true)}><Percent size={14} /> Encargos</Button>
        <Button variant="secondary" size="sm" onClick={() => exportFinanceiroCsv(filtros).catch(() => {})}><Download size={14} /> Exportar CSV</Button>
      </div>
    }>
      {/* KPIs */}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!r ? <><Skeleton class="h-20" /><Skeleton class="h-20" /><Skeleton class="h-20" /><Skeleton class="h-20" /></> : <>
          <Kpi icon={<Wallet size={14} />} label="Recebido" value={money(r.recebido)} hint={`${r.parcelasPagas} parcela(s) paga(s)`} tone="text-success" />
          <Kpi icon={<TrendingUp size={14} />} label="A receber" value={money(r.aReceberTotal)} hint={`${money(r.aVencer)} a vencer`} />
          <Kpi icon={<AlertTriangle size={14} />} label="Vencido" value={money(r.vencidoTotal)} hint={r.encargosTotal > 0 ? `+${money(r.encargosTotal)} de encargos` : undefined} tone={r.vencidoTotal > 0 ? 'text-danger' : 'text-fg'} />
          <Kpi icon={<Users size={14} />} label="Inadimplentes" value={String(r.inadimplentes)} hint="alunos com parcela vencida" tone={r.inadimplentes > 0 ? 'text-danger' : 'text-fg'} />
        </>}
      </div>

      {/* Aging */}
      {r && agingTotal > 0 && (
        <Card class="mt-3">
          <div class="text-xs font-semibold uppercase text-fg-muted mb-2">Aging da inadimplência</div>
          <div class="grid grid-cols-4 gap-3 text-center">
            {([['1–30 dias', r.aging.d0_30], ['31–60', r.aging.d31_60], ['61–90', r.aging.d61_90], ['90+ dias', r.aging.d90]] as const).map(([lbl, v]) => (
              <div key={lbl}>
                <div class="text-sm font-medium text-fg">{money(v)}</div>
                <div class="h-1.5 my-1 rounded bg-surface-2 overflow-hidden"><div class="h-full bg-danger" style={`width:${agingBar(v)}%`} /></div>
                <div class="text-[11px] text-fg-subtle">{lbl}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filtros */}
      <Card class="mt-3 flex flex-wrap items-end gap-2">
        <div class="relative flex-1 min-w-[180px]">
          <Search size={14} class="absolute left-2 top-2.5 text-fg-subtle" />
          <Input value={filtros.q ?? ''} onInput={(e) => setF({ q: (e.target as HTMLInputElement).value || undefined })} placeholder="Buscar aluno (nome ou RA)…" class="pl-7" />
        </div>
        <div class="w-44">
          <Select value={filtros.situacao ?? ''} onChange={(e) => setF({ situacao: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Todas as situações</option>
            <option value="ABERTA">Em aberto</option>
            <option value="VENCIDA">Vencida</option>
            <option value="PAGA">Paga</option>
            <option value="CANCELADA">Cancelada</option>
          </Select>
        </div>
        <div class="w-56">
          <Select value={filtros.turmaId ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setF({ turmaId: v ? Number(v) : undefined }) }}>
            <option value="">Todas as turmas</option>
            {(turmas.data?.turmas ?? []).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </Select>
        </div>
        <label class="flex items-center gap-1.5 text-sm text-fg px-2 py-2"><input type="checkbox" checked={!!filtros.vencidas} onChange={(e) => setF({ vencidas: (e.target as HTMLInputElement).checked || undefined })} /> Só vencidas</label>
      </Card>

      {/* Barra de ações em lote */}
      {selIds.length > 0 && (
        <div class="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/30">
          <span class="text-sm text-fg flex-1">{selIds.length} parcela(s) selecionada(s){selItens.length && !alunoUnico ? ' · vários alunos' : ''}</span>
          <Button variant="ghost" size="sm" disabled={!alunoUnico} title={alunoUnico ? 'Renegociar em acordo' : 'Selecione parcelas de um único aluno'} onClick={() => setRenegOpen(true)}><Handshake size={14} /> Renegociar</Button>
          <Button variant="secondary" size="sm" disabled={acoes.cobrancaLote.isPending} onClick={() => acoes.cobrancaLote.mutate(selIds, { onSuccess: () => setSel(new Set()) })}><Send size={14} /> Gerar 2ª via (Asaas)</Button>
          <Button variant="primary" size="sm" disabled={acoes.baixaLote.isPending} onClick={() => { if (confirm(`Dar baixa em ${selIds.length} parcela(s)?`)) acoes.baixaLote.mutate(selIds, { onSuccess: () => setSel(new Set()) }) }}><CheckCircle2 size={14} /> Dar baixa</Button>
        </div>
      )}

      {/* Tabela */}
      <Card class="mt-3 p-0 overflow-x-auto">
        {parcelas.isLoading ? <Skeleton class="h-48 w-full" /> : itens.length === 0 ? <p class="text-sm text-fg-muted p-6 text-center">Nenhuma parcela encontrada.</p> : (
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-xs text-fg-muted">
              <tr>
                <th class="p-2 w-8"><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
                <th class="text-left p-2 font-medium">Aluno</th>
                <th class="text-left p-2 font-medium">Turma</th>
                <th class="text-left p-2 font-medium">Parcela</th>
                <th class="text-left p-2 font-medium">Vencimento</th>
                <th class="text-right p-2 font-medium">Valor</th>
                <th class="text-center p-2 font-medium">Situação</th>
                <th class="p-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {itens.map((p) => <LinhaParcela key={p.id} p={p} checked={sel.has(p.id)} onToggle={() => toggle(p.id)} onExtrato={() => setExtratoAluno({ id: p.alunoId, nome: p.alunoNome })} onBaixa={() => { if (confirm('Dar baixa nesta parcela?')) acoes.baixaLote.mutate([p.id]) }} onCobranca={() => acoes.cobrancaLote.mutate([p.id])} onRecibo={() => recibo.mutate(p.id, { onSuccess: (r) => abrirDocumentoPdf(r.documento.id).catch(() => {}) })} onNfse={() => setNfseParcela({ id: p.id, nome: p.alunoNome })} />)}
            </tbody>
          </table>
        )}
      </Card>
      {parcelas.data && parcelas.data.total > LIMIT && (
        <div class="mt-3"><Pagination total={parcelas.data.total} limit={LIMIT} offset={((filtros.page ?? 1) - 1) * LIMIT} onChange={(off) => setFiltros((f) => ({ ...f, page: Math.floor(off / LIMIT) + 1 }))} /></div>
      )}

      <Modal open={!!extratoAluno} onOpenChange={(o) => !o && setExtratoAluno(null)} title={extratoAluno ? `Extrato — ${extratoAluno.nome}` : ''} size="lg">
        {extratoAluno && <ExtratoView alunoId={extratoAluno.id} />}
      </Modal>
      <Modal open={cfgOpen} onOpenChange={setCfgOpen} title="Encargos por atraso" size="md">
        <EncargosForm onClose={() => setCfgOpen(false)} />
      </Modal>
      <Modal open={termoOpen} onOpenChange={setTermoOpen} title="Termo do contrato" size="lg">
        <TermoForm onClose={() => setTermoOpen(false)} />
      </Modal>
      <Modal open={renegOpen} onOpenChange={setRenegOpen} title={alunoUnico ? `Renegociar — ${alunoUnico.alunoNome}` : 'Renegociar'} size="md">
        {alunoUnico && <RenegociarForm parcelaIds={selIds} onClose={() => { setRenegOpen(false); setSel(new Set()) }} />}
      </Modal>
      <Modal open={!!nfseParcela} onOpenChange={(o) => !o && setNfseParcela(null)} title={nfseParcela ? `NFS-e — ${nfseParcela.nome}` : ''} size="md">
        {nfseParcela && <NfsePanel parcelaId={nfseParcela.id} />}
      </Modal>
    </Page>
  )
}

function RenegociarForm({ parcelaIds, onClose }: { parcelaIds: number[]; onClose: () => void }) {
  const { simular, renegociar } = useRenegociar()
  const [entrada, setEntrada] = useState('0')
  const [num, setNum] = useState('3')
  const [primeiro, setPrimeiro] = useState('')
  useEffect(() => { simular.mutate(parcelaIds) /* eslint-disable-next-line */ }, [])
  const sim = simular.data
  const entradaC = Math.round((Number(entrada) || 0) * 100)
  const numP = Math.max(1, Number(num) || 1)
  const restante = sim ? Math.max(0, sim.total - entradaC) : 0
  const valorParcela = restante > 0 ? Math.round(restante / numP) : 0
  const valido = sim && entradaC < sim.total && primeiro

  return (
    <div class="space-y-3">
      {!sim ? <Skeleton class="h-20 w-full" /> : (
        <div class="rounded-lg bg-surface-2 p-3 text-sm space-y-0.5">
          <div class="flex justify-between"><span class="text-fg-muted">{sim.qtd} parcela(s) · principal</span><span>{money(sim.valorOriginal)}</span></div>
          <div class="flex justify-between"><span class="text-fg-muted">Multa + juros</span><span class="text-danger">{money(sim.encargos)}</span></div>
          <div class="flex justify-between font-semibold border-t border-border pt-1 mt-1"><span>Total a renegociar</span><span>{money(sim.total)}</span></div>
        </div>
      )}
      <div class="grid grid-cols-3 gap-2">
        <Input label="Entrada (R$)" type="number" value={entrada} onInput={(e) => setEntrada((e.target as HTMLInputElement).value)} />
        <Input label="Nº de parcelas" type="number" value={num} onInput={(e) => setNum((e.target as HTMLInputElement).value)} />
        <Input label="1º vencimento" type="date" value={primeiro} onInput={(e) => setPrimeiro((e.target as HTMLInputElement).value)} />
      </div>
      {sim && restante > 0 && <p class="text-sm text-fg">Novo acordo: {entradaC > 0 ? <>entrada de <b>{money(entradaC)}</b> + </> : ''}<b>{numP}×</b> de <b>{money(valorParcela)}</b></p>}
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" size="sm" disabled={!valido || renegociar.isPending} onClick={() => renegociar.mutate({ parcelaIds, entrada: entradaC, numParcelas: numP, primeiroVencimento: primeiro }, { onSuccess: onClose })}><Handshake size={14} /> Confirmar acordo</Button>
      </div>
    </div>
  )
}

function EncargosForm({ onClose }: { onClose: () => void }) {
  const cfg = useEncargosConfig()
  const mut = useEncargosConfigMut()
  const bloqMut = useBloqueioConfigMut()
  const [f, setF] = useState<EncargosConfig | null>(null)
  const [bloq, setBloq] = useState<BloqueioConfig | null>(null)
  useEffect(() => { if (cfg.data) { setF(cfg.data.config); setBloq(cfg.data.bloqueio) } }, [cfg.data])
  if (!f || !bloq) return <Skeleton class="h-40 w-full" />
  const set = (p: Partial<EncargosConfig>) => setF({ ...f, ...p })
  const num = (k: keyof EncargosConfig) => (e: any) => set({ [k]: Number((e.target as HTMLInputElement).value) } as any)
  const setB = (p: Partial<BloqueioConfig>) => setBloq({ ...bloq, ...p })
  const salvar = async () => { await mut.mutateAsync(f); await bloqMut.mutateAsync(bloq); onClose() }
  return (
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <Input label="Multa por atraso (%)" type="number" value={String(f.multaPct)} onInput={num('multaPct')} />
        <Input label="Juros ao mês (%)" type="number" value={String(f.jurosMesPct)} onInput={num('jurosMesPct')} />
        <Input label="Carência (dias)" type="number" value={String(f.carenciaDias)} onInput={num('carenciaDias')} />
        <Input label="Desconto pontualidade (%)" type="number" value={String(f.descontoPontualidadePct)} onInput={num('descontoPontualidadePct')} />
      </div>
      <p class="text-[11px] text-fg-subtle">Multa incide uma vez; juros pró-rata por dia (mês = 30 dias) após a carência. Desconto de pontualidade aplica-se a parcelas pagas até o vencimento.</p>
      <div class="border-t border-border pt-3 space-y-2">
        <label class="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={bloq.enabled} onChange={(e) => setB({ enabled: (e.target as HTMLInputElement).checked })} /> Bloqueio acadêmico por inadimplência</label>
        <div class="grid grid-cols-2 gap-3">
          <Input label="Tolerância (dias de atraso)" type="number" value={String(bloq.toleranciaDias)} onInput={(e) => setB({ toleranciaDias: Number((e.target as HTMLInputElement).value) })} />
          <Input label="Mínimo de parcelas vencidas" type="number" value={String(bloq.minParcelas)} onInput={(e) => setB({ minParcelas: Number((e.target as HTMLInputElement).value) })} />
        </div>
        <p class="text-[11px] text-fg-subtle">Quando ativo, bloqueia nova matrícula e oculta o boletim no portal do aluno enquanto houver pendência além da tolerância.</p>
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" size="sm" disabled={mut.isPending || bloqMut.isPending} onClick={salvar}>Salvar</Button>
      </div>
    </div>
  )
}

function LinhaParcela({ p, checked, onToggle, onExtrato, onBaixa, onCobranca, onRecibo, onNfse }: { p: ParcelaLinha; checked: boolean; onToggle: () => void; onExtrato: () => void; onBaixa: () => void; onCobranca: () => void; onRecibo: () => void; onNfse: () => void }) {
  const podeAgir = p.situacao !== 'PAGA' && p.situacao !== 'CANCELADA'
  const paga = p.situacao === 'PAGA'
  return (
    <tr class="hover:bg-surface-2">
      <td class="p-2 text-center">{podeAgir ? <input type="checkbox" checked={checked} onChange={onToggle} /> : null}</td>
      <td class="p-2"><button class="text-fg hover:text-accent text-left" onClick={onExtrato}>{p.alunoNome}<span class="block text-[11px] text-fg-subtle">RA {p.ra || '—'}</span></button></td>
      <td class="p-2 text-xs text-fg-muted truncate max-w-[10rem]">{p.turmaNome}</td>
      <td class="p-2 text-fg-muted text-xs">{p.nroParcela}ª · {p.tipo.toLowerCase()}</td>
      <td class="p-2 text-xs">{new Date(p.vencimento).toLocaleDateString('pt-BR')}{p.atrasada && <span class="block text-[11px] text-danger">{p.diasAtraso}d em atraso</span>}</td>
      <td class="p-2 text-right font-medium">{money(p.valor)}{p.atrasada && p.valorAtual !== p.valor && <span class="block text-[11px] text-danger">→ {money(p.valorAtual)}</span>}</td>
      <td class="p-2 text-center"><Badge tone={p.atrasada ? 'danger' : SIT_TONE[p.situacao] ?? 'neutral'}>{p.atrasada ? 'Atrasada' : SIT_LABEL[p.situacao] ?? p.situacao}</Badge></td>
      <td class="p-2 text-right whitespace-nowrap">
        {podeAgir && <>
          <button class="text-fg-muted hover:text-accent px-1" title="Gerar 2ª via (Asaas)" onClick={onCobranca}><Send size={14} /></button>
          <button class="text-fg-muted hover:text-success px-1" title="Dar baixa" onClick={onBaixa}><CheckCircle2 size={14} /></button>
        </>}
        {paga && <>
          <button class="text-fg-muted hover:text-accent px-1" title="Recibo (PDF)" onClick={onRecibo}><Receipt size={14} /></button>
          <button class="text-fg-muted hover:text-accent px-1" title="NFS-e" onClick={onNfse}><FileSpreadsheet size={14} /></button>
        </>}
        <button class="text-fg-muted hover:text-accent px-1" title="Extrato do aluno" onClick={onExtrato}><FileText size={14} /></button>
      </td>
    </tr>
  )
}

function NfsePanel({ parcelaId }: { parcelaId: number }) {
  const lista = useNfse(parcelaId)
  const mut = useNfseMut(parcelaId)
  const nf = lista.data?.itens?.[0] ?? null
  const [numero, setNumero] = useState(''); const [serie, setSerie] = useState(''); const [link, setLink] = useState('')
  useEffect(() => { if (nf) { setNumero(nf.numero ?? ''); setSerie(nf.serie ?? ''); setLink(nf.link ?? '') } }, [nf?.id])
  if (lista.isLoading) return <Skeleton class="h-28 w-full" />

  if (!nf) return (
    <div class="space-y-3">
      <p class="text-sm text-fg-muted">Nenhuma NFS-e registrada para este pagamento.</p>
      <p class="text-[11px] text-fg-subtle">A emissão automática depende do provedor da prefeitura. Crie o registro para controlar a nota; depois informe o número emitido.</p>
      <div class="flex justify-end"><Button variant="primary" size="sm" disabled={mut.criar.isPending} onClick={() => mut.criar.mutate()}>Criar registro de NFS-e</Button></div>
    </div>
  )
  return (
    <div class="space-y-3">
      <div class="flex items-center gap-2 text-sm"><Badge tone={nf.status === 'EMITIDA' ? 'success' : nf.status === 'CANCELADA' ? 'danger' : 'warning'}>{nf.status}</Badge><span class="text-fg-muted">{money(nf.valorCentavos)}</span>{nf.emitidaEm && <span class="text-xs text-fg-subtle">em {new Date(nf.emitidaEm).toLocaleDateString('pt-BR')}</span>}</div>
      <div class="grid grid-cols-2 gap-2">
        <Input label="Número da NFS-e" value={numero} onInput={(e) => setNumero((e.target as HTMLInputElement).value)} />
        <Input label="Série" value={serie} onInput={(e) => setSerie((e.target as HTMLInputElement).value)} />
      </div>
      <Input label="Link da nota" value={link} onInput={(e) => setLink((e.target as HTMLInputElement).value)} placeholder="https://…" />
      <p class="text-[11px] text-fg-subtle">Informe o número emitido na prefeitura e marque como emitida. A integração automática com o provedor municipal pode ser plugada depois.</p>
      <div class="flex justify-end gap-2 flex-wrap">
        {nf.link && <a href={nf.link} target="_blank"><Button variant="ghost" size="sm">Abrir nota</Button></a>}
        <Button variant="secondary" size="sm" disabled={mut.registrar.isPending} onClick={() => mut.registrar.mutate({ id: nf.id, numero, serie, link, status: 'EMITIDA' })}>Marcar emitida</Button>
        {nf.status !== 'CANCELADA' && <Button variant="ghost" size="sm" disabled={mut.registrar.isPending} onClick={() => mut.registrar.mutate({ id: nf.id, status: 'CANCELADA' })}>Cancelar nota</Button>}
      </div>
    </div>
  )
}

function TermoForm({ onClose }: { onClose: () => void }) {
  const q = useContratoTermo()
  const mut = useContratoTermoMut()
  const [txt, setTxt] = useState('')
  useEffect(() => { if (q.data?.termo) setTxt(q.data.termo) }, [q.data?.termo])
  if (q.isLoading) return <Skeleton class="h-48 w-full" />
  return (
    <div class="space-y-3">
      <p class="text-[11px] text-fg-subtle">Texto exibido ao aluno no portal para aceite. Variáveis: {'{nome} {ra} {curso} {turma} {valorTotal} {numParcelas} {valorParcela}'}</p>
      <Textarea rows={14} value={txt} onInput={(e) => setTxt((e.target as HTMLTextAreaElement).value)} />
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" size="sm" disabled={mut.isPending} onClick={() => mut.mutate(txt, { onSuccess: onClose })}>Salvar termo</Button>
      </div>
    </div>
  )
}

function ExtratoView({ alunoId }: { alunoId: number }) {
  const ex = useExtrato(alunoId)
  if (ex.isLoading || !ex.data) return <Skeleton class="h-40 w-full" />
  const d = ex.data
  const contrato = d.contratos[0]
  return (
    <div class="space-y-3">
      {contrato && <div class="text-xs flex items-center gap-2">
        <span class="text-fg-muted">Contrato:</span>
        {contrato.aceiteEm ? <Badge tone="success">Aceito em {new Date(contrato.aceiteEm).toLocaleDateString('pt-BR')}{contrato.aceiteNome ? ` · ${contrato.aceiteNome}` : ''}</Badge> : <Badge tone="warning">Aceite pendente</Badge>}
      </div>}
      <div class="grid grid-cols-3 gap-2 text-center">
        <Card class="py-2"><div class="text-[11px] text-fg-muted">Pago</div><div class="text-sm font-semibold text-success">{money(d.totais.pago)}</div></Card>
        <Card class="py-2"><div class="text-[11px] text-fg-muted">Em aberto</div><div class="text-sm font-semibold">{money(d.totais.aberto)}</div></Card>
        <Card class="py-2"><div class="text-[11px] text-fg-muted">Vencido</div><div class={`text-sm font-semibold ${d.totais.vencido > 0 ? 'text-danger' : ''}`}>{money(d.totais.vencido)}</div></Card>
      </div>
      <div class="max-h-[50vh] overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface-2 text-xs text-fg-muted sticky top-0"><tr><th class="text-left p-2">Parcela</th><th class="text-left p-2">Vencimento</th><th class="text-right p-2">Valor</th><th class="text-center p-2">Situação</th></tr></thead>
          <tbody class="divide-y divide-border">
            {d.parcelas.map((p) => (
              <tr key={p.id}>
                <td class="p-2 text-fg-muted text-xs">{p.nroParcela}ª · {p.tipo.toLowerCase()}</td>
                <td class="p-2 text-xs">{new Date(p.vencimento).toLocaleDateString('pt-BR')}</td>
                <td class="p-2 text-right">{money(p.valor)}</td>
                <td class="p-2 text-center"><Badge tone={p.atrasada ? 'danger' : SIT_TONE[p.situacao] ?? 'neutral'}>{p.atrasada ? 'Atrasada' : SIT_LABEL[p.situacao] ?? p.situacao}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
