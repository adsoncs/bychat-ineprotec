import { useState } from 'preact/hooks'
import { ScrollText, Plus, Trash2 } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useMatriculas } from '@/hooks/useAcaMatricula'
import { useTccs, useTccMut, TCC_STATUS } from '@/hooks/useAcaTcc'

const ORDER = ['REGISTRADO', 'EM_ANDAMENTO', 'ENTREGUE', 'APROVADO', 'REPROVADO']

export function AcademicoTccPage() {
  const [status, setStatus] = useState('')
  const data = useTccs(status)
  const matriculas = useMatriculas('')
  const mut = useTccMut()
  const [f, setF] = useState({ matriculaId: '', titulo: '', orientador: '' })

  const tccs = data.data?.tccs ?? []
  const counts = data.data?.counts ?? {}
  const add = () => { if (!f.matriculaId || !f.titulo) return; mut.criar.mutate({ matriculaId: Number(f.matriculaId), titulo: f.titulo, orientador: f.orientador || undefined }, { onSuccess: () => setF({ matriculaId: '', titulo: '', orientador: '' }) }) }

  return (
    <Page title="TCC" description="Registro e acompanhamento de Trabalhos de Conclusão de Curso.">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><ScrollText size={16} /> Registrar TCC</div>
        <div class="grid sm:grid-cols-[1.4fr_2fr_1.2fr_auto] gap-2">
          <Select value={f.matriculaId} onChange={(e: any) => setF({ ...f, matriculaId: e.currentTarget.value })}>
            <option value="">Aluno/matrícula…</option>
            {(matriculas.data?.matriculas ?? []).map((m) => <option key={m.id} value={m.id}>RA {m.aluno.ra} · {m.aluno.lead.nome}</option>)}
          </Select>
          <Input placeholder="Título do TCC" value={f.titulo} onInput={(e: any) => setF({ ...f, titulo: e.currentTarget.value })} />
          <Input placeholder="Orientador" value={f.orientador} onInput={(e: any) => setF({ ...f, orientador: e.currentTarget.value })} />
          <Button size="sm" variant="secondary" disabled={!f.matriculaId || !f.titulo || mut.criar.isPending} onClick={add}><Plus size={14} /></Button>
        </div>
      </Card>

      <div class="flex flex-wrap gap-1">
        <button class={`text-xs px-2 py-1 rounded border ${status === '' ? 'bg-surface-2 border-border' : 'border-transparent text-fg-muted'}`} onClick={() => setStatus('')}>Todos</button>
        {ORDER.filter((s) => counts[s]).map((s) => <button key={s} class={`text-xs px-2 py-1 rounded border ${status === s ? 'bg-surface-2 border-border' : 'border-transparent text-fg-muted'}`} onClick={() => setStatus(s)}>{TCC_STATUS[s].label} ({counts[s]})</button>)}
      </div>

      {data.isLoading ? <Skeleton class="h-32 w-full" /> : tccs.length === 0 ? <EmptyState icon={<ScrollText size={28} />} title="Nenhum TCC" description="Registre o primeiro TCC acima." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {tccs.map((t) => (
            <div key={t.id} class="px-4 py-3 text-sm flex items-center gap-3">
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{t.titulo}</span><span class="block text-xs text-fg-muted">{t.alunoNome}{t.ra ? ` · RA ${t.ra}` : ''}{t.orientador ? ` · orient. ${t.orientador}` : ''}{t.nota != null ? ` · nota ${t.nota}` : ''}</span></span>
              <Select value={t.status} onChange={(e: any) => mut.atualizar.mutate({ id: t.id, status: e.currentTarget.value })} class="!py-1 text-xs !w-36">{ORDER.map((s) => <option key={s} value={s}>{TCC_STATUS[s].label}</option>)}</Select>
              {(t.status === 'APROVADO' || t.status === 'REPROVADO') && <Input class="!w-20 !py-1 text-xs" type="number" step="0.1" placeholder="Nota" value={t.nota ?? ''} onInput={(e: any) => mut.atualizar.mutate({ id: t.id, nota: e.currentTarget.value })} />}
              <Badge tone={TCC_STATUS[t.status]?.tone ?? 'neutral'}>{TCC_STATUS[t.status]?.label ?? t.status}</Badge>
              <button class="text-fg-muted hover:text-danger" onClick={() => mut.excluir.mutate(t.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>
      )}
    </Page>
  )
}
