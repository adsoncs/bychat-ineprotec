import { useState } from 'preact/hooks'
import { Download, Database, AlertTriangle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePeriodos, useTurmas } from '@/hooks/useAcaCatalogo'
import { useSistecPreview, exportSistecCsv, SISTEC_LABEL } from '@/hooks/useAcaSistec'

export function AcademicoSistecPage() {
  const periodos = usePeriodos()
  const turmas = useTurmas()
  const [periodoLetivoId, setPeriodo] = useState<number | null>(null)
  const [turmaId, setTurma] = useState<number | null>(null)
  const filtros = { periodoLetivoId, turmaId }
  const prev = useSistecPreview(filtros)
  const d = prev.data

  return (
    <Page title="Censo / SISTEC" description="Exportação consolidada de matrículas para prestação de informações (educação profissional)." actions={
      <Button variant="primary" size="sm" disabled={!d || d.total === 0} onClick={() => exportSistecCsv(filtros).catch(() => {})}><Download size={14} /> Exportar CSV</Button>
    }>
      <Card class="flex flex-wrap items-end gap-2">
        <div class="w-48">
          <label class="block text-xs font-medium text-fg-muted mb-1">Período</label>
          <Select value={periodoLetivoId ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setPeriodo(v ? Number(v) : null) }}>
            <option value="">Todos</option>
            {(periodos.data?.periodos ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
          </Select>
        </div>
        <div class="w-64">
          <label class="block text-xs font-medium text-fg-muted mb-1">Turma</label>
          <Select value={turmaId ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setTurma(v ? Number(v) : null) }}>
            <option value="">Todas</option>
            {(turmas.data?.turmas ?? []).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </Select>
        </div>
      </Card>

      {!d ? <Skeleton class="h-40 w-full mt-3" /> : (
        <div class="mt-3 space-y-3">
          <div class="grid gap-3 sm:grid-cols-3">
            <Card class="space-y-1"><div class="flex items-center gap-2 text-xs text-fg-muted"><Database size={14} /> Matrículas a informar</div><div class="text-2xl font-semibold text-fg">{d.total}</div></Card>
            <Card class="space-y-1"><div class="flex items-center gap-2 text-xs text-fg-muted"><AlertTriangle size={14} /> Sem CPF</div><div class={`text-2xl font-semibold ${d.semCpf > 0 ? 'text-danger' : 'text-fg'}`}>{d.semCpf}</div><div class="text-[11px] text-fg-subtle">corrija antes de enviar</div></Card>
            <Card class="space-y-1"><div class="text-xs text-fg-muted">Situações distintas</div><div class="text-2xl font-semibold text-fg">{Object.keys(d.porSituacao).length}</div></Card>
          </div>

          <Card class="space-y-2">
            <h3 class="text-xs font-semibold uppercase text-fg-muted">Por situação SISTEC</h3>
            {Object.keys(d.porSituacao).length === 0 ? <p class="text-xs text-fg-muted">Nenhuma matrícula no filtro.</p> : (
              <div class="flex flex-wrap gap-2">
                {Object.entries(d.porSituacao).map(([s, n]) => <Badge key={s} tone="neutral">{SISTEC_LABEL[s] ?? s}: <b class="ml-1">{n}</b></Badge>)}
              </div>
            )}
          </Card>

          {d.amostra.length > 0 && (
            <Card class="p-0 overflow-x-auto">
              <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted">Amostra (primeiras {d.amostra.length})</div>
              <table class="w-full text-sm">
                <thead class="bg-surface text-xs text-fg-muted"><tr><th class="text-left p-2">Nome</th><th class="text-left p-2">CPF</th><th class="text-left p-2">Curso</th><th class="text-left p-2">Situação</th></tr></thead>
                <tbody class="divide-y divide-border">
                  {d.amostra.map((a, i) => (
                    <tr key={i}><td class="p-2">{a.nome}</td><td class="p-2 text-xs">{a.cpf || <span class="text-danger">— sem CPF</span>}</td><td class="p-2 text-xs text-fg-muted">{a.curso}</td><td class="p-2 text-xs">{SISTEC_LABEL[a.situacao] ?? a.situacao}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <p class="text-[11px] text-fg-subtle">O CSV traz CPF, nome, nascimento, RA, curso, carga horária, situação e datas. O leiaute oficial do SISTEC/Censo pode ser mapeado a partir destes campos conforme a versão vigente do MEC.</p>
        </div>
      )}
    </Page>
  )
}
