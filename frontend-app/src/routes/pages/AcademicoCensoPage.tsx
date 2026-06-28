import { useState, useEffect } from 'preact/hooks'
import { Database, Download, AlertTriangle, CheckCircle2, GraduationCap } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { KpiCard } from '@/components/ui/KpiCard'
import { useAnosCenso, useValidacaoCenso, useEnade, useCensoMut, baixarCensoCsv, type Inconsistencia } from '@/hooks/useAcaCenso'

type Tab = 'validacao' | 'enade'

export function AcademicoCensoPage() {
  const [tab, setTab] = useState<Tab>('validacao')
  const anos = useAnosCenso()
  const [anoBase, setAnoBase] = useState<number | null>(null)
  useEffect(() => { if (anoBase === null && anos.data?.anos?.length) setAnoBase(anos.data.anos[0]) }, [anos.data])

  return (
    <Page title="Censo INEP / ENADE" description="Validação de consistência, Censo da Educação Superior e seleção ENADE (ingressantes/concluintes).">
      <p class="text-xs text-fg-muted">⚠️ Os leiautes oficiais do INEP variam por ano-base. As exportações são uma base consolidada, mapeável ao layout vigente.</p>
      <div class="flex gap-1 border-b border-border">
        {([['validacao', 'Validação & Censo Superior'], ['enade', 'ENADE']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'validacao' ? <ValidacaoTab anoBase={anoBase} setAnoBase={setAnoBase} anos={anos.data?.anos ?? []} /> : <EnadeTab anos={anos.data?.anos ?? []} />}
    </Page>
  )
}

function ValidacaoTab({ anoBase, setAnoBase, anos }: { anoBase: number | null; setAnoBase: (a: number | null) => void; anos: number[] }) {
  const val = useValidacaoCenso(anoBase)
  const mut = useCensoMut()
  const [just, setJust] = useState<{ mat: number } | null>(null)
  const [motivo, setMotivo] = useState('')
  const v = val.data

  return (
    <div class="space-y-3 mt-3">
      <div class="flex items-center gap-2 flex-wrap">
        <Select value={anoBase ?? ''} onChange={(e: any) => setAnoBase(e.currentTarget.value ? Number(e.currentTarget.value) : null)} class="!w-40">
          <option value="">Todos os anos</option>{anos.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Button size="sm" variant="secondary" onClick={() => baixarCensoCsv(`superior.csv${anoBase ? `?anoBase=${anoBase}` : ''}`, `censo-superior${anoBase ? `-${anoBase}` : ''}.csv`).catch(() => {})}><Download size={14} /> Exportar Censo Superior</Button>
      </div>

      {val.isLoading ? <Skeleton class="h-24 w-full" /> : v && (
        <>
          <div class="grid grid-cols-3 gap-3">
            <KpiCard label="Matrículas" value={String(v.total)} />
            <KpiCard label="Com inconsistência" value={String(v.comInconsistencia)} />
            <KpiCard label="Pendentes (sem justificativa)" value={String(v.pendentes)} />
          </div>
          {v.inconsistencias.length === 0 ? (
            <Card><p class="text-sm text-success flex items-center gap-2"><CheckCircle2 size={16} /> Nenhuma inconsistência encontrada.</p></Card>
          ) : (
            <Card class="p-0 overflow-hidden divide-y divide-border">
              {v.inconsistencias.map((i: Inconsistencia) => (
                <div key={i.matriculaId} class="px-4 py-3 text-sm">
                  <div class="flex items-center gap-2">
                    <span class="flex-1 min-w-0"><span class="block truncate text-fg">{i.nome} <span class="text-xs text-fg-subtle">RA {i.ra || '—'} · {i.curso}</span></span></span>
                    {i.justificada ? <Badge tone="neutral">justificada</Badge> : <Badge tone="warning">pendente</Badge>}
                    {!i.justificada && <Button size="sm" variant="ghost" onClick={() => { setJust({ mat: i.matriculaId }); setMotivo('') }}>Justificar</Button>}
                  </div>
                  <div class="flex flex-wrap gap-1 mt-1">{i.problemas.map((p) => <span key={p} class="text-xs px-2 py-0.5 bg-surface-2 rounded text-warning flex items-center gap-1"><AlertTriangle size={10} /> {p}</span>)}</div>
                  {just?.mat === i.matriculaId && (
                    <div class="flex gap-2 mt-2">
                      <Input class="flex-1" placeholder="Motivo da justificativa" value={motivo} onInput={(e: any) => setMotivo(e.currentTarget.value)} />
                      <Button size="sm" variant="primary" disabled={!motivo || !anoBase || mut.justificar.isPending} onClick={() => mut.justificar.mutate({ matriculaId: i.matriculaId, anoBase: anoBase!, motivo }, { onSuccess: () => setJust(null) })}>Salvar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setJust(null)}>Cancelar</Button>
                    </div>
                  )}
                  {!anoBase && just?.mat === i.matriculaId && <p class="text-xs text-danger mt-1">Selecione um ano-base para justificar.</p>}
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function EnadeTab({ anos }: { anos: number[] }) {
  const [ano, setAno] = useState<number>(anos[0] ?? new Date().getFullYear())
  const enade = useEnade(ano)
  const e = enade.data

  return (
    <div class="space-y-3 mt-3">
      <div class="flex items-center gap-2 flex-wrap">
        <Input type="number" value={ano} onInput={(ev: any) => setAno(Number(ev.currentTarget.value) || ano)} class="!w-32" label="Ano ENADE" />
        <Button size="sm" variant="secondary" class="self-end" onClick={() => baixarCensoCsv(`enade.csv?ano=${ano}`, `enade-${ano}.csv`).catch(() => {})}><Download size={14} /> Exportar ENADE</Button>
      </div>
      {enade.isLoading ? <Skeleton class="h-24 w-full" /> : e && (
        <>
          <div class="grid grid-cols-2 gap-3">
            <KpiCard label="Ingressantes" value={String(e.totalIngressantes)} />
            <KpiCard label="Concluintes" value={String(e.totalConcluintes)} />
          </div>
          {e.porCurso.length === 0 ? <Card><p class="text-sm text-fg-muted">Nenhum aluno enquadrado no ENADE de {ano}.</p></Card> : (
            <Card class="p-0 overflow-hidden">
              <table class="w-full text-sm">
                <thead class="bg-surface-2 text-xs text-fg-muted"><tr><th class="text-left p-2 flex items-center gap-1"><GraduationCap size={12} /> Curso</th><th class="p-2 text-right">Ingressantes</th><th class="p-2 text-right">Concluintes</th></tr></thead>
                <tbody class="divide-y divide-border">
                  {e.porCurso.map((c) => <tr key={c.curso}><td class="p-2">{c.curso}</td><td class="p-2 text-right">{c.ingressantes}</td><td class="p-2 text-right">{c.concluintes}</td></tr>)}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
