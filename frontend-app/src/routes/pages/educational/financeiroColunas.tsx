// Colunas da lista do Financeiro do portal: a equipe escolhe quais ver e a
// escolha fica guardada neste navegador. "Candidato" é fixa.
import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import { Columns3, RotateCcw } from '@/components/ui/icon-set'
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
  sem_cobranca: { rotulo: 'Sem cobrança', tom: 'neutral' },
}
const GATEWAY: Record<string, string> = { iugu: 'iugu', asaas: 'Asaas', pagarme: 'Pagar.me', simulado: 'Simulado', manual: 'Manual', isencao: 'Isento (cupom)' }
const STATUS_INSCRICAO: Record<string, string> = {
  draft: 'Rascunho', submitted: 'Enviada', pending: 'Aguardando pagamento', paid: 'Paga', approved: 'Aprovada', enrolled: 'Matriculada',
  rejected: 'Reprovada', cancelled: 'Cancelada', expired: 'Expirada', lost: 'Perdida', merged: 'Mesclada',
}

const Sub = ({ children }: { children: ComponentChildren }) => <div class="text-2xs text-fg-muted">{children}</div>

export interface ColunaFin {
  id: string
  rotulo: string
  grupo: 'Aluno' | 'Curso' | 'Valores' | 'Pagamento' | 'Vencimento' | 'Inscrição'
  direita?: boolean
  dica?: string
  render: (l: LinhaFinanceiro) => ComponentChildren
}

export const COLUNAS_FIN: ColunaFin[] = [
  // Aluno
  { id: 'contato', rotulo: 'Contato', grupo: 'Aluno', render: (l) => <><div class="text-xs">{l.email ?? '—'}</div><Sub>{l.whatsapp ?? ''}</Sub></> },
  { id: 'cpf', rotulo: 'CPF', grupo: 'Aluno', render: (l) => <span class="text-xs font-mono">{l.cpf ?? '—'}</span> },
  // Curso
  { id: 'curso', rotulo: 'Curso / oferta', grupo: 'Curso', render: (l) => <><div class="text-sm">{l.curso?.nome ?? '—'}</div><Sub>{l.oferta?.nome ?? ''}</Sub></> },
  { id: 'portal', rotulo: 'Portal', grupo: 'Curso', render: (l) => <span class="text-xs">{l.portal?.nome ?? '—'}</span> },
  { id: 'processo', rotulo: 'Processo seletivo', grupo: 'Curso', render: (l) => <span class="text-xs">{l.processo?.nome ?? '—'}</span> },
  { id: 'cobranca', rotulo: 'Cobrança', grupo: 'Curso', render: (l) => <span class="text-xs">{l.rotulo}</span> },
  // Valores
  { id: 'tabela', rotulo: 'Valor de tabela', grupo: 'Valores', direita: true, render: (l) => <span class="tabular-nums">{brl(l.valorTabela)}</span> },
  { id: 'desconto', rotulo: 'Desconto', grupo: 'Valores', direita: true, render: (l) => <>{l.descontoCupom + l.descontoAVista > 0 ? <span class="text-success tabular-nums">−{brl(l.descontoCupom + l.descontoAVista)}</span> : '—'}{l.cupom && <div class="text-2xs text-fg-muted font-mono">{l.cupom}</div>}</> },
  { id: 'cupom', rotulo: 'Cupom', grupo: 'Valores', render: (l) => <span class="text-xs font-mono">{l.cupom ?? '—'}</span> },
  { id: 'valor', rotulo: '1ª cobrança', grupo: 'Valores', direita: true, dica: 'Valor da 1ª cobrança (com cupom e desconto)', render: (l) => <><span class="tabular-nums font-medium">{brl(l.valorCobrado)}</span>{l.parcelas > 1 && <Sub>{l.parcelas}x</Sub>}</> },
  { id: 'parcelas', rotulo: 'Parcelas', grupo: 'Valores', direita: true, render: (l) => <span class="tabular-nums">{l.parcelas}</span> },
  { id: 'recebidoPeriodo', rotulo: 'Pago no período', grupo: 'Pagamento', direita: true, dica: 'O que entrou dentro das datas do filtro', render: (l) => <span class={`tabular-nums font-medium ${l.recebidoNoPeriodo ? 'text-success' : 'text-fg-muted'}`}>{l.recebidoNoPeriodo ? brl(l.recebidoNoPeriodo) : '—'}</span> },
  { id: 'recebidoTotal', rotulo: 'Recebido (total)', grupo: 'Pagamento', direita: true, dica: 'Tudo o que já entrou nesta matrícula', render: (l) => <><span class="tabular-nums">{l.recebidoTotal ? brl(l.recebidoTotal) : '—'}</span>{l.pagamentosFeitos > 1 && <Sub>{l.pagamentosFeitos} pagamentos</Sub>}</> },
  { id: 'emAberto', rotulo: 'Em aberto', grupo: 'Vencimento', direita: true, dica: 'Soma das cobranças ainda não pagas', render: (l) => <><span class={`tabular-nums ${l.vencidoValor > 0 ? 'text-danger font-medium' : l.emAberto ? 'text-warning' : 'text-fg-muted'}`}>{l.emAberto ? brl(l.emAberto) : '—'}</span>{l.parcelasEmAberto > 0 && <Sub>{l.parcelasEmAberto} {l.parcelasEmAberto === 1 ? 'cobrança' : 'cobranças'}</Sub>}</> },
  { id: 'vencido', rotulo: 'Vencido', grupo: 'Vencimento', direita: true, render: (l) => <span class={`tabular-nums ${l.vencidoValor ? 'text-danger font-medium' : 'text-fg-muted'}`}>{l.vencidoValor ? brl(l.vencidoValor) : '—'}</span> },
  { id: 'venceNoPeriodo', rotulo: 'Vence no período', grupo: 'Vencimento', direita: true, dica: 'Cobranças com vencimento dentro das datas do filtro (pagas ou não)', render: (l) => <span class="tabular-nums">{l.venceNoPeriodo ? brl(l.venceNoPeriodo) : '—'}</span> },
  // Pagamento
  { id: 'meio', rotulo: 'Meio', grupo: 'Pagamento', render: (l) => <Meio meio={l.meio === 'cartao' ? 'credit_card' : l.meio} /> },
  { id: 'gateway', rotulo: 'Gateway', grupo: 'Pagamento', render: (l) => <span class="text-xs">{l.gateway ? GATEWAY[l.gateway] ?? l.gateway : '—'}</span> },
  { id: 'situacao', rotulo: 'Situação', grupo: 'Pagamento', render: (l) => <Badge tone={SITUACAO_FIN[l.situacao].tom}>{SITUACAO_FIN[l.situacao].rotulo}</Badge> },
  { id: 'pagoEm', rotulo: 'Pago em', grupo: 'Pagamento', dica: 'Data do último pagamento', render: (l) => {
    const u = l.recebimentos?.[l.recebimentos.length - 1]
    return u ? <><span class="text-sm tabular-nums">{dia(u.em ?? u.dia)}</span><Sub>{[hora(u.em), u.rotulo].filter(Boolean).join(' · ')}</Sub></> : <span class="text-fg-muted">—</span>
  } },
  { id: 'tentativas', rotulo: 'Tentativas', grupo: 'Pagamento', direita: true, render: (l) => <span class="tabular-nums">{l.tentativas}</span> },
  // Vencimento
  { id: 'venceEm', rotulo: 'Vence em', grupo: 'Vencimento', dica: 'A cobrança em aberto mais antiga', render: (l) => {
    if (!l.vencimentoMaisAntigo) return <span class="text-fg-muted">—</span>
    const venceu = l.vencimentoMaisAntigo < hoje()
    return <><span class={`text-sm tabular-nums ${venceu ? 'text-danger font-medium' : ''}`}>{dia(l.vencimentoMaisAntigo)}</span>{venceu && <Sub>vencida</Sub>}</>
  } },
  { id: 'proximoVencimento', rotulo: 'Próximo vencimento', grupo: 'Vencimento', render: (l) => <span class="text-sm tabular-nums">{dia(l.proximoVencimento)}</span> },
  // Inscrição
  { id: 'inscritoEm', rotulo: 'Inscrito em', grupo: 'Inscrição', render: (l) => <span class="text-sm tabular-nums">{dia(l.criadoEm)}</span> },
  { id: 'statusInscricao', rotulo: 'Status da inscrição', grupo: 'Inscrição', render: (l) => <span class="text-xs">{STATUS_INSCRICAO[l.inscricaoStatus ?? ''] ?? l.inscricaoStatus ?? '—'}</span> },
]

export const COLUNAS_PADRAO = ['curso', 'cobranca', 'valor', 'meio', 'situacao', 'pagoEm', 'recebidoPeriodo', 'venceEm', 'emAberto']
const CHAVE = 'financeiro-portal:colunas:v1'

export function useColunasFin(): [string[], (ids: string[]) => void] {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(CHAVE) || 'null')
      if (Array.isArray(v)) return v.filter((x) => COLUNAS_FIN.some((c) => c.id === x))
    } catch { /* sem armazenamento: padrão */ }
    return COLUNAS_PADRAO
  })
  const salvar = (novo: string[]) => {
    setIds(novo)
    try { localStorage.setItem(CHAVE, JSON.stringify(novo)) } catch { /* ignora */ }
  }
  return [ids, salvar]
}

/** Botão "Colunas" com a lista para marcar e desmarcar, agrupada. */
export function SeletorDeColunas({ ids, aoMudar }: { ids: string[]; aoMudar: (ids: string[]) => void }) {
  const [aberto, setAberto] = useState(false)
  const grupos = [...new Set(COLUNAS_FIN.map((c) => c.grupo))]
  // Mantém a ordem da definição: a tabela não embaralha ao marcar.
  const alternar = (id: string) => {
    const set = new Set(ids)
    if (set.has(id)) set.delete(id); else set.add(id)
    aoMudar(COLUNAS_FIN.map((c) => c.id).filter((x) => set.has(x)))
  }
  return (
    <div class="relative">
      <Button variant="secondary" size="sm" onClick={() => setAberto((x) => !x)} aria-expanded={aberto}>
        <Columns3 size={13} /> Colunas ({ids.length})
      </Button>
      {aberto && (
        <>
          <div class="fixed inset-0 z-30" onClick={() => setAberto(false)} />
          <div class="absolute right-0 top-full mt-1 z-40 w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface shadow-lg p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="text-sm font-medium">Colunas da lista</div>
              <div class="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => aoMudar(COLUNAS_FIN.map((c) => c.id))}>Todas</Button>
                <Button variant="ghost" size="sm" onClick={() => aoMudar(COLUNAS_PADRAO)}><RotateCcw size={12} /> Padrão</Button>
              </div>
            </div>
            <div class="grid gap-3 sm:grid-cols-3">
              {grupos.map((g) => (
                <div key={g}>
                  <div class="text-2xs uppercase tracking-wider text-fg-muted mb-1">{g}</div>
                  {COLUNAS_FIN.filter((c) => c.grupo === g).map((c) => (
                    <label key={c.id} class="flex items-start gap-2 py-1 text-sm cursor-pointer" title={c.dica}>
                      <input type="checkbox" class="mt-0.5" checked={ids.includes(c.id)} onChange={() => alternar(c.id)} />
                      <span>{c.rotulo}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div class="text-2xs text-fg-muted mt-2">"Candidato" fica sempre. A escolha fica salva neste navegador.</div>
          </div>
        </>
      )}
    </div>
  )
}
