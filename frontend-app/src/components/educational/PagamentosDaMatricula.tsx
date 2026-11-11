// Pagamentos de uma matrícula: UM jeito de mostrar, em todas as telas da equipe
// (aba Financeiro da inscrição e detalhe do Financeiro do portal).
//
//  • ResumoValores        — os números da matrícula, em blocos iguais.
//  • ListaDeFaturas       — cada pagamento (1ª cobrança, parcelas do Meu Portal,
//                           parcelas do gateway, títulos do combinado/acordo)
//                           numa linha com as MESMAS colunas: parcela,
//                           vencimento, pagamento, meio, valor, situação, ações.
//                           Fonte: services/areaDoAluno.faturasDaInscricao — a
//                           mesma lista que o aluno vê no Meu Portal.
//  • TentativasDeCobranca — o histórico técnico (cada tentativa no gateway).
//  • Recolhivel           — seção que abre e fecha (histórico técnico).
//
// Fatura vencida (boleto/Pix do Asaas): "Atualizar fatura" dá nova data na
// MESMA cobrança, sem multa nem juros (services/atualizarFatura). Nada é
// enviado ao aluno: a equipe copia a mensagem e manda pela conversa.
import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import {
  Banknote, CalendarClock, ChevronDown, ChevronRight, Copy, CreditCard, ExternalLink, FileText, MessageCircle, QrCode, Receipt,
} from '@/components/ui/icon-set'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { toast } from '@/lib/toast'
import { agruparCobrancas } from '@/lib/cobrancas'
import { paymentProviderLabel, paymentStatusLabel, paymentStatusTone } from '@/lib/paymentLabels'

// ─── utilidades ──────────────────────────────────────────────────────────────

export const brl = (n: number | string | null | undefined) =>
  n == null || n === '' ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** "2026-12-10" ou ISO com hora → 10/12/2026 (dia de Brasília). */
export function diaBr(v: string | null | undefined): string {
  if (!v) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('/')
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/** Data e hora curtas: 11/11/26 12:29. */
export function quandoBr(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function copiar(texto: string, oQue: string) {
  navigator.clipboard.writeText(texto).then(() => toast(`${oQue} copiado`, 'success')).catch(() => toast('Não foi possível copiar', 'danger'))
}

/** Ícone + nome do meio, igual em todas as listas. */
export function Meio({ meio }: { meio: string | null | undefined }) {
  const m = String(meio ?? '').toLowerCase()
  const nome = !m ? '—' : m === 'pix' ? 'PIX' : m === 'boleto' ? 'Boleto' : m === 'credit_card' || m.startsWith('cart') ? 'Cartão' : m === 'manual' ? 'Manual' : String(meio)
  const Icone = m === 'pix' ? QrCode : m === 'boleto' ? FileText : m === 'credit_card' || m.startsWith('cart') ? CreditCard : Banknote
  return <span class="inline-flex items-center gap-1.5 text-sm text-fg">{m && <Icone size={13} class="text-fg-muted shrink-0" />}{nome}</span>
}

// ─── resumo ──────────────────────────────────────────────────────────────────

export interface ItemDoResumo { rotulo: string; valor: string; extra?: string | null | undefined; tom?: 'success' | 'danger' | 'warning' | undefined }

export function ResumoValores({ itens }: { itens: Array<ItemDoResumo | null | false | undefined> }) {
  const lista = itens.filter(Boolean) as ItemDoResumo[]
  return (
    <div class="grid gap-2 grid-cols-2 lg:grid-cols-4">
      {lista.map((i) => (
        <div key={i.rotulo} class="rounded-lg border border-border bg-surface-2 px-3 py-2.5 min-w-0">
          <div class="text-2xs uppercase tracking-wider text-fg-muted">{i.rotulo}</div>
          <div class={`text-base font-semibold tabular-nums mt-0.5 ${i.tom === 'success' ? 'text-success' : i.tom === 'danger' ? 'text-danger' : i.tom === 'warning' ? 'text-warning' : 'text-fg'}`}>{i.valor}</div>
          {i.extra && <div class="text-2xs text-fg-muted mt-0.5 truncate" title={i.extra}>{i.extra}</div>}
        </div>
      ))}
    </div>
  )
}

// ─── seção recolhível ────────────────────────────────────────────────────────

export function Recolhivel({ titulo, dica, children, inicial = false }: { titulo: string; dica?: string; children: ComponentChildren; inicial?: boolean }) {
  const [aberto, setAberto] = useState(inicial)
  return (
    <div class="rounded-lg border border-border">
      <button type="button" class="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-2 rounded-lg" onClick={() => setAberto((x) => !x)} aria-expanded={aberto}>
        {aberto ? <ChevronDown size={14} class="text-fg-muted" /> : <ChevronRight size={14} class="text-fg-muted" />}
        <span class="text-sm font-medium text-fg">{titulo}</span>
        {dica && <span class="text-2xs text-fg-muted ml-auto">{dica}</span>}
      </button>
      {aberto && <div class="border-t border-border p-3 space-y-4">{children}</div>}
    </div>
  )
}

// ─── lista de faturas ────────────────────────────────────────────────────────

type Situacao = 'paga' | 'aberta' | 'vencida' | 'cancelada' | 'estornada' | 'prevista'

interface Fatura {
  chave: string
  titulo: string
  detalhe: string | null
  valor: number
  vencimento: string | null
  situacao: Situacao
  pagaEm: string | null
  meio: string | null
  pagar: string | null
  boletoPdf: string | null
  recibo: string | null
  pix: string | null
  linha: string | null
  podeAtualizar?: boolean
}
interface Resultado {
  vencimento: string
  link: string | null
  valor: number
  mensagem: { texto: string; leadId: number | null; whatsapp: string | null }
}

const SITUACAO: Record<Situacao, { rotulo: string; tom: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  paga: { rotulo: 'Paga', tom: 'success' },
  aberta: { rotulo: 'Em aberto', tom: 'warning' },
  vencida: { rotulo: 'Vencida', tom: 'danger' },
  prevista: { rotulo: 'Prevista', tom: 'neutral' },
  cancelada: { rotulo: 'Cancelada', tom: 'neutral' },
  estornada: { rotulo: 'Estornada', tom: 'info' },
}

/** Onde a tela chama: a inscrição (tela Portal de Matrículas) ou o Financeiro do portal — cada uma com a sua permissão. */
export type OrigemDasFaturas = 'inscricao' | 'financeiro'
const BASE: Record<OrigemDasFaturas, string> = {
  inscricao: '/admin/enrollment-registrations',
  financeiro: '/admin/educational/portal-financeiro',
}
export const chaveDasFaturas = (id: number) => ['faturas-da-inscricao', id]

const COLUNAS = 'sm:grid sm:grid-cols-[minmax(0,1.5fr)_6.5rem_6.5rem_6rem_7rem_6.5rem] sm:items-center sm:gap-3'

export function ListaDeFaturas({ registrationId, origem, podeOperar }: { registrationId: number; origem: OrigemDasFaturas; podeOperar: boolean }) {
  const q = useQuery({
    queryKey: chaveDasFaturas(registrationId),
    queryFn: () => api.get<{ faturas: Fatura[]; aviso: string | null; hoje: string }>(`${BASE[origem]}/${registrationId}/faturas`),
    staleTime: 30_000,
  })
  const [alvo, setAlvo] = useState<Fatura | null>(null)

  if (q.isLoading) return <div class="space-y-2">{[0, 1].map((i) => <Skeleton key={i} class="h-12 w-full" />)}</div>
  if (q.isError) return <div class="text-xs text-danger">Não foi possível carregar os pagamentos: {(q.error as Error).message}</div>
  const faturas = q.data?.faturas ?? []
  if (!faturas.length) return <div class="text-sm text-fg-muted py-1">Nenhuma cobrança gerada ainda.</div>

  const validas = faturas.filter((f) => f.situacao !== 'cancelada' && f.situacao !== 'estornada')
  const pagas = validas.filter((f) => f.situacao === 'paga')
  const recebido = pagas.reduce((s, f) => s + (f.valor || 0), 0)
  const emAberto = validas.filter((f) => f.situacao === 'aberta' || f.situacao === 'vencida').reduce((s, f) => s + (f.valor || 0), 0)
  const vencido = validas.filter((f) => f.situacao === 'vencida').reduce((s, f) => s + (f.valor || 0), 0)
  const previsto = validas.filter((f) => f.situacao === 'prevista').reduce((s, f) => s + (f.valor || 0), 0)
  const pct = validas.length ? Math.round((pagas.length / validas.length) * 100) : 0

  return (
    <div class="space-y-3">
      {/* Progresso: quantas pagas e quanto entrou. */}
      <div class="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg-muted">
        <span><strong class="text-fg tabular-nums">{pagas.length} de {validas.length}</strong> {validas.length === 1 ? 'paga' : 'pagas'}</span>
        <span>Recebido <strong class="text-success tabular-nums">{brl(recebido)}</strong></span>
        {emAberto > 0 && <span>Em aberto <strong class={`tabular-nums ${vencido > 0 ? 'text-danger' : 'text-warning'}`}>{brl(emAberto)}</strong></span>}
        {previsto > 0 && <span>A gerar <strong class="text-fg tabular-nums">{brl(previsto)}</strong></span>}
        <div class="h-1.5 w-full sm:w-32 sm:ml-auto rounded-full bg-surface-3 overflow-hidden" aria-label={`${pct}% pago`}>
          <div class="h-full bg-success rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {q.data?.aviso && <div class="text-2xs text-fg-muted">{q.data.aviso}</div>}

      <div class="rounded-lg border border-border overflow-hidden">
        <div class={`hidden ${COLUNAS} px-3 py-2 bg-surface-2 text-2xs uppercase tracking-wider text-fg-muted`}>
          <span>Parcela</span><span>Vencimento</span><span>Pagamento</span><span>Meio</span><span class="text-right">Valor</span><span>Situação</span>
        </div>
        <ul class="divide-y divide-border">
          {faturas.map((f) => <LinhaDaFatura key={f.chave} f={f} podeOperar={podeOperar} aoAtualizar={() => setAlvo(f)} />)}
        </ul>
      </div>
      {alvo && q.data && <AtualizarFaturaModal registrationId={registrationId} base={BASE[origem]} fatura={alvo} hoje={q.data.hoje} onClose={() => setAlvo(null)} />}
    </div>
  )
}

function LinhaDaFatura({ f, podeOperar, aoAtualizar }: { f: Fatura; podeOperar: boolean; aoAtualizar: () => void }) {
  const s = SITUACAO[f.situacao] ?? { rotulo: f.situacao, tom: 'neutral' as const }
  const apagada = f.situacao === 'cancelada' || f.situacao === 'estornada'
  const aberta = f.situacao === 'aberta' || f.situacao === 'vencida'
  const cartaoVencido = f.situacao === 'vencida' && !f.podeAtualizar
  const temAcao = !!(f.recibo || (aberta && (f.pagar || f.boletoPdf || f.linha || f.pix)) || (f.situacao === 'vencida'))
  return (
    <li class={`px-3 py-2.5 ${f.situacao === 'vencida' ? 'bg-danger/5' : ''} ${apagada ? 'opacity-60' : ''}`}>
      <div class={`grid grid-cols-2 gap-x-3 gap-y-1.5 ${COLUNAS}`}>
        <div class="col-span-2 sm:col-span-1 min-w-0">
          <div class="text-sm font-medium text-fg truncate">{f.titulo}</div>
          {f.detalhe && <div class="text-2xs text-fg-muted truncate" title={f.detalhe}>{f.detalhe}</div>}
        </div>
        <Celula rotulo="Vencimento"><span class={`text-sm tabular-nums ${f.situacao === 'vencida' ? 'text-danger font-medium' : 'text-fg'}`}>{diaBr(f.vencimento)}</span></Celula>
        <Celula rotulo="Pagamento"><span class={`text-sm tabular-nums ${f.pagaEm ? 'text-fg' : 'text-fg-muted'}`}>{f.situacao === 'paga' ? diaBr(f.pagaEm) : '—'}</span></Celula>
        <Celula rotulo="Meio"><Meio meio={f.meio} /></Celula>
        <Celula rotulo="Valor" direita><span class={`text-sm font-semibold tabular-nums ${apagada ? 'line-through text-fg-muted' : 'text-fg'}`}>{brl(f.valor)}</span></Celula>
        <Celula rotulo="Situação"><Badge tone={s.tom}>{s.rotulo}</Badge></Celula>
      </div>
      {temAcao && (
        <div class="flex flex-wrap items-center gap-1.5 mt-2">
          {f.situacao === 'vencida' && podeOperar && f.podeAtualizar && (
            <Button size="sm" onClick={aoAtualizar}><CalendarClock size={12} /> Atualizar vencimento</Button>
          )}
          {aberta && f.pagar && <AcaoLink href={f.pagar} icone={<ExternalLink size={12} />}>Abrir fatura</AcaoLink>}
          {aberta && f.boletoPdf && <AcaoLink href={f.boletoPdf} icone={<FileText size={12} />}>Boleto em PDF</AcaoLink>}
          {aberta && f.linha && <AcaoBotao onClick={() => copiar(f.linha!, 'Linha digitável')} icone={<Copy size={12} />}>Copiar linha digitável</AcaoBotao>}
          {aberta && f.pix && <AcaoBotao onClick={() => copiar(f.pix!, 'Código PIX')} icone={<QrCode size={12} />}>Copiar PIX</AcaoBotao>}
          {f.recibo && <AcaoLink href={f.recibo} icone={<Receipt size={12} />}>Comprovante</AcaoLink>}
          {cartaoVencido && <span class="text-2xs text-fg-muted">Cartão vencido: gere uma nova forma de pagamento.</span>}
        </div>
      )}
    </li>
  )
}

function Celula({ rotulo, direita, children }: { rotulo: string; direita?: boolean; children: ComponentChildren }) {
  return (
    <div class={`min-w-0 ${direita ? 'sm:text-right' : ''}`}>
      <div class="sm:hidden text-2xs text-fg-muted">{rotulo}</div>
      {children}
    </div>
  )
}

const ACAO = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-surface text-xs text-fg hover:bg-surface-2 transition-colors'
function AcaoLink({ href, icone, children }: { href: string; icone: ComponentChildren; children: ComponentChildren }) {
  return <a class={ACAO} href={href} target="_blank" rel="noopener noreferrer">{icone}{children}</a>
}
function AcaoBotao({ onClick, icone, children }: { onClick: () => void; icone: ComponentChildren; children: ComponentChildren }) {
  return <button type="button" class={ACAO} onClick={onClick}>{icone}{children}</button>
}

function somarDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function AtualizarFaturaModal({ registrationId, base, fatura, hoje, onClose }: { registrationId: number; base: string; fatura: Fatura; hoje: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [data, setData] = useState(hoje)
  const [r, setR] = useState<Resultado | null>(null)
  const m = useMutation({
    mutationFn: () => api.post<Resultado>(`${base}/${registrationId}/faturas/atualizar`, { chave: fatura.chave, vencimento: data }),
    onSuccess: (res) => {
      setR(res)
      toast(`Fatura atualizada: vence em ${diaBr(res.vencimento)}`, 'success')
      // A inscrição, o Financeiro e a Inadimplência leem a mesma cobrança.
      void qc.invalidateQueries()
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const wa = r?.mensagem.whatsapp ? r.mensagem.whatsapp.replace(/\D/g, '') : ''

  return (
    <Modal
      open onOpenChange={(o) => { if (!o) onClose() }}
      title={r ? 'Vencimento atualizado' : 'Atualizar vencimento'}
      description={`${fatura.titulo} · ${brl(fatura.valor)} · venceu em ${diaBr(fatura.vencimento)}`}
      size="md"
      footer={r ? (
        <div class="flex flex-wrap justify-end gap-2 w-full">
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
          {r.link && <Button variant="secondary" size="sm" onClick={() => copiar(r.link!, 'Link')}><Copy size={12} /> Copiar link</Button>}
          <Button size="sm" onClick={() => copiar(r.mensagem.texto, 'Mensagem')}><Copy size={12} /> Copiar mensagem</Button>
        </div>
      ) : (
        <div class="flex justify-end gap-2 w-full">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={m.isPending || !data} onClick={() => m.mutate()}>{m.isPending ? 'Atualizando…' : 'Atualizar vencimento'}</Button>
        </div>
      )}
    >
      {!r ? (
        <div class="space-y-3">
          <Input label="Novo vencimento" type="date" value={data} min={hoje} max={somarDias(hoje, 60)} onInput={(e) => setData((e.target as HTMLInputElement).value)} />
          <div class="text-xs text-fg-muted space-y-1">
            <div>A cobrança continua a mesma no Asaas, com o mesmo link: só a data muda, e o boleto e o PIX são renovados.</div>
            <div>O valor fica igual ({brl(fatura.valor)}), sem multa nem juros.</div>
          </div>
        </div>
      ) : (
        <div class="space-y-3">
          <div class="text-sm">Novo vencimento: <strong>{diaBr(r.vencimento)}</strong> · {brl(r.valor)}</div>
          <Textarea label="Mensagem para o aluno" rows={8} value={r.mensagem.texto} readOnly />
          <div class="text-xs text-fg-muted flex flex-wrap gap-x-3 gap-y-1">
            <span>Copie e envie pela conversa do aluno:</span>
            {r.mensagem.leadId && <a class="text-accent hover:underline inline-flex items-center gap-1" href={`/app/leads/${r.mensagem.leadId}`}><MessageCircle size={11} /> Abrir lead</a>}
            {wa && <a class="text-accent hover:underline inline-flex items-center gap-1" href={`https://wa.me/${wa}?text=${encodeURIComponent(r.mensagem.texto)}`} target="_blank" rel="noopener"><ExternalLink size={11} /> WhatsApp Web</a>}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── histórico técnico: tentativas no gateway ────────────────────────────────

export interface Tentativa {
  id: number
  provider: string
  method: string
  status: string
  amount: string | number | null
  externalId?: string | null
  createdAt: string
  paidAt?: string | null
  expiresAt?: string | null
  boletoLine?: string | null
  boletoPdfUrl?: string | null
  qrCode?: string | null
  cardBrand?: string | null
  cardLastDigits?: string | null
  lastErrorMessage: string | null
  deInscricao?: string | null
}

export function TentativasDeCobranca({ tentativas }: { tentativas: Tentativa[] }) {
  const [abertos, setAbertos] = useState<string[]>([])
  if (!tentativas.length) return <div class="text-xs text-fg-muted">Nenhuma tentativa no gateway.</div>
  return (
    <Table minWidth="44rem">
      <THead><TR><TH>Gerada em</TH><TH>Meio</TH><TH>Gateway</TH><TH align="right">Valor</TH><TH>Status</TH><TH>Detalhe</TH></TR></THead>
      <TBody>
        {agruparCobrancas(tentativas).flatMap((g) => (abertos.includes(g.chave) ? g.itens : [g.principal]).map((t, i) => (
          <TR key={t.id} class={i > 0 ? 'bg-surface-2' : ''}>
            <TD>
              <span class="text-xs tabular-nums">{quandoBr(t.createdAt)}</span>
              {i === 0 && g.itens.length > 1 && (
                <button type="button" class="block text-2xs text-accent hover:underline" onClick={() => setAbertos((x) => (x.includes(g.chave) ? x.filter((k) => k !== g.chave) : [...x, g.chave]))}>
                  {abertos.includes(g.chave) ? 'ocultar iguais' : `+${g.itens.length - 1} iguais`}
                </button>
              )}
              {t.deInscricao && <span class="block text-2xs text-fg-muted font-mono">de {t.deInscricao}</span>}
            </TD>
            <TD><Meio meio={t.method} /></TD>
            <TD><span class="text-xs">{paymentProviderLabel(t.provider)}</span></TD>
            <TD align="right" class="tabular-nums">{brl(t.amount)}</TD>
            <TD>
              <Badge tone={paymentStatusTone(t.status)}>{paymentStatusLabel(t.status)}</Badge>
              {t.status === 'paid' && t.paidAt && <span class="block text-2xs text-fg-muted mt-0.5">em {diaBr(t.paidAt)}</span>}
            </TD>
            <TD>
              <div class="text-2xs text-fg-muted max-w-[18rem] break-words space-y-0.5">
                {t.cardLastDigits && <div>{t.cardBrand ?? 'Cartão'} final {t.cardLastDigits}</div>}
                {t.lastErrorMessage && <div class="text-danger">{t.lastErrorMessage}</div>}
                {t.externalId && <div class="font-mono">{t.externalId}</div>}
              </div>
            </TD>
          </TR>
        )))}
      </TBody>
    </Table>
  )
}
