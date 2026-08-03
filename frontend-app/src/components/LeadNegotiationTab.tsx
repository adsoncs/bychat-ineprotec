import { useState, useEffect, useRef } from 'preact/hooks'
import { Handshake, Plus, Trash2, Paperclip, Download, Search, ChevronLeft, RotateCcw, Boxes, Link2Off, PencilLine } from 'lucide-preact'
import {
  useNegotiations, useNegotiation, useSaveNegotiation, useDeleteNegotiation,
  useCloseNegotiation, useReopenNegotiation, useUploadNegotiationAttachment, useDeleteNegotiationAttachment,
  useCatalogPick, useCatalogBrowse, useCatalogPickCategories, useNegotiationSuggestion,
  type Negotiation, type NegItem, type CatalogHit,
} from '@/hooks/useNegotiations'
import { useLossReasons } from '@/hooks/useLeadOutcome'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
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

// `cobranca` decide de que lado da conta a linha cai: mensalidade entra no MRR,
// pagamento único entra no valor de implantação/projeto. `parcelas` só vale para
// o único (implantação em 6x) e `recorrenciaMeses` só para o recorrente.
/** "R$ 8.000,00 + R$ 890,00/mês" quando há mensalidade; só o total quando não há.
 * Um contrato de recorrência exibido como número único parece venda avulsa. */
function negValueLabel(n: { valorFinal?: unknown; valorUnico?: unknown; valorRecorrente?: unknown } | null | undefined): string {
  const mrr = num(n?.valorRecorrente)
  if (!n || mrr <= 0) return money(n?.valorFinal)
  const unico = num(n.valorUnico)
  return unico > 0 ? `${money(unico)} + ${money(mrr)}/mês` : `${money(mrr)}/mês`
}

interface Row {
  productId: number | null; nome: string; quantidade: number; precoUnit: number; descontoItem: number
  cobranca: 'unico' | 'recorrente'; parcelas: number; recorrenciaMeses: number
  /** Preço de tabela do produto (só no item vindo do catálogo) — serve para
   * mostrar de quanto foi a concessão quando o negociado é outro. Não vai ao
   * backend; é contexto de tela. */
  precoTabela?: number | null
}
const NEW_ROW: Row = { productId: null, nome: '', quantidade: 1, precoUnit: 0, descontoItem: 0, cobranca: 'unico', parcelas: 0, recorrenciaMeses: 0 }
const isRec = (r: Row) => r.cobranca === 'recorrente'
const rowSubtotal = (r: Row) => Math.max(0, r.precoUnit * r.quantidade - (r.descontoItem || 0))

// Estado do formulário num objeto só: qualquer patch marca "alterações não salvas".
interface Form {
  titulo: string; status: string; rows: Row[]
  // Bloco do pagamento único
  descontoTipo: 'valor' | 'percent'; descontoValor: string; acrescimos: string
  pagamentoForma: string; parcelas: string; entrada: string
  // Bloco da mensalidade
  descontoRecTipo: 'valor' | 'percent'; descontoRecValor: string
  pagamentoFormaRec: string; vencimentoDiaRec: string
  // Geral
  condicao: string; probabilidade: string; validadeAte: string; obs: string
}
const EMPTY_FORM: Form = {
  titulo: 'Proposta', status: 'rascunho', rows: [],
  descontoTipo: 'valor', descontoValor: '', acrescimos: '',
  pagamentoForma: '', parcelas: '', entrada: '',
  descontoRecTipo: 'valor', descontoRecValor: '',
  pagamentoFormaRec: '', vencimentoDiaRec: '',
  condicao: '', probabilidade: '', validadeAte: '', obs: '',
}

function rowFromProduct(p: CatalogHit): Row {
  return {
    ...NEW_ROW,
    productId: p.id,
    nome: p.nome,
    precoUnit: num(p.preco),
    cobranca: p.cobranca === 'recorrente' ? 'recorrente' : 'unico',
    precoTabela: p.preco != null ? num(p.preco) : null,
  }
}

/** Busca rápida por texto, para quem já sabe o nome do item. */
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
              onClick={() => { onPick(rowFromProduct(p)); setQ('') }}>
              <span class="truncate">{p.nome} <span class="text-fg-subtle">· {p.categoria}</span></span>
              <span class="text-fg-muted shrink-0">{money(p.preco)}{p.cobranca === 'recorrente' ? '/mês' : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Seletor do catálogo: mostra o que existe, por categoria, e deixa marcar
 * vários de uma vez. Sem ele, o operador precisava adivinhar o nome do produto
 * para a busca por texto devolver alguma coisa. */
function CatalogPickerModal({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (rows: Row[]) => void }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [sel, setSel] = useState<Map<number, number>>(new Map())
  const cats = useCatalogPickCategories(open)
  const browse = useCatalogBrowse(cat, open)

  useEffect(() => { if (!open) { setSel(new Map()); setQ(''); setCat('') } }, [open])

  const produtos = (browse.data?.products ?? []).filter((p) => {
    const t = q.trim().toLowerCase()
    if (!t) return true
    return `${p.nome} ${p.categoria} ${p.sku ?? ''}`.toLowerCase().includes(t)
  })
  function toggle(p: CatalogHit) {
    setSel((cur) => {
      const next = new Map(cur)
      if (next.has(p.id)) next.delete(p.id); else next.set(p.id, 1)
      return next
    })
  }
  function confirmar() {
    const byId = new Map((browse.data?.products ?? []).map((p) => [p.id, p]))
    const rows: Row[] = []
    for (const [id, qtd] of sel) {
      const p = byId.get(id)
      if (p) rows.push({ ...rowFromProduct(p), quantidade: Math.max(1, qtd) })
    }
    if (rows.length) onAdd(rows)
    onClose()
  }

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose() }} title="Adicionar itens do catálogo" size="lg">
      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative flex-1 min-w-48">
            <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Filtrar por nome, categoria ou SKU…"
              class="w-full pl-8 pr-2 py-1.5 rounded-md bg-surface border border-border text-sm text-fg" />
          </div>
          <Select value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value)} class="w-48">
            <option value="">Todas as categorias</option>
            {(cats.data?.categories ?? []).map((c) => <option key={c.categoria} value={c.categoria}>{c.categoria} ({c.count})</option>)}
          </Select>
        </div>

        {browse.isLoading ? (
          <div class="space-y-2"><Skeleton class="h-10 w-full" /><Skeleton class="h-10 w-full" /></div>
        ) : produtos.length === 0 ? (
          <EmptyState icon={Boxes} title="Nada no catálogo"
            description={cat || q ? 'Nenhum item com esse filtro. Limpe a busca ou escolha outra categoria.' : 'Cadastre produtos em CRM › Catálogo para reaproveitá-los nas propostas — ou adicione o item digitando à mão.'} />
        ) : (
          <div class="max-h-80 overflow-y-auto rounded-md border border-border divide-y divide-border">
            {produtos.map((p) => {
              const marcado = sel.has(p.id)
              return (
                <label key={p.id} class={`flex items-center gap-3 px-3 py-2 cursor-pointer ${marcado ? 'bg-accent/5' : 'hover:bg-surface-2'}`}>
                  <input type="checkbox" class="h-4 w-4 shrink-0" checked={marcado} onChange={() => toggle(p)} />
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm text-fg truncate">
                      {p.nome}
                      {p.cobranca === 'recorrente' ? <Badge tone="info" class="ml-2">Mensalidade</Badge> : null}
                      {p.disponivel === false ? <Badge tone="danger" class="ml-2">Esgotado</Badge> : null}
                    </span>
                    <span class="block text-[11px] text-fg-subtle truncate">{p.categoria}{p.sku ? ` · ${p.sku}` : ''}</span>
                  </span>
                  {marcado ? (
                    <input type="number" min={1} value={String(sel.get(p.id) ?? 1)} onClick={(e) => e.preventDefault()}
                      onInput={(e) => { const v = Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1); setSel((c) => new Map(c).set(p.id, v)) }}
                      class="w-14 px-1.5 py-1 rounded bg-surface border border-border text-xs text-center" title="Quantidade" />
                  ) : null}
                  <span class="text-sm text-fg-muted shrink-0 tabular-nums">{money(p.preco)}{p.cobranca === 'recorrente' ? '/mês' : ''}</span>
                </label>
              )
            })}
          </div>
        )}

        <div class="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={confirmar} disabled={sel.size === 0}>
            Adicionar {sel.size > 0 ? `${sel.size} ${sel.size === 1 ? 'item' : 'itens'}` : 'itens'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Como o item é cobrado: uma vez (implantação, site) ou todo mês (mensalidade).
 * Fica na própria linha do item porque é decisão por item, não por proposta —
 * a mesma proposta costuma ter os dois. */
function BillingToggle({ value, disabled, onChange }: { value: 'unico' | 'recorrente'; disabled?: boolean; onChange: (v: 'unico' | 'recorrente') => void }) {
  const opt = (v: 'unico' | 'recorrente', label: string) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={value === v}
      onClick={() => onChange(v)}
      class={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors disabled:opacity-60 ${value === v ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
    >
      {label}
    </button>
  )
  return (
    <div class="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-surface-3">
      {opt('unico', 'Pagamento único')}
      {opt('recorrente', 'Mensalidade')}
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

/** Editor da proposta. Exportado porque a tela do módulo (NegotiationsPage) abre
 * exatamente este formulário num modal — a proposta é a mesma, mudou só de onde
 * se chega nela. */
export function NegotiationEditor({ leadId, id, onBack, hideBack }: { leadId: number; id: number | 'new'; onBack: () => void; hideBack?: boolean }) {
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
  const [pickerOpen, setPickerOpen] = useState(false)

  function patch(p: Partial<Form>) { setF((cur) => ({ ...cur, ...p })); setDirty(true) }

  useEffect(() => {
    const s = sugData?.suggestion
    if (!isNew || !s || prefilled || dirty) return
    setF((cur) => ({
      ...cur,
      titulo: s.titulo || cur.titulo,
      rows: s.items.map((i) => ({
        ...NEW_ROW,
        productId: i.productId, nome: i.nome, quantidade: i.quantidade,
        precoUnit: i.precoUnit, descontoItem: i.descontoItem,
        cobranca: i.cobranca === 'recorrente' ? 'recorrente' as const : 'unico' as const,
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
      rows: (n.items || []).map((i: NegItem) => ({
        productId: i.productId ?? null, nome: i.nome, quantidade: i.quantidade,
        precoUnit: num(i.precoUnit), descontoItem: num(i.descontoItem),
        cobranca: i.cobranca === 'recorrente' ? 'recorrente' as const : 'unico' as const,
        parcelas: i.parcelas ?? 0, recorrenciaMeses: i.recorrenciaMeses ?? 0,
      })),
      descontoTipo: (n.descontoTipo as any) || 'valor',
      descontoValor: n.descontoValor != null ? String(n.descontoValor) : '',
      acrescimos: n.frete != null ? String(n.frete) : '',
      pagamentoForma: n.pagamentoForma || '',
      parcelas: n.parcelas != null ? String(n.parcelas) : '',
      entrada: n.entrada != null ? String(n.entrada) : '',
      descontoRecTipo: (n.descontoRecTipo as any) || 'valor',
      descontoRecValor: n.descontoRecValor != null ? String(n.descontoRecValor) : '',
      pagamentoFormaRec: n.pagamentoFormaRec || '',
      vencimentoDiaRec: n.vencimentoDiaRec != null ? String(n.vencimentoDiaRec) : '',
      condicao: n.condicaoPagamento || '',
      probabilidade: n.probabilidade != null ? String(n.probabilidade) : '',
      validadeAte: n.validadeAte ? n.validadeAte.slice(0, 10) : '',
      obs: n.observacoes || '',
    })
    setDirty(false)
    setLoaded(true)
  }, [n, loaded])

  if (!isNew && isLoading) return <Skeleton class="h-64 w-full" />

  // ── Conta explícita, em duas colunas: pagamento único e mensalidade ──
  // O desconto geral é rateado na proporção do subtotal de cada lado; os
  // acréscimos (frete/taxas) caem inteiros no único — taxa pontual não é receita
  // recorrente. Sem isso, um desconto na implantação derrubaria o MRR do card.
  const subUnico = f.rows.reduce((s, r) => s + (isRec(r) ? 0 : rowSubtotal(r)), 0)
  const subRecorrente = f.rows.reduce((s, r) => s + (isRec(r) ? rowSubtotal(r) : 0), 0)
  const subtotal = subUnico + subRecorrente
  // Cada bloco tem o seu desconto: ceder na implantação e ceder na mensalidade
  // são concessões diferentes e de valores diferentes.
  const descUnico = f.descontoValor ? (f.descontoTipo === 'percent' ? subUnico * (num(f.descontoValor) / 100) : num(f.descontoValor)) : 0
  const descRecorrente = f.descontoRecValor ? (f.descontoRecTipo === 'percent' ? subRecorrente * (num(f.descontoRecValor) / 100) : num(f.descontoRecValor)) : 0
  const desconto = descUnico + descRecorrente
  const acrescimos = num(f.acrescimos)
  const totalUnico = Math.max(0, subUnico - descUnico + acrescimos)
  const mrr = Math.max(0, subRecorrente - descRecorrente)
  // `total` = valor de face do 1º ciclo (único + 1 mensalidade). É o que vai para
  // `valorFinal` e para o valor de venda do lead ao fechar como ganha.
  const total = totalUnico + mrr
  const temRecorrente = subRecorrente > 0
  // Sem nenhum item ainda, mostramos o bloco do único (é o caso mais comum).
  const temUnico = subUnico > 0 || !temRecorrente
  // Entrada abate do pagamento único → saldo parcelado (se houver parcelas).
  const entrada = num(f.entrada)
  // No resumo, o bloco do único também aparece se houver acréscimo ou entrada
  // lançados sem item — senão o valor sumiria da conta sem explicação.
  // (declarado depois de `entrada` de propósito: `const` não é içado)
  const mostraUnico = temUnico || acrescimos > 0 || entrada > 0
  const saldo = Math.max(0, totalUnico - entrada)
  const nParcelas = Math.max(0, Math.round(num(f.parcelas)))
  const valorParcela = nParcelas > 0 ? saldo / nParcelas : 0
  // Itens únicos com parcelamento próprio (implantação em 6x, site à vista).
  const parceladosPorItem = f.rows.filter((r) => !isRec(r) && r.parcelas > 1 && rowSubtotal(r) > 0)
  // Contrato: mensalidade × prazo declarado, quando o operador informa o prazo.
  const mesesContrato = f.rows.reduce((m, r) => isRec(r) && r.recorrenciaMeses > m ? r.recorrenciaMeses : m, 0)
  const valorContrato = mesesContrato > 0 ? totalUnico + mrr * mesesContrato : 0
  const closed = !!n?.resultado
  // Desconto por item só aparece se algum item antigo já tiver (legado) — novos usam o desconto geral.
  const hasItemDesc = f.rows.some((r) => (r.descontoItem || 0) > 0)

  function setRow(i: number, p: Partial<Row>) { patch({ rows: f.rows.map((r, idx) => idx === i ? { ...r, ...p } : r) }) }
  function submit() {
    if (!f.rows.length && !confirm('Salvar sem nenhum item?')) return
    const payload = {
      id: isNew ? undefined : (id as number), titulo: f.titulo, status: f.status,
      items: f.rows.map((r) => ({
        ...r,
        parcelas: !isRec(r) && r.parcelas > 1 ? r.parcelas : null,
        recorrenciaMeses: isRec(r) && r.recorrenciaMeses > 0 ? r.recorrenciaMeses : null,
      })),
      descontoTipo: f.descontoTipo, descontoValor: f.descontoValor ? num(f.descontoValor) : null, frete: f.acrescimos ? acrescimos : null,
      descontoRecTipo: f.descontoRecTipo, descontoRecValor: f.descontoRecValor ? num(f.descontoRecValor) : null,
      pagamentoFormaRec: f.pagamentoFormaRec || null, vencimentoDiaRec: f.vencimentoDiaRec ? Math.round(num(f.vencimentoDiaRec)) : null,
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
        {hideBack
          ? <span />
          : <button type="button" class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg" onClick={goBack}><ChevronLeft size={15} /> Voltar</button>}
        {closed ? (
          <Badge tone={n?.resultado === 'won' ? 'success' : 'danger'}>
            {n?.resultado === 'won' ? `Ganha · ${negValueLabel(n)}` : `Perdida${n?.lostReason ? ' · ' + n.lostReason.name : ''}`}
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
        <CatalogPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onAdd={(rows) => patch({ rows: [...f.rows, ...rows] })} />
        {f.rows.length === 0 ? <p class="text-xs text-fg-subtle">Nenhum item ainda. Busque no catálogo acima ou clique em "Adicionar item".</p> : (
          <div class="space-y-2">
            {/* Cabeçalho das colunas — evita adivinhar o que é cada campo */}
            <div class="grid grid-cols-12 gap-2 text-[11px] font-medium text-fg-subtle px-0.5">
              <span class={hasItemDesc ? 'col-span-4' : 'col-span-5'}>Item</span>
              <span class="col-span-1 text-center">Qtd</span>
              <span class="col-span-2">Valor unit. (R$)</span>
              {hasItemDesc ? <span class="col-span-2">Desc. item (R$)</span> : null}
              <span class={hasItemDesc ? 'col-span-2 text-right' : 'col-span-3 text-right'}>Subtotal</span>
            </div>
            {f.rows.map((r, i) => (
              <div key={i} class="rounded-md border border-border/60 bg-surface-2/30 p-2 space-y-1.5">
                <div class="grid grid-cols-12 gap-2 items-center">
                  <input class={`${hasItemDesc ? 'col-span-4' : 'col-span-5'} px-2 py-1.5 rounded bg-surface border border-border text-sm disabled:opacity-60`} placeholder="Descrição do item" disabled={closed || r.productId != null} value={r.nome} onInput={(e) => setRow(i, { nome: (e.target as HTMLInputElement).value })} />
                  <input class="col-span-1 px-1 py-1.5 rounded bg-surface border border-border text-sm text-center disabled:opacity-60" type="number" min={1} disabled={closed} value={String(r.quantidade)} onInput={(e) => setRow(i, { quantidade: Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1) })} />
                  <input class="col-span-2 px-2 py-1.5 rounded bg-surface border border-border text-sm disabled:opacity-60" inputMode="decimal" disabled={closed} value={String(r.precoUnit)} onInput={(e) => setRow(i, { precoUnit: num((e.target as HTMLInputElement).value) })} />
                  {hasItemDesc ? <input class="col-span-2 px-2 py-1.5 rounded bg-surface border border-border text-sm disabled:opacity-60" inputMode="decimal" disabled={closed} value={String(r.descontoItem)} onInput={(e) => setRow(i, { descontoItem: num((e.target as HTMLInputElement).value) })} /> : null}
                  <span class={`${hasItemDesc ? 'col-span-2' : 'col-span-3'} text-sm text-fg tabular-nums text-right`}>
                    {money(rowSubtotal(r))}{isRec(r) ? <span class="text-xs text-fg-muted">/mês</span> : null}
                  </span>
                  {!closed ? <button type="button" class="col-span-1 text-fg-subtle hover:text-danger justify-self-end" title="Remover item" onClick={() => patch({ rows: f.rows.filter((_, idx) => idx !== i) })}><Trash2 size={14} /></button> : <span class="col-span-1" />}
                </div>
                {/* Como este item é cobrado — o que separa MRR de venda avulsa nos relatórios */}
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                  {/* De onde veio a linha: item do catálogo (com vínculo) ou digitado à mão */}
                  {r.productId != null ? (
                    <span class="inline-flex items-center gap-1">
                      <Badge tone="neutral">Catálogo</Badge>
                      {!closed ? (
                        <button type="button" class="text-fg-subtle hover:text-fg inline-flex items-center gap-0.5"
                          title="Desvincular do catálogo e editar livremente"
                          onClick={() => setRow(i, { productId: null, precoTabela: null })}>
                          <Link2Off size={12} /> desvincular
                        </button>
                      ) : null}
                      {r.precoTabela != null && Math.abs(r.precoTabela - r.precoUnit) > 0.009 ? (
                        <span class="text-fg-subtle">· tabela {money(r.precoTabela)}</span>
                      ) : null}
                    </span>
                  ) : (
                    <Badge tone="neutral">Digitado</Badge>
                  )}
                  <BillingToggle value={r.cobranca} disabled={closed} onChange={(v) => setRow(i, { cobranca: v })} />
                  {isRec(r) ? (
                    <span class="inline-flex items-center gap-1">
                      contrato de
                      <input class="w-14 px-1.5 py-1 rounded bg-surface border border-border text-xs text-center disabled:opacity-60" type="number" min={0} placeholder="—" disabled={closed}
                        value={r.recorrenciaMeses ? String(r.recorrenciaMeses) : ''}
                        onInput={(e) => setRow(i, { recorrenciaMeses: Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0) })} />
                      meses <span class="text-fg-subtle">(opcional)</span>
                      {r.recorrenciaMeses > 0 ? <span class="text-fg-subtle">· {money(rowSubtotal(r) * r.recorrenciaMeses)} no contrato</span> : null}
                    </span>
                  ) : (
                    <span class="inline-flex items-center gap-1">
                      em
                      <input class="w-12 px-1.5 py-1 rounded bg-surface border border-border text-xs text-center disabled:opacity-60" type="number" min={1} placeholder="1" disabled={closed}
                        value={r.parcelas > 1 ? String(r.parcelas) : ''}
                        onInput={(e) => setRow(i, { parcelas: Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0) })} />
                      {r.parcelas > 1 ? <>× de {money(rowSubtotal(r) / r.parcelas)}</> : <>× <span class="text-fg-subtle">(vazio = à vista)</span></>}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {!closed ? (
          <div class="flex flex-wrap items-center gap-2 mt-2">
            <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)}><Boxes size={13} /> Adicionar do catálogo</Button>
            <Button size="sm" variant="ghost" onClick={() => patch({ rows: [...f.rows, { ...NEW_ROW }] })}><PencilLine size={13} /> Digitar item</Button>
            <span class="text-[11px] text-fg-subtle">Pode misturar os dois na mesma proposta.</span>
          </div>
        ) : null}
      </Card>

      {/* Valores e pagamento + resumo lado a lado */}
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card class="lg:col-span-2">
          <div class="text-sm font-semibold text-fg mb-1">Valores e pagamento</div>
          <p class="text-[11px] text-fg-subtle mb-3">
            Desconto e condições são <strong>de cada bloco</strong>: dá para ceder na implantação sem mexer no valor
            que se repete todo mês — e o contrário também.
          </p>

          {/* ── Pagamento único ── */}
          {temUnico ? (
            <div class="rounded-md border border-border/60 p-3">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle mb-2">Pagamento único</div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-medium text-fg mb-1">Desconto no único</label>
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
              </div>
            </div>
          ) : null}

          {/* ── Mensalidade — só quando a proposta tem recorrência ── */}
          {temRecorrente ? (
            <div class={`rounded-md border border-border/60 p-3 ${temUnico ? 'mt-3' : ''}`}>
              <div class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle mb-2">Mensalidade</div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-medium text-fg mb-1">Desconto na mensalidade</label>
                  <div class="flex gap-1">
                    <Select value={f.descontoRecTipo} disabled={closed} onChange={(e) => patch({ descontoRecTipo: (e.target as HTMLSelectElement).value as any })} class="w-20"><option value="valor">R$</option><option value="percent">%</option></Select>
                    <Input value={f.descontoRecValor} disabled={closed} onInput={(e) => patch({ descontoRecValor: (e.target as HTMLInputElement).value })} />
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-fg mb-1">Forma de cobrança</label>
                  <Select value={f.pagamentoFormaRec} disabled={closed} onChange={(e) => patch({ pagamentoFormaRec: (e.target as HTMLSelectElement).value })}>
                    <option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option><option value="cartao_recorrente">Cartão recorrente</option><option value="debito_automatico">Débito automático</option><option value="transferencia">Transferência</option><option value="outro">Outro</option>
                  </Select>
                </div>
                <Input label="Dia do vencimento" type="number" min={1} max={31} placeholder="ex.: 10" value={f.vencimentoDiaRec} disabled={closed} onInput={(e) => patch({ vencimentoDiaRec: (e.target as HTMLInputElement).value })} />
              </div>
            </div>
          ) : null}

          {/* ── Geral ── */}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Input label="Chance de fechar (%)" type="number" min={0} max={100} value={f.probabilidade} disabled={closed} onInput={(e) => patch({ probabilidade: (e.target as HTMLInputElement).value })} />
          </div>
          <div class="mt-3"><Textarea label="Condições combinadas (visível na proposta)" rows={2} disabled={closed} value={f.condicao} onInput={(e) => patch({ condicao: (e.target as HTMLTextAreaElement).value })} /></div>
          <div class="mt-3"><Textarea label="Observações internas (não vai para o cliente)" rows={2} disabled={closed} value={f.obs} onInput={(e) => patch({ obs: (e.target as HTMLTextAreaElement).value })} /></div>
        </Card>

        {/* Resumo — a conta inteira, sempre visível e ao vivo, separando o que
            é recorrente do que é cobrado uma vez só */}
        <Card class="!p-4 h-fit lg:sticky lg:top-2">
          <div class="text-sm font-semibold text-fg mb-3">Resumo</div>

          {mostraUnico ? (
          <div class="space-y-1.5">
            <div class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Pagamento único</div>
            <SummaryRow label="Subtotal" value={money(subUnico)} />
            {descUnico > 0 ? <SummaryRow label={`Desconto${f.descontoTipo === 'percent' ? ` (${num(f.descontoValor)}%)` : ''}`} value={money(descUnico)} sign="−" /> : null}
            {acrescimos > 0 ? <SummaryRow label="Acréscimos" value={money(acrescimos)} sign="+" /> : null}
            <SummaryRow label="Total à vista" value={money(totalUnico)} strong />
            {entrada > 0 ? (
              <>
                <SummaryRow label="Entrada" value={money(entrada)} sign="−" />
                <SummaryRow label={nParcelas > 0 ? `Saldo em ${nParcelas}× de ${money(valorParcela)}` : 'Saldo'} value={money(saldo)} />
                {entrada > totalUnico ? <p class="text-[11px] text-danger">⚠ Entrada maior que o pagamento único.</p> : null}
              </>
            ) : nParcelas > 0 && totalUnico > 0 ? (
              <SummaryRow label={`${nParcelas}× de ${money(valorParcela)}`} value={money(totalUnico)} />
            ) : null}
            {parceladosPorItem.length > 0 ? (
              <div class="pt-1 space-y-0.5">
                {parceladosPorItem.map((r, i) => (
                  <div key={i} class="flex items-baseline justify-between gap-2 text-[11px] text-fg-subtle">
                    <span class="truncate">{r.nome || 'Item'}</span>
                    <span class="tabular-nums shrink-0">{r.parcelas}× {money(rowSubtotal(r) / r.parcelas)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          ) : null}

          {temRecorrente ? (
            <div class={`space-y-1.5 ${mostraUnico ? 'mt-4 pt-3 border-t border-border' : ''}`}>
              <div class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Recorrente</div>
              <SummaryRow label="Subtotal mensal" value={money(subRecorrente)} />
              {descRecorrente > 0 ? <SummaryRow label={`Desconto${f.descontoRecTipo === 'percent' ? ` (${num(f.descontoRecValor)}%)` : ''}`} value={money(descRecorrente)} sign="−" /> : null}
              <SummaryRow label="Mensalidade" value={`${money(mrr)}/mês`} strong />
              {mesesContrato > 0 ? (
                <SummaryRow label={`Contrato de ${mesesContrato} meses`} value={money(valorContrato)} />
              ) : null}
              {f.vencimentoDiaRec ? <p class="text-[11px] text-fg-subtle">Vence todo dia {Math.round(num(f.vencimentoDiaRec))}.</p> : null}
            </div>
          ) : null}

          <div class="mt-4 pt-3 border-t border-border">
            <SummaryRow
              label={!temRecorrente ? 'Total' : mostraUnico ? '1º pagamento (único + 1 mês)' : '1ª mensalidade'}
              value={money(total)}
              strong
            />
            {temRecorrente ? <p class="text-[11px] text-fg-subtle mt-1">É este valor que vai para o card de venda do lead ao fechar como ganha. A mensalidade entra separada nos indicadores de recorrência.</p> : null}
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
          <p class="text-xs text-fg-muted mb-3">
            Ganha registra {money(total)} como valor de venda do lead
            {temRecorrente ? <> ({money(totalUnico)} único + {money(mrr)}/mês, que segue nos indicadores de recorrência)</> : null}
            ; perdida registra o motivo. Ambas atualizam os relatórios.
          </p>
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
              <div class="text-sm text-fg-muted">
                {temRecorrente ? 'Único:' : 'Total:'} <span class="text-base font-semibold text-fg tabular-nums">{money(temRecorrente ? totalUnico : total)}</span>
                {temRecorrente ? <> · Mensal: <span class="text-base font-semibold text-fg tabular-nums">{money(mrr)}</span>/mês</> : null}
              </div>
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
                  <span class="text-base font-semibold text-fg shrink-0 tabular-nums">{negValueLabel(neg)}</span>
                </button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
