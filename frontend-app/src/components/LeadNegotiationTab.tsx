import { useState, useEffect, useRef } from 'preact/hooks'
import { Handshake, Plus, Trash2, Paperclip, Download, Search, ChevronLeft, RotateCcw } from 'lucide-preact'
import {
  useNegotiations, useNegotiation, useSaveNegotiation, useDeleteNegotiation,
  useCloseNegotiation, useReopenNegotiation, useUploadNegotiationAttachment, useDeleteNegotiationAttachment,
  useCatalogPick, useNegotiationSuggestion, type Negotiation, type NegItem,
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

// Estado do formulário num objeto só: qualquer patch marca "alterações não salvas".
interface Form {
  titulo: string; status: string; rows: Row[]
  descontoTipo: 'valor' | 'percent'; descontoValor: string; acrescimos: string
  pagamentoForma: string; parcelas: string; entrada: string; condicao: string
  probabilidade: string; validadeAte: string; obs: string
}
const EMPTY_FORM: Form = {
  titulo: 'Proposta', status: 'rascunho', rows: [],
  descontoTipo: 'valor', descontoValor: '', acrescimos: '',
  pagamentoForma: '', parcelas: '', entrada: '', condicao: '',
  probabilidade: '', validadeAte: '', obs: '',
}

function CatalogSearch({ onPick }: { onPick: (r: Row) => void }) {
  const [q, setQ] = useState('')
  const { data } = useCatalogPick(q)
  return (
    <div class="relative">
      <div class="relative">
        <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
        <input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Buscar item no catálogo…" class="w-full pl-8 pr-2 py-1.5 rounded-md bg-surface border border-border text-sm text-fg" />
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

/** Linha do resumo financeiro (Subtotal − Desconto + Acréscimos = Total). */
function SummaryRow({ label, value, sign, strong }: { label: string; value: string; sign?: '+' | '−'; strong?: boolean }) {
  return (
    <div class={`flex items-baseline justify-between gap-2 ${strong ? 'text-fg font-semibold text-base' : 'text-sm text-fg-muted'}`}>
      <span>{label}</span>
      <span class="tabular-nums">{sign ? `${sign} ` : ''}{value}</span>
    </div>
  )
}

function NegotiationEditor({ leadId, id, onBack }: { leadId: number; id: number | 'new'; onBack: () => void }) {
  const isNew = id === 'new'
  const { data, isLoading } = useNegotiation(isNew ? null : (id as number))
  const save = useSaveNegotiation(leadId)
  const del = useDeleteNegotiation(leadId)
  const close = useCloseNegotiation(leadId)
  const reopen = useReopenNegotiation(leadId)
  const upload = useUploadNegotiationAttachment(leadId)
  const delAtt = useDeleteNegotiationAttachment(leadId)
  const lossReasons = useLossReasons()
  const fileRef = useRef<HTMLInputElement>(null)

  const n = data?.negotiation
  const [f, setF] = useState<Form>(EMPTY_FORM)
  const [dirty, setDirty] = useState(false)
  const [loaded, setLoaded] = useState(isNew)
  const [lostReasonId, setLostReasonId] = useState('')
  // Proposta nova: o backend sugere curso + valor de tabela e as condições que o
  // lead já trouxe do CRM antigo. Só preenche enquanto o operador não digitou nada.
  const { data: sugData } = useNegotiationSuggestion(isNew ? leadId : null)
  const [prefilled, setPrefilled] = useState(false)

  function patch(p: Partial<Form>) { setF((cur) => ({ ...cur, ...p })); setDirty(true) }

  useEffect(() => {
    const s = sugData?.suggestion
    if (!isNew || !s || prefilled || dirty) return
    setF((cur) => ({
      ...cur,
      titulo: s.titulo || cur.titulo,
      rows: s.items.map((i) => ({
        productId: i.productId, nome: i.nome, quantidade: i.quantidade,
        precoUnit: i.precoUnit, descontoItem: i.descontoItem,
      })),
      pagamentoForma: s.pagamentoForma || cur.pagamentoForma,
      parcelas: s.parcelas != null ? String(s.parcelas) : cur.parcelas,
      descontoTipo: s.descontoTipo ?? cur.descontoTipo,
      descontoValor: s.descontoValor != null ? String(s.descontoValor) : cur.descontoValor,
      condicao: s.condicaoPagamento || cur.condicao,
    }))
    setPrefilled(true)
  }, [sugData?.suggestion, isNew, prefilled, dirty])

  useEffect(() => {
    if (!n || loaded) return
    setF({
      titulo: n.titulo, status: n.status,
      rows: (n.items || []).map((i: NegItem) => ({ productId: i.productId ?? null, nome: i.nome, quantidade: i.quantidade, precoUnit: num(i.precoUnit), descontoItem: num(i.descontoItem) })),
      descontoTipo: (n.descontoTipo as any) || 'valor',
      descontoValor: n.descontoValor != null ? String(n.descontoValor) : '',
      acrescimos: n.frete != null ? String(n.frete) : '',
      pagamentoForma: n.pagamentoForma || '',
      parcelas: n.parcelas != null ? String(n.parcelas) : '',
      entrada: n.entrada != null ? String(n.entrada) : '',
      condicao: n.condicaoPagamento || '',
      probabilidade: n.probabilidade != null ? String(n.probabilidade) : '',
      validadeAte: n.validadeAte ? n.validadeAte.slice(0, 10) : '',
      obs: n.observacoes || '',
    })
    setDirty(false)
    setLoaded(true)
  }, [n, loaded])

  if (!isNew && isLoading) return <Skeleton class="h-64 w-full" />

  // ── Conta explícita: Subtotal − Desconto + Acréscimos = Total ──
  const subtotal = f.rows.reduce((s, r) => s + Math.max(0, r.precoUnit * r.quantidade - (r.descontoItem || 0)), 0)
  const desconto = f.descontoValor ? (f.descontoTipo === 'percent' ? subtotal * (num(f.descontoValor) / 100) : num(f.descontoValor)) : 0
  const acrescimos = num(f.acrescimos)
  const total = Math.max(0, subtotal - desconto + acrescimos)
  // Entrada abate do total → saldo parcelado (se houver parcelas).
  const entrada = num(f.entrada)
  const saldo = Math.max(0, total - entrada)
  const nParcelas = Math.max(0, Math.round(num(f.parcelas)))
  const valorParcela = nParcelas > 0 ? saldo / nParcelas : 0
  const closed = !!n?.resultado
  // Desconto por item só aparece se algum item antigo já tiver (legado) — novos usam o desconto geral.
  const hasItemDesc = f.rows.some((r) => (r.descontoItem || 0) > 0)

  function setRow(i: number, p: Partial<Row>) { patch({ rows: f.rows.map((r, idx) => idx === i ? { ...r, ...p } : r) }) }
  function submit() {
    if (!f.rows.length && !confirm('Salvar sem nenhum item?')) return
    const payload = {
      id: isNew ? undefined : (id as number), titulo: f.titulo, status: f.status,
      items: f.rows, descontoTipo: f.descontoTipo, descontoValor: f.descontoValor ? num(f.descontoValor) : null, frete: f.acrescimos ? acrescimos : null,
      pagamentoForma: f.pagamentoForma || null, parcelas: f.parcelas ? nParcelas : null, entrada: f.entrada ? entrada : null,
      condicaoPagamento: f.condicao || null, probabilidade: f.probabilidade ? num(f.probabilidade) : null,
      validadeAte: f.validadeAte || null, observacoes: f.obs || null,
    }
    save.mutate(payload as any, {
      onSuccess: () => { setDirty(false); toast('Negociação salva', 'success'); if (isNew) onBack() },
      onError: (e: unknown) => toast((e as Error).message || 'Erro ao salvar', 'danger'),
    })
  }
  function doClose(resultado: 'won' | 'lost') {
    if (isNew) { toast('Salve a negociação primeiro', 'warning'); return }
    if (dirty) { toast('Salve as alterações antes de fechar', 'warning'); return }
    if (resultado === 'lost' && !lostReasonId && (lossReasons.data?.data || []).length > 0 && !confirm('Fechar como perdida sem informar o motivo?')) return
    close.mutate({ id: id as number, resultado, lostReasonId: resultado === 'lost' && lostReasonId ? Number(lostReasonId) : undefined, valorFinal: total }, {
      onSuccess: () => toast(resultado === 'won' ? 'Negociação ganha 🎉 — valor registrado no lead' : 'Negociação perdida', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  function goBack() {
    if (dirty && !confirm('Há alterações não salvas. Sair mesmo assim?')) return
    onBack()
  }

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <button type="button" class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg" onClick={goBack}><ChevronLeft size={15} /> Voltar</button>
        {closed ? (
          <Badge tone={n?.resultado === 'won' ? 'success' : 'danger'}>
            {n?.resultado === 'won' ? `Ganha · ${money(n?.valorFinal)}` : `Perdida${n?.lostReason ? ' · ' + n.lostReason.name : ''}`}
          </Badge>
        ) : null}
      </div>

      {/* Rascunho pré-preenchido com o que o lead trouxe do CRM de origem */}
      {isNew && prefilled ? (
        <Card class="!p-3 bg-accent/5 border-accent/30">
          <div class="text-sm text-fg-muted">
            Rascunho preenchido com os dados de <strong class="text-fg">{sugData?.suggestion?.origem === 'kommo' ? 'Kommo' : 'origem'}</strong> deste
            lead (curso, valor de tabela e condições). Revise antes de salvar.
          </div>
        </Card>
      ) : null}

      {/* Negociação fechada: banner com resultado + reabrir */}
      {closed ? (
        <Card class="!p-3 bg-surface-2/50">
          <div class="flex items-center gap-3 flex-wrap">
            <div class="text-sm text-fg flex-1 min-w-40">
              Esta negociação foi fechada como <strong>{n?.resultado === 'won' ? 'ganha' : 'perdida'}</strong>
              {n?.fechadaEm ? <> em {new Date(n.fechadaEm).toLocaleDateString('pt-BR')}</> : null} e está travada para edição.
            </div>
            <Button size="sm" variant="ghost" onClick={() => reopen.mutate(id as number, { onSuccess: () => { setLoaded(false); toast('Negociação reaberta', 'success') }, onError: (e: unknown) => toast((e as Error).message, 'danger') })} disabled={reopen.isPending}>
              <RotateCcw size={13} /> {reopen.isPending ? 'Reabrindo…' : 'Reabrir para editar'}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Dados básicos */}
      <Card>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div class="md:col-span-2"><Input label="Título" value={f.titulo} disabled={closed} onInput={(e) => patch({ titulo: (e.target as HTMLInputElement).value })} /></div>
          <div>
            <label class="block text-xs font-medium text-fg mb-1">Status</label>
            <Select value={f.status} disabled={closed} onChange={(e) => patch({ status: (e.target as HTMLSelectElement).value })}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </div>
          <Input label="Válida até" type="date" value={f.validadeAte} disabled={closed} onInput={(e) => patch({ validadeAte: (e.target as HTMLInputElement).value })} />
        </div>
      </Card>

      {/* Itens */}
      <Card>
        <div class="text-sm font-semibold text-fg mb-2">Itens</div>
        {!closed ? <div class="mb-3"><CatalogSearch onPick={(r) => patch({ rows: [...f.rows, r] })} /></div> : null}
        {f.rows.length === 0 ? <p class="text-xs text-fg-subtle">Nenhum item ainda. Busque no catálogo acima ou clique em "Adicionar item".</p> : (
          <div class="space-y-1.5">
            {/* Cabeçalho das colunas — evita adivinhar o que é cada campo */}
            <div class="grid grid-cols-12 gap-2 text-[11px] font-medium text-fg-subtle px-0.5">
              <span class={hasItemDesc ? 'col-span-4' : 'col-span-5'}>Item</span>
              <span class="col-span-1 text-center">Qtd</span>
              <span class="col-span-2">Valor unit. (R$)</span>
              {hasItemDesc ? <span class="col-span-2">Desc. item (R$)</span> : null}
              <span class={hasItemDesc ? 'col-span-2 text-right' : 'col-span-3 text-right'}>Subtotal</span>
            </div>
            {f.rows.map((r, i) => (
              <div key={i} class="grid grid-cols-12 gap-2 items-center">
                <input class={`${hasItemDesc ? 'col-span-4' : 'col-span-5'} px-2 py-1.5 rounded bg-surface border border-border text-sm disabled:opacity-60`} placeholder="Descrição do item" disabled={closed} value={r.nome} onInput={(e) => setRow(i, { nome: (e.target as HTMLInputElement).value })} />
                <input class="col-span-1 px-1 py-1.5 rounded bg-surface border border-border text-sm text-center disabled:opacity-60" type="number" min={1} disabled={closed} value={String(r.quantidade)} onInput={(e) => setRow(i, { quantidade: Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1) })} />
                <input class="col-span-2 px-2 py-1.5 rounded bg-surface border border-border text-sm disabled:opacity-60" inputMode="decimal" disabled={closed} value={String(r.precoUnit)} onInput={(e) => setRow(i, { precoUnit: num((e.target as HTMLInputElement).value) })} />
                {hasItemDesc ? <input class="col-span-2 px-2 py-1.5 rounded bg-surface border border-border text-sm disabled:opacity-60" inputMode="decimal" disabled={closed} value={String(r.descontoItem)} onInput={(e) => setRow(i, { descontoItem: num((e.target as HTMLInputElement).value) })} /> : null}
                <span class={`${hasItemDesc ? 'col-span-2' : 'col-span-3'} text-sm text-fg tabular-nums text-right`}>{money(Math.max(0, r.precoUnit * r.quantidade - (r.descontoItem || 0)))}</span>
                {!closed ? <button type="button" class="col-span-1 text-fg-subtle hover:text-danger justify-self-end" title="Remover item" onClick={() => patch({ rows: f.rows.filter((_, idx) => idx !== i) })}><Trash2 size={14} /></button> : <span class="col-span-1" />}
              </div>
            ))}
          </div>
        )}
        {!closed ? <Button size="sm" variant="ghost" class="mt-2" onClick={() => patch({ rows: [...f.rows, { productId: null, nome: '', quantidade: 1, precoUnit: 0, descontoItem: 0 }] })}><Plus size={13} /> Adicionar item</Button> : null}
      </Card>

      {/* Valores e pagamento + resumo lado a lado */}
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card class="lg:col-span-2">
          <div class="text-sm font-semibold text-fg mb-2">Valores e pagamento</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-medium text-fg mb-1">Desconto</label>
              <div class="flex gap-1">
                <Select value={f.descontoTipo} disabled={closed} onChange={(e) => patch({ descontoTipo: (e.target as HTMLSelectElement).value as any })} class="w-20"><option value="valor">R$</option><option value="percent">%</option></Select>
                <Input value={f.descontoValor} disabled={closed} onInput={(e) => patch({ descontoValor: (e.target as HTMLInputElement).value })} />
              </div>
            </div>
            <Input label="Acréscimos (frete, taxas…) R$" value={f.acrescimos} disabled={closed} onInput={(e) => patch({ acrescimos: (e.target as HTMLInputElement).value })} />
            <div>
              <label class="block text-xs font-medium text-fg mb-1">Forma de pagamento</label>
              <Select value={f.pagamentoForma} disabled={closed} onChange={(e) => patch({ pagamentoForma: (e.target as HTMLSelectElement).value })}>
                <option value="">—</option><option value="pix">PIX</option><option value="cartao">Cartão</option><option value="boleto">Boleto</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="financiamento">Financiamento</option><option value="outro">Outro</option>
              </Select>
            </div>
            <Input label="Entrada / sinal (R$)" value={f.entrada} disabled={closed} onInput={(e) => patch({ entrada: (e.target as HTMLInputElement).value })} />
            <Input label="Parcelas do saldo" type="number" min={0} value={f.parcelas} disabled={closed} onInput={(e) => patch({ parcelas: (e.target as HTMLInputElement).value })} />
            <Input label="Chance de fechar (%)" type="number" min={0} max={100} value={f.probabilidade} disabled={closed} onInput={(e) => patch({ probabilidade: (e.target as HTMLInputElement).value })} />
          </div>
          <div class="mt-3"><Textarea label="Condições combinadas (visível na proposta)" rows={2} disabled={closed} value={f.condicao} onInput={(e) => patch({ condicao: (e.target as HTMLTextAreaElement).value })} /></div>
          <div class="mt-3"><Textarea label="Observações internas (não vai para o cliente)" rows={2} disabled={closed} value={f.obs} onInput={(e) => patch({ obs: (e.target as HTMLTextAreaElement).value })} /></div>
        </Card>

        {/* Resumo — a conta inteira, sempre visível e ao vivo */}
        <Card class="!p-4 h-fit lg:sticky lg:top-2">
          <div class="text-sm font-semibold text-fg mb-3">Resumo</div>
          <div class="space-y-1.5">
            <SummaryRow label={`Subtotal (${f.rows.length} ${f.rows.length === 1 ? 'item' : 'itens'})`} value={money(subtotal)} />
            {desconto > 0 ? <SummaryRow label={`Desconto${f.descontoTipo === 'percent' ? ` (${num(f.descontoValor)}%)` : ''}`} value={money(desconto)} sign="−" /> : null}
            {acrescimos > 0 ? <SummaryRow label="Acréscimos" value={money(acrescimos)} sign="+" /> : null}
            <div class="border-t border-border my-2" />
            <SummaryRow label="Total" value={money(total)} strong />
            {entrada > 0 ? (
              <>
                <SummaryRow label="Entrada" value={money(entrada)} sign="−" />
                <SummaryRow label={nParcelas > 0 ? `Saldo em ${nParcelas}× de ${money(valorParcela)}` : 'Saldo'} value={money(saldo)} />
                {entrada > total ? <p class="text-[11px] text-danger">⚠ Entrada maior que o total.</p> : null}
              </>
            ) : nParcelas > 0 && total > 0 ? (
              <SummaryRow label={`${nParcelas}× de ${money(valorParcela)}`} value={money(total)} />
            ) : null}
          </div>
        </Card>
      </div>

      {/* Anexos (só p/ negociação salva) */}
      {!isNew ? (
        <Card>
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm font-semibold text-fg flex items-center gap-1.5"><Paperclip size={14} /> Proposta / anexos</div>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>{upload.isPending ? 'Enviando…' : 'Anexar arquivo'}</Button>
            <input ref={fileRef} type="file" class="hidden" onChange={(e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (file) upload.mutate({ id: id as number, file }, { onSuccess: () => toast('Anexado', 'success'), onError: (er: unknown) => toast((er as Error).message, 'danger') }); if (fileRef.current) fileRef.current.value = '' }} />
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

      {/* Fechar negociação — bloco explícito, separado do salvar */}
      {!isNew && !closed ? (
        <Card class="!p-4">
          <div class="text-sm font-semibold text-fg mb-1">Fechar negociação</div>
          <p class="text-xs text-fg-muted mb-3">Ganha registra o total de {money(total)} como valor de venda do lead; perdida registra o motivo. Ambas atualizam os relatórios.</p>
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => doClose('won')} disabled={close.isPending}>✅ Marcar como ganha</Button>
            <div class="flex items-center gap-1">
              <Select value={lostReasonId} onChange={(e) => setLostReasonId((e.target as HTMLSelectElement).value)} class="w-44"><option value="">Motivo da perda…</option>{(lossReasons.data?.data || []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
              <Button variant="ghost" size="sm" onClick={() => doClose('lost')} disabled={close.isPending}>❌ Marcar como perdida</Button>
            </div>
            <div class="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => { if (confirm('Excluir esta negociação?')) del.mutate(id as number, { onSuccess: () => onBack() }) }}><Trash2 size={14} /> Excluir</Button>
          </div>
        </Card>
      ) : null}

      {/* Barra fixa: total + salvar SEMPRE à vista */}
      {!closed ? (
        <div class="sticky bottom-0 z-10 pt-1">
          <Card class="!p-3 shadow-lg border-border">
            <div class="flex items-center gap-3 flex-wrap">
              <div class="text-sm text-fg-muted">Total: <span class="text-base font-semibold text-fg tabular-nums">{money(total)}</span></div>
              {dirty ? <Badge tone="warning">alterações não salvas</Badge> : !isNew ? <span class="text-xs text-fg-subtle">tudo salvo</span> : null}
              <div class="flex-1" />
              <Button variant="primary" size="sm" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : isNew ? 'Criar negociação' : 'Salvar alterações'}</Button>
            </div>
          </Card>
        </div>
      ) : null}
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
        <EmptyState icon={Handshake} title="Nenhuma negociação" description="Crie uma proposta: adicione itens, desconto e condições de pagamento — o total é calculado na hora." />
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
                      {neg.probabilidade != null && !neg.resultado ? <span class="text-xs text-fg-subtle">{neg.probabilidade}% de chance</span> : null}
                    </div>
                    <div class="text-xs text-fg-muted mt-0.5">
                      {neg._count?.items ? <>{neg._count.items} item(ns)</> : 'sem itens'}
                      {neg._count?.attachments ? <> · {neg._count.attachments} anexo(s)</> : null}
                      {neg.createdAt ? <> · criada em {new Date(neg.createdAt).toLocaleDateString('pt-BR')}</> : null}
                    </div>
                  </div>
                  <span class="text-base font-semibold text-fg shrink-0 tabular-nums">{money(neg.valorFinal)}</span>
                </button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
