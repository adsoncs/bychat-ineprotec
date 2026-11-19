// Colunas da lista do Financeiro do portal: a equipe escolhe quais ver e a
// escolha fica guardada neste navegador. "Candidato" é fixa.
import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  Columns3, RotateCcw, Search, ArrowUp, ArrowDown, X, Check, Minus, User, BookOpen, Wallet, CreditCard,
  CalendarClock, ClipboardList, Briefcase, Coins,
} from '@/components/ui/icon-set'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { LinhaFinanceiro, SituacaoFin } from '@/hooks/usePortalFinanceiro'
import { Meio } from '@/components/educational/PagamentosDaMatricula'

const brl = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (v: string | null | undefined) => {
  if (!v) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('/')
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}
const hora = (v: string | null | undefined) => {
  if (!v || /^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
}
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

export const SITUACAO_FIN: Record<SituacaoFin, { rotulo: string; tom: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  pago: { rotulo: 'Pago', tom: 'success' },
  pendente: { rotulo: 'Pendente', tom: 'warning' },
  vencido: { rotulo: 'Vencido', tom: 'danger' },
  falhou: { rotulo: 'Falhou', tom: 'danger' },
  estornado: { rotulo: 'Estornado', tom: 'info' },
  cancelado: { rotulo: 'Cancelado', tom: 'neutral' },
  transferido: { rotulo: 'Transferido', tom: 'neutral' },
  sem_cobranca: { rotulo: 'Sem cobrança', tom: 'neutral' },
}
const GATEWAY: Record<string, string> = { iugu: 'iugu', asaas: 'Asaas', pagarme: 'Pagar.me', simulado: 'Simulado', manual: 'Manual', isencao: 'Isento (cupom)' }
const STATUS_INSCRICAO: Record<string, string> = {
  draft: 'Rascunho', submitted: 'Enviada', pending: 'Aguardando pagamento', paid: 'Paga', approved: 'Aprovada', enrolled: 'Matriculada',
  rejected: 'Reprovada', cancelled: 'Cancelada', transferred: 'Transferida', expired: 'Expirada', lost: 'Perdida', merged: 'Mesclada',
}

const Sub = ({ children }: { children: ComponentChildren }) => <div class="text-2xs text-fg-muted">{children}</div>
const Vazio = () => <span class="text-fg-muted">—</span>
const Nome = ({ p, sub }: { p: { nome: string } | null | undefined; sub?: ComponentChildren }) =>
  p ? <><div class="text-sm whitespace-nowrap">{p.nome}</div>{sub && <Sub>{sub}</Sub>}</> : <Vazio />

const COMISSAO: Record<string, { rotulo: string; tom: 'success' | 'warning' | 'neutral' }> = {
  prevista: { rotulo: 'Prevista', tom: 'warning' },
  paga: { rotulo: 'Paga', tom: 'success' },
  cancelada: { rotulo: 'Cancelada', tom: 'neutral' },
}
const PROPOSTA = (p: { status: string; resultado: string | null }) =>
  p.resultado === 'won' ? { rotulo: 'Ganha', tom: 'success' as const }
    : p.resultado === 'lost' ? { rotulo: 'Perdida', tom: 'danger' as const }
      : { rotulo: 'Em aberto', tom: 'info' as const }
const ORIGEM_INSCRICAO: Record<string, string> = { portal: 'Portal', link: 'Link de matrícula', manual: 'Inscrição pela equipe', assistida: 'Inscrição assistida' }
const comissaoValida = (l: LinhaFinanceiro) => (l.comercial?.comissao && l.comercial.comissao.status !== 'cancelada' ? l.comercial.comissao.valor : 0)
const competencia = (v: string | null | undefined) => {
  if (!v) return '—'
  const [a, m] = v.split('-')
  return new Date(Number(a), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '')
}

export type GrupoFin = 'Aluno' | 'Curso' | 'Valores' | 'Pagamento' | 'Vencimento' | 'Comercial' | 'Comissão' | 'Inscrição'
export interface ColunaFin {
  id: string
  rotulo: string
  grupo: GrupoFin
  direita?: boolean
  dica?: string
  render: (l: LinhaFinanceiro) => ComponentChildren
}

const GRUPOS: Array<{ id: GrupoFin; icone: ComponentChildren; texto: string }> = [
  { id: 'Aluno', icone: <User size={13} />, texto: 'Quem é o aluno' },
  { id: 'Curso', icone: <BookOpen size={13} />, texto: 'O que foi vendido' },
  { id: 'Valores', icone: <Coins size={13} />, texto: 'Preço, desconto e plano' },
  { id: 'Pagamento', icone: <CreditCard size={13} />, texto: 'O que entrou e como' },
  { id: 'Vencimento', icone: <CalendarClock size={13} />, texto: 'O que falta receber' },
  { id: 'Comercial', icone: <Briefcase size={13} />, texto: 'Quem vendeu e de onde veio' },
  { id: 'Comissão', icone: <Wallet size={13} />, texto: 'Metas & Comissões' },
  { id: 'Inscrição', icone: <ClipboardList size={13} />, texto: 'Dados da inscrição' },
]

export const COLUNAS_FIN: ColunaFin[] = [
  // Aluno
  { id: 'contato', rotulo: 'Contato', grupo: 'Aluno', dica: 'E-mail e WhatsApp', render: (l) => <><div class="text-xs">{l.email ?? '—'}</div><Sub>{l.whatsapp ?? ''}</Sub></> },
  { id: 'cpf', rotulo: 'CPF', grupo: 'Aluno', dica: 'Mascarado', render: (l) => <span class="text-xs font-mono">{l.cpf ?? '—'}</span> },
  // Curso
  { id: 'curso', rotulo: 'Curso / oferta', grupo: 'Curso', render: (l) => <><div class="text-sm">{l.curso?.nome ?? '—'}</div><Sub>{l.oferta?.nome ?? ''}</Sub></> },
  { id: 'portal', rotulo: 'Portal', grupo: 'Curso', render: (l) => <span class="text-xs">{l.portal?.nome ?? '—'}</span> },
  { id: 'processo', rotulo: 'Processo seletivo', grupo: 'Curso', render: (l) => <span class="text-xs">{l.processo?.nome ?? '—'}</span> },
  { id: 'cobranca', rotulo: 'Cobrança', grupo: 'Curso', dica: 'Taxa de inscrição ou matrícula / 1ª mensalidade', render: (l) => <span class="text-xs">{l.rotulo}</span> },
  // Valores
  { id: 'tabela', rotulo: 'Valor de tabela', grupo: 'Valores', direita: true, dica: 'Antes de cupom e desconto', render: (l) => <span class="tabular-nums">{brl(l.valorTabela)}</span> },
  { id: 'desconto', rotulo: 'Desconto', grupo: 'Valores', direita: true, dica: 'Cupom + desconto à vista', render: (l) => <>{l.descontoCupom + l.descontoAVista > 0 ? <span class="text-success tabular-nums">−{brl(l.descontoCupom + l.descontoAVista)}</span> : '—'}{l.cupom && <div class="text-2xs text-fg-muted font-mono">{l.cupom}</div>}</> },
  { id: 'cupom', rotulo: 'Cupom', grupo: 'Valores', render: (l) => <span class="text-xs font-mono">{l.cupom ?? '—'}</span> },
  { id: 'valor', rotulo: '1ª cobrança', grupo: 'Valores', direita: true, dica: 'Valor da 1ª cobrança (com cupom e desconto)', render: (l) => <><span class="tabular-nums font-medium">{brl(l.valorCobrado)}</span>{l.parcelas > 1 && <Sub>{l.parcelas}x</Sub>}</> },
  { id: 'parcelas', rotulo: 'Parcelas', grupo: 'Valores', direita: true, render: (l) => <span class="tabular-nums">{l.parcelas}</span> },
  { id: 'valorPlano', rotulo: 'Valor do plano', grupo: 'Valores', direita: true, dica: 'Total do plano escolhido (curso todo), quando o portal grava', render: (l) => <span class="tabular-nums">{brl(l.valorPlano)}</span> },
  // Pagamento
  { id: 'recebidoPeriodo', rotulo: 'Pago no período', grupo: 'Pagamento', direita: true, dica: 'O que entrou dentro das datas do filtro', render: (l) => <span class={`tabular-nums font-medium ${l.recebidoNoPeriodo ? 'text-success' : 'text-fg-muted'}`}>{l.recebidoNoPeriodo ? brl(l.recebidoNoPeriodo) : '—'}</span> },
  { id: 'recebidoTotal', rotulo: 'Recebido (total)', grupo: 'Pagamento', direita: true, dica: 'Tudo o que já entrou nesta matrícula', render: (l) => <><span class="tabular-nums">{l.recebidoTotal ? brl(l.recebidoTotal) : '—'}</span>{l.pagamentosFeitos > 1 && <Sub>{l.pagamentosFeitos} pagamentos</Sub>}</> },
  { id: 'meio', rotulo: 'Meio', grupo: 'Pagamento', render: (l) => <Meio meio={l.meio === 'cartao' ? 'credit_card' : l.meio} /> },
  { id: 'gateway', rotulo: 'Gateway', grupo: 'Pagamento', render: (l) => <span class="text-xs">{l.gateway ? GATEWAY[l.gateway] ?? l.gateway : '—'}</span> },
  { id: 'situacao', rotulo: 'Situação', grupo: 'Pagamento', render: (l) => <Badge tone={SITUACAO_FIN[l.situacao].tom}>{SITUACAO_FIN[l.situacao].rotulo}</Badge> },
  { id: 'pagoEm', rotulo: 'Pago em', grupo: 'Pagamento', dica: 'Data do último pagamento', render: (l) => {
    const u = l.recebimentos?.[l.recebimentos.length - 1]
    return u ? <><span class="text-sm tabular-nums">{dia(u.em ?? u.dia)}</span><Sub>{[hora(u.em), u.rotulo].filter(Boolean).join(' · ')}</Sub></> : <Vazio />
  } },
  { id: 'tentativas', rotulo: 'Tentativas', grupo: 'Pagamento', direita: true, dica: 'Cobranças geradas para esta inscrição', render: (l) => <span class="tabular-nums">{l.tentativas}</span> },
  // Vencimento
  { id: 'emAberto', rotulo: 'Em aberto', grupo: 'Vencimento', direita: true, dica: 'Soma das cobranças ainda não pagas', render: (l) => <><span class={`tabular-nums ${l.vencidoValor > 0 ? 'text-danger font-medium' : l.emAberto ? 'text-warning' : 'text-fg-muted'}`}>{l.emAberto ? brl(l.emAberto) : '—'}</span>{l.parcelasEmAberto > 0 && <Sub>{l.parcelasEmAberto} {l.parcelasEmAberto === 1 ? 'cobrança' : 'cobranças'}</Sub>}</> },
  { id: 'vencido', rotulo: 'Vencido', grupo: 'Vencimento', direita: true, dica: 'Em aberto com vencimento já passado', render: (l) => <span class={`tabular-nums ${l.vencidoValor ? 'text-danger font-medium' : 'text-fg-muted'}`}>{l.vencidoValor ? brl(l.vencidoValor) : '—'}</span> },
  { id: 'venceNoPeriodo', rotulo: 'Vence no período', grupo: 'Vencimento', direita: true, dica: 'Cobranças com vencimento dentro das datas do filtro (pagas ou não)', render: (l) => <span class="tabular-nums">{l.venceNoPeriodo ? brl(l.venceNoPeriodo) : '—'}</span> },
  { id: 'venceEm', rotulo: 'Vence em', grupo: 'Vencimento', dica: 'A cobrança em aberto mais antiga', render: (l) => {
    if (!l.vencimentoMaisAntigo) return <Vazio />
    const venceu = l.vencimentoMaisAntigo < hoje()
    return <><span class={`text-sm tabular-nums ${venceu ? 'text-danger font-medium' : ''}`}>{dia(l.vencimentoMaisAntigo)}</span>{venceu && <Sub>vencida</Sub>}</>
  } },
  { id: 'proximoVencimento', rotulo: 'Próximo vencimento', grupo: 'Vencimento', render: (l) => <span class="text-sm tabular-nums">{dia(l.proximoVencimento)}</span> },
  // Comercial
  { id: 'responsavelVenda', rotulo: 'Responsável pela venda', grupo: 'Comercial', dica: 'Quem ganhou a matrícula (responsável pela proposta ganha). Sem proposta ganha, mostra o vendedor da inscrição', render: (l) => {
    const c = l.comercial
    if (c?.fechadoPor) return <Nome p={c.fechadoPor} sub={c.proposta?.fechadaEm ? `ganho em ${dia(c.proposta.fechadaEm)}` : 'ganho'} />
    return <Nome p={c?.vendedor} sub="vendedor da inscrição" />
  } },
  { id: 'ganhoEm', rotulo: 'Ganho em', grupo: 'Comercial', dica: 'Data em que a proposta foi fechada como ganha', render: (l) => <span class="text-sm tabular-nums">{l.comercial?.proposta?.resultado === 'won' ? dia(l.comercial.proposta.fechadaEm) : '—'}</span> },
  { id: 'proposta', rotulo: 'Proposta', grupo: 'Comercial', dica: 'Proposta de Negociações ligada a esta inscrição', render: (l) => {
    const p = l.comercial?.proposta
    if (!p) return <Vazio />
    const s = PROPOSTA(p)
    return <><Badge tone={s.tom}>{s.rotulo}</Badge><Sub>#{p.id}</Sub></>
  } },
  { id: 'valorVenda', rotulo: 'Valor da venda', grupo: 'Comercial', direita: true, dica: 'Valor da proposta (o que conta para meta e comissão)', render: (l) => <span class="tabular-nums">{brl(l.comercial?.proposta?.valor)}</span> },
  { id: 'vendedor', rotulo: 'Vendedor na inscrição', grupo: 'Comercial', dica: 'Responsável pelo lead no momento da inscrição', render: (l) => <Nome p={l.comercial?.vendedor} /> },
  { id: 'atendidoPor', rotulo: 'Atendido por', grupo: 'Comercial', dica: 'Quem atendeu a inscrição (inscrição assistida)', render: (l) => <Nome p={l.comercial?.atendidoPor} /> },
  { id: 'responsavelLead', rotulo: 'Responsável atual do lead', grupo: 'Comercial', render: (l) => <Nome p={l.comercial?.responsavelLead} /> },
  { id: 'midia', rotulo: 'Mídia / origem', grupo: 'Comercial', dica: 'Pela marcação do anúncio (gclid, fbclid) ou UTM', render: (l) => <><div class="text-xs">{l.midia ?? '—'}</div>{l.campanha && <Sub>{l.campanha}</Sub>}</> },
  { id: 'campanha', rotulo: 'Campanha', grupo: 'Comercial', dica: 'utm_campaign', render: (l) => <span class="text-xs">{l.campanha ?? '—'}</span> },
  // Comissão
  { id: 'comissao', rotulo: 'Comissão', grupo: 'Comissão', direita: true, dica: 'Lançamento de Metas & Comissões desta venda', render: (l) => {
    const c = l.comercial?.comissao
    if (!c) return <Vazio />
    const s = COMISSAO[c.status] ?? { rotulo: c.status, tom: 'neutral' as const }
    return <><div class={`tabular-nums font-medium ${c.status === 'cancelada' ? 'line-through text-fg-muted' : ''}`}>{brl(c.valor)}</div><Sub>{s.rotulo}{c.beneficiario ? ` · ${c.beneficiario.nome.split(' ')[0]}` : ''}</Sub></>
  } },
  { id: 'comissaoStatus', rotulo: 'Situação da comissão', grupo: 'Comissão', render: (l) => {
    const c = l.comercial?.comissao
    if (!c) return <span class="text-xs text-fg-muted">Sem lançamento</span>
    const s = COMISSAO[c.status] ?? { rotulo: c.status, tom: 'neutral' as const }
    return <Badge tone={s.tom}>{s.rotulo}</Badge>
  } },
  { id: 'beneficiario', rotulo: 'Comissionado', grupo: 'Comissão', dica: 'Quem recebe a comissão', render: (l) => <Nome p={l.comercial?.comissao?.beneficiario} /> },
  { id: 'regra', rotulo: 'Regra de comissão', grupo: 'Comissão', dica: 'Regra configurada em Metas & Comissões', render: (l) => <span class="text-xs">{l.comercial?.comissao?.regra ?? '—'}</span> },
  { id: 'competencia', rotulo: 'Competência', grupo: 'Comissão', dica: 'Mês em que a comissão conta', render: (l) => <span class="text-sm capitalize">{competencia(l.comercial?.comissao?.competencia)}</span> },
  { id: 'comissaoPagaEm', rotulo: 'Comissão paga em', grupo: 'Comissão', render: (l) => <span class="text-sm tabular-nums">{dia(l.comercial?.comissao?.pagaEm)}</span> },
  { id: 'comissaoPct', rotulo: '% sobre o recebido', grupo: 'Comissão', direita: true, dica: 'Comissão ÷ recebido (total)', render: (l) => {
    const c = comissaoValida(l)
    return <span class="tabular-nums text-xs">{c && l.recebidoTotal ? `${((c / l.recebidoTotal) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}</span>
  } },
  { id: 'liquido', rotulo: 'Líquido após comissão', grupo: 'Comissão', direita: true, dica: 'Recebido (total) − comissão (antes das taxas do gateway)', render: (l) => {
    if (!l.recebidoTotal) return <Vazio />
    const c = comissaoValida(l)
    return <><span class="tabular-nums font-medium">{brl(Math.round((l.recebidoTotal - c) * 100) / 100)}</span>{c > 0 && <Sub>−{brl(c)}</Sub>}</>
  } },
  // Inscrição
  { id: 'inscritoEm', rotulo: 'Inscrito em', grupo: 'Inscrição', render: (l) => <span class="text-sm tabular-nums">{dia(l.criadoEm)}</span> },
  { id: 'statusInscricao', rotulo: 'Status da inscrição', grupo: 'Inscrição', render: (l) => <span class="text-xs">{STATUS_INSCRICAO[l.inscricaoStatus ?? ''] ?? l.inscricaoStatus ?? '—'}</span> },
  { id: 'origemInscricao', rotulo: 'Canal da inscrição', grupo: 'Inscrição', dica: 'Portal, link de matrícula ou inscrição feita pela equipe', render: (l) => <span class="text-xs">{l.origemInscricao ? ORIGEM_INSCRICAO[l.origemInscricao] ?? l.origemInscricao : 'Portal'}</span> },
]

export const COLUNAS_PADRAO = ['curso', 'cobranca', 'valor', 'meio', 'situacao', 'pagoEm', 'recebidoPeriodo', 'venceEm', 'emAberto', 'responsavelVenda', 'comissao']

/** Conjuntos prontos para não montar a tabela do zero. */
const MODELOS: Array<{ id: string; rotulo: string; ids: string[] }> = [
  { id: 'padrao', rotulo: 'Padrão', ids: COLUNAS_PADRAO },
  { id: 'cobranca', rotulo: 'Cobrança', ids: ['contato', 'curso', 'valor', 'situacao', 'venceEm', 'emAberto', 'vencido', 'tentativas', 'responsavelLead'] },
  { id: 'comercial', rotulo: 'Comercial e comissão', ids: ['curso', 'situacao', 'recebidoTotal', 'responsavelVenda', 'valorVenda', 'comissao', 'regra', 'competencia', 'liquido', 'midia'] },
  { id: 'conciliacao', rotulo: 'Conciliação', ids: ['portal', 'cobranca', 'valor', 'meio', 'gateway', 'pagoEm', 'recebidoPeriodo', 'recebidoTotal'] },
]

// v1 guardava as colunas na ordem da definição; v2 guarda na ordem escolhida.
const CHAVE = 'financeiro-portal:colunas:v2'
const CHAVE_V1 = 'financeiro-portal:colunas:v1'
const validos = (v: unknown) => (Array.isArray(v) ? v.filter((x) => COLUNAS_FIN.some((c) => c.id === x)) : null)

export function useColunasFin(): [string[], (ids: string[]) => void] {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const v2 = validos(JSON.parse(localStorage.getItem(CHAVE) || 'null'))
      if (v2) return v2
      // Quem já tinha escolhido no v1 mantém a escolha e ganha as colunas comerciais do padrão.
      const v1 = validos(JSON.parse(localStorage.getItem(CHAVE_V1) || 'null'))
      if (v1) return [...v1, ...['responsavelVenda', 'comissao'].filter((x) => !v1.includes(x))]
    } catch { /* sem armazenamento: padrão */ }
    return COLUNAS_PADRAO
  })
  const salvar = (novo: string[]) => {
    setIds(novo)
    try { localStorage.setItem(CHAVE, JSON.stringify(novo)) } catch { /* ignora */ }
  }
  return [ids, salvar]
}

/** As colunas visíveis, na ordem escolhida. */
export const colunasVisiveis = (ids: string[]) => ids.map((id) => COLUNAS_FIN.find((c) => c.id === id)).filter((c): c is ColunaFin => !!c)

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function Caixa({ estado }: { estado: 'sim' | 'nao' | 'parte' }) {
  return (
    <span class={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${estado === 'nao' ? 'border-border-strong bg-surface' : 'border-accent bg-accent text-fg-on-brand'}`} aria-hidden>
      {estado === 'sim' && <Check size={11} strokeWidth={3} />}
      {estado === 'parte' && <Minus size={11} strokeWidth={3} />}
    </span>
  )
}

/** Botão "Colunas": painel com busca, modelos prontos, grupos e a ordem das colunas. */
export function SeletorDeColunas({ ids, aoMudar }: { ids: string[]; aoMudar: (ids: string[]) => void }) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  useEffect(() => {
    if (!aberto) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [aberto])

  const termo = semAcento(busca.trim())
  const filtradas = useMemo(() => (termo ? COLUNAS_FIN.filter((c) => semAcento(`${c.rotulo} ${c.grupo} ${c.dica ?? ''}`).includes(termo)) : COLUNAS_FIN), [termo])
  const marcadas = new Set(ids)
  // Marcar acrescenta no fim; desmarcar tira sem mexer na ordem das outras.
  const alternar = (id: string) => aoMudar(marcadas.has(id) ? ids.filter((x) => x !== id) : [...ids, id])
  const alternarGrupo = (g: GrupoFin) => {
    const doGrupo = filtradas.filter((c) => c.grupo === g).map((c) => c.id)
    const todas = doGrupo.every((x) => marcadas.has(x))
    aoMudar(todas ? ids.filter((x) => !doGrupo.includes(x)) : [...ids, ...doGrupo.filter((x) => !marcadas.has(x))])
  }
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= ids.length) return
    const n = [...ids]; [n[i], n[j]] = [n[j]!, n[i]!]; aoMudar(n)
  }
  const modeloAtual = MODELOS.find((m) => m.ids.length === ids.length && m.ids.every((x, i) => ids[i] === x))?.id
  const porId = new Map(COLUNAS_FIN.map((c) => [c.id, c]))

  return (
    <div class="relative">
      <Button variant="secondary" size="sm" onClick={() => setAberto((x) => !x)} aria-expanded={aberto} aria-haspopup="dialog">
        <Columns3 size={13} /> Colunas <span class="ml-0.5 rounded-full bg-surface-3 px-1.5 text-2xs tabular-nums">{ids.length}</span>
      </Button>
      {aberto && (
        <>
          <div class="fixed inset-0 z-30" onClick={() => setAberto(false)} />
          <div role="dialog" aria-label="Personalizar colunas" class="absolute right-0 top-full mt-2 z-40 w-[min(46rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface shadow-xl overflow-hidden">
            {/* Cabeçalho */}
            <div class="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-border">
              <div>
                <div class="text-sm font-semibold">Personalizar colunas</div>
                <div class="text-2xs text-fg-muted mt-0.5">{ids.length} de {COLUNAS_FIN.length} visíveis · "Candidato" fica sempre na 1ª coluna</div>
              </div>
              <button type="button" class="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg" onClick={() => setAberto(false)} aria-label="Fechar"><X size={15} /></button>
            </div>

            {/* Busca + modelos */}
            <div class="px-4 py-3 space-y-2.5 border-b border-border bg-surface-2/40">
              <label class="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 h-8 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                <Search size={13} class="text-fg-muted" />
                <input
                  class="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted"
                  placeholder="Buscar coluna (ex.: comissão, vencido, responsável)"
                  value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)} autoFocus
                />
                {busca && <button type="button" class="text-fg-muted hover:text-fg" onClick={() => setBusca('')} aria-label="Limpar busca"><X size={12} /></button>}
              </label>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-2xs uppercase tracking-wider text-fg-muted mr-1">Modelos</span>
                {MODELOS.map((m) => (
                  <button key={m.id} type="button" onClick={() => aoMudar(m.ids)}
                    class={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${modeloAtual === m.id ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-border hover:border-accent/60 hover:bg-surface-2'}`}>
                    {m.rotulo}
                  </button>
                ))}
              </div>
            </div>

            <div class="grid sm:grid-cols-[1fr_15rem]">
              {/* Todas as colunas, por grupo */}
              <div class="max-h-[24rem] overflow-y-auto px-2 py-2">
                {!filtradas.length && <div class="px-2 py-8 text-center text-xs text-fg-muted">Nenhuma coluna com "{busca}".</div>}
                {GRUPOS.map((g) => {
                  const cols = filtradas.filter((c) => c.grupo === g.id)
                  if (!cols.length) return null
                  const n = cols.filter((c) => marcadas.has(c.id)).length
                  return (
                    <div key={g.id} class="mb-1.5">
                      <button type="button" onClick={() => alternarGrupo(g.id)} class="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2" title="Marcar ou desmarcar o grupo">
                        <Caixa estado={n === 0 ? 'nao' : n === cols.length ? 'sim' : 'parte'} />
                        <span class="text-fg-muted">{g.icone}</span>
                        <span class="text-xs font-semibold">{g.id}</span>
                        <span class="text-2xs text-fg-muted truncate hidden md:inline">{g.texto}</span>
                        <span class="ml-auto text-2xs tabular-nums text-fg-muted">{n}/{cols.length}</span>
                      </button>
                      <div class="ml-4 border-l border-border pl-2">
                        {cols.map((c) => (
                          <button key={c.id} type="button" onClick={() => alternar(c.id)} aria-pressed={marcadas.has(c.id)}
                            class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
                            <span class="mt-0.5"><Caixa estado={marcadas.has(c.id) ? 'sim' : 'nao'} /></span>
                            <span class="min-w-0">
                              <span class={`block text-sm ${marcadas.has(c.id) ? 'font-medium' : ''}`}>{c.rotulo}</span>
                              {c.dica && <span class="block text-2xs text-fg-muted leading-snug">{c.dica}</span>}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Ordem das colunas na tabela */}
              <div class="border-t sm:border-t-0 sm:border-l border-border bg-surface-2/40 flex flex-col">
                <div class="px-3 pt-3 pb-1.5 text-2xs uppercase tracking-wider text-fg-muted">Ordem na tabela</div>
                <div class="max-h-[22rem] overflow-y-auto px-2 pb-2 space-y-0.5">
                  <div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg-muted">
                    <span class="w-4 text-2xs tabular-nums text-right">1</span> Candidato <span class="ml-auto text-2xs">fixa</span>
                  </div>
                  {!ids.length && <div class="px-2 py-4 text-2xs text-fg-muted">Nenhuma coluna marcada.</div>}
                  {ids.map((id, i) => {
                    const c = porId.get(id)
                    if (!c) return null
                    return (
                      <div key={id} class="group flex items-center gap-1.5 rounded-md border border-transparent bg-surface px-2 py-1 hover:border-border">
                        <span class="w-4 text-2xs tabular-nums text-right text-fg-muted">{i + 2}</span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-sm">{c.rotulo}</span>
                          <span class="block text-2xs text-fg-muted">{c.grupo}</span>
                        </span>
                        <button type="button" class="rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-30" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={`Subir ${c.rotulo}`}><ArrowUp size={12} /></button>
                        <button type="button" class="rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-30" disabled={i === ids.length - 1} onClick={() => mover(i, 1)} aria-label={`Descer ${c.rotulo}`}><ArrowDown size={12} /></button>
                        <button type="button" class="rounded p-0.5 text-fg-muted hover:bg-danger/10 hover:text-danger" onClick={() => alternar(id)} aria-label={`Tirar ${c.rotulo}`}><X size={12} /></button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Rodapé */}
            <div class="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border">
              <div class="text-2xs text-fg-muted">A escolha fica salva neste navegador.</div>
              <div class="flex gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => aoMudar(COLUNAS_PADRAO)}><RotateCcw size={12} /> Restaurar padrão</Button>
                <Button variant="primary" size="sm" onClick={() => setAberto(false)}>Concluir</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
