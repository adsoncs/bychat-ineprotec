import { useState } from 'preact/hooks'
import { Briefcase, Search, Plus, Trash2, CheckCircle2, XCircle, Link as LinkIcon } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAlunos } from '@/hooks/useAcaAluno'
import { useEstagioPainel, useEstagioMut, type ResumoHoras } from '@/hooks/useAcaEstagio'

const EST_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  EM_ANDAMENTO: { label: 'Em andamento', tone: 'warning' }, CONCLUIDO: { label: 'Concluído', tone: 'success' }, CANCELADO: { label: 'Cancelado', tone: 'danger' },
}

export function AcademicoEstagioPage() {
  const [q, setQ] = useState('')
  const [alunoId, setAlunoId] = useState<number | null>(null)
  const alunos = useAlunos(q)
  return (
    <Page title="Estágio & Atividades" description="Estágio supervisionado e atividades complementares — horas por aluno.">
      <div class="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card class="space-y-2 self-start">
          <div class="relative"><Search size={14} class="absolute left-2 top-2.5 text-fg-subtle" /><Input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Buscar aluno…" class="pl-7" /></div>
          <div class="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {alunos.isLoading ? <Skeleton class="h-24 w-full" /> : (alunos.data?.alunos ?? []).map((a) => (
              <button key={a.id} class={`w-full text-left px-2 py-2 text-sm hover:bg-surface-2 ${alunoId === a.id ? 'bg-surface-2 font-medium' : ''}`} onClick={() => setAlunoId(a.id)}>
                <div class="text-fg truncate">{a.lead.nome}</div><div class="text-[11px] text-fg-subtle">RA {a.ra || '—'}</div>
              </button>
            ))}
          </div>
        </Card>
        {alunoId ? <Painel alunoId={alunoId} /> : <Card class="flex items-center justify-center text-sm text-fg-muted min-h-[200px]">Selecione um aluno.</Card>}
      </div>
    </Page>
  )
}

function Barra({ r, label }: { r: { horas: number; meta: number; cumprido: boolean }; label: string }) {
  const pct = r.meta > 0 ? Math.min(100, Math.round((r.horas / r.meta) * 100)) : 0
  return (
    <div>
      <div class="flex justify-between text-xs mb-0.5"><span class="text-fg-muted">{label}</span><span class={r.cumprido ? 'text-success font-medium' : 'text-fg'}>{r.horas}/{r.meta}h</span></div>
      <div class="h-2 rounded bg-surface-2 overflow-hidden"><div class={`h-full ${r.cumprido ? 'bg-success' : 'bg-accent'}`} style={`width:${pct}%`} /></div>
    </div>
  )
}

function Painel({ alunoId }: { alunoId: number }) {
  const data = useEstagioPainel(alunoId)
  const mut = useEstagioMut(alunoId)
  const [emp, setEmp] = useState(''); const [chE, setChE] = useState('')
  const [atTit, setAtTit] = useState(''); const [atH, setAtH] = useState('')
  if (data.isLoading || !data.data) return <Skeleton class="h-64 w-full" />
  const { estagios, atividades, resumo } = data.data as { estagios: any[]; atividades: any[]; resumo: ResumoHoras }

  return (
    <div class="space-y-4">
      <Card class="grid sm:grid-cols-2 gap-4">
        <Barra r={resumo.estagio} label="Estágio supervisionado" />
        <Barra r={resumo.atividades} label="Atividades complementares" />
      </Card>

      <Card class="p-0 overflow-hidden">
        <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted flex items-center gap-1"><Briefcase size={13} /> Estágios</div>
        {estagios.length === 0 ? <p class="text-xs text-fg-muted p-3">Nenhum estágio.</p> : estagios.map((e) => (
          <div key={e.id} class="px-4 py-2 flex items-center gap-2 border-t border-border text-sm">
            <span class="flex-1">{e.empresa}<span class="block text-[11px] text-fg-subtle">{e.cargaHorariaH}h{e.supervisor ? ` · ${e.supervisor}` : ''}</span></span>
            <Select value={e.status} onChange={(ev) => mut.upEstagio.mutate({ id: e.id, status: (ev.target as HTMLSelectElement).value })}>
              {Object.entries(EST_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <button class="text-fg-subtle hover:text-danger" onClick={() => mut.delEstagio.mutate(e.id)}><Trash2 size={13} /></button>
          </div>
        ))}
        <div class="px-4 py-2 border-t border-border grid sm:grid-cols-[1fr_90px_auto] gap-2">
          <Input value={emp} onInput={(e) => setEmp((e.target as HTMLInputElement).value)} placeholder="Empresa" />
          <Input type="number" value={chE} onInput={(e) => setChE((e.target as HTMLInputElement).value)} placeholder="Horas" />
          <Button variant="secondary" size="sm" disabled={!emp.trim() || mut.addEstagio.isPending} onClick={() => mut.addEstagio.mutate({ empresa: emp.trim(), cargaHorariaH: Number(chE) || 0 }, { onSuccess: () => { setEmp(''); setChE('') } })}><Plus size={14} /> Estágio</Button>
        </div>
      </Card>

      <Card class="p-0 overflow-hidden">
        <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted">Atividades complementares {resumo.atividades.pendentes > 0 && <Badge tone="warning">{resumo.atividades.pendentes} pendente(s)</Badge>}</div>
        {atividades.length === 0 ? <p class="text-xs text-fg-muted p-3">Nenhuma atividade.</p> : atividades.map((a) => (
          <div key={a.id} class="px-4 py-2 flex items-center gap-2 border-t border-border text-sm">
            <span class="flex-1">{a.titulo}<span class="block text-[11px] text-fg-subtle">{a.horas}h{a.comprovanteUrl ? <> · <a href={a.comprovanteUrl} target="_blank" class="text-accent"><LinkIcon size={10} class="inline" /> comprovante</a></> : ''}</span></span>
            {a.status === 'PENDENTE' ? <>
              <button class="text-fg-muted hover:text-success px-1" title="Aprovar" onClick={() => mut.upAtividade.mutate({ id: a.id, status: 'APROVADA' })}><CheckCircle2 size={16} /></button>
              <button class="text-fg-muted hover:text-danger px-1" title="Rejeitar" onClick={() => mut.upAtividade.mutate({ id: a.id, status: 'REJEITADA' })}><XCircle size={16} /></button>
            </> : <Badge tone={a.status === 'APROVADA' ? 'success' : 'danger'}>{a.status === 'APROVADA' ? 'Aprovada' : 'Rejeitada'}</Badge>}
            <button class="text-fg-subtle hover:text-danger" onClick={() => mut.delAtividade.mutate(a.id)}><Trash2 size={13} /></button>
          </div>
        ))}
        <div class="px-4 py-2 border-t border-border grid sm:grid-cols-[1fr_90px_auto] gap-2">
          <Input value={atTit} onInput={(e) => setAtTit((e.target as HTMLInputElement).value)} placeholder="Atividade" />
          <Input type="number" value={atH} onInput={(e) => setAtH((e.target as HTMLInputElement).value)} placeholder="Horas" />
          <Button variant="secondary" size="sm" disabled={!atTit.trim() || mut.addAtividade.isPending} onClick={() => mut.addAtividade.mutate({ titulo: atTit.trim(), horas: Number(atH) || 0, status: 'APROVADA' }, { onSuccess: () => { setAtTit(''); setAtH('') } })}><Plus size={14} /> Atividade</Button>
        </div>
      </Card>
    </div>
  )
}
