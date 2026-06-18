import { useState } from 'preact/hooks'
import { Layers, Plus, Trash2, BookOpen, CalendarRange, GraduationCap, Users } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import {
  useAcaRefs, usePeriodos, useDisciplinas, useMatrizes, useTurmas, useCatalogoMut,
  type Matriz, type Ref, type Turma,
} from '@/hooks/useAcaCatalogo'
import { useInscricoes, useInscricaoMut } from '@/hooks/useAcaInscricao'
import { useMatriculaMut } from '@/hooks/useAcaMatricula'
import { useAlunos } from '@/hooks/useAcaAluno'
import { ArrowLeft, UserPlus, X, CheckCircle2 } from 'lucide-preact'

const TABS = [
  { key: 'periodos', label: 'Períodos', icon: CalendarRange },
  { key: 'disciplinas', label: 'Disciplinas', icon: BookOpen },
  { key: 'matriz', label: 'Matriz Curricular', icon: Layers },
  { key: 'turmas', label: 'Turmas', icon: Users },
] as const

export function AcademicoEstruturaPage() {
  const [tab, setTab] = useState<typeof TABS[number]['key']>('periodos')
  return (
    <Page title="Estrutura Acadêmica" description="Períodos, disciplinas, matriz curricular e turmas.">
      <div class="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.key} class={`text-sm px-3 py-2 -mb-px border-b-2 inline-flex items-center gap-1.5 ${tab === t.key ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(t.key)}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'periodos' && <PeriodosTab />}
      {tab === 'disciplinas' && <DisciplinasTab />}
      {tab === 'matriz' && <MatrizTab />}
      {tab === 'turmas' && <TurmasTab />}
    </Page>
  )
}

function CourseSelect({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const refs = useAcaRefs()
  return (
    <Select value={value ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; onChange(v ? Number(v) : null) }}>
      <option value="">— Curso —</option>
      {(refs.data?.courses ?? []).map((c: Ref) => <option key={c.id} value={c.id}>{c.nome}</option>)}
    </Select>
  )
}

function PeriodosTab() {
  const list = usePeriodos()
  const mut = useCatalogoMut()
  const [codigo, setCodigo] = useState(''); const [desc, setDesc] = useState(''); const [ano, setAno] = useState('')
  function add() { if (!codigo.trim() || !desc.trim()) return; mut.createPeriodo.mutate({ codigo: codigo.trim(), descricao: desc.trim(), anoLetivo: ano ? Number(ano) : undefined }, { onSuccess: () => { setCodigo(''); setDesc(''); setAno('') } }) }
  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <h3 class="text-xs font-semibold uppercase text-fg-muted">Novo período</h3>
        <div class="grid sm:grid-cols-[120px_1fr_100px_auto] gap-2 items-end">
          <Input label="Código" value={codigo} onInput={(e) => setCodigo((e.target as HTMLInputElement).value)} placeholder="2026/1" />
          <Input label="Descrição" value={desc} onInput={(e) => setDesc((e.target as HTMLInputElement).value)} placeholder="Período Letivo 2026/1" />
          <Input label="Ano" type="number" value={ano} onInput={(e) => setAno((e.target as HTMLInputElement).value)} />
          <Button variant="primary" size="sm" disabled={mut.createPeriodo.isPending} onClick={add}><Plus size={14} /> Criar</Button>
        </div>
        {mut.createPeriodo.isError && <p class="text-xs text-danger">{(mut.createPeriodo.error as any)?.message}</p>}
      </Card>
      <Card class="divide-y divide-border p-0 overflow-hidden">
        {(list.data?.periodos ?? []).map((p) => (
          <div key={p.id} class="px-4 py-2.5 flex items-center gap-3">
            <Badge tone="info">{p.codigo}</Badge>
            <span class="flex-1 text-sm text-fg">{p.descricao}</span>
            <span class="text-xs text-fg-muted">{p._count?.turmas ?? 0} turma(s)</span>
            <button class="text-fg-muted hover:text-danger" onClick={() => mut.delPeriodo.mutate(p.id)}><Trash2 size={14} /></button>
          </div>
        ))}
        {(list.data?.periodos?.length ?? 0) === 0 && <p class="text-xs text-fg-muted p-4">Nenhum período.</p>}
      </Card>
    </div>
  )
}

function DisciplinasTab() {
  const [courseId, setCourseId] = useState<number | null>(null)
  const list = useDisciplinas(courseId ?? undefined)
  const mut = useCatalogoMut()
  const [nome, setNome] = useState(''); const [ch, setCh] = useState('')
  function add() { if (!courseId || !nome.trim()) return; mut.createDisciplina.mutate({ courseId, nome: nome.trim(), cargaHoraria: Number(ch) || 0 }, { onSuccess: () => { setNome(''); setCh('') } }) }
  const total = (list.data?.disciplinas ?? []).reduce((s, d) => s + d.cargaHoraria, 0)
  return (
    <div class="space-y-3 mt-3">
      <div class="flex items-center gap-2"><span class="text-xs text-fg-muted">Curso:</span><div class="w-72"><CourseSelect value={courseId} onChange={setCourseId} /></div></div>
      {courseId && (
        <>
          <Card class="space-y-2">
            <h3 class="text-xs font-semibold uppercase text-fg-muted">Nova disciplina</h3>
            <div class="grid sm:grid-cols-[1fr_120px_auto] gap-2 items-end">
              <Input label="Nome" value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} placeholder="Topografia I" />
              <Input label="Carga (h)" type="number" value={ch} onInput={(e) => setCh((e.target as HTMLInputElement).value)} />
              <Button variant="primary" size="sm" disabled={mut.createDisciplina.isPending} onClick={add}><Plus size={14} /> Criar</Button>
            </div>
          </Card>
          <Card class="divide-y divide-border p-0 overflow-hidden">
            <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted">{list.data?.disciplinas?.length ?? 0} disciplina(s) · {total}h</div>
            {(list.data?.disciplinas ?? []).map((d) => (
              <div key={d.id} class="px-4 py-2.5 flex items-center gap-3">
                <span class="flex-1 text-sm text-fg">{d.nome}</span>
                <span class="text-xs text-fg-muted">{d.cargaHoraria}h</span>
                <button class="text-fg-muted hover:text-danger" onClick={() => mut.delDisciplina.mutate(d.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}

function MatrizTab() {
  const [courseId, setCourseId] = useState<number | null>(null)
  const matrizes = useMatrizes(courseId ?? undefined)
  const discs = useDisciplinas(courseId ?? undefined)
  const mut = useCatalogoMut()
  const [versao, setVersao] = useState('')
  return (
    <div class="space-y-3 mt-3">
      <div class="flex items-center gap-2"><span class="text-xs text-fg-muted">Curso:</span><div class="w-72"><CourseSelect value={courseId} onChange={setCourseId} /></div>
        {courseId && (
          <div class="flex items-center gap-1 ml-auto">
            <Input value={versao} onInput={(e) => setVersao((e.target as HTMLInputElement).value)} placeholder="versão (2026)" />
            <Button variant="secondary" size="sm" disabled={!versao.trim()} onClick={() => mut.createMatriz.mutate({ courseId, versao: versao.trim() }, { onSuccess: () => setVersao('') })}><Plus size={14} /> Nova matriz</Button>
          </div>
        )}
      </div>
      {(matrizes.data?.matrizes ?? []).map((m) => (
        <MatrizCard key={m.id} matriz={m} disciplinas={discs.data?.disciplinas ?? []} mut={mut} />
      ))}
      {courseId && (matrizes.data?.matrizes?.length ?? 0) === 0 && <p class="text-xs text-fg-muted">Nenhuma matriz para este curso. Crie uma acima.</p>}
    </div>
  )
}

function MatrizCard({ matriz, disciplinas, mut }: { matriz: Matriz; disciplinas: any[]; mut: ReturnType<typeof useCatalogoMut> }) {
  const [discId, setDiscId] = useState(''); const [fase, setFase] = useState('1')
  const porFase: Record<number, typeof matriz.componentes> = {}
  for (const c of matriz.componentes) (porFase[c.fase] ??= []).push(c)
  const ch = matriz.componentes.reduce((s, c) => s + c.disciplina.cargaHoraria, 0)
  return (
    <Card class="space-y-2">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-fg">Matriz {matriz.versao}</h3>
        <span class="text-xs text-fg-muted">{matriz.componentes.length} componentes · {ch}h</span>
      </div>
      {Object.keys(porFase).sort((a, b) => +a - +b).map((f) => (
        <div key={f} class="space-y-1">
          <div class="text-xs font-medium text-fg-muted">Módulo {f}</div>
          {porFase[+f].map((c) => (
            <div key={c.id} class="flex items-center gap-2 text-sm pl-2">
              <span class="flex-1 text-fg">{c.disciplina.nome}</span>
              <span class="text-xs text-fg-subtle">{c.disciplina.cargaHoraria}h</span>
              <button class="text-fg-muted hover:text-danger" onClick={() => mut.delComponente.mutate({ matrizId: matriz.id, compId: c.id })}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      ))}
      <div class="flex items-end gap-1.5 border-t border-border pt-2">
        <div class="flex-1">
          <Select value={discId} onChange={(e) => setDiscId((e.target as HTMLSelectElement).value)}>
            <option value="">+ Adicionar disciplina…</option>
            {disciplinas.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </Select>
        </div>
        <div class="w-20"><Input label="Módulo" type="number" value={fase} onInput={(e) => setFase((e.target as HTMLInputElement).value)} /></div>
        <Button variant="secondary" size="sm" disabled={!discId} onClick={() => { mut.addComponente.mutate({ matrizId: matriz.id, disciplinaId: Number(discId), fase: Number(fase) || 1 }, { onSuccess: () => setDiscId('') }) }}>Add</Button>
      </div>
    </Card>
  )
}

function TurmasTab() {
  const list = useTurmas()
  const refs = useAcaRefs()
  const mut = useCatalogoMut()
  const [selected, setSelected] = useState<Turma | null>(null)
  const [nome, setNome] = useState(''); const [periodoId, setPeriodoId] = useState(''); const [offId, setOffId] = useState(''); const [matrizId, setMatrizId] = useState(''); const [turno, setTurno] = useState(''); const [cap, setCap] = useState('')
  function add() {
    if (!nome.trim() || !periodoId) return
    mut.createTurma.mutate({ nome: nome.trim(), periodoLetivoId: Number(periodoId), courseOfferingId: offId ? Number(offId) : undefined, matrizId: matrizId ? Number(matrizId) : undefined, turno: turno || undefined, capacidade: cap ? Number(cap) : undefined }, { onSuccess: () => { setNome(''); setCap('') } })
  }

  if (selected) return <InscricoesPanel turma={selected} onBack={() => setSelected(null)} />

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <h3 class="text-xs font-semibold uppercase text-fg-muted">Nova turma</h3>
        <Input label="Nome" value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} placeholder="Téc. Agrimensura — Noturno — 2026/1" />
        <div class="grid sm:grid-cols-5 gap-2">
          <Select value={periodoId} onChange={(e) => setPeriodoId((e.target as HTMLSelectElement).value)}><option value="">Período*</option>{(refs.data?.periodos ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}</Select>
          <Select value={offId} onChange={(e) => setOffId((e.target as HTMLSelectElement).value)}><option value="">Oferta</option>{(refs.data?.offerings ?? []).map((o) => <option key={o.id} value={o.id}>{o.nome}{o.complemento ? ` (${o.complemento})` : ''}</option>)}</Select>
          <Select value={matrizId} onChange={(e) => setMatrizId((e.target as HTMLSelectElement).value)}><option value="">Matriz</option>{(refs.data?.matrizes ?? []).map((m) => <option key={m.id} value={m.id}>v{m.versao}</option>)}</Select>
          <Select value={turno} onChange={(e) => setTurno((e.target as HTMLSelectElement).value)}><option value="">Turno</option>{['MATUTINO', 'VESPERTINO', 'NOTURNO', 'INTEGRAL', 'EAD'].map((t) => <option key={t} value={t}>{t}</option>)}</Select>
          <Input placeholder="Capacidade" type="number" value={cap} onInput={(e) => setCap((e.target as HTMLInputElement).value)} />
        </div>
        <div class="flex justify-end"><Button variant="primary" size="sm" disabled={!nome.trim() || !periodoId || mut.createTurma.isPending} onClick={add}><Plus size={14} /> Criar turma</Button></div>
      </Card>
      <Card class="divide-y divide-border p-0 overflow-hidden">
        {(list.data?.turmas ?? []).map((t) => (
          <div key={t.id} class="px-4 py-2.5 flex items-center gap-3 hover:bg-surface-2">
            <button class="flex-1 flex items-center gap-3 text-left" onClick={() => setSelected(t)}>
              <GraduationCap size={15} class="text-fg-muted shrink-0" />
              <span class="flex-1 text-sm text-fg">{t.nome}</span>
              <Badge tone="info">{t.periodoLetivo.codigo}</Badge>
              {t.turno && <span class="text-xs text-fg-muted">{t.turno}</span>}
              <span class="text-xs text-fg-muted">{t._count?.matriculas ?? 0}/{t.capacidade ?? '∞'}</span>
            </button>
            <label class="flex items-center gap-1 text-[11px] text-fg-muted shrink-0" title="Permite o aluno se (re)matricular pelo portal" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={!!t.matriculaAberta} onChange={(e) => mut.updateTurma.mutate({ id: t.id, matriculaAberta: (e.target as HTMLInputElement).checked })} /> matrícula aberta
            </label>
            <button class="text-fg-muted hover:text-danger" onClick={() => mut.delTurma.mutate(t.id)}><Trash2 size={14} /></button>
          </div>
        ))}
        {(list.data?.turmas?.length ?? 0) === 0 && <p class="text-xs text-fg-muted p-4">Nenhuma turma.</p>}
      </Card>
      <p class="text-[11px] text-fg-subtle">Clique numa turma para gerenciar inscrições (vagas e lista de espera).</p>
    </div>
  )
}

function InscricoesPanel({ turma, onBack }: { turma: Turma; onBack: () => void }) {
  const data = useInscricoes(turma.id)
  const mut = useInscricaoMut(turma.id)
  const [q, setQ] = useState('')
  const busca = useAlunos(q)
  const occ = data.data?.ocupacao
  const inscritos = (data.data?.inscricoes ?? []).filter((i) => i.status !== 'CANCELADO')
  const emVaga = inscritos.filter((i) => !i.listaEspera)
  const espera = inscritos.filter((i) => i.listaEspera)
  const jaInscritos = new Set(inscritos.map((i) => i.aluno.id))

  return (
    <div class="space-y-3 mt-3">
      <button class="text-xs text-accent inline-flex items-center gap-1" onClick={onBack}><ArrowLeft size={13} /> Voltar às turmas</button>
      <Card class="space-y-1">
        <h3 class="text-sm font-semibold text-fg">{turma.nome}</h3>
        {occ && (
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={occ.lotada ? 'danger' : 'success'}>{occ.inscritos}{occ.capacidade != null ? `/${occ.capacidade}` : ''} em vaga</Badge>
            {occ.emEspera > 0 && <Badge tone="warning">{occ.emEspera} em espera</Badge>}
            {occ.vagasLivres != null && <span class="text-fg-muted">{occ.vagasLivres} vaga(s) livre(s)</span>}
          </div>
        )}
      </Card>

      <Card class="space-y-2">
        <h4 class="text-xs font-semibold uppercase text-fg-muted inline-flex items-center gap-1"><UserPlus size={12} /> Inscrever aluno</h4>
        <Input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Buscar aluno por nome, RA ou CPF…" />
        {q.trim().length >= 1 && (
          <div class="max-h-44 overflow-auto divide-y divide-border rounded-md border border-border">
            {(busca.data?.alunos ?? []).filter((a) => !jaInscritos.has(a.id)).length === 0 ? (
              <p class="text-xs text-fg-muted p-2">Nenhum aluno disponível. (Promova um contato a aluno na tela Alunos.)</p>
            ) : (busca.data?.alunos ?? []).filter((a) => !jaInscritos.has(a.id)).map((a) => (
              <div key={a.id} class="flex items-center gap-2 px-2 py-1.5">
                <span class="flex-1 text-sm text-fg truncate">{a.lead.nome} <span class="text-xs text-fg-subtle">RA {a.ra}</span></span>
                <Button variant="secondary" size="sm" disabled={mut.inscrever.isPending} onClick={() => mut.inscrever.mutate(a.id, { onSuccess: () => setQ('') })}>
                  {occ?.lotada ? 'Lista de espera' : 'Inscrever'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card class="p-0 overflow-hidden">
        <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted">Inscritos ({emVaga.length})</div>
        {emVaga.length === 0 ? <p class="text-xs text-fg-muted p-4">Ninguém em vaga ainda.</p> : emVaga.map((i) => (
          <div key={i.id} class="px-4 py-2.5 flex items-center gap-3 border-t border-border">
            <span class="text-fg-muted text-xs font-mono w-24 shrink-0">RA {i.aluno.ra}</span>
            <span class="flex-1 text-sm text-fg truncate">{i.aluno.lead.nome}</span>
            <Badge tone={i.status === 'MATRICULADO' ? 'success' : 'info'}>{i.status}</Badge>
            {['INSCRITO', 'PRE_MATRICULA'].includes(i.status) && <EfetivarBtn matriculaId={i.id} />}
            <button class="text-fg-muted hover:text-danger" title="Cancelar inscrição" onClick={() => mut.cancelar.mutate(i.id)}><X size={14} /></button>
          </div>
        ))}
        {espera.length > 0 && (
          <>
            <div class="px-4 py-2 bg-warning/10 text-xs text-warning border-t border-border">Lista de espera ({espera.length})</div>
            {espera.map((i) => (
              <div key={i.id} class="px-4 py-2.5 flex items-center gap-3 border-t border-border">
                <span class="text-fg-muted text-xs font-mono w-24 shrink-0">RA {i.aluno.ra}</span>
                <span class="flex-1 text-sm text-fg truncate">{i.aluno.lead.nome}</span>
                <Button variant="ghost" size="sm" disabled={occ?.lotada || mut.promover.isPending} onClick={() => mut.promover.mutate(i.id)}>Promover</Button>
                <button class="text-fg-muted hover:text-danger" onClick={() => mut.cancelar.mutate(i.id)}><X size={14} /></button>
              </div>
            ))}
          </>
        )}
      </Card>
    </div>
  )
}

function EfetivarBtn({ matriculaId }: { matriculaId: number }) {
  const mut = useMatriculaMut(matriculaId)
  return (
    <Button variant="secondary" size="sm" disabled={mut.efetivar.isPending} onClick={() => mut.efetivar.mutate()} title="Efetivar matrícula">
      <CheckCircle2 size={13} /> {mut.efetivar.isPending ? '…' : 'Efetivar'}
    </Button>
  )
}
