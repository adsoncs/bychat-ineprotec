import { useState, useEffect, useRef } from 'preact/hooks'
import { Handshake, Plus, Trash2, Paperclip, Download, Search, ChevronLeft } from 'lucide-preact'
import {
  useNegotiations, useNegotiation, useSaveNegotiation, useDeleteNegotiation,
  useCloseNegotiation, useUploadNegotiationAttachment, useDeleteNegotiationAttachment,
  useCatalogPick, type Negotiation, type NegItem,
} from '@/hooks/useNegotiations'
import { useLossReasons } from '@/hooks/useLeadOutcome'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'

type Tone = 'info' | 'success' | 'danger' | 'warning' | 'neutral'
const STATUS: Record<string, { label: string; tone: Tone }> = {
  rascunho: { label: 'Rascunho', tone: 'neutral' },
  enviada: { label: 'Enviada', tone: 'info' },
  em_negociacao: { label: 'Em negociação', tone: 'warning' },
  aceita: { label: 'Aceita', tone: 'success' },
  recusada: { label: 'Recusada', tone: 'danger' },
  expirada: { label: 'Expirada', tone: 'neutral' },
}
const money = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00' }
const num = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0 }

interface Row { productId: number | null; nome: string; quantidade: number; precoUnit: number; descontoItem: number }

function CatalogSearch({ onPick }: { onPick: (r: Row) => void }) {
  const [q, setQ] = useState('')
  const { data } = useCatalogPick(q)
  return (
    <div class="relative">
      <div class="relative">
        <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
        <input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Buscar produto no catálogo…" class="w-full pl-8 pr-2 py-1.5 rounded-md bg-surface border border-border text-sm text-fg" />
      </div>
      {q.trim().length >= 2 && data?.products?.length ? (
        <div class="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-md border border-border bg-surface shadow-lg">
          {data.products.map((p) => (
            <button key={p.id} type="button" class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 flex justify-between gap-2"
              onClick={() => { onPick({ productId: p.id, nome: p.nome, quantidade: 1, precoUnit: num(p.preco), descontoItem: 0 }); setQ('') }}>
              <span class="truncate">{p.nome} <span class="text-fg-subtle">· {p.categoria}</span></span>
              <span class="text-fg-muted shrink-0">{money(p.preco)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function NegotiationEditor({ leadId, id, onBack }: { leadId: number; id: number | 'new'; onBack: () => void }) {
  const isNew = id === 'new'
  const { data, isLoading } = useNegotiation(isNew ? null : (id as number))
  const save = useSaveNegotiation(leadId)
  const del = useDeleteNegotiation(leadId)
  const close = useCloseNegotiation(leadId)
  const upload = useUploadNegotiationAttachment(leadId)
  const delAtt = useDeleteNegotiationAttachment(leadId)
  const lossReasons = useLossReasons()
  const fileRef = useRef<HTMLInputElement>(null)

  const n = data?.negotiation
  const [titulo, setTitulo] = useState('Proposta')
  const [status, setStatus] = useState('rascunho')
  const [rows, setRows] = useState<Row[]>([])
  const [descontoTipo, setDescontoTipo] = useState<'valor' | 'percent'>('valor')
  const [descontoValor, setDescontoValor] = useState('')
  const [frete, setFrete] = useState('')
  const [pagamentoForma, setPagamentoForma] = useState('')
  const [parcelas, setParcelas] = useState('')
  const [entrada, setEntrada] = useState('')
  const [condicao, setCondicao] = useState('')
  const [probabilidade, setProbabilidade] = useState('')
  const [validadeAte, setValidade] = useState('')
  const [obs, setObs] = useState('')
  const [loaded, setLoaded] = useState(isNew)
  const [lostReasonId, setLostReasonId] = useState('')

  useEffect(() => {
    if (!n || loaded) return
    setTitulo(n.titulo); setStatus(n.status)
    setRows((n.items || []).map((i: NegItem) => ({ productId: i.productId ?? null, nome: i.nome, quantidade: i.quantidade, precoUnit: num(i.precoUnit), descontoItem: num(i.descontoItem) })))
    setDescontoTipo((n.descontoTipo as any) || 'valor'); setDescontoValor(n.descontoValor != null ? String(n.descontoValor) : '')
    setFrete(n.frete != null ? String(n.frete) : ''); setPagamentoForma(n.pagamentoForma || ''); setParcelas(n.parcelas != null ? String(n.parcelas) : '')
    setEntrada(n.entrada != null ? String(n.entrada) : ''); setCondicao(n.condicaoPagamento || '')
    setProbabilidade(n.probabilidade != null ? String(n.probabilidade) : ''); setValidade(n.validadeAte ? n.validadeAte.slice(0, 10) : ''); setObs(n.observacoes || '')
    setLoaded(true)
  }, [n, loaded])

  if (!isNew && isLoading) return <Skeleton class="h-64 w-full" />

  const valorTabela = rows.reduce((s, r) => s + Math.max(0, r.precoUnit * r.quantidade - (r.descontoItem || 0)), 0)
  const desc = descontoValor ? (descontoTipo === 'percent' ? valorTabela * (num(descontoValor) / 100) : num(descontoValor)) : 0
  const valorFinal = Math.max(0, valorTabela - desc + num(frete))
  const closed = !!n?.resultado

  function setRow(i: number, patch: Partial<Row>) { setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r)) }
  function submit(nextStatus?: string) {
    const payload = {
      id: isNew ? undefined : (id as number), titulo, status: nextStatus || status,
      items: rows, descontoTipo, descontoValor: descontoValor ? num(descontoValor) : null, frete: frete ? num(frete) : null,
      pagamentoForma: pagamentoForma || null, parcelas: parcelas ? num(parcelas) : null, entrada: entrada ? num(entrada) : null,
      condicaoPagamento: condicao || null, probabilidade: probabilidade ? num(probabilidade) : null,
      validadeAte: validadeAte || null, observacoes: obs || null,
    }
    save.mutate(payload as any, {
      onSuccess: (r: any) => { toast('Negociação salva', 'success'); if (isNew && r?.negotiation?.id) onBack() },
      onError: (e: unknown) => toast((e as Error).message || 'Erro ao salvar', 'danger'),
    })
  }
  function doClose(resultado: 'won' | 'lost') {
    if (isNew) { toast('Salve a negociação primeiro', 'warning'); return }
    close.mutate({ id: id as number, resultado, lostReasonId: resultado === 'lost' && lostReasonId ? Number(lostReasonId) : undefined, valorFinal }, {
      onSuccess: () => toast(resultado === 'won' ? 'Negociação ganha 🎉' : 'Negociação perdida', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-4">
      <button type="button" class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg" onClick={onBack}><ChevronLeft size={15} /> Voltar</button>

      <Card>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="md:col-span-2"><Input label="Título da proposta" value={titulo} onInput={(e) => setTitulo((e.target as HTMLInputElement).value)} /></div>
          <div>
            <label class="block text-xs font-medium text-fg mb-1">Status</label>
            <Select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      {/* Itens */}
      <Card>
        <div class="text-sm font-semibold text-fg mb-2">Itens</div>
        {!closed ? <div class="mb-3"><CatalogSearch onPick={(r) => setRows((rs) => [...rs, r])} /></div> : null}
        {rows.length === 0 ? <p class="text-xs text-fg-subtle">Nenhum item. Busque no catálogo acima ou adicione um item livre.</p> : (
          <div class="space-y-2">
            {rows.map((r, i) => (
              <div key={i} class="grid grid-cols-12 gap-2 items-center">
                <input class="col-span-5 px-2 py-1.5 rounded bg-surface border border-border text-sm" placeholder="Item" value={r.nome} onInput={(e) => setRow(i, { nome: (e.target as HTMLInputElement).value })} />
                <input class="col-span-1 px-2 py-1.5 rounded bg-surface border border-border text-sm" type="number" min={1} value={String(r.quantidade)} onInput={(e) => setRow(i, { quantidade: Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1) })} />
                <input class="col-span-2 px-2 py-1.5 rounded bg-surface border border-border text-sm" placeholder="Preço" value={String(r.precoUnit)} onInput={(e) => setRow(i, { precoUnit: num((e.target as HTMLInputElement).value) })} />
                <input class="col-span-2 px-2 py-1.5 rounded bg-surface border border-border text-sm" placeholder="Desc." value={String(r.descontoItem)} onInput={(e) => setRow(i, { descontoItem: num((e.target as HTMLInputElement).value) })} />
                <span class="col-span-1 text-xs text-fg-muted text-right">{money(Math.max(0, r.precoUnit * r.quantidade - r.descontoItem))}</span>
                <button type="button" class="col-span-1 text-fg-subtle hover:text-danger justify-self-end" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
        {!closed ? <Button size="sm" variant="ghost" class="mt-2" onClick={() => setRows((rs) => [...rs, { productId: null, nome: '', quantidade: 1, precoUnit: 0, descontoItem: 0 }])}><Plus size={13} /> Item livre</Button> : null}
      </Card>

      {/* Valores + pagamento */}
      <Card>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs font-medium text-fg mb-1">Desconto</label>
            <div class="flex gap-1">
              <Select value={descontoTipo} onChange={(e) => setDescontoTipo((e.target as HTMLSelectElement).value as any)} class="w-20"><option value="valor">R$</option><option value="percent">%</option></Select>
              <Input value={descontoValor} onInput={(e) => setDescontoValor((e.target as HTMLInputElement).value)} />
            </div>
          </div>
          <Input label="Frete/acréscimo (R$)" value={frete} onInput={(e) => setFrete((e.target as HTMLInputElement).value)} />
          <Input label="Probabilidade (%)" type="number" value={probabilidade} onInput={(e) => setProbabilidade((e.target as HTMLInputElement).value)} />
          <Input label="Validade da proposta" type="date" value={validadeAte} onInput={(e) => setValidade((e.target as HTMLInputElement).value)} />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
          <div>
            <label class="block text-xs font-medium text-fg mb-1">Forma de pagamento</label>
            <Select value={pagamentoForma} onChange={(e) => setPagamentoForma((e.target as HTMLSelectElement).value)}>
              <option value="">—</option><option value="pix">PIX</option><option value="cartao">Cartão</option><option value="boleto">Boleto</option><option value="dinheiro">Dinheiro</option>
            </Select>
          </div>
          <Input label="Parcelas" type="number" value={parcelas} onInput={(e) => setParcelas((e.target as HTMLInputElement).value)} />
          <Input label="Entrada (R$)" value={entrada} onInput={(e) => setEntrada((e.target as HTMLInputElement).value)} />
          <div class="flex flex-col justify-end">
            <div class="text-xs text-fg-muted">Valor de tabela: {money(valorTabela)}</div>
            <div class="text-base font-semibold text-fg">Total: {money(valorFinal)}</div>
          </div>
        </div>
        <div class="mt-3"><Textarea label="Condição de pagamento / observações" rows={2} value={condicao} onInput={(e) => setCondicao((e.target as HTMLTextAreaElement).value)} /></div>
        <div class="mt-3"><Textarea label="Observações internas" rows={2} value={obs} onInput={(e) => setObs((e.target as HTMLTextAreaElement).value)} /></div>
      </Card>

      {/* Anexos (só p/ negociação salva) */}
      {!isNew ? (
        <Card>
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm font-semibold text-fg flex items-center gap-1.5"><Paperclip size={14} /> Proposta / anexos</div>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>{upload.isPending ? 'Enviando…' : 'Anexar arquivo'}</Button>
            <input ref={fileRef} type="file" class="hidden" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) upload.mutate({ id: id as number, file: f }, { onSuccess: () => toast('Anexado', 'success'), onError: (er: unknown) => toast((er as Error).message, 'danger') }); if (fileRef.current) fileRef.current.value = '' }} />
          </div>
          {(n?.attachments || []).length === 0 ? <p class="text-xs text-fg-subtle">Nenhum anexo. Anexe a proposta enviada ao cliente.</p> : (
            <div class="space-y-1">
              {n!.attachments!.map((a) => (
                <div key={a.id} class="flex items-center gap-2 text-sm">
                  <a href={a.url} target="_blank" rel="noopener" class="text-info hover:underline inline-flex items-center gap-1 flex-1 truncate"><Download size={13} /> {a.fileName}</a>
                  <button type="button" class="text-fg-subtle hover:text-danger" onClick={() => delAtt.mutate(a.id)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {/* Ações */}
      <div class="flex flex-wrap items-center gap-2">
        {!closed ? (
          <>
            <Button variant="primary" size="sm" onClick={() => submit()} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
            {!isNew ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => doClose('won')} disabled={close.isPending}>✅ Ganha</Button>
                <div class="flex items-center gap-1">
                  <Select value={lostReasonId} onChange={(e) => setLostReasonId((e.target as HTMLSelectElement).value)} class="w-40"><option value="">Motivo da perda…</option>{(lossReasons.data?.data || []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
                  <Button variant="ghost" size="sm" onClick={() => doClose('lost')} disabled={close.isPending}>❌ Perdida</Button>
                </div>
                <div class="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => { if (confirm('Excluir esta negociação?')) del.mutate(id as number, { onSuccess: () => onBack() }) }}><Trash2 size={14} /></Button>
              </>
            ) : null}
          </>
        ) : (
          <Badge tone={n?.resultado === 'won' ? 'success' : 'danger'}>{n?.resultado === 'won' ? `Ganha · ${money(n?.valorFinal)}` : `Perdida${n?.lostReason ? ' · ' + n.lostReason.name : ''}`}</Badge>
        )}
      </div>
    </div>
  )
}

export function LeadNegotiationTab({ leadId }: { leadId: number }) {
  const [selected, setSelected] = useState<number | 'new' | null>(null)
  const { data, isLoading } = useNegotiations(leadId)
  const list = data?.negotiations || []

  if (selected !== null) return <NegotiationEditor leadId={leadId} id={selected} onBack={() => setSelected(null)} />

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-fg">Negociações</div>
        <Button size="sm" variant="primary" onClick={() => setSelected('new')}><Plus size={14} /> Nova negociação</Button>
      </div>
      {isLoading ? <Skeleton class="h-24 w-full" /> : list.length === 0 ? (
        <EmptyState icon={Handshake} title="Nenhuma negociação" description="Crie uma proposta: itens do catálogo, valores, desconto, condição de pagamento e anexe a proposta enviada." />
      ) : (
        <div class="space-y-2">
          {list.map((neg: Negotiation) => {
            const st = neg.resultado === 'won' ? { label: 'Ganha', tone: 'success' as Tone } : neg.resultado === 'lost' ? { label: 'Perdida', tone: 'danger' as Tone } : (STATUS[neg.status] || STATUS.rascunho)
            return (
              <Card key={neg.id}>
                <button type="button" class="w-full text-left flex items-center gap-3" onClick={() => setSelected(neg.id)}>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-medium text-fg truncate">{neg.titulo}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {neg.probabilidade != null && !neg.resultado ? <span class="text-xs text-fg-subtle">{neg.probabilidade}%</span> : null}
                    </div>
                    <div class="text-xs text-fg-muted mt-0.5">
                      {money(neg.valorFinal)}
                      {neg._count?.items ? <> · {neg._count.items} item(ns)</> : null}
                      {neg._count?.attachments ? <> · {neg._count.attachments} anexo(s)</> : null}
                    </div>
                  </div>
                  <span class="text-base font-semibold text-fg shrink-0">{money(neg.valorFinal)}</span>
                </button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
