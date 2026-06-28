import { useState } from 'preact/hooks'
import { ClipboardList, ArrowLeft, CheckCircle2, Hash } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useMatriculas, useMatricula, useMatriculaMut } from '@/hooks/useAcaMatricula'
import { useFinanceiro, useFinanceiroMut } from '@/hooks/useAcaFinanceiro'
import { Copy, FileText } from 'lucide-preact'

const STATUS_LABEL: Record<string, string> = {
  INSCRITO: 'Inscrito', PRE_MATRICULA: 'Pré-matrícula', MATRICULADO: 'Matriculado',
  TRANCADO: 'Trancado', TRANSFERIDO: 'Transferido', CONCLUIDO: 'Concluído', EVADIDO: 'Evadido', CANCELADO: 'Cancelado',
}
const STATUS_TONE: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
  INSCRITO: 'info', PRE_MATRICULA: 'warning', MATRICULADO: 'success', TRANCADO: 'warning',
  TRANSFERIDO: 'neutral', CONCLUIDO: 'accent', EVADIDO: 'danger', CANCELADO: 'neutral',
}
const ORDER = ['INSCRITO', 'PRE_MATRICULA', 'MATRICULADO', 'TRANCADO', 'TRANSFERIDO', 'CONCLUIDO', 'EVADIDO', 'CANCELADO']

export function AcademicoMatriculasPage() {
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const list = useMatriculas(status)

  if (selectedId !== null) return <MatriculaDetalhe id={selectedId} onBack={() => setSelectedId(null)} />

  const rows = list.data?.matriculas ?? []
  const counters = list.data?.counters ?? {}
  return (
    <Page title="Matrículas" description="Efetivação e ciclo de vida das matrículas.">
      <div class="flex flex-wrap items-center gap-2">
        <button class={`text-xs px-3 py-1.5 rounded-md border ${status === '' ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`} onClick={() => setStatus('')}>Todas</button>
        {ORDER.filter((s) => counters[s]).map((s) => (
          <button key={s} class={`text-xs px-3 py-1.5 rounded-md border ${status === s ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`} onClick={() => setStatus(s)}>
            {STATUS_LABEL[s]} ({counters[s]})
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <div class="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-14 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList size={28} />} title="Nenhuma matrícula" description="Inscreva alunos numa turma (aba Turmas) e efetive aqui." />
      ) : (
        <Card class="divide-y divide-border p-0 overflow-hidden">
          {rows.map((m) => (
            <button key={m.id} class="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-2 text-left" onClick={() => setSelectedId(m.id)}>
              <span class="text-fg-muted text-xs font-mono w-24 shrink-0">RA {m.aluno.ra}</span>
              <span class="flex-1 min-w-0">
                <span class="block truncate text-sm font-medium text-fg">{m.aluno.lead.nome}</span>
                <span class="block truncate text-xs text-fg-muted">{m.turma.nome} · {m.turma.periodoLetivo.codigo}</span>
              </span>
              {m.listaEspera && <Badge tone="warning">espera</Badge>}
              {m.contrato && <Badge tone="accent">financeiro</Badge>}
              <Badge tone={STATUS_TONE[m.status]} solid>{STATUS_LABEL[m.status]}</Badge>
            </button>
          ))}
        </Card>
      )}
    </Page>
  )
}

function MatriculaDetalhe({ id, onBack }: { id: number; onBack: () => void }) {
  const detail = useMatricula(id)
  const mut = useMatriculaMut(id)
  const [obs, setObs] = useState('')
  const m = detail.data?.matricula
  const transicoes = detail.data?.transicoes ?? []

  function transit(para: string) {
    const precisaObs = ['CANCELADO', 'EVADIDO', 'TRANSFERIDO', 'TRANCADO'].includes(para)
    mut.setStatus.mutate({ para, obs: precisaObs ? (obs || undefined) : undefined }, { onSuccess: () => setObs('') })
  }

  return (
    <Page title={m ? m.aluno.lead.nome : 'Matrícula'} actions={<Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>}>
      {!m ? <Skeleton class="h-40 w-full" /> : (
        <div class="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div class="space-y-4">
            <Card class="space-y-2">
              <div class="flex items-center gap-2">
                <Badge tone={STATUS_TONE[m.status]} solid>{STATUS_LABEL[m.status]}</Badge>
                {m.listaEspera && <Badge tone="warning">lista de espera</Badge>}
                <span class="ml-auto text-fg-muted text-xs font-mono inline-flex items-center gap-1"><Hash size={11} /> RA {m.aluno.ra}</span>
              </div>
              <dl class="text-sm text-fg-muted grid grid-cols-2 gap-y-1 pt-1">
                <dt>Aluno</dt><dd class="text-fg text-right">{m.aluno.lead.nome}</dd>
                <dt>Turma</dt><dd class="text-fg text-right truncate">{m.turma.nome}</dd>
                <dt>Período</dt><dd class="text-fg text-right">{m.turma.periodoLetivo.codigo}</dd>
                <dt>Origem</dt><dd class="text-fg text-right">{m.origem || '—'}</dd>
                {m.motivoSaida && (<><dt>Motivo saída</dt><dd class="text-fg text-right">{m.motivoSaida}</dd></>)}
              </dl>
            </Card>

            <FinanceiroCard matriculaId={m.id} podeGerar={m.status === 'MATRICULADO'} />

            <Card>
              <h3 class="text-sm font-semibold text-fg mb-2">Trilha de status</h3>
              <ol class="space-y-1.5">
                {m.eventos.map((e) => (
                  <li key={e.id} class="text-xs flex gap-2">
                    <span class="text-fg-subtle shrink-0">{new Date(e.createdAt).toLocaleString('pt-BR')}</span>
                    <span class="text-fg">{e.de ? `${STATUS_LABEL[e.de] || e.de} → ` : ''}<b>{STATUS_LABEL[e.para] || e.para}</b>{e.obs ? ` — ${e.obs}` : ''}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          <Card class="space-y-2">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted">Ações</h3>
            {['INSCRITO', 'PRE_MATRICULA', 'TRANCADO'].includes(m.status) && !m.listaEspera && (
              <Button variant="primary" size="sm" class="w-full" disabled={mut.efetivar.isPending} onClick={() => mut.efetivar.mutate()}>
                <CheckCircle2 size={14} /> {mut.efetivar.isPending ? 'Efetivando…' : 'Efetivar matrícula'}
              </Button>
            )}
            {m.listaEspera && <p class="text-xs text-warning">Aluno em lista de espera — promova para vaga (aba Turmas) antes de efetivar.</p>}
            {transicoes.length > 0 && (
              <>
                <p class="text-[11px] text-fg-subtle pt-1">Mudar status para:</p>
                <textarea class="w-full text-xs rounded-md border border-border bg-surface px-2 py-1.5 text-fg" rows={2} placeholder="Observação (obrigatória em trancar/cancelar/transferir)" value={obs} onInput={(e) => setObs((e.target as HTMLTextAreaElement).value)} />
                <div class="flex flex-wrap gap-1.5">
                  {transicoes.filter((s) => s !== 'MATRICULADO').map((s) => (
                    <button key={s} class="text-xs px-2.5 py-1 rounded-md border border-border text-fg-muted hover:bg-surface-2" disabled={mut.setStatus.isPending} onClick={() => transit(s)}>
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </>
            )}
            {mut.setStatus.isError && <p class="text-xs text-danger">{(mut.setStatus.error as any)?.message}</p>}
          </Card>
        </div>
      )}
    </Page>
  )
}

const SIT_TONE: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  ABERTA: 'info', PAGA: 'success', VENCIDA: 'danger', CANCELADA: 'neutral', RENEGOCIADA: 'warning',
}
const TIPO_LABEL: Record<string, string> = { MATRICULA: 'Matrícula', MENSALIDADE: 'Mensalidade', MATERIAL: 'Material', TAXA: 'Taxa', OUTRO: 'Outro' }
const brl = (c: number) => `R$ ${(c / 100).toFixed(2)}`

function FinanceiroCard({ matriculaId, podeGerar }: { matriculaId: number; podeGerar: boolean }) {
  const fin = useFinanceiro(matriculaId)
  const mut = useFinanceiroMut(matriculaId)
  const c = fin.data?.contrato

  if (!c) {
    return (
      <Card>
        <h3 class="text-sm font-semibold text-fg mb-2">Financeiro</h3>
        <p class="text-xs text-fg-muted">Nenhum contrato gerado.</p>
        {podeGerar && <Button variant="secondary" size="sm" class="mt-2" disabled={mut.gerar.isPending} onClick={() => mut.gerar.mutate()}>Gerar contrato + parcelas</Button>}
        {mut.gerar.isError && <p class="text-xs text-danger mt-1">{(mut.gerar.error as any)?.message}</p>}
      </Card>
    )
  }
  const pagas = c.parcelas.filter((p) => p.situacao === 'PAGA').length
  const aberto = c.parcelas.filter((p) => ['ABERTA', 'VENCIDA'].includes(p.situacao)).reduce((s, p) => s + p.valorBrutoCentavos, 0)
  return (
    <Card class="p-0 overflow-hidden">
      <div class="px-4 py-2.5 bg-surface-2 flex items-center gap-2">
        <h3 class="text-sm font-semibold text-fg flex-1">Financeiro</h3>
        <Badge tone={c.status === 'QUITADO' ? 'success' : 'accent'}>{c.status}</Badge>
      </div>
      <div class="px-4 py-2 text-xs text-fg-muted border-b border-border">
        Total {brl(c.valorTotalCentavos)} · {pagas}/{c.parcelas.length} pagas · em aberto {brl(aberto)}
        {c.descontoCentavos > 0 && <span class="text-success"> · desconto {brl(c.descontoCentavos)}</span>}
      </div>
      <div class="max-h-80 overflow-auto divide-y divide-border">
        {c.parcelas.map((p) => (
          <div key={p.id} class="px-4 py-2 flex items-center gap-2 text-sm">
            <span class="w-6 text-xs text-fg-subtle">{p.nroParcela}</span>
            <span class="flex-1 min-w-0">
              <span class="text-fg">{TIPO_LABEL[p.tipo] || p.tipo}</span>
              <span class="block text-[11px] text-fg-muted">venc. {new Date(p.dataVencimento).toLocaleDateString('pt-BR')} · {brl(p.valorBrutoCentavos)}</span>
            </span>
            <Badge tone={SIT_TONE[p.situacao]}>{p.situacao}</Badge>
            {['ABERTA', 'VENCIDA'].includes(p.situacao) && (
              <div class="flex items-center gap-1">
                {!p.asaasChargeId && <button class="text-[11px] text-accent hover:underline" title="Emitir boleto/PIX no Asaas" disabled={mut.cobranca.isPending} onClick={() => mut.cobranca.mutate(p.id)}>Cobrar</button>}
                {p.linhaDigitavel && <a class="text-fg-muted hover:text-accent" href={p.linhaDigitavel} target="_blank" rel="noopener" title="Boleto"><FileText size={13} /></a>}
                {p.pixCopiaCola && <button class="text-fg-muted hover:text-accent" title="Copiar PIX" onClick={() => navigator.clipboard?.writeText(p.pixCopiaCola!)}><Copy size={13} /></button>}
                <button class="text-[11px] text-fg-muted hover:text-success" title="Dar baixa manual" disabled={mut.baixa.isPending} onClick={() => mut.baixa.mutate(p.id)}>Baixar</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {mut.cobranca.isError && <p class="text-xs text-danger px-4 py-2">{(mut.cobranca.error as any)?.message}</p>}
    </Card>
  )
}
