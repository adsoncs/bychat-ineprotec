import { useState } from 'preact/hooks'
import { Users, GraduationCap, TrendingUp, Wallet, AlertTriangle, Percent } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePeriodos } from '@/hooks/useAcaCatalogo'
import { useAcaBi, money } from '@/hooks/useAcaBi'
import { SITUACAO_LABEL } from '@/hooks/useAcaFechamento'

const SIT_COR: Record<string, string> = { APROVADO: 'bg-success', RECUPERACAO: 'bg-warning', REPROVADO_NOTA: 'bg-danger', REPROVADO_FREQUENCIA: 'bg-danger', REPROVADO: 'bg-danger', EM_ANDAMENTO: 'bg-fg-subtle' }
const PARC_LABEL: Record<string, string> = { ABERTA: 'Em aberto', PAGA: 'Pagas', VENCIDA: 'Vencidas', CANCELADA: 'Canceladas', RENEGOCIADA: 'Renegociadas' }
const PARC_COR: Record<string, string> = { ABERTA: 'bg-warning', PAGA: 'bg-success', VENCIDA: 'bg-danger', CANCELADA: 'bg-fg-subtle', RENEGOCIADA: 'bg-accent' }

function Kpi({ icon, label, value, hint, tone }: { icon: any; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card class="space-y-1">
      <div class="flex items-center gap-2 text-fg-muted text-xs">{icon}<span>{label}</span></div>
      <div class={`text-2xl font-semibold ${tone ?? 'text-fg'}`}>{value}</div>
      {hint && <div class="text-[11px] text-fg-subtle">{hint}</div>}
    </Card>
  )
}

export function AcademicoBiPage() {
  const periodos = usePeriodos()
  const [periodoId, setPeriodoId] = useState<number | null>(null)
  const bi = useAcaBi(periodoId)
  const d = bi.data

  return (
    <Page title="Indicadores (BI)" description="Visão acadêmica e financeira do módulo." actions={
      <div class="w-56">
        <Select value={periodoId ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setPeriodoId(v ? Number(v) : null) }}>
          <option value="">Todos os períodos</option>
          {(periodos.data?.periodos ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
        </Select>
      </div>
    }>
      {bi.isLoading || !d ? <Skeleton class="h-64 w-full" /> : (
        <div class="space-y-5">
          {/* Acadêmico */}
          <div>
            <h2 class="text-xs font-semibold uppercase text-fg-muted mb-2">Acadêmico</h2>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi icon={<Users size={14} />} label="Alunos ativos" value={String(d.academico.alunosAtivos)} hint={`${d.academico.listaEspera} em lista de espera`} />
              <Kpi icon={<GraduationCap size={14} />} label="Turmas ativas" value={String(d.academico.turmasAtivas)} />
              <Kpi icon={<Percent size={14} />} label="Ocupação" value={`${d.academico.ocupacaoPct}%`} hint={`${d.academico.vagas.ocupadas}/${d.academico.vagas.capacidade} vagas`} />
              <Kpi icon={<AlertTriangle size={14} />} label="Evasão / Concluintes" value={`${d.academico.evadidos} / ${d.academico.concluidos}`} tone={d.academico.evadidos > 0 ? 'text-danger' : 'text-fg'} />
            </div>
          </div>

          {/* Desempenho */}
          <div class="grid gap-3 lg:grid-cols-2">
            <Card class="space-y-2">
              <div class="flex items-center justify-between"><h3 class="text-xs font-semibold uppercase text-fg-muted">Resultados</h3><span class="text-xs text-fg-subtle">{d.desempenho.totalAvaliados} avaliado(s)</span></div>
              {d.desempenho.totalAvaliados === 0 ? <p class="text-xs text-fg-muted">Nenhum diário fechado ainda.</p> : (
                <div class="space-y-1.5">
                  {Object.entries(d.desempenho.situacao).map(([s, n]) => {
                    const pct = Math.round((n / d.desempenho.totalAvaliados) * 100)
                    return (
                      <div key={s}>
                        <div class="flex justify-between text-xs mb-0.5"><span>{SITUACAO_LABEL[s] ?? s}</span><span class="text-fg-muted">{n} ({pct}%)</span></div>
                        <div class="h-2 rounded bg-surface-2 overflow-hidden"><div class={`h-full ${SIT_COR[s] ?? 'bg-accent'}`} style={`width:${pct}%`} /></div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
            <Card class="flex items-center gap-4">
              <div class="flex-1">
                <div class="flex items-center gap-2 text-fg-muted text-xs"><TrendingUp size={14} /> Frequência média</div>
                <div class={`text-3xl font-semibold ${d.desempenho.frequenciaMedia != null && d.desempenho.frequenciaMedia < 75 ? 'text-danger' : 'text-fg'}`}>{d.desempenho.frequenciaMedia != null ? `${d.desempenho.frequenciaMedia}%` : '—'}</div>
                <div class="text-[11px] text-fg-subtle">média das disciplinas com resultado</div>
              </div>
            </Card>
          </div>

          {/* Financeiro */}
          <div>
            <h2 class="text-xs font-semibold uppercase text-fg-muted mb-2">Financeiro</h2>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi icon={<Wallet size={14} />} label="Recebido" value={money(d.financeiro.recebido)} tone="text-success" />
              <Kpi icon={<Wallet size={14} />} label="A receber" value={money(d.financeiro.aReceber)} />
              <Kpi icon={<AlertTriangle size={14} />} label="Inadimplência" value={money(d.financeiro.inadimplencia.valor)} hint={`${d.financeiro.inadimplencia.count} parcela(s) vencida(s)`} tone={d.financeiro.inadimplencia.valor > 0 ? 'text-danger' : 'text-fg'} />
              <Kpi icon={<TrendingUp size={14} />} label="Ticket médio" value={money(d.financeiro.ticketMedio)} hint={`${d.financeiro.contratosAtivos} contrato(s) ativo(s)`} />
            </div>
            {Object.keys(d.financeiro.porSituacao).length > 0 && (
              <Card class="mt-3 p-0 overflow-hidden">
                <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted">Parcelas por situação</div>
                <table class="w-full text-sm">
                  <tbody class="divide-y divide-border">
                    {Object.entries(d.financeiro.porSituacao).map(([s, v]) => (
                      <tr key={s}>
                        <td class="p-2"><span class={`inline-block w-2 h-2 rounded-full mr-2 ${PARC_COR[s] ?? 'bg-accent'}`} />{PARC_LABEL[s] ?? s}</td>
                        <td class="p-2 text-right text-fg-muted">{v.count}</td>
                        <td class="p-2 text-right font-medium">{money(v.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        </div>
      )}
    </Page>
  )
}
