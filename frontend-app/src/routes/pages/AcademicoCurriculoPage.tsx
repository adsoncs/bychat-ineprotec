import { useState } from 'preact/hooks'
import { Network, GraduationCap, CheckCircle2, XCircle, Plus, Trash2, BookCheck } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { useMatriculas } from '@/hooks/useAcaMatricula'
import { useAcaRefs } from '@/hooks/useAcaCatalogo'
import {
  useGrade, useComponentes, useEquivalencias, useAproveitamentos, useDependencias, useCurriculoMut,
  GRADE_STATUS, AP_STATUS_LABEL, type GradeComponente,
} from '@/hooks/useAcaCurriculo'

type Tab = 'grade' | 'aproveitamentos' | 'equivalencias'

export function AcademicoCurriculoPage() {
  const [tab, setTab] = useState<Tab>('grade')
  return (
    <Page title="Currículo" description="Grade do aluno, aproveitamento de estudos, dependências e equivalências entre disciplinas.">
      <div class="flex gap-1 border-b border-border">
        {([['grade', 'Grade do aluno'], ['aproveitamentos', 'Aproveitamentos'], ['equivalencias', 'Equivalências']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'grade' && <GradeTab />}
      {tab === 'aproveitamentos' && <AproveitamentosTab />}
      {tab === 'equivalencias' && <EquivalenciasTab />}
    </Page>
  )
}

function statusBadge(status: string) {
  const s = GRADE_STATUS[status] ?? { label: status, tone: 'neutral' as const }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

function GradeTab() {
  const matriculas = useMatriculas('')
  const [matId, setMatId] = useState<number | null>(null)
  const grade = useGrade(matId)
  const deps = useDependencias(matId)
  const mut = useCurriculoMut()
  const [aproveitar, setAproveitar] = useState<GradeComponente | null>(null)

  const rows = matriculas.data?.matriculas ?? []
  const g = grade.data

  return (
    <div class="space-y-3 mt-3">
      <Select label="Aluno / matrícula" value={matId ?? ''} onChange={(e: any) => setMatId(e.currentTarget.value ? Number(e.currentTarget.value) : null)}>
        <option value="">Selecione…</option>
        {rows.map((m) => <option key={m.id} value={m.id}>RA {m.aluno.ra} · {m.aluno.lead.nome} — {m.turma.nome}</option>)}
      </Select>

      {matId === null ? <EmptyState icon={<GraduationCap size={26} />} title="Selecione um aluno" description="Escolha uma matrícula para ver a grade curricular." /> :
        grade.isLoading ? <Skeleton class="h-48 w-full" /> :
        g?.semMatriz ? <Card><p class="text-sm text-fg-muted">A turma desta matrícula não tem matriz curricular vinculada.</p></Card> : g && (
          <>
            <div class="flex flex-wrap gap-2">
              {Object.entries(g.resumo).filter(([, n]) => n > 0).map(([s, n]) => <span key={s} class="text-xs">{statusBadge(s)} <b class="ml-0.5">{n}</b></span>)}
            </div>
            <Card class="p-0 overflow-hidden">
              <table class="w-full text-sm">
                <thead class="bg-surface-2 text-xs text-fg-muted"><tr><th class="text-left p-2 w-10">Fase</th><th class="text-left p-2">Disciplina</th><th class="text-right p-2">CH</th><th class="text-center p-2">Situação</th><th class="p-2 w-28"></th></tr></thead>
                <tbody class="divide-y divide-border">
                  {g.componentes.map((c) => (
                    <tr key={c.componenteId} class="hover:bg-surface-2">
                      <td class="p-2 text-fg-muted">{c.fase}º</td>
                      <td class="p-2"><span class="text-fg">{c.disciplina}</span>{c.codigo && <span class="text-xs text-fg-subtle ml-1">{c.codigo}</span>}{!c.obrigatoria && <span class="text-xs text-fg-subtle ml-1">(optativa)</span>}</td>
                      <td class="p-2 text-right text-fg-muted">{c.cargaHoraria}h</td>
                      <td class="p-2 text-center">{statusBadge(c.status)}{c.media != null && <span class="block text-[11px] text-fg-subtle">média {c.media}</span>}</td>
                      <td class="p-2 text-right">
                        {['PENDENTE', 'CURSANDO'].includes(c.status) && (
                          <div class="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" onClick={() => setAproveitar(c)}>Aproveitar</Button>
                            <Button size="sm" variant="ghost" title="Lançar dependência" onClick={() => mut.criarDependencia.mutate({ matriculaId: matId, componenteId: c.componenteId, tipo: 'DEPENDENCIA' })}>DP</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {(deps.data?.dependencias ?? []).length > 0 && (
              <Card class="space-y-1">
                <div class="text-xs font-medium text-fg-muted">Dependências / adaptações</div>
                {(deps.data?.dependencias ?? []).map((d) => (
                  <div key={d.id} class="flex items-center gap-2 text-sm">
                    <Badge tone="warning">{d.tipo === 'ADAPTACAO' ? 'Adaptação' : 'DP'}</Badge>
                    <span class="flex-1">{d.componenteNome}</span>
                    <Select value={d.situacao} onChange={(e: any) => mut.atualizarDependencia.mutate({ id: d.id, situacao: e.currentTarget.value })} class="!w-36 !py-1 text-xs">
                      <option value="EM_CURSO">Em curso</option><option value="CUMPRIDA">Cumprida</option><option value="PENDENTE">Pendente</option>
                    </Select>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}

      {aproveitar && matId !== null && <AproveitamentoModal matriculaId={matId} comp={aproveitar} onClose={() => setAproveitar(null)} />}
    </div>
  )
}

function AproveitamentoModal({ matriculaId, comp, onClose }: { matriculaId: number; comp: GradeComponente; onClose: () => void }) {
  const mut = useCurriculoMut()
  const [origem, setOrigem] = useState('EXTERNO')
  const [instituicao, setInstituicao] = useState('')
  const [disciplinaOrigem, setDisciplinaOrigem] = useState('')
  const [ch, setCh] = useState(String(comp.cargaHoraria || 0))
  const [nota, setNota] = useState('')

  const save = () => mut.criarAproveitamento.mutate(
    { matriculaId, componenteId: comp.componenteId, origem, instituicaoOrigem: instituicao || null, disciplinaOrigem: disciplinaOrigem || null, cargaHorariaAproveitada: Number(ch) || 0, nota: nota || null },
    { onSuccess: onClose },
  )
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Solicitar aproveitamento" description={comp.disciplina}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={mut.criarAproveitamento.isPending} onClick={save}>Solicitar</Button></>}>
      <div class="space-y-3">
        <Select label="Origem" value={origem} onChange={(e: any) => setOrigem(e.currentTarget.value)}>
          <option value="EXTERNO">Externo (outra instituição)</option><option value="INTERNO">Interno (mesma instituição)</option><option value="SUFICIENCIA">Prova de suficiência</option>
        </Select>
        <Input label="Instituição de origem" value={instituicao} onInput={(e: any) => setInstituicao(e.currentTarget.value)} />
        <div class="grid grid-cols-2 gap-3">
          <Input label="Disciplina de origem" value={disciplinaOrigem} onInput={(e: any) => setDisciplinaOrigem(e.currentTarget.value)} />
          <Input label="CH aproveitada" type="number" value={ch} onInput={(e: any) => setCh(e.currentTarget.value)} />
        </div>
        <Input label="Nota (opcional)" type="number" step="0.1" value={nota} onInput={(e: any) => setNota(e.currentTarget.value)} />
        <p class="text-xs text-fg-muted">A solicitação fica como “Solicitado”. Ao deferir (aba Aproveitamentos), o componente passa a contar no histórico.</p>
      </div>
    </Modal>
  )
}

function AproveitamentosTab() {
  const [status, setStatus] = useState('')
  const data = useAproveitamentos(status)
  const mut = useCurriculoMut()
  const itens = data.data?.aproveitamentos ?? []
  const counts = data.data?.counts ?? {}

  return (
    <div class="space-y-3 mt-3">
      <div class="flex flex-wrap gap-1">
        <button class={`text-xs px-2 py-1 rounded border ${status === '' ? 'bg-surface-2 border-border' : 'border-transparent text-fg-muted'}`} onClick={() => setStatus('')}>Todos</button>
        {['SOLICITADO', 'DEFERIDO', 'INDEFERIDO'].map((s) => (
          <button key={s} class={`text-xs px-2 py-1 rounded border ${status === s ? 'bg-surface-2 border-border' : 'border-transparent text-fg-muted'}`} onClick={() => setStatus(s)}>{AP_STATUS_LABEL[s]} ({counts[s] ?? 0})</button>
        ))}
      </div>
      {data.isLoading ? <Skeleton class="h-40 w-full" /> : itens.length === 0 ? <EmptyState icon={<BookCheck size={26} />} title="Sem aproveitamentos" description="As solicitações de aproveitamento aparecem aqui." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {itens.map((a) => (
            <div key={a.id} class="px-4 py-3 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0">
                <span class="block truncate text-fg">{a.alunoNome}{a.ra ? ` · RA ${a.ra}` : ''}</span>
                <span class="block truncate text-xs text-fg-muted">{a.componenteNome} · {a.cargaHorariaAproveitada}h · {a.origem}{a.instituicaoOrigem ? ` · ${a.instituicaoOrigem}` : ''}{a.nota != null ? ` · nota ${a.nota}` : ''}</span>
              </span>
              <Badge tone={a.status === 'DEFERIDO' ? 'success' : a.status === 'INDEFERIDO' ? 'danger' : 'warning'}>{AP_STATUS_LABEL[a.status]}</Badge>
              {a.status === 'SOLICITADO' && (
                <div class="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={mut.decidirAproveitamento.isPending} onClick={() => mut.decidirAproveitamento.mutate({ id: a.id, status: 'INDEFERIDO' })}><XCircle size={14} /></Button>
                  <Button size="sm" variant="primary" disabled={mut.decidirAproveitamento.isPending} onClick={() => mut.decidirAproveitamento.mutate({ id: a.id, status: 'DEFERIDO' })}><CheckCircle2 size={14} /> Deferir</Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function EquivalenciasTab() {
  const refs = useAcaRefs()
  const [matrizId, setMatrizId] = useState<number | null>(null)
  const comps = useComponentes(matrizId)
  const eqs = useEquivalencias()
  const mut = useCurriculoMut()
  const [cA, setCA] = useState('')
  const [cB, setCB] = useState('')
  const matrizes = refs.data?.matrizes ?? []
  const componentes = comps.data?.componentes ?? []

  const add = () => {
    if (!cA || !cB || cA === cB) return
    mut.criarEquivalencia.mutate({ componenteId: Number(cA), componenteEquivalenteId: Number(cB) }, { onSuccess: () => { setCA(''); setCB('') } })
  }

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><Network size={16} /> Nova equivalência</div>
        <Select label="Matriz" value={matrizId ?? ''} onChange={(e: any) => { setMatrizId(e.currentTarget.value ? Number(e.currentTarget.value) : null); setCA(''); setCB('') }}>
          <option value="">Selecione a matriz…</option>
          {matrizes.map((m) => <option key={m.id} value={m.id}>Matriz #{m.id} · v{m.versao}</option>)}
        </Select>
        {matrizId !== null && (
          <div class="grid sm:grid-cols-[1fr_auto_1fr_auto] gap-2 items-end">
            <Select label="Componente" value={cA} onChange={(e: any) => setCA(e.currentTarget.value)}>
              <option value="">—</option>{componentes.map((c) => <option key={c.id} value={c.id}>{c.fase}º · {c.nome}</option>)}
            </Select>
            <span class="text-fg-muted pb-2">≡</span>
            <Select label="Equivale a" value={cB} onChange={(e: any) => setCB(e.currentTarget.value)}>
              <option value="">—</option>{componentes.map((c) => <option key={c.id} value={c.id}>{c.fase}º · {c.nome}</option>)}
            </Select>
            <Button variant="secondary" disabled={!cA || !cB || cA === cB || mut.criarEquivalencia.isPending} onClick={add}><Plus size={14} /> Adicionar</Button>
          </div>
        )}
      </Card>

      <Card class="p-0 overflow-hidden">
        {eqs.isLoading ? <Skeleton class="h-24 w-full" /> : (eqs.data?.equivalencias ?? []).length === 0 ? <p class="text-sm text-fg-muted p-6 text-center">Nenhuma equivalência cadastrada.</p> : (
          <div class="divide-y divide-border">
            {(eqs.data?.equivalencias ?? []).map((e) => (
              <div key={e.id} class="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span class="flex-1">{e.componenteNome} <span class="text-fg-muted">≡</span> {e.equivalenteNome}</span>
                <Button size="sm" variant="ghost" onClick={() => mut.excluirEquivalencia.mutate(e.id)}><Trash2 size={14} /></Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
