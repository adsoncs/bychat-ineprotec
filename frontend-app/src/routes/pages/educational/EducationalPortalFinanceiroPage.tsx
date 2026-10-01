import { useMemo, useState } from 'preact/hooks'
import {
  Wallet, Clock, AlertTriangle, TrendingUp, Receipt, Percent, Download, RefreshCw, X,
  CheckCircle2, Ban, Undo2, Send, Copy, Eye, QrCode, FileText, CreditCard, Banknote, Filter, Mail,
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
import { agruparCobrancas } from '@/lib/cobrancas'
import { paymentStatusLabel, paymentStatusTone } from '@/lib/paymentLabels'
import { baixarCsv } from '@/lib/baixarCsv'
import {
  usePortalFinanceiro, useDetalheFinanceiro, useBaixaManual, useCancelarCobranca, useEstornar,
  useSincronizarPagamento, useReenviarLink, useMensagemCobranca, useReenviarCobrancaEmail, qsDe,
  type FiltrosFin, type LinhaFinanceiro, type SituacaoFin,
} from '@/hooks/usePortalFinanceiro'
import { useEnrollmentPortals } from '@/hooks/useEnrollmentPortals'
import { useCourses, useOfferings, useSelectionProcesses } from '@/hooks/useEducational'

const brl = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const data = (iso: string | null | undefined, hora = false) =>
  !iso ? '—' : new Date(iso).toLocaleString('pt-BR', hora
    ? { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: '2-digit' })

const SITUACAO: Record<SituacaoFin, { rotulo: string; tom: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  pago: { rotulo: 'Pago', tom: 'success' },
  pendente: { rotulo: 'Pendente', tom: 'warning' },
  vencido: { rotulo: 'Vencido', tom: 'danger' },
  falhou: { rotulo: 'Falhou', tom: 'danger' },
  estornado: { rotulo: 'Estornado', tom: 'info' },
  cancelado: { rotulo: 'Cancelado', tom: 'neutral' },
  sem_cobranca: { rotulo: 'Sem cobrança', tom: 'neutral' },
}
const MEIO: Record<string, string> = { pix: 'PIX', boleto: 'Boleto', cartao: 'Cartão', link: 'Link', manual: 'Manual', outro: 'Outro' }
const GATEWAY: Record<string, string> = { iugu: 'iugu', asaas: 'Asaas', pagarme: 'Pagar.me', simulado: 'Simulado', manual: 'Manual' }

function hojeMenos(dias: number) {
  const d = new Date(Date.now() - dias * 86400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

export function EducationalPortalFinanceiroPage() {
  const [f, setF] = useState<FiltrosFin>({ de: hojeMenos(90), ate: hojeMenos(0), limit: 50, offset: 0, ordenar: 'recentes' })
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState<number | null>(null)
  const q = usePortalFinanceiro(f)
  const portais = useEnrollmentPortals()
  const cursos = useCourses()
  const ofertas = useOfferings(f.courseId ? { courseId: Number(f.courseId) } : {})
  const processos = useSelectionProcesses()
  const ind = q.data?.indicadores

  const set = (patch: Partial<FiltrosFin>) => setF((a) => ({ ...a, ...patch, offset: 0 }))
  const temFiltro = !!(f.portalId || f.courseId || f.offeringId || f.processId || f.situacao || f.meio || f.gateway || f.escopo || f.cupom || f.search)
  const limpar = () => { setBusca(''); setF({ de: f.de, ate: f.ate, limit: 50, offset: 0, ordenar: 'recentes' }) }

  const maxDia = useMemo(() => Math.max(1, ...(ind?.porDia ?? []).map((d) => d.valor)), [ind])

  return (
    <Page
      title="Financeiro do portal"
      description="Taxas de inscrição e primeiras cobranças do curso (matrícula / 1ª mensalidade) pagas pelo portal de matrículas."
      actions={
        <div class="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw size={13} /> Atualizar
          </Button>
          <Button variant="secondary" size="sm" onClick={() => baixarCsv(`/admin/educational/portal-financeiro/export.csv?${qsDe({ ...f, limit: undefined, offset: undefined })}`, 'financeiro-portal.csv').catch((e) => toast(e.message, 'danger'))}>
            <Download size={13} /> Exportar CSV
          </Button>
        </div>
      }
    >
      {/* Período — o recorte de todos os números da tela */}
      <Card class="p-3 mb-4">
        <div class="flex flex-wrap items-end gap-3">
          <Input label="De" type="date" value={f.de ?? ''} onInput={(e) => set({ de: (e.target as HTMLInputElement).value })} />
          <Input label="Até" type="date" value={f.ate ?? ''} onInput={(e) => set({ ate: (e.target as HTMLInputElement).value })} />
          <div class="flex gap-1 pb-0.5">
            {[['7 dias', 7], ['30 dias', 30], ['90 dias', 90], ['12 meses', 365]].map(([r, d]) => (
              <Button key={r} size="sm" variant={f.de === hojeMenos(d as number) && f.ate === hojeMenos(0) ? 'primary' : 'ghost'} onClick={() => set({ de: hojeMenos(d as number), ate: hojeMenos(0) })}>{r}</Button>
            ))}
          </div>
          <div class="text-2xs text-fg-muted pb-2 ml-auto">Período pela data da inscrição.</div>
        </div>
      </Card>

      <div class="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-4">
        <KpiCard label="Recebido" value={brl(ind?.recebido)} hint={`${ind?.pagos ?? 0} pagamento(s)`} icon={<Wallet size={16} />} tone="success" loading={q.isLoading} />
        <KpiCard label="A receber" value={brl(ind?.pendente)} hint={`${ind?.porSituacao?.pendente ?? 0} cobrança(s) em aberto`} icon={<Clock size={16} />} tone="warning" loading={q.isLoading} />
        <KpiCard label="Vencido" value={brl(ind?.vencido)} hint={`${ind?.porSituacao?.vencido ?? 0} sem pagar no prazo`} icon={<AlertTriangle size={16} />} tone="danger" loading={q.isLoading} />
        <KpiCard label="Conversão" value={`${(ind?.conversao ?? 0).toLocaleString('pt-BR')}%`} hint={`${ind?.pagos ?? 0} de ${ind?.comCobranca ?? 0} com cobrança`} icon={<TrendingUp size={16} />} tone="accent" loading={q.isLoading} />
        <KpiCard label="Ticket médio" value={brl(ind?.ticketMedio)} hint={`${ind?.inscricoes ?? 0} inscrição(ões) no período`} icon={<Receipt size={16} />} tone="violet" loading={q.isLoading} />
        <KpiCard label="Descontos" value={brl(ind?.descontos)} hint={`${ind?.comCupom ?? 0} pago(s) com cupom`} icon={<Percent size={16} />} tone="orange" loading={q.isLoading} />
      </div>

      <div class="grid gap-3 lg:grid-cols-3 mb-4">
        <Card class="p-4 lg:col-span-2">
          <div class="text-sm font-semibold mb-3">Recebido por dia</div>
          {!ind?.porDia.length ? (
            <div class="text-xs text-fg-muted py-8 text-center">Nenhum pagamento no período.</div>
          ) : (
            <div class="flex items-end gap-1 h-36" role="img" aria-label="Recebido por dia">
              {ind.porDia.map((d) => (
                <div key={d.dia} class="flex-1 min-w-[4px] group relative flex flex-col justify-end h-full">
                  <div class="bg-accent/80 group-hover:bg-accent rounded-t" style={{ height: `${Math.max(3, (d.valor / maxDia) * 100)}%` }} />
                  <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap text-2xs bg-surface-3 border border-border rounded px-1.5 py-0.5 z-10">
                    {new Date(`${d.dia}T12:00:00`).toLocaleDateString('pt-BR')} · {brl(d.valor)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card class="p-4">
          <div class="text-sm font-semibold mb-3">Por meio de pagamento</div>
          {!ind || !Object.keys(ind.porMeio).length ? (
            <div class="text-xs text-fg-muted py-8 text-center">Sem pagamentos.</div>
          ) : (
            <div class="space-y-2.5">
              {Object.entries(ind.porMeio).sort((a, b) => b[1].valor - a[1].valor).map(([m, v]) => {
                const pct = ind.recebido ? Math.round((v.valor / ind.recebido) * 100) : 0
                return (
                  <div key={m}>
                    <div class="flex justify-between text-xs mb-1"><span>{MEIO[m] ?? m} · {v.quantidade}</span><span class="tabular-nums">{brl(v.valor)} · {pct}%</span></div>
                    <div class="h-1.5 rounded bg-surface-3 overflow-hidden"><div class="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {!!ind?.porCurso.length && (
        <Card class="p-4 mb-4">
          <div class="text-sm font-semibold mb-3">Por curso</div>
          <Table minWidth="36rem">
            <THead><TR><TH>Curso</TH><TH align="right">Inscrições</TH><TH align="right">Pagas</TH><TH align="right">Conversão</TH><TH align="right">Recebido</TH></TR></THead>
            <TBody>
              {ind.porCurso.map((c) => (
                <TR key={c.curso}>
                  <TD>{c.curso}</TD>
                  <TD align="right">{c.inscritos}</TD>
                  <TD align="right">{c.pagos}</TD>
                  <TD align="right">{c.inscritos ? Math.round((c.pagos / c.inscritos) * 100) : 0}%</TD>
                  <TD align="right">{brl(c.recebido)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {/* Filtros */}
      <Card class="p-3 mb-3">
        <div class="flex items-center gap-2 mb-2 text-xs text-fg-muted"><Filter size={12} /> Filtros</div>
        <div class="grid gap-2 grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
          <form class="col-span-2" onSubmit={(e) => { e.preventDefault(); set({ search: busca.trim() || undefined }) }}>
            <Input label="Buscar" placeholder="Nome, e-mail, código ou id da cobrança" value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)} />
          </form>
          <Select label="Situação" value={f.situacao ?? ''} onChange={(e) => set({ situacao: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Todas</option>
            {Object.entries(SITUACAO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}{ind ? ` (${ind.porSituacao[k as SituacaoFin] ?? 0})` : ''}</option>)}
          </Select>
          <Select label="Meio" value={f.meio ?? ''} onChange={(e) => set({ meio: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Todos</option>
            {['pix', 'boleto', 'cartao', 'link', 'manual'].map((m) => <option key={m} value={m}>{MEIO[m]}</option>)}
          </Select>
          <Select label="Cobrança" value={f.escopo ?? ''} onChange={(e) => set({ escopo: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Todas</option>
            <option value="taxa">Taxa de inscrição</option>
            <option value="curso">Matrícula / 1ª mensalidade</option>
          </Select>
          <Select label="Cupom" value={['com', 'sem'].includes(f.cupom ?? '') ? f.cupom : f.cupom ? 'codigo' : ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; set({ cupom: v === 'codigo' ? f.cupom : v || undefined }) }}>
            <option value="">Todos</option>
            <option value="com">Com cupom</option>
            <option value="sem">Sem cupom</option>
          </Select>
          <Select label="Gateway" value={f.gateway ?? ''} onChange={(e) => set({ gateway: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Todos</option>
            {Object.entries(GATEWAY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select label="Ordenar" value={f.ordenar ?? 'recentes'} onChange={(e) => set({ ordenar: (e.target as HTMLSelectElement).value })}>
            <option value="recentes">Inscrição mais recente</option>
            <option value="pagamento">Pagamento mais recente</option>
            <option value="vencimento">Vence primeiro</option>
            <option value="valor">Maior valor</option>
          </Select>
          <Select label="Portal" value={f.portalId ?? ''} onChange={(e) => set({ portalId: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Todos</option>
            {(portais.data?.portals ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Select>
          <Select label="Curso" value={f.courseId ?? ''} onChange={(e) => set({ courseId: (e.target as HTMLSelectElement).value || undefined, offeringId: undefined })}>
            <option value="">Todos</option>
            {(cursos.data?.courses ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
          <Select label="Oferta" value={f.offeringId ?? ''} onChange={(e) => set({ offeringId: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Todas</option>
            {(ofertas.data?.offerings ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </Select>
          <Select label="Processo seletivo" value={f.processId ?? ''} onChange={(e) => set({ processId: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Todos</option>
            {(processos.data?.processes ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Select>
          {temFiltro && <div class="flex items-end"><Button variant="ghost" size="sm" onClick={limpar}><X size={12} /> Limpar filtros</Button></div>}
        </div>
      </Card>

      <Card class="p-0 overflow-hidden">
        {q.isLoading ? (
          <div class="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-10 w-full" />)}</div>
        ) : !q.data?.items.length ? (
          <EmptyState icon={<Wallet size={22} />} title="Nenhuma cobrança no recorte" description={temFiltro ? 'Ajuste ou limpe os filtros.' : 'Quando candidatos pagarem pelo portal, os pagamentos aparecem aqui.'} />
        ) : (
          <>
            <Table minWidth="72rem">
              <THead>
                <TR>
                  <TH>Candidato</TH><TH>Curso / oferta</TH><TH>Cobrança</TH><TH align="right">Tabela</TH><TH align="right">Desconto</TH>
                  <TH align="right">A receber</TH><TH>Meio</TH><TH>Situação</TH><TH>Pago / vence</TH><TH> </TH>
                </TR>
              </THead>
              <TBody>
                {q.data.items.map((l) => (
                  <TR key={l.id} class="cursor-pointer hover:bg-surface-2" onClick={() => setAberto(l.id)}>
                    <TD>
                      <div class="font-medium text-sm">{l.nome ?? '—'}</div>
                      <div class="text-2xs text-fg-muted font-mono">{l.candidateCode}</div>
                      {!!l.mescladas?.length && <div class="text-2xs text-fg-muted" title="Inscrições da mesma pessoa mescladas nesta">inclui {l.mescladas.join(', ')}</div>}
                    </TD>
                    <TD>
                      <div class="text-sm">{l.curso?.nome ?? '—'}</div>
                      <div class="text-2xs text-fg-muted">{l.oferta?.nome ?? l.portal?.nome ?? ''}</div>
                    </TD>
                    <TD><span class="text-xs">{l.rotulo}</span></TD>
                    <TD align="right" class="tabular-nums">{brl(l.valorTabela)}</TD>
                    <TD align="right" class="tabular-nums">
                      {l.descontoCupom + l.descontoAVista > 0 ? <span class="text-success">−{brl(l.descontoCupom + l.descontoAVista)}</span> : '—'}
                      {l.cupom && <div class="text-2xs text-fg-muted font-mono">{l.cupom}</div>}
                    </TD>
                    <TD align="right" class="tabular-nums font-medium">{brl(l.valorCobrado)}{l.parcelas > 1 && <div class="text-2xs text-fg-muted">{l.parcelas}x</div>}</TD>
                    <TD><span class="text-xs">{l.meio ? MEIO[l.meio] : '—'}</span>{l.gateway && <div class="text-2xs text-fg-muted">{GATEWAY[l.gateway] ?? l.gateway}</div>}</TD>
                    <TD><Badge tone={SITUACAO[l.situacao].tom}>{SITUACAO[l.situacao].rotulo}</Badge></TD>
                    <TD><span class="text-xs">{l.situacao === 'pago' ? data(l.pagoEm, true) : data(l.venceEm, true)}</span></TD>
                    <TD><Eye size={14} class="text-fg-muted" /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div class="p-3 border-t border-border">
              <Pagination total={q.data.total} limit={q.data.limit} offset={q.data.offset} onChange={(offset) => setF((a) => ({ ...a, offset }))} />
            </div>
          </>
        )}
      </Card>

      {aberto && <DetalheModal id={aberto} onClose={() => setAberto(null)} />}
    </Page>
  )
}

function DetalheModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [abertos, setAbertos] = useState<string[]>([])
  const q = useDetalheFinanceiro(id)
  const sync = useSincronizarPagamento()
  const reenviar = useReenviarLink()
  const cancelar = useCancelarCobranca()
  const [baixa, setBaixa] = useState(false)
  const [estorno, setEstorno] = useState(false)
  const [reenvioCobranca, setReenvioCobranca] = useState(false)
  const [confirmaCancelar, setConfirmaCancelar] = useState(false)
  const d = q.data
  const l = d?.linha

  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => toast('Copiado', 'success')).catch(() => toast('Não foi possível copiar', 'danger'))
  const falhou = (e: unknown) => toast((e as Error).message, 'danger')

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={l ? `${l.nome ?? 'Candidato'} · ${l.candidateCode}` : 'Carregando…'} size="xl">
      {!d || !l ? (
        <div class="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} class="h-8 w-full" />)}</div>
      ) : (
        <div class="space-y-4">
          <div class="flex flex-wrap items-center gap-2">
            <Badge tone={SITUACAO[l.situacao].tom} solid>{SITUACAO[l.situacao].rotulo}</Badge>
            <span class="text-sm text-fg-muted">{l.rotulo} · {l.portal?.nome}</span>
            {l.leadId && <a class="text-xs text-accent hover:underline ml-auto" href={`/app/leads/${l.leadId}`}>Abrir lead</a>}
            {l.portal && <a class="text-xs text-accent hover:underline" href={`/app/enrollment-portals/${l.portal.id}/registrations/${l.id}`}>Abrir inscrição</a>}
          </div>

          <div class="grid gap-3 sm:grid-cols-4">
            <Resumo rotulo="Valor de tabela" valor={brl(l.valorTabela)} />
            <Resumo rotulo="Descontos" valor={l.descontoCupom + l.descontoAVista > 0 ? `−${brl(l.descontoCupom + l.descontoAVista)}` : '—'} extra={[l.cupom && `cupom ${l.cupom}`, l.descontoAVista > 0 && 'à vista PIX'].filter(Boolean).join(' · ')} />
            <Resumo rotulo={l.situacao === 'pago' ? 'Recebido' : 'A receber'} valor={brl(l.valorCobrado)} extra={l.parcelas > 1 ? `${l.parcelas}x${l.acrescimo ? ` · +${brl(l.acrescimo)} juros` : ''}` : undefined} />
            <Resumo rotulo={l.situacao === 'pago' ? 'Pago em' : 'Vence em'} valor={l.situacao === 'pago' ? data(l.pagoEm, true) : data(l.venceEm, true)} extra={l.meio ? `${MEIO[l.meio]}${l.gateway ? ` · ${GATEWAY[l.gateway] ?? l.gateway}` : ''}` : undefined} />
          </div>

          <div class="grid gap-3 sm:grid-cols-3 text-sm">
            <div><div class="text-2xs text-fg-muted">Curso / oferta</div>{l.curso?.nome ?? '—'}<div class="text-xs text-fg-muted">{l.oferta?.nome}</div></div>
            <div><div class="text-2xs text-fg-muted">Processo seletivo</div>{l.processo?.nome ?? '—'}</div>
            <div><div class="text-2xs text-fg-muted">Contato</div>{l.email ?? '—'}<div class="text-xs text-fg-muted">{l.whatsapp ?? ''}{l.cpf ? ` · CPF ${l.cpf}` : ''}</div></div>
          </div>

          <div class="flex flex-wrap gap-2 border-y border-border py-3">
            <Button size="sm" variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate(l.id, { onSuccess: (r) => { toast(r.transitionedToPaid ? 'Pagamento confirmado no gateway' : 'Sincronizado — sem mudança', 'success'); q.refetch() }, onError: falhou })}>
              <RefreshCw size={12} /> {sync.isPending ? 'Consultando…' : 'Consultar gateway'}
            </Button>
            {l.situacao !== 'pago' && l.situacao !== 'estornado' && (
              <>
                {(l.situacao === 'pendente' || l.situacao === 'vencido') && (
                  <Button size="sm" variant="secondary" onClick={() => setReenvioCobranca(true)}>
                    <Send size={12} /> Reenviar cobrança
                  </Button>
                )}
                {/* Reenvia o ACESSO ao portal (link assinado de continuação), não a
                  * cobrança — o rótulo antigo "Reenviar link" e o aviso "link de
                  * pagamento reenviado" faziam a secretaria achar que o boleto tinha ido. */}
                <Button size="sm" variant="ghost" disabled={reenviar.isPending} onClick={() => reenviar.mutate(l.id, { onSuccess: () => toast('Acesso ao portal reenviado ao candidato', 'success'), onError: falhou })}>
                  <Send size={12} /> Reenviar acesso ao portal
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setBaixa(true)}><CheckCircle2 size={12} /> Dar baixa manual</Button>
                {(l.situacao === 'pendente' || l.situacao === 'vencido') && (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmaCancelar(true)}><Ban size={12} /> Cancelar cobrança</Button>
                )}
              </>
            )}
            {l.situacao === 'pago' && l.gateway === 'iugu' && l.meio !== 'boleto' && (
              <Button size="sm" variant="ghost" onClick={() => setEstorno(true)}><Undo2 size={12} /> Estornar</Button>
            )}
            {d.paymentUrl && <Button size="sm" variant="ghost" onClick={() => copiar(d.paymentUrl!)}><Copy size={12} /> Copiar link do gateway</Button>}
          </div>

          <div>
            <div class="text-sm font-semibold mb-2">Tentativas de pagamento ({d.tentativas.length})</div>
            {!!l.mescladas?.length && <div class="text-xs text-fg-muted mb-2">Inclui as tentativas de {l.mescladas.join(', ')}, mescladas nesta inscrição.</div>}
            {!d.tentativas.length ? <div class="text-xs text-fg-muted">Nenhuma cobrança gerada ainda.</div> : (
              <Table minWidth="44rem">
                <THead><TR><TH>Quando</TH><TH>Meio</TH><TH>Gateway</TH><TH align="right">Valor</TH><TH>Status</TH><TH>Detalhe</TH></TR></THead>
                <TBody>
                  {agruparCobrancas(d.tentativas).flatMap((g) => (abertos.includes(g.chave) ? g.itens : [g.principal]).map((t, i) => (
                    <TR key={t.id} class={i > 0 ? 'bg-surface-2' : ''}>
                      <TD>
                        <span class="text-xs">{data(t.createdAt, true)}</span>
                        {i === 0 && g.itens.length > 1 && (
                          <button class="block text-2xs text-accent hover:underline" onClick={() => setAbertos((x) => (x.includes(g.chave) ? x.filter((k) => k !== g.chave) : [...x, g.chave]))}>
                            {abertos.includes(g.chave) ? 'ocultar iguais' : `+${g.itens.length - 1} iguais`}
                          </button>
                        )}
                        {t.deInscricao && <span class="block text-2xs text-fg-muted font-mono">de {t.deInscricao}</span>}
                      </TD>
                      <TD>
                        <span class="inline-flex items-center gap-1 text-xs">
                          {t.method === 'pix' ? <QrCode size={12} /> : t.method === 'boleto' ? <FileText size={12} /> : t.method === 'credit_card' ? <CreditCard size={12} /> : <Banknote size={12} />}
                          {t.method === 'credit_card' ? 'Cartão' : t.method === 'pix' ? 'PIX' : t.method === 'boleto' ? 'Boleto' : t.method}
                        </span>
                      </TD>
                      <TD><span class="text-xs">{GATEWAY[t.provider] ?? t.provider}</span></TD>
                      <TD align="right" class="tabular-nums">{brl(t.amount)}</TD>
                      <TD><Badge tone={paymentStatusTone(t.status)}>{paymentStatusLabel(t.status)}</Badge></TD>
                      <TD>
                        <div class="text-2xs text-fg-muted max-w-[18rem] break-words">
                          {t.cardLastDigits && `${t.cardBrand ?? 'Cartão'} final ${t.cardLastDigits} · `}
                          {t.lastErrorMessage ?? ''}
                          {t.boletoLine && <button class="text-accent hover:underline ml-1" onClick={() => copiar(t.boletoLine!)}>copiar linha</button>}
                          {t.qrCode && <button class="text-accent hover:underline ml-1" onClick={() => copiar(t.qrCode!)}>copiar PIX</button>}
                          {t.boletoPdfUrl && <a class="text-accent hover:underline ml-1" href={t.boletoPdfUrl} target="_blank" rel="noopener">PDF</a>}
                          {t.externalId && <div class="font-mono">{t.externalId}</div>}
                        </div>
                      </TD>
                    </TR>
                  )))}
                </TBody>
              </Table>
            )}
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <div class="text-sm font-semibold mb-2">Linha do tempo</div>
              {!d.eventos.length ? <div class="text-xs text-fg-muted">Sem eventos de pagamento.</div> : (
                <ul class="space-y-1.5">
                  {d.eventos.map((e) => (
                    <li key={e.id} class="text-xs"><span class="text-fg-muted">{data(e.createdAt, true)}</span> · {e.title}{e.userName ? ` (${e.userName})` : ''}{e.description && <div class="text-2xs text-fg-muted">{e.description}</div>}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div class="text-sm font-semibold mb-2">Avisos do gateway ({d.avisos.length})</div>
              {!d.avisos.length ? <div class="text-xs text-fg-muted">Nenhum aviso recebido.</div> : (
                <ul class="space-y-1.5">
                  {d.avisos.map((a) => (
                    <li key={a.id} class="text-xs"><span class="text-fg-muted">{data(a.receivedAt, true)}</span> · {GATEWAY[a.provider] ?? a.provider} · {a.eventType} · <Badge tone={a.status === 'processed' ? 'success' : a.status === 'error' ? 'danger' : 'neutral'}>{a.status}</Badge>{a.errorMessage && <div class="text-2xs text-danger">{a.errorMessage}</div>}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {d.cupom && <div class="text-xs text-fg-muted">Cupom <span class="font-mono text-fg">{d.cupom.code}</span> consumido em {data(d.cupom.em, true)} · desconto {brl(d.cupom.desconto)}</div>}
        </div>
      )}

      {baixa && l && <BaixaManualModal linha={l} onClose={() => { setBaixa(false); q.refetch() }} />}
      {estorno && l && <EstornoModal linha={l} onClose={() => { setEstorno(false); q.refetch() }} />}
      {reenvioCobranca && l && <ReenvioCobrancaModal linha={l} onClose={() => setReenvioCobranca(false)} />}
      <ConfirmDialog
        open={confirmaCancelar}
        onOpenChange={setConfirmaCancelar}
        title="Cancelar a cobrança em aberto?"
        description="O boleto/PIX pendente deixa de valer (na iugu, é cancelado). A inscrição continua, e o candidato pode gerar uma nova cobrança pelo portal."
        confirmLabel="Cancelar cobrança"
        destructive
        loading={cancelar.isPending}
        onConfirm={() => cancelar.mutate(id, {
          onSuccess: (r) => { toast(r.avisos.length ? r.avisos.join(' · ') : 'Cobrança cancelada', r.avisos.length ? 'warning' : 'success'); setConfirmaCancelar(false); q.refetch() },
          onError: falhou,
        })}
      />
    </Modal>
  )
}

function Resumo({ rotulo, valor, extra }: { rotulo: string; valor: string; extra?: string | undefined }) {
  return (
    <div class="rounded-md border border-border bg-surface-2 p-3">
      <div class="text-2xs text-fg-muted">{rotulo}</div>
      <div class="text-base font-semibold tabular-nums">{valor}</div>
      {extra && <div class="text-2xs text-fg-muted">{extra}</div>}
    </div>
  )
}

function BaixaManualModal({ linha, onClose }: { linha: LinhaFinanceiro; onClose: () => void }) {
  const [valor, setValor] = useState(String(linha.valorCobrado ?? linha.valorTabela ?? ''))
  const [forma, setForma] = useState('pix_direto')
  const [pagoEm, setPagoEm] = useState(new Date().toISOString().slice(0, 16))
  const [obs, setObs] = useState('')
  const m = useBaixaManual()
  return (
    <Modal
      open onOpenChange={(o) => { if (!o) onClose() }}
      title="Dar baixa manual"
      description="Para pagamento recebido fora do gateway. Os efeitos são os mesmos da confirmação automática: inscrição paga, cupom consumido, aviso ao candidato. Cobranças abertas no gateway deixam de valer."
      size="md"
      footer={<div class="flex justify-end gap-2 w-full">
        <Button variant="secondary" size="sm" onClick={onClose}>Voltar</Button>
        <Button variant="primary" size="sm" disabled={m.isPending} onClick={() => m.mutate({ id: linha.id, valor: Number(valor.replace(',', '.')), forma, observacao: obs, pagoEm: new Date(pagoEm).toISOString() }, {
          onSuccess: () => { toast('Baixa registrada', 'success'); onClose() },
          onError: (e) => toast((e as Error).message, 'danger'),
        })}>{m.isPending ? 'Registrando…' : 'Confirmar baixa'}</Button>
      </div>}
    >
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <Input label="Valor recebido (R$) *" value={valor} onInput={(e) => setValor((e.target as HTMLInputElement).value)} inputMode="decimal" />
          <Input label="Recebido em *" type="datetime-local" value={pagoEm} onInput={(e) => setPagoEm((e.target as HTMLInputElement).value)} />
        </div>
        <Select label="Forma" value={forma} onChange={(e) => setForma((e.target as HTMLSelectElement).value)}>
          <option value="pix_direto">PIX direto na conta</option>
          <option value="transferencia">Transferência / TED</option>
          <option value="dinheiro">Dinheiro</option>
          <option value="cartao_maquininha">Cartão na maquininha</option>
          <option value="outro">Outro</option>
        </Select>
        <Textarea label="Observação" rows={3} value={obs} onInput={(e) => setObs((e.target as HTMLTextAreaElement).value)} placeholder="Ex.: comprovante enviado pelo WhatsApp em 25/09" />
      </div>
    </Modal>
  )
}

function EstornoModal({ linha, onClose }: { linha: LinhaFinanceiro; onClose: () => void }) {
  const [parcial, setParcial] = useState('')
  const [motivo, setMotivo] = useState('')
  const m = useEstornar()
  return (
    <Modal
      open onOpenChange={(o) => { if (!o) onClose() }}
      title="Estornar pagamento"
      description={`${brl(linha.valorCobrado)} pago ${linha.meio === 'cartao' ? 'por cartão' : linha.meio === 'link' ? 'pelo link da iugu' : 'por PIX'} na iugu. O valor volta para quem pagou${linha.meio === 'cartao' ? ' (na fatura do cartão)' : ''}.`}
      size="md"
      footer={<div class="flex justify-end gap-2 w-full">
        <Button variant="secondary" size="sm" onClick={onClose}>Voltar</Button>
        <Button variant="danger" size="sm" disabled={m.isPending} onClick={() => m.mutate({ id: linha.id, ...(parcial ? { valor: Number(parcial.replace(',', '.')) } : {}), motivo }, {
          onSuccess: () => { toast('Estorno solicitado na iugu', 'success'); onClose() },
          onError: (e) => toast((e as Error).message, 'danger'),
        })}>{m.isPending ? 'Estornando…' : parcial ? 'Estornar parte' : 'Estornar tudo'}</Button>
      </div>}
    >
      <div class="space-y-3">
        {(linha.meio === 'cartao' || linha.meio === 'link') && (
          <Input label="Valor parcial (opcional)" value={parcial} onInput={(e) => setParcial((e.target as HTMLInputElement).value)} placeholder="Vazio = estorno total" inputMode="decimal" hint={linha.meio === 'link' ? 'Estorno parcial só existe no cartão — se foi pago por PIX, deixe vazio.' : 'Estorno parcial só existe no cartão.'} />
        )}
        <Textarea label="Motivo" rows={3} value={motivo} onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} />
      </div>
    </Modal>
  )
}

export default EducationalPortalFinanceiroPage

/** Reenvio da COBRANÇA: mensagem pronta para o WhatsApp/Conversas e, na iugu,
 * o e-mail oficial da fatura (com PIX e boleto). */
function ReenvioCobrancaModal({ linha, onClose }: { linha: LinhaFinanceiro; onClose: () => void }) {
  const msg = useMensagemCobranca(linha.id)
  const email = useReenviarCobrancaEmail()
  const d = msg.data
  const wa = d?.whatsapp ? d.whatsapp.replace(/\D/g, '') : ''
  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => toast('Mensagem copiada', 'success')).catch(() => toast('Não foi possível copiar', 'danger'))
  return (
    <Modal
      open onOpenChange={(o) => { if (!o) onClose() }}
      title="Reenviar cobrança"
      description={`${linha.nome ?? 'Candidato'} · ${linha.candidateCode} · ${brl(linha.valorCobrado ?? linha.valorTabela)}`}
      size="md"
      footer={<div class="flex flex-wrap justify-end gap-2 w-full">
        <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
        {d?.emailIugu && (
          <Button variant="secondary" size="sm" disabled={email.isPending} onClick={() => email.mutate(linha.id, {
            onSuccess: (r) => toast(`E-mail da iugu enviado${r.email ? ` para ${r.email}` : ''}`, 'success'),
            onError: (e) => toast((e as Error).message, 'danger'),
          })}><Mail size={12} /> {email.isPending ? 'Enviando…' : 'Enviar e-mail da iugu'}</Button>
        )}
        {d && <Button size="sm" onClick={() => copiar(d.texto)}><Copy size={12} /> Copiar mensagem</Button>}
      </div>}
    >
      {msg.isLoading ? <Skeleton class="h-40" /> : msg.isError ? (
        <div class="text-sm text-danger">{(msg.error as Error).message}</div>
      ) : d ? (
        <div class="space-y-3">
          <Textarea label="Mensagem para o candidato" rows={10} value={d.texto} readOnly />
          <div class="text-xs text-fg-muted space-y-1">
            <div>Copie e envie pelo Conversas{d.leadId ? <> (<a class="text-accent hover:underline" href={`/app/leads/${d.leadId}`}>abrir lead</a>)</> : null}{wa ? <> ou pelo <a class="text-accent hover:underline" href={`https://wa.me/${wa}?text=${encodeURIComponent(d.texto)}`} target="_blank" rel="noopener">WhatsApp Web</a></> : null}.</div>
            {d.emailIugu
              ? <div>"Enviar e-mail da iugu" manda o e-mail oficial da fatura{d.email ? ` para ${d.email}` : ''}, com PIX, boleto e link de pagamento.</div>
              : <div>Envio automático por e-mail só existe para cobranças da iugu.</div>}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
