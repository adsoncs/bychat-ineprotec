import { useMemo, useState } from 'preact/hooks'
import {
  Ticket, Plus, Pencil, Trash2, Copy, Archive, ArchiveRestore, Layers, Download, Eye, Percent,
  Wallet, TrendingUp, Sparkles, Tag, Users, Calendar, CheckCircle2, AlertTriangle,
} from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { KpiCard } from '@/components/ui/KpiCard'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { toast } from '@/lib/toast'
import { baixarCsv } from '@/lib/baixarCsv'
import { qsDe } from '@/hooks/usePortalFinanceiro'
import {
  useCuponsEdu, useResumoCupons, useDetalheCupom, useCriarCupom, useEditarCupom, useExcluirCupom,
  useDuplicarCupom, useArquivarCupom, useGerarLote, useSimularCupom,
  type CupomEdu, type CupomInput, type SituacaoCupom, type MeioCupom, type FiltrosCupom,
} from '@/hooks/useCuponsEdu'
import { useEnrollmentPortals } from '@/hooks/useEnrollmentPortals'
import { useCourses, useOfferings, useSelectionProcesses, useEducationalLevels, useModalities } from '@/hooks/useEducational'

const brl = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dt = (iso: string | null | undefined) => !iso ? '—' : new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const paraInputData = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const SIT: Record<SituacaoCupom, { rotulo: string; tom: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  ativo: { rotulo: 'Ativo', tom: 'success' },
  agendado: { rotulo: 'Agendado', tom: 'info' },
  esgotado: { rotulo: 'Esgotado', tom: 'warning' },
  expirado: { rotulo: 'Expirado', tom: 'danger' },
  inativo: { rotulo: 'Inativo', tom: 'neutral' },
  arquivado: { rotulo: 'Arquivado', tom: 'neutral' },
}
const MEIOS: Array<{ id: MeioCupom; nome: string }> = [
  { id: 'pix', nome: 'PIX' }, { id: 'boleto', nome: 'Boleto' }, { id: 'credit_card', nome: 'Cartão' },
]
const descontoTxt = (c: Pick<CupomEdu, 'type' | 'value' | 'maxDiscount'>) =>
  c.type === 'percent' ? `${c.value.toLocaleString('pt-BR')}%${c.maxDiscount ? ` (até ${brl(c.maxDiscount)})` : ''}` : brl(c.value)

function useCatalogos() {
  const portais = useEnrollmentPortals()
  const cursos = useCourses()
  const ofertas = useOfferings()
  const processos = useSelectionProcesses()
  const niveis = useEducationalLevels()
  const modalidades = useModalities()
  return {
    portais: (portais.data?.portals ?? []).map((p: any) => ({ id: p.id, nome: p.nome })),
    cursos: (cursos.data?.courses ?? []).map((c: any) => ({ id: c.id, nome: c.nome })),
    // O nome da oferta costuma repetir o do curso; o complemento/turno é o que distingue.
    ofertas: (ofertas.data?.offerings ?? []).map((o: any) => ({ id: o.id, nome: o.nome, extra: [o.complemento, o.turno, o.selectionProcess?.nome].filter(Boolean).join(' · ') })),
    processos: (processos.data?.processes ?? []).map((p: any) => ({ id: p.id, nome: p.nome })),
    niveis: (niveis.data?.levels ?? []).map((n: any) => ({ id: n.id, nome: n.nome })),
    modalidades: (modalidades.data?.modalities ?? []).map((m: any) => ({ id: m.id, nome: m.nome })),
  }
}
type Catalogos = ReturnType<typeof useCatalogos>

/** Frase curta com as travas — o que a secretaria lê na lista. */
function ondeVale(c: CupomEdu | CupomInput, cat: Catalogos): string[] {
  const nomes = (ids: number[] | null | undefined, lista: Array<{ id: number; nome: string }>) =>
    (ids ?? []).map((id) => lista.find((x) => x.id === id)?.nome ?? `#${id}`)
  const out: string[] = []
  const par = (rot: string, ids: number[] | null | undefined, lista: Array<{ id: number; nome: string }>) => {
    const n = nomes(ids, lista)
    if (n.length) out.push(`${rot}: ${n.length > 2 ? `${n.slice(0, 2).join(', ')} +${n.length - 2}` : n.join(', ')}`)
  }
  par('Cursos', c.courseIds, cat.cursos)
  par('Ofertas', c.offeringIds, cat.ofertas)
  par('Processos', c.processIds, cat.processos)
  par('Níveis', c.levelIds, cat.niveis)
  par('Modalidades', c.modalityIds, cat.modalidades)
  par('Portais', c.portalIds, cat.portais)
  if (c.scope) out.push(c.scope === 'taxa' ? 'Só taxa de inscrição' : 'Só matrícula/1ª mensalidade')
  if (c.paymentMethods?.length) out.push(`Só ${c.paymentMethods.map((m) => MEIOS.find((x) => x.id === m)?.nome).join('/')}`)
  const cpfs = Array.isArray(c.allowedCpfs) ? c.allowedCpfs.length : 0
  if (cpfs) out.push(`${cpfs} CPF(s) autorizados`)
  const doms = Array.isArray(c.emailDomains) ? c.emailDomains : []
  if (doms.length) out.push(`E-mail @${doms.join(', @')}`)
  return out
}

export function EducationalCuponsPage() {
  const [f, setF] = useState<FiltrosCupom>({ situacao: '', limit: 50, offset: 0 })
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<CupomEdu | 'novo' | null>(null)
  const [lote, setLote] = useState(false)
  const [detalhe, setDetalhe] = useState<number | null>(null)
  const [excluindo, setExcluindo] = useState<CupomEdu | null>(null)
  const lista = useCuponsEdu(f)
  const resumo = useResumoCupons()
  const cat = useCatalogos()
  const duplicar = useDuplicarCupom()
  const arquivar = useArquivarCupom()
  const excluir = useExcluirCupom()
  const r = resumo.data
  const set = (p: Partial<FiltrosCupom>) => setF((a) => ({ ...a, ...p, offset: 0 }))
  const erro = (e: unknown) => toast((e as Error).message, 'danger')
  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => toast(`${t} copiado`, 'success')).catch(() => {})

  return (
    <Page
      title="Cupons"
      description="Descontos do portal de matrículas, com travas por curso, oferta, processo, meio de pagamento, público, quantidade e validade."
      actions={
        <div class="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => baixarCsv(`/admin/coupons/export.csv?${qsDe({ ...f, limit: undefined, offset: undefined })}`, 'cupons.csv').catch(erro)}><Download size={13} /> CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => setLote(true)}><Layers size={13} /> Gerar lote</Button>
          <Button variant="primary" size="sm" onClick={() => setEditando('novo')}><Plus size={13} /> Novo cupom</Button>
        </div>
      }
    >
      <div class="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-4">
        <KpiCard label="Cupons ativos" value={r?.porSituacao?.ativo ?? 0} hint={`${r?.total ?? 0} no total`} icon={<Ticket size={16} />} tone="accent" loading={resumo.isLoading} />
        <KpiCard label="Resgates" value={r?.resgates ?? 0} hint={`${r?.resgates30d ?? 0} nos últimos 30 dias`} icon={<CheckCircle2 size={16} />} tone="violet" loading={resumo.isLoading} />
        <KpiCard label="Desconto concedido" value={brl(r?.descontoConcedido)} hint={`${brl(r?.desconto30d)} em 30 dias`} icon={<Percent size={16} />} tone="orange" loading={resumo.isLoading} />
        <KpiCard label="Receita com cupom" value={brl(r?.receitaComCupom)} hint="Pago por quem usou cupom" icon={<Wallet size={16} />} tone="success" loading={resumo.isLoading} />
        <KpiCard label="Atenção" value={(r?.porSituacao?.esgotado ?? 0) + (r?.porSituacao?.expirado ?? 0)} hint={`${r?.porSituacao?.esgotado ?? 0} esgotado(s) · ${r?.porSituacao?.expirado ?? 0} expirado(s)`} icon={<AlertTriangle size={16} />} tone="warning" loading={resumo.isLoading} />
      </div>

      <Card class="p-3 mb-3">
        <div class="flex flex-wrap gap-1 mb-3">
          {[['', 'Todos'], ['ativo', 'Ativos'], ['agendado', 'Agendados'], ['esgotado', 'Esgotados'], ['expirado', 'Expirados'], ['inativo', 'Inativos'], ['arquivado', 'Arquivados']].map(([k, rot]) => (
            <Button key={k} size="sm" variant={(f.situacao ?? '') === k ? 'primary' : 'ghost'} onClick={() => set({ situacao: k })}>
              {rot}{k && r?.porSituacao?.[k] ? ` · ${r.porSituacao[k]}` : ''}
            </Button>
          ))}
        </div>
        <div class="grid gap-2 grid-cols-1 md:grid-cols-4">
          <form class="md:col-span-2" onSubmit={(e) => { e.preventDefault(); set({ search: busca.trim() || undefined }) }}>
            <Input label="Buscar" placeholder="Código, descrição ou campanha" value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)} />
          </form>
          <Select label="Campanha" value={f.campaign ?? ''} onChange={(e) => set({ campaign: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Todas</option>
            {(r?.campanhas ?? []).map((c) => <option key={c.nome} value={c.nome}>{c.nome} ({c.cupons})</option>)}
          </Select>
          <Select label="Lote" value={f.batch ?? ''} onChange={(e) => set({ batch: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Todos</option>
            {(r?.lotes ?? []).map((l) => <option key={l.nome} value={l.nome}>{l.nome} ({l.cupons})</option>)}
          </Select>
        </div>
      </Card>

      <Card class="p-0 overflow-hidden">
        {lista.isLoading ? (
          <div class="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} class="h-11 w-full" />)}</div>
        ) : !lista.data?.items.length ? (
          <EmptyState icon={<Ticket size={22} />} title="Nenhum cupom aqui" description="Crie um cupom ou gere um lote de códigos únicos para uma campanha." action={<Button variant="primary" size="sm" onClick={() => setEditando('novo')}><Plus size={13} /> Novo cupom</Button>} />
        ) : (
          <>
            <Table minWidth="70rem">
              <THead><TR><TH>Código</TH><TH>Desconto</TH><TH>Onde vale</TH><TH align="right">Uso</TH><TH>Validade</TH><TH>Situação</TH><TH align="right">Ações</TH></TR></THead>
              <TBody>
                {lista.data.items.map((c) => {
                  const regras = ondeVale(c, cat)
                  return (
                    <TR key={c.id}>
                      <TD>
                        <button class="font-mono font-semibold text-sm hover:text-accent inline-flex items-center gap-1" onClick={() => copiar(c.code)} title="Copiar código">{c.code}<Copy size={11} class="text-fg-muted" /></button>
                        <div class="text-2xs text-fg-muted max-w-[16rem] truncate">{[c.description, c.campaign && `Campanha: ${c.campaign}`, c.batch && `Lote: ${c.batch}`].filter(Boolean).join(' · ') || '—'}</div>
                      </TD>
                      <TD>
                        <div class="text-sm font-medium">{descontoTxt(c)}</div>
                        <div class="text-2xs text-fg-muted">{[c.minAmount && `mín. ${brl(c.minAmount)}`, c.stackWithPix && 'soma com PIX', c.maxInstallments && `até ${c.maxInstallments}x`].filter(Boolean).join(' · ')}</div>
                      </TD>
                      <TD>
                        {regras.length ? <div class="flex flex-wrap gap-1 max-w-[22rem]">{regras.map((t) => <span key={t} class="text-2xs leading-tight px-1.5 py-0.5 rounded bg-surface-3 text-fg-muted">{t}</span>)}</div> : <span class="text-xs text-fg-muted">Em qualquer inscrição</span>}
                      </TD>
                      <TD align="right">
                        <div class="text-sm tabular-nums">{c.usageCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</div>
                        <div class="text-2xs text-fg-muted">{c.numeros?.reservados ? `${c.numeros.reservados} reservado(s)` : c.perUserLimit ? `${c.perUserLimit}/pessoa` : 'sem limite/pessoa'}</div>
                        {c.usageLimit ? <div class="h-1 mt-1 rounded bg-surface-3 overflow-hidden w-20 ml-auto"><div class="h-full bg-accent" style={{ width: `${Math.min(100, ((c.usageCount + (c.numeros?.reservados ?? 0)) / c.usageLimit) * 100)}%` }} /></div> : null}
                      </TD>
                      <TD><div class="text-xs">{c.validFrom ? dt(c.validFrom) : 'Já vale'}</div><div class="text-2xs text-fg-muted">{c.validUntil ? `até ${dt(c.validUntil)}` : 'sem fim'}</div></TD>
                      <TD><Badge tone={SIT[c.situacao].tom}>{SIT[c.situacao].rotulo}</Badge></TD>
                      <TD align="right">
                        <div class="flex justify-end gap-0.5">
                          <IconeAcao titulo="Detalhes e resgates" onClick={() => setDetalhe(c.id)}><Eye size={14} /></IconeAcao>
                          <IconeAcao titulo="Editar" onClick={() => setEditando(c)}><Pencil size={14} /></IconeAcao>
                          <IconeAcao titulo="Duplicar (nasce inativo)" onClick={() => duplicar.mutate({ id: c.id }, { onSuccess: (x) => { toast(`Criado ${x.coupon.code} (inativo)`, 'success'); setEditando(x.coupon) }, onError: erro })}><Copy size={14} /></IconeAcao>
                          {c.archivedAt
                            ? <IconeAcao titulo="Desarquivar" onClick={() => arquivar.mutate({ id: c.id, arquivar: false }, { onSuccess: () => toast('Desarquivado (continua inativo)', 'success'), onError: erro })}><ArchiveRestore size={14} /></IconeAcao>
                            : <IconeAcao titulo="Arquivar" onClick={() => arquivar.mutate({ id: c.id, arquivar: true }, { onSuccess: () => toast('Arquivado', 'success'), onError: erro })}><Archive size={14} /></IconeAcao>}
                          <IconeAcao titulo={c.usageCount > 0 ? 'Já usado — arquive em vez de excluir' : 'Excluir'} perigo disabled={c.usageCount > 0} onClick={() => setExcluindo(c)}><Trash2 size={14} /></IconeAcao>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
            <div class="p-3 border-t border-border"><Pagination total={lista.data.total} limit={f.limit ?? 50} offset={f.offset ?? 0} onChange={(offset) => setF((a) => ({ ...a, offset }))} /></div>
          </>
        )}
      </Card>

      {editando && <CupomModal cupom={editando === 'novo' ? null : editando} cat={cat} onClose={() => setEditando(null)} />}
      {lote && <CupomModal cupom={null} cat={cat} lote onClose={() => setLote(false)} />}
      {detalhe && <DetalheCupomModal id={detalhe} cat={cat} onClose={() => setDetalhe(null)} onEditar={(c) => { setDetalhe(null); setEditando(c) }} />}
      <ConfirmDialog
        open={!!excluindo}
        onOpenChange={(o) => { if (!o) setExcluindo(null) }}
        title={`Excluir ${excluindo?.code}?`}
        description="O cupom nunca foi usado, então pode ser excluído de vez. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        destructive
        loading={excluir.isPending}
        onConfirm={() => { if (excluindo) excluir.mutate(excluindo.id, { onSuccess: () => { toast('Cupom excluído', 'success'); setExcluindo(null) }, onError: erro }) }}
      />
    </Page>
  )
}

function IconeAcao(p: { titulo: string; onClick: () => void; children: preact.ComponentChildren; perigo?: boolean; disabled?: boolean }) {
  return (
    <button type="button" title={p.titulo} aria-label={p.titulo} disabled={p.disabled} onClick={p.onClick}
      class={`size-8 rounded-md grid place-items-center text-fg-muted hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed ${p.perigo ? 'hover:text-danger' : 'hover:text-fg'}`}>
      {p.children}
    </button>
  )
}

/** Lista de escolhas múltiplas com busca — vazio = sem trava. */
function MultiEscolha(p: { rotulo: string; dica?: string; opcoes: Array<{ id: number; nome: string; extra?: string }>; valor: number[]; onChange: (v: number[]) => void }) {
  const [q, setQ] = useState('')
  const vis = p.opcoes.filter((o) => !q || `${o.nome} ${o.extra ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const alterna = (id: number) => p.onChange(p.valor.includes(id) ? p.valor.filter((x) => x !== id) : [...p.valor, id])
  return (
    <div class="rounded-md border border-border p-2.5">
      <div class="flex items-center justify-between mb-1.5">
        <div class="text-xs font-medium">{p.rotulo}</div>
        <div class="text-2xs text-fg-muted">{p.valor.length ? `${p.valor.length} escolhido(s)` : 'Todos'}{p.valor.length > 0 && <button type="button" class="ml-2 text-accent hover:underline" onClick={() => p.onChange([])}>limpar</button>}</div>
      </div>
      {p.opcoes.length > 6 && <input class="w-full mb-1.5 text-xs px-2 py-1 rounded border border-border bg-surface" placeholder="Filtrar…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />}
      <div class="max-h-36 overflow-y-auto space-y-0.5">
        {!p.opcoes.length && <div class="text-2xs text-fg-muted">Nada cadastrado.</div>}
        {vis.map((o) => (
          <label key={o.id} class="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
            <input type="checkbox" checked={p.valor.includes(o.id)} onChange={() => alterna(o.id)} />
            <span>{o.nome}{o.extra ? <span class="text-fg-muted"> · {o.extra}</span> : null}</span>
          </label>
        ))}
      </div>
      {p.dica && <div class="text-2xs text-fg-muted mt-1">{p.dica}</div>}
    </div>
  )
}

function codigoAleatorio() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 8 }, () => a[Math.floor(Math.random() * a.length)]).join('')
}

function CupomModal({ cupom, cat, lote, onClose }: { cupom: CupomEdu | null; cat: Catalogos; lote?: boolean; onClose: () => void }) {
  const c = cupom
  const [s, setS] = useState({
    code: c?.code ?? '', description: c?.description ?? '', campaign: c?.campaign ?? '', notes: c?.notes ?? '',
    active: c?.active ?? true,
    type: (c?.type ?? 'percent') as 'percent' | 'fixed', value: c ? String(c.value) : '',
    maxDiscount: c?.maxDiscount != null ? String(c.maxDiscount) : '', minAmount: c?.minAmount != null ? String(c.minAmount) : '',
    usageLimit: c?.usageLimit != null ? String(c.usageLimit) : '', perUserLimit: String(c?.perUserLimit ?? 1),
    maxInstallments: c?.maxInstallments != null ? String(c.maxInstallments) : '',
    validFrom: paraInputData(c?.validFrom), validUntil: paraInputData(c?.validUntil),
    portalIds: c?.portalIds ?? [], courseIds: c?.courseIds ?? [], offeringIds: c?.offeringIds ?? [], processIds: c?.processIds ?? [],
    levelIds: c?.levelIds ?? [], modalityIds: c?.modalityIds ?? [],
    paymentMethods: (c?.paymentMethods ?? []) as MeioCupom[], scope: (c?.scope ?? '') as '' | 'taxa' | 'curso',
    stackWithPix: c?.stackWithPix ?? false,
    allowedCpfs: (c?.allowedCpfs ?? []).join('\n'), emailDomains: (c?.emailDomains ?? []).join(', '),
    quantidade: '50', prefixo: 'CAMPANHA', loteNome: '',
  })
  const [aba, setAba] = useState<'desconto' | 'onde' | 'publico' | 'limites'>('desconto')
  const upd = (p: Partial<typeof s>) => setS((a) => ({ ...a, ...p }))
  const criar = useCriarCupom()
  const editar = useEditarCupom()
  const gerar = useGerarLote()
  const salvando = criar.isPending || editar.isPending || gerar.isPending

  const payload: CupomInput = {
    description: s.description || null, campaign: s.campaign || null, notes: s.notes || null, active: s.active,
    type: s.type, value: Number(s.value.replace(',', '.')),
    maxDiscount: s.type === 'percent' && s.maxDiscount ? Number(s.maxDiscount.replace(',', '.')) : null,
    minAmount: s.minAmount ? Number(s.minAmount.replace(',', '.')) : null,
    usageLimit: s.usageLimit ? parseInt(s.usageLimit) : null,
    perUserLimit: s.perUserLimit === '' ? 1 : parseInt(s.perUserLimit),
    maxInstallments: s.maxInstallments ? parseInt(s.maxInstallments) : null,
    validFrom: s.validFrom ? new Date(s.validFrom).toISOString() : null,
    validUntil: s.validUntil ? new Date(s.validUntil).toISOString() : null,
    portalIds: s.portalIds, courseIds: s.courseIds, offeringIds: s.offeringIds, processIds: s.processIds,
    levelIds: s.levelIds, modalityIds: s.modalityIds,
    paymentMethods: s.paymentMethods, scope: s.scope || null, stackWithPix: s.stackWithPix,
    allowedCpfs: s.allowedCpfs, emailDomains: s.emailDomains,
  }
  const regras = ondeVale({ ...payload, allowedCpfs: s.allowedCpfs.split(/[\s,;]+/).filter(Boolean), emailDomains: s.emailDomains.split(/[\s,;]+/).filter(Boolean) } as CupomInput, cat)

  function salvar() {
    if (!payload.value || payload.value <= 0) { toast('Informe o valor do desconto', 'danger'); setAba('desconto'); return }
    if (s.type === 'percent' && payload.value > 100) { toast('Percentual máximo: 100%', 'danger'); return }
    const ok = (msg: string) => () => { toast(msg, 'success'); onClose() }
    const erro = (e: unknown) => toast((e as Error).message, 'danger')
    if (lote) {
      gerar.mutate({ ...payload, quantidade: parseInt(s.quantidade) || 0, prefixo: s.prefixo, ...(s.loteNome ? { lote: s.loteNome } : {}) }, {
        onSuccess: (r) => { toast(`${r.criados} códigos gerados no lote ${r.lote}`, 'success'); void baixarCodigos(r.codigos, r.lote); onClose() },
        onError: erro,
      })
    } else if (c) {
      editar.mutate({ id: c.id, code: s.code, ...payload }, { onSuccess: ok('Cupom atualizado'), onError: erro })
    } else {
      if (s.code.trim().length < 3) { toast('Código: mínimo 3 caracteres', 'danger'); return }
      criar.mutate({ code: s.code, ...payload } as any, { onSuccess: ok('Cupom criado'), onError: erro })
    }
  }

  const ABAS = [['desconto', 'Desconto', Percent], ['onde', 'Onde vale', Tag], ['publico', 'Quem pode usar', Users], ['limites', 'Limites e validade', Calendar]] as const

  return (
    <Modal
      open onOpenChange={(o) => { if (!o) onClose() }}
      title={lote ? 'Gerar lote de códigos únicos' : c ? `Editar ${c.code}` : 'Novo cupom'}
      description={lote ? 'Cada código vale uma vez só, com a mesma regra. Útil para distribuir em evento, parceiro ou indicação.' : undefined}
      size="xl"
      footer={<div class="flex items-center justify-between gap-2 w-full">
        <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={s.active} onChange={(e) => upd({ active: (e.target as HTMLInputElement).checked })} /> Ativo</label>
        <div class="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : lote ? `Gerar ${s.quantidade || 0} códigos` : 'Salvar'}</Button>
        </div>
      </div>}
    >
      <div class="space-y-4">
        {lote ? (
          <div class="grid gap-3 sm:grid-cols-3">
            <Input label="Quantidade *" type="number" min="1" max="1000" value={s.quantidade} onInput={(e) => upd({ quantidade: (e.target as HTMLInputElement).value })} hint="Até 1.000 por vez" />
            <Input label="Prefixo *" value={s.prefixo} onInput={(e) => upd({ prefixo: (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} hint="Ex.: FEIRA2027 → FEIRA2027-7KQ3MZ" />
            <Input label="Nome do lote" value={s.loteNome} onInput={(e) => upd({ loteNome: (e.target as HTMLInputElement).value })} placeholder="Automático se vazio" />
          </div>
        ) : (
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="flex gap-1.5 items-start">
              <div class="flex-1 min-w-0"><Input label="Código *" value={s.code} onInput={(e) => upd({ code: (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="EX.: VOLTAAULAS20" disabled={!!c && c.usageCount > 0} hint={c && c.usageCount > 0 ? 'Já usado: o código não muda' : 'Letras, números, - e _'} /></div>
              {!c && <div class="pt-[22px]"><Button variant="ghost" size="sm" onClick={() => upd({ code: codigoAleatorio() })} title="Gerar código aleatório" aria-label="Gerar código aleatório"><Sparkles size={13} /></Button></div>}
            </div>
            <Input label="Descrição" value={s.description} onInput={(e) => upd({ description: (e.target as HTMLInputElement).value })} placeholder="Ex.: 20% na taxa — volta às aulas" />
            <Input label="Campanha" value={s.campaign} onInput={(e) => upd({ campaign: (e.target as HTMLInputElement).value })} placeholder="Agrupa cupons no relatório" list="campanhas" />
          </div>
        )}

        <div class="flex border-b border-border overflow-x-auto">
          {ABAS.map(([id, rot, Icone]) => (
            <button key={id} type="button" onClick={() => setAba(id)} class={`h-9 px-3 text-sm flex items-center gap-1.5 border-b-2 whitespace-nowrap ${aba === id ? 'border-accent text-fg font-semibold' : 'border-transparent text-fg-muted hover:text-fg'}`}>
              <Icone size={13} />{rot}
            </button>
          ))}
        </div>

        {aba === 'desconto' && (
          <div class="space-y-3">
            <div class="grid gap-3 sm:grid-cols-4">
              <Select label="Tipo *" value={s.type} onChange={(e) => upd({ type: (e.target as HTMLSelectElement).value as any })}>
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor fixo (R$)</option>
              </Select>
              <Input label={s.type === 'percent' ? 'Percentual *' : 'Valor (R$) *'} value={s.value} inputMode="decimal" onInput={(e) => upd({ value: (e.target as HTMLInputElement).value })} placeholder={s.type === 'percent' ? '20' : '50,00'} />
              {s.type === 'percent' && <Input label="Teto do desconto (R$)" value={s.maxDiscount} inputMode="decimal" onInput={(e) => upd({ maxDiscount: (e.target as HTMLInputElement).value })} placeholder="Sem teto" />}
              <Input label="Vale a partir de (R$)" value={s.minAmount} inputMode="decimal" onInput={(e) => upd({ minAmount: (e.target as HTMLInputElement).value })} placeholder="Qualquer valor" />
            </div>
            <label class="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" class="mt-1" checked={s.stackWithPix} onChange={(e) => upd({ stackWithPix: (e.target as HTMLInputElement).checked })} />
              <span>Somar com o desconto à vista do PIX<div class="text-2xs text-fg-muted">Desligado (padrão): no PIX vale o maior dos dois descontos. Ligado: o desconto do PIX incide depois do cupom.</div></span>
            </label>
          </div>
        )}

        {aba === 'onde' && (
          <div class="space-y-3">
            <div class="text-2xs text-fg-muted">Nada marcado = vale em todos. Marcando mais de um grupo, o cupom precisa atender a todos (ex.: curso X <b>e</b> processo Y).</div>
            <div class="grid gap-3 md:grid-cols-2">
              <MultiEscolha rotulo="Cursos" opcoes={cat.cursos} valor={s.courseIds} onChange={(v) => upd({ courseIds: v })} />
              <MultiEscolha rotulo="Ofertas (turmas)" opcoes={cat.ofertas} valor={s.offeringIds} onChange={(v) => upd({ offeringIds: v })} />
              <MultiEscolha rotulo="Processos seletivos" opcoes={cat.processos} valor={s.processIds} onChange={(v) => upd({ processIds: v })} />
              <MultiEscolha rotulo="Portais" opcoes={cat.portais} valor={s.portalIds} onChange={(v) => upd({ portalIds: v })} />
              <MultiEscolha rotulo="Níveis" opcoes={cat.niveis} valor={s.levelIds} onChange={(v) => upd({ levelIds: v })} />
              <MultiEscolha rotulo="Modalidades" opcoes={cat.modalidades} valor={s.modalityIds} onChange={(v) => upd({ modalityIds: v })} />
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <Select label="Tipo de cobrança" value={s.scope} onChange={(e) => upd({ scope: (e.target as HTMLSelectElement).value as any })}>
                <option value="">Taxa de inscrição e curso</option>
                <option value="taxa">Só taxa de inscrição</option>
                <option value="curso">Só matrícula / 1ª mensalidade</option>
              </Select>
              <div>
                <div class="text-xs font-medium mb-1.5">Meios de pagamento</div>
                <div class="flex gap-3">
                  {MEIOS.map((m) => (
                    <label key={m.id} class="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="checkbox" checked={!s.paymentMethods.length || s.paymentMethods.includes(m.id)} onChange={(e) => {
                        const atual = s.paymentMethods.length ? s.paymentMethods : MEIOS.map((x) => x.id)
                        const novo = (e.target as HTMLInputElement).checked ? [...new Set([...atual, m.id])] : atual.filter((x) => x !== m.id)
                        upd({ paymentMethods: novo.length === MEIOS.length ? [] : novo })
                      }} />{m.nome}
                    </label>
                  ))}
                </div>
                <div class="text-2xs text-fg-muted mt-1">Nos outros meios o candidato paga o valor sem o cupom.</div>
              </div>
            </div>
          </div>
        )}

        {aba === 'publico' && (
          <div class="grid gap-3 md:grid-cols-2">
            <Textarea label="CPFs autorizados (convênio)" rows={7} value={s.allowedCpfs} onInput={(e) => upd({ allowedCpfs: (e.target as HTMLTextAreaElement).value })} placeholder={'Um por linha ou separados por vírgula\n529.982.247-25\n111.444.777-35'} hint={`${s.allowedCpfs.split(/[\s,;]+/).filter((x) => x.replace(/\D/g, '').length === 11).length} CPF(s) válidos · vazio = qualquer pessoa`} />
            <div class="space-y-3">
              <Input label="Domínios de e-mail" value={s.emailDomains} onInput={(e) => upd({ emailDomains: (e.target as HTMLInputElement).value })} placeholder="empresa.com.br, prefeitura.go.gov.br" hint="Só quem se inscreveu com e-mail desses domínios. Vazio = qualquer e-mail." />
              <Input label="Usos por pessoa (CPF)" type="number" min="0" value={s.perUserLimit} onInput={(e) => upd({ perUserLimit: (e.target as HTMLInputElement).value })} hint="0 = sem limite por pessoa" />
            </div>
          </div>
        )}

        {aba === 'limites' && (
          <div class="space-y-3">
            <div class="grid gap-3 sm:grid-cols-3">
              <Input label="Quantidade total de usos" type="number" min="1" value={lote ? '1' : s.usageLimit} disabled={lote} onInput={(e) => upd({ usageLimit: (e.target as HTMLInputElement).value })} placeholder="Ilimitado" hint={lote ? 'Cada código do lote vale 1 vez' : 'Conta também as cobranças em aberto (reserva)'} />
              <Input label="Parcelas máximas com o cupom" type="number" min="1" max="21" value={s.maxInstallments} onInput={(e) => upd({ maxInstallments: (e.target as HTMLInputElement).value })} placeholder="As do portal" />
              <div />
              <Input label="Vale a partir de" type="datetime-local" value={s.validFrom} onInput={(e) => upd({ validFrom: (e.target as HTMLInputElement).value })} hint="Vazio = já vale" />
              <Input label="Vale até" type="datetime-local" value={s.validUntil} onInput={(e) => upd({ validUntil: (e.target as HTMLInputElement).value })} hint="Vazio = sem fim" />
            </div>
            <Textarea label="Notas internas" rows={3} value={s.notes} onInput={(e) => upd({ notes: (e.target as HTMLTextAreaElement).value })} placeholder="Quem pediu, onde foi divulgado… (não aparece para o candidato)" />
          </div>
        )}

        <div class="rounded-md bg-surface-3 p-3 text-xs">
          <div class="font-semibold mb-1">Resumo da regra</div>
          <div>
            <b>{s.value ? descontoTxt({ type: s.type, value: Number(s.value.replace(',', '.')) || 0, maxDiscount: s.maxDiscount ? Number(s.maxDiscount.replace(',', '.')) : null }) : '—'}</b> de desconto
            {s.minAmount && ` em cobranças a partir de ${brl(Number(s.minAmount.replace(',', '.')))}`}
            {regras.length ? `, ${regras.join('; ').toLowerCase()}` : ', em qualquer inscrição'}
            {lote ? `. ${s.quantidade || 0} códigos, 1 uso cada` : s.usageLimit ? `. Até ${s.usageLimit} usos` : '. Usos ilimitados'}
            {Number(s.perUserLimit) > 0 ? `, ${s.perUserLimit} por pessoa` : ', sem limite por pessoa'}
            {s.maxInstallments && `, até ${s.maxInstallments}x`}
            {s.validUntil ? `, até ${new Date(s.validUntil).toLocaleString('pt-BR')}` : ''}
            {s.stackWithPix ? '. Soma com o desconto do PIX.' : '.'}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function baixarCodigos(codigos: string[], lote: string) {
  const blob = new Blob(['﻿codigo\n' + codigos.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `lote-${lote}.csv`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function DetalheCupomModal({ id, cat, onClose, onEditar }: { id: number; cat: Catalogos; onClose: () => void; onEditar: (c: CupomEdu) => void }) {
  const q = useDetalheCupom(id)
  const simular = useSimularCupom()
  const [codigo, setCodigo] = useState('')
  const [meio, setMeio] = useState('')
  const d = q.data
  const regras = useMemo(() => (d ? ondeVale(d.coupon, cat) : []), [d, cat])
  const res = simular.data?.resultado
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={d ? `Cupom ${d.coupon.code}` : 'Carregando…'} size="xl"
      footer={d ? <div class="flex justify-end w-full"><Button size="sm" variant="secondary" onClick={() => onEditar(d.coupon)}><Pencil size={12} /> Editar</Button></div> : undefined}>
      {!d ? <div class="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-9 w-full" />)}</div> : (
        <div class="space-y-4">
          <div class="flex flex-wrap items-center gap-2">
            <Badge tone={SIT[d.coupon.situacao].tom} solid>{SIT[d.coupon.situacao].rotulo}</Badge>
            <span class="text-sm">{descontoTxt(d.coupon)}</span>
            {d.coupon.campaign && <Badge tone="info">Campanha: {d.coupon.campaign}</Badge>}
            {d.coupon.batch && <Badge tone="neutral">Lote: {d.coupon.batch}</Badge>}
          </div>
          {d.coupon.description && <div class="text-sm text-fg-muted">{d.coupon.description}</div>}
          <div class="flex flex-wrap gap-1">{regras.length ? regras.map((t) => <Badge key={t} tone="neutral">{t}</Badge>) : <span class="text-xs text-fg-muted">Vale em qualquer inscrição</span>}</div>

          <div class="grid gap-3 grid-cols-2 md:grid-cols-4">
            <KpiCard label="Usos" value={`${d.coupon.usageCount}${d.coupon.usageLimit ? ` / ${d.coupon.usageLimit}` : ''}`} icon={<CheckCircle2 size={16} />} tone="accent" />
            <KpiCard label="Reservados" value={d.numeros?.reservados ?? 0} hint="Cobranças abertas com o cupom" icon={<Ticket size={16} />} tone="warning" />
            <KpiCard label="Desconto concedido" value={brl(d.numeros?.desconto)} icon={<Percent size={16} />} tone="orange" />
            <KpiCard label="Receita com o cupom" value={brl(d.numeros?.receita)} icon={<TrendingUp size={16} />} tone="success" />
          </div>

          <Card class="p-3">
            <div class="text-sm font-semibold mb-2">Testar numa inscrição</div>
            <div class="flex flex-wrap gap-2 items-end">
              <Input label="Código do candidato" value={codigo} onInput={(e) => setCodigo((e.target as HTMLInputElement).value.toUpperCase())} placeholder="MAT-26-000123-XXXX" />
              <Select label="Meio" value={meio} onChange={(e) => setMeio((e.target as HTMLSelectElement).value)}>
                <option value="">Qualquer</option>
                {MEIOS.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </Select>
              <Button size="sm" variant="secondary" disabled={!codigo || simular.isPending} onClick={() => simular.mutate({ id, candidateCode: codigo, ...(meio ? { metodo: meio } : {}) }, { onError: (e) => toast((e as Error).message, 'danger') })}>{simular.isPending ? 'Testando…' : 'Testar'}</Button>
            </div>
            {simular.data && (
              <div class={`mt-2 text-sm ${res && 'valido' in res ? 'text-danger' : 'text-success'}`}>
                {simular.data.cobranca ? `${simular.data.cobranca.rotulo}: ${brl(simular.data.cobranca.valor)}. ` : ''}
                {res && 'valido' in res ? `Não vale: ${res.motivo}` : `Vale — desconto ${brl(res?.descontoCupom)}, fica ${brl(res?.valorComCupom)}.`}
              </div>
            )}
          </Card>

          {!!d.porCurso.length && (
            <div>
              <div class="text-sm font-semibold mb-2">Uso por curso</div>
              <div class="flex flex-wrap gap-2">{d.porCurso.map((c) => <Badge key={c.curso} tone="neutral">{c.curso}: {c.usos} · {brl(c.desconto)}</Badge>)}</div>
            </div>
          )}

          <div>
            <div class="text-sm font-semibold mb-2">Resgates ({d.redemptions.length})</div>
            {!d.redemptions.length ? <div class="text-xs text-fg-muted">Ninguém pagou com este cupom ainda.</div> : (
              <Table minWidth="48rem">
                <THead><TR><TH>Quando</TH><TH>Candidato</TH><TH>Curso</TH><TH align="right">Antes</TH><TH align="right">Desconto</TH><TH align="right">Pago</TH></TR></THead>
                <TBody>
                  {d.redemptions.map((r) => (
                    <TR key={r.id}>
                      <TD><span class="text-xs">{dt(r.redeemedAt)}</span></TD>
                      <TD><div class="text-sm">{r.nome ?? '—'}</div><div class="text-2xs text-fg-muted font-mono">{r.candidateCode}</div></TD>
                      <TD><span class="text-xs">{r.curso ?? '—'}</span></TD>
                      <TD align="right" class="tabular-nums">{brl(r.amountBefore)}</TD>
                      <TD align="right" class="tabular-nums text-success">−{brl(r.discountValue)}</TD>
                      <TD align="right" class="tabular-nums">{brl(r.amountAfter)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>
          {!!d.reservas.length && (
            <div>
              <div class="text-sm font-semibold mb-2">Reservas em aberto ({d.reservas.length})</div>
              <ul class="text-xs space-y-1">{d.reservas.map((r) => <li key={r.id}><span class="font-mono">{r.candidateCode}</span> · {r.nome ?? '—'} · expira {dt(r.expiraEm)}</li>)}</ul>
            </div>
          )}
          {d.coupon.notes && <div class="text-xs text-fg-muted whitespace-pre-wrap border-t border-border pt-3"><b>Notas:</b> {d.coupon.notes}</div>}
        </div>
      )}
    </Modal>
  )
}

export default EducationalCuponsPage
