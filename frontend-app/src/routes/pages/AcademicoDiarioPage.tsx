import { useState } from 'preact/hooks'
import { BookMarked, Plus, ArrowLeft, Trash2, CheckSquare, Square, Save, Link as LinkIcon } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { ListaVerificacaoPanel } from '@/components/aca/ListaVerificacaoPanel'
import { useTurmas } from '@/hooks/useAcaCatalogo'
import { useTurmaDiarios, useDiario, useChamada, useDiarioMut, type FreqRow } from '@/hooks/useAcaDiario'
import { useNotas, useNotaMut, type LinhaNota } from '@/hooks/useAcaNota'
import { useFechamento, useFecharDiario, useAcaConfig, useAcaConfigMut, SITUACAO_LABEL, situacaoTone } from '@/hooks/useAcaFechamento'
import { gerarLinkPortal } from '@/hooks/useAcaSecretaria'
import { useHorarios, useHorarioMut, DIAS, type Conflito } from '@/hooks/useAcaHorario'
import { useUsers } from '@/hooks/useUsers'
import { CalendarClock } from 'lucide-preact'
import { ApiError } from '@/lib/apiClient'
import { usePlanoMateriais, usePlanoMut, type PlanoEnsino } from '@/hooks/useAcaMaterial'
import { Link2, ExternalLink } from 'lucide-preact'

export function AcademicoDiarioPage() {
  const turmas = useTurmas()
  const [turmaId, setTurmaId] = useState<number | null>(null)
  const [diarioId, setDiarioId] = useState<number | null>(null)

  if (diarioId !== null) return <DiarioView diarioId={diarioId} onBack={() => setDiarioId(null)} />

  return (
    <Page title="Diário de Classe" description="Registro de aulas e frequência por turma e disciplina.">
      <div class="flex items-center gap-2">
        <span class="text-xs text-fg-muted">Turma:</span>
        <div class="w-80">
          <Select value={turmaId ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setTurmaId(v ? Number(v) : null) }}>
            <option value="">— Selecione a turma —</option>
            {(turmas.data?.turmas ?? []).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </Select>
        </div>
      </div>
      {turmaId && <DisciplinasDaTurma turmaId={turmaId} onOpen={setDiarioId} />}
    </Page>
  )
}

function DisciplinasDaTurma({ turmaId, onOpen }: { turmaId: number; onOpen: (diarioId: number) => void }) {
  const data = useTurmaDiarios(turmaId)
  const mut = useDiarioMut()
  if (data.isLoading) return <Skeleton class="h-40 w-full mt-3" />
  const itens = data.data?.itens ?? []
  return (
    <div class="space-y-2 mt-3">
      <p class="text-xs text-fg-muted">{data.data?.matriculados ?? 0} aluno(s) matriculado(s). Abra o diário de cada disciplina.</p>
      <Card class="divide-y divide-border p-0 overflow-hidden">
        {itens.length === 0 ? <p class="text-xs text-fg-muted p-4">Turma sem matriz/disciplinas. Defina a matriz na Estrutura Acadêmica.</p> : itens.map((it) => (
          <div key={it.disciplinaId} class="px-4 py-2.5 flex items-center gap-3">
            <span class="text-xs text-fg-subtle w-16">Mód {it.fase}</span>
            <span class="flex-1 text-sm text-fg">{it.nome} <span class="text-xs text-fg-muted">({it.cargaHoraria}h)</span></span>
            {it.diario ? (
              <Button variant="secondary" size="sm" onClick={() => onOpen(it.diario!.id)}>Abrir diário</Button>
            ) : (
              <Button variant="ghost" size="sm" disabled={mut.abrir.isPending} onClick={() => mut.abrir.mutate({ turmaId, disciplinaId: it.disciplinaId }, { onSuccess: (r) => onOpen(r.diario.id) })}>Criar diário</Button>
            )}
          </div>
        ))}
      </Card>
      <HorariosPanel turmaId={turmaId} disciplinas={itens.map((i) => ({ id: i.disciplinaId, nome: i.nome }))} />
    </div>
  )
}

function PlanoPanel({ diarioId }: { diarioId: number }) {
  const data = usePlanoMateriais(diarioId)
  const mut = usePlanoMut(diarioId)
  const [p, setP] = useState<Partial<PlanoEnsino>>({})
  const [mTit, setMTit] = useState(''); const [mUrl, setMUrl] = useState('')
  useEffect(() => { if (data.data?.plano) setP(data.data.plano) }, [data.data?.plano])
  if (data.isLoading) return <Skeleton class="h-48 w-full mt-3" />
  const materiais = data.data?.materiais ?? []
  const campo = (k: keyof PlanoEnsino, label: string, rows = 3) => (
    <div><label class="block text-xs font-medium text-fg-muted mb-1">{label}</label><Textarea rows={rows} value={(p[k] as string) ?? ''} onInput={(e) => setP({ ...p, [k]: (e.target as HTMLTextAreaElement).value })} /></div>
  )
  function addMat() { if (!mTit.trim() || !mUrl.trim()) return; mut.addMaterial.mutate({ titulo: mTit.trim(), url: mUrl.trim() }, { onSuccess: () => { setMTit(''); setMUrl('') } }) }
  return (
    <div class="space-y-4 mt-3">
      <Card class="space-y-3">
        <h3 class="text-xs font-semibold uppercase text-fg-muted">Plano de ensino</h3>
        {campo('ementa', 'Ementa')}
        {campo('objetivos', 'Objetivos')}
        {campo('conteudo', 'Conteúdo programático', 4)}
        {campo('bibliografia', 'Bibliografia')}
        {campo('criterios', 'Critérios de avaliação', 2)}
        <div class="flex justify-end"><Button variant="primary" size="sm" disabled={mut.salvarPlano.isPending} onClick={() => mut.salvarPlano.mutate(p)}><Save size={14} /> Salvar plano</Button></div>
      </Card>
      <Card class="space-y-2">
        <h3 class="text-xs font-semibold uppercase text-fg-muted">Materiais</h3>
        {materiais.length === 0 ? <p class="text-xs text-fg-muted">Nenhum material publicado.</p> : (
          <div class="divide-y divide-border">
            {materiais.map((m) => (
              <div key={m.id} class="py-2 flex items-center gap-2 text-sm">
                <Link2 size={14} class="text-fg-muted" />
                <a href={m.url} target="_blank" rel="noopener" class="flex-1 text-accent hover:underline truncate">{m.titulo} <ExternalLink size={11} class="inline" /></a>
                <button class="text-fg-subtle hover:text-danger" onClick={() => mut.delMaterial.mutate(m.id)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
        <div class="grid sm:grid-cols-[1fr_1.4fr_auto] gap-2">
          <Input value={mTit} onInput={(e) => setMTit((e.target as HTMLInputElement).value)} placeholder="Título" />
          <Input value={mUrl} onInput={(e) => setMUrl((e.target as HTMLInputElement).value)} placeholder="Link (Drive, PDF, vídeo…)" />
          <Button variant="secondary" size="sm" disabled={!mTit.trim() || !mUrl.trim() || mut.addMaterial.isPending} onClick={addMat}><Plus size={14} /> Adicionar</Button>
        </div>
      </Card>
    </div>
  )
}

function HorariosPanel({ turmaId, disciplinas }: { turmaId: number; disciplinas: Array<{ id: number; nome: string }> }) {
  const data = useHorarios(turmaId)
  const mut = useHorarioMut(turmaId)
  const users = useUsers()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ disciplinaId: '', professorUserId: '', sala: '', diaSemana: '1', horaInicio: '19:00', horaFim: '20:40' })
  const [conflito, setConflito] = useState<Conflito[] | null>(null)
  const set = (p: any) => setF({ ...f, ...p })
  const horarios = data.data?.horarios ?? []

  function salvar(force = false) {
    if (!f.disciplinaId) return
    setConflito(null)
    mut.criar.mutate({ turmaId, disciplinaId: Number(f.disciplinaId), professorUserId: f.professorUserId ? Number(f.professorUserId) : null, sala: f.sala || null, diaSemana: Number(f.diaSemana), horaInicio: f.horaInicio, horaFim: f.horaFim, force }, {
      onSuccess: () => { setF({ ...f, sala: '' }); setConflito(null) },
      onError: (e) => { if (e instanceof ApiError && e.status === 409) setConflito((e.payload as any)?.conflitos ?? []) },
    })
  }

  const porDia = new Map<number, typeof horarios>()
  for (const h of horarios) { const a = porDia.get(h.diaSemana) ?? []; a.push(h); porDia.set(h.diaSemana, a) }

  return (
    <Card class="mt-2">
      <button class="w-full flex items-center gap-2 text-xs font-semibold uppercase text-fg-muted" onClick={() => setOpen((v) => !v)}>
        <CalendarClock size={14} /> Grade de horários {horarios.length > 0 && <span class="text-fg-subtle">({horarios.length})</span>}<span class="ml-auto text-accent">{open ? 'fechar' : 'abrir'}</span>
      </button>
      {open && <div class="mt-3 space-y-3">
        {horarios.length > 0 && (
          <table class="w-full text-sm">
            <tbody class="divide-y divide-border">
              {[...porDia.keys()].sort().map((d) => (
                <tr key={d}><td class="py-1.5 pr-2 text-fg-muted align-top w-20">{DIAS[d]}</td><td class="py-1.5">{porDia.get(d)!.map((h) => (
                  <div key={h.id} class="flex items-center gap-2 mb-0.5">
                    <span class="text-fg">{h.horaInicio}–{h.horaFim} <b>{h.disciplinaNome}</b>{h.sala ? ` · sala ${h.sala}` : ''}{h.professorNome ? ` · ${h.professorNome}` : ''}</span>
                    <button class="text-fg-subtle hover:text-danger" onClick={() => mut.excluir.mutate(h.id)}><Trash2 size={12} /></button>
                  </div>
                ))}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <div class="grid sm:grid-cols-[1fr_120px_90px_90px_90px_auto] gap-2 items-end">
          <Select value={f.disciplinaId} onChange={(e) => set({ disciplinaId: (e.target as HTMLSelectElement).value })}><option value="">Disciplina…</option>{disciplinas.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}</Select>
          <Select value={f.diaSemana} onChange={(e) => set({ diaSemana: (e.target as HTMLSelectElement).value })}>{[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{DIAS[d]}</option>)}</Select>
          <Input type="time" value={f.horaInicio} onInput={(e) => set({ horaInicio: (e.target as HTMLInputElement).value })} />
          <Input type="time" value={f.horaFim} onInput={(e) => set({ horaFim: (e.target as HTMLInputElement).value })} />
          <Input value={f.sala} onInput={(e) => set({ sala: (e.target as HTMLInputElement).value })} placeholder="Sala" />
          <Button variant="primary" size="sm" disabled={!f.disciplinaId || mut.criar.isPending} onClick={() => salvar(false)}><Plus size={14} /></Button>
        </div>
        <Select value={f.professorUserId} onChange={(e) => set({ professorUserId: (e.target as HTMLSelectElement).value })}><option value="">Professor (opcional)…</option>{(users.data?.users ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        {conflito && (
          <div class="rounded-lg bg-danger/10 border border-danger/30 p-2 text-xs text-danger">
            ⚠️ Conflito de {conflito[0]?.motivo} ({conflito.map((c) => c.horario).join(', ')}).
            <button class="ml-2 underline" onClick={() => salvar(true)}>Agendar mesmo assim</button>
          </div>
        )}
      </div>}
    </Card>
  )
}

function DiarioView({ diarioId, onBack }: { diarioId: number; onBack: () => void }) {
  const data = useDiario(diarioId)
  const mut = useDiarioMut()
  const [aulaId, setAulaId] = useState<number | null>(null)
  const [mode, setMode] = useState<'aulas' | 'notas' | 'competencia' | 'fechamento' | 'plano'>('aulas')
  const [data_, setData_] = useState(''); const [conteudo, setConteudo] = useState(''); const [qtd, setQtd] = useState('2')

  if (aulaId !== null) return <ChamadaView aulaId={aulaId} onBack={() => setAulaId(null)} />

  const d = data.data
  function addAula() {
    if (!data_ || !conteudo.trim()) return
    mut.addAula.mutate({ diarioId, data: data_, conteudo: conteudo.trim(), quantidadeAulas: Number(qtd) || 1 }, { onSuccess: () => { setData_(''); setConteudo('') } })
  }
  async function linkProfessor() {
    if (!d?.diario.professorUserId) return
    try { const url = await gerarLinkPortal('professor', d.diario.professorUserId); try { await navigator.clipboard.writeText(url) } catch {}; window.prompt('Link do portal do professor (copiado):', url) } catch {}
  }
  return (
    <Page title={d ? `${d.disciplina?.nome ?? 'Diário'}` : 'Diário'} actions={<div class="flex gap-2">{d?.diario.professorUserId ? <Button variant="ghost" size="sm" onClick={linkProfessor}><LinkIcon size={14} /> Link do professor</Button> : null}<Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button></div>}>
      <div class="flex gap-1 border-b border-border">
        <button class={`text-sm px-3 py-2 -mb-px border-b-2 ${mode === 'aulas' ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setMode('aulas')}>Aulas & Frequência</button>
        <button class={`text-sm px-3 py-2 -mb-px border-b-2 ${mode === 'notas' ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setMode('notas')}>Avaliações & Notas</button>
        <button class={`text-sm px-3 py-2 -mb-px border-b-2 ${mode === 'competencia' ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setMode('competencia')}>Competências</button>
        <button class={`text-sm px-3 py-2 -mb-px border-b-2 ${mode === 'fechamento' ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setMode('fechamento')}>Fechamento</button>
        <button class={`text-sm px-3 py-2 -mb-px border-b-2 ${mode === 'plano' ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setMode('plano')}>Plano & Materiais</button>
      </div>
      {mode === 'notas' && <NotasPanel diarioId={diarioId} />}
      {mode === 'competencia' && <ListaVerificacaoPanel diarioId={diarioId} />}
      {mode === 'fechamento' && <FechamentoPanel diarioId={diarioId} />}
      {mode === 'plano' && <PlanoPanel diarioId={diarioId} />}
      {mode === 'aulas' && (!d ? <Skeleton class="h-40 w-full mt-3" /> : (
        <div class="grid gap-4 lg:grid-cols-[1fr_320px] mt-3">
          <div class="space-y-4">
            <Card class="space-y-2">
              <h3 class="text-xs font-semibold uppercase text-fg-muted">Registrar aula</h3>
              <div class="grid sm:grid-cols-[150px_1fr_90px_auto] gap-2 items-end">
                <Input label="Data" type="date" value={data_} onInput={(e) => setData_((e.target as HTMLInputElement).value)} />
                <Input label="Conteúdo" value={conteudo} onInput={(e) => setConteudo((e.target as HTMLInputElement).value)} placeholder="Tema da aula" />
                <Input label="Aulas" type="number" value={qtd} onInput={(e) => setQtd((e.target as HTMLInputElement).value)} />
                <Button variant="primary" size="sm" disabled={!data_ || !conteudo.trim() || mut.addAula.isPending} onClick={addAula}><Plus size={14} /> Lançar</Button>
              </div>
            </Card>
            <Card class="p-0 overflow-hidden">
              <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted">Aulas ({d.diario.aulas.length}) · {d.totalAulas} aula(s)-relógio</div>
              {d.diario.aulas.length === 0 ? <p class="text-xs text-fg-muted p-4">Nenhuma aula registrada.</p> : d.diario.aulas.map((a) => (
                <div key={a.id} class="px-4 py-2.5 flex items-center gap-3 border-t border-border">
                  <span class="text-xs text-fg-muted w-20 shrink-0">{new Date(a.data).toLocaleDateString('pt-BR')}</span>
                  <span class="flex-1 text-sm text-fg truncate">{a.conteudo}</span>
                  <Badge tone="neutral">{a.quantidadeAulas} aula(s)</Badge>
                  <Button variant="secondary" size="sm" onClick={() => setAulaId(a.id)}>Chamada</Button>
                  <button class="text-fg-muted hover:text-danger" onClick={() => mut.delAula.mutate({ aulaId: a.id })}><Trash2 size={13} /></button>
                </div>
              ))}
            </Card>
          </div>
          <Card class="p-0 overflow-hidden">
            <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted">Frequência ({d.matriculados} aluno(s))</div>
            {d.resumo.length === 0 ? <p class="text-xs text-fg-muted p-4">Sem alunos matriculados.</p> : d.resumo.map((r) => (
              <div key={r.matriculaId} class="px-4 py-2 flex items-center gap-2 border-t border-border text-sm">
                <span class="flex-1 truncate text-fg">{r.nome}</span>
                {r.faltas > 0 && <span class="text-xs text-fg-muted">{r.faltas} falta(s)</span>}
                <Badge tone={r.presencaPct >= 75 ? 'success' : r.presencaPct >= 50 ? 'warning' : 'danger'}>{r.presencaPct}%</Badge>
              </div>
            ))}
          </Card>
        </div>
      ))}
    </Page>
  )
}

function NotasPanel({ diarioId }: { diarioId: number }) {
  const data = useNotas(diarioId)
  const mut = useNotaMut(diarioId)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [nome, setNome] = useState(''); const [peso, setPeso] = useState('1'); const [vmax, setVmax] = useState('10')

  const avals = data.data?.avaliacoes ?? []
  const linhas = data.data?.linhas ?? []
  const cellKey = (mId: number, aId: number) => `${mId}:${aId}`
  const cellVal = (l: LinhaNota, aId: number) => {
    const k = cellKey(l.matriculaId, aId)
    if (k in edits) return edits[k]
    const v = l.notas[aId]
    return v == null ? '' : String(v)
  }
  function addAval() {
    if (!nome.trim()) return
    mut.addAvaliacao.mutate({ nome: nome.trim(), peso: Number(peso) || 1, valorMaximo: Number(vmax) || 10 }, { onSuccess: () => { setNome(''); setPeso('1'); setVmax('10') } })
  }
  function salvar() {
    // agrupa edições por avaliação
    const porAval: Record<number, Array<{ matriculaId: number; valor: number | null }>> = {}
    for (const k of Object.keys(edits)) {
      const [mId, aId] = k.split(':').map(Number)
      const raw = edits[k].trim().replace(',', '.')
      ;(porAval[aId] ??= []).push({ matriculaId: mId, valor: raw === '' ? null : Number(raw) })
    }
    const ids = Object.keys(porAval).map(Number)
    Promise.all(ids.map((aId) => mut.lancarNotas.mutateAsync({ avaliacaoId: aId, registros: porAval[aId] }))).then(() => setEdits({}))
  }
  const dirty = Object.keys(edits).length > 0

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <h3 class="text-xs font-semibold uppercase text-fg-muted">Nova avaliação</h3>
        <div class="grid sm:grid-cols-[1fr_90px_110px_auto] gap-2 items-end">
          <Input label="Nome" value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} placeholder="Prova 1" />
          <Input label="Peso" type="number" value={peso} onInput={(e) => setPeso((e.target as HTMLInputElement).value)} />
          <Input label="Nota máx." type="number" value={vmax} onInput={(e) => setVmax((e.target as HTMLInputElement).value)} />
          <Button variant="primary" size="sm" disabled={!nome.trim() || mut.addAvaliacao.isPending} onClick={addAval}><Plus size={14} /> Criar</Button>
        </div>
      </Card>

      {avals.length === 0 ? (
        <p class="text-xs text-fg-muted">Crie avaliações para lançar notas.</p>
      ) : (
        <Card class="p-0 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-xs text-fg-muted">
              <tr>
                <th class="text-left p-2 font-medium sticky left-0 bg-surface-2">Aluno</th>
                {avals.map((a) => (
                  <th key={a.id} class="p-2 font-medium text-center min-w-[80px]">
                    <div class="inline-flex items-center gap-1">{a.nome}<button class="text-fg-subtle hover:text-danger" onClick={() => mut.delAvaliacao.mutate(a.id)}><Trash2 size={11} /></button></div>
                    <div class="text-[10px] text-fg-subtle">peso {a.peso} · máx {a.valorMaximo}</div>
                  </th>
                ))}
                <th class="p-2 font-medium text-center">Média</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {linhas.map((l) => (
                <tr key={l.matriculaId} class="hover:bg-surface-2">
                  <td class="p-2 text-fg truncate max-w-[12rem] sticky left-0 bg-surface">{l.nome}</td>
                  {avals.map((a) => (
                    <td key={a.id} class="p-1 text-center">
                      <input
                        class="w-14 rounded border border-border bg-surface px-1 py-0.5 text-center text-fg"
                        value={cellVal(l, a.id)}
                        onInput={(e) => setEdits((p) => ({ ...p, [cellKey(l.matriculaId, a.id)]: (e.target as HTMLInputElement).value }))}
                        placeholder="—"
                      />
                    </td>
                  ))}
                  <td class="p-2 text-center">
                    {l.media != null ? <Badge tone={l.media >= 6 ? 'success' : l.media >= 4 ? 'warning' : 'danger'}>{l.media}</Badge> : <span class="text-fg-subtle text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {dirty && (
        <div class="flex justify-end">
          <Button variant="primary" size="sm" disabled={mut.lancarNotas.isPending} onClick={salvar}><Save size={14} /> Salvar notas</Button>
        </div>
      )}
    </div>
  )
}

function FechamentoPanel({ diarioId }: { diarioId: number }) {
  const data = useFechamento(diarioId)
  const fechar = useFecharDiario(diarioId)
  const cfg = useAcaConfig()
  const cfgMut = useAcaConfigMut()
  const [openCfg, setOpenCfg] = useState(false)
  const r = cfg.data?.regras
  const linhas = data.data?.linhas ?? []

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold uppercase text-fg-muted">Regras de aprovação</h3>
          <button class="text-xs text-accent hover:underline" onClick={() => setOpenCfg((v) => !v)}>{openCfg ? 'Fechar' : 'Configurar'}</button>
        </div>
        {!openCfg ? (
          <p class="text-xs text-fg-muted">{r ? <>Média ≥ <b>{r.mediaAprovacao}</b> · Frequência ≥ <b>{r.frequenciaMinima}%</b>{r.recuperacaoHabilitada ? <> · Recuperação a partir de <b>{r.recuperacaoMin}</b></> : ' · Sem recuperação'}</> : 'Carregando…'}</p>
        ) : r ? <RegrasForm regras={r} onSave={(b) => cfgMut.mutate(b, { onSuccess: () => setOpenCfg(false) })} saving={cfgMut.isPending} /> : null}
      </Card>

      {data.data?.fechado && <p class="text-xs text-warning">⚑ Diário já fechado. Refechar sobrescreve as situações salvas (mantém ajustes do conselho na tela de Conselho).</p>}

      <Card class="p-0 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface-2 text-xs text-fg-muted">
            <tr><th class="text-left p-2 font-medium">Aluno</th><th class="p-2 font-medium text-center">Média</th><th class="p-2 font-medium text-center">Freq.</th><th class="p-2 font-medium text-center">Situação</th></tr>
          </thead>
          <tbody class="divide-y divide-border">
            {linhas.length === 0 ? <tr><td colspan={4} class="p-4 text-center text-xs text-fg-muted">Sem matriculados.</td></tr> : linhas.map((l) => (
              <tr key={l.matriculaId} class="hover:bg-surface-2">
                <td class="p-2 text-fg">{l.nome}{!l.completo && <span class="ml-1 text-[10px] text-fg-subtle">(notas incompletas)</span>}</td>
                <td class="p-2 text-center">{l.media != null ? <Badge tone={l.media >= 6 ? 'success' : l.media >= 4 ? 'warning' : 'danger'}>{l.media}</Badge> : <span class="text-fg-subtle text-xs">—</span>}</td>
                <td class="p-2 text-center"><Badge tone={l.freqPct >= (r?.frequenciaMinima ?? 75) ? 'success' : 'danger'}>{l.freqPct}%</Badge></td>
                <td class="p-2 text-center"><Badge tone={situacaoTone(l.situacao)}>{SITUACAO_LABEL[l.situacao] ?? l.situacao}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div class="flex justify-end">
        <Button variant="primary" size="sm" disabled={fechar.isPending || linhas.length === 0} onClick={() => fechar.mutate()}><Save size={14} /> {data.data?.fechado ? 'Refechar diário' : 'Fechar diário'}</Button>
      </div>
    </div>
  )
}

function RegrasForm({ regras, onSave, saving }: { regras: import('@/hooks/useAcaFechamento').Regras; onSave: (b: any) => void; saving: boolean }) {
  const [ma, setMa] = useState(String(regras.mediaAprovacao))
  const [fm, setFm] = useState(String(regras.frequenciaMinima))
  const [rec, setRec] = useState(regras.recuperacaoHabilitada)
  const [rm, setRm] = useState(String(regras.recuperacaoMin))
  return (
    <div class="space-y-2">
      <div class="grid sm:grid-cols-3 gap-2">
        <Input label="Média de aprovação" type="number" value={ma} onInput={(e) => setMa((e.target as HTMLInputElement).value)} />
        <Input label="Frequência mínima (%)" type="number" value={fm} onInput={(e) => setFm((e.target as HTMLInputElement).value)} />
        <Input label="Média p/ recuperação" type="number" value={rm} onInput={(e) => setRm((e.target as HTMLInputElement).value)} />
      </div>
      <label class="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={rec} onChange={(e) => setRec((e.target as HTMLInputElement).checked)} /> Habilitar recuperação</label>
      <div class="flex justify-end">
        <Button variant="primary" size="sm" disabled={saving} onClick={() => onSave({ mediaAprovacao: Number(ma), frequenciaMinima: Number(fm), recuperacaoHabilitada: rec, recuperacaoMin: Number(rm) })}>Salvar regras</Button>
      </div>
    </div>
  )
}

function ChamadaView({ aulaId, onBack }: { aulaId: number; onBack: () => void }) {
  const data = useChamada(aulaId)
  const mut = useDiarioMut()
  const [local, setLocal] = useState<Record<number, { presente: boolean; justificada: boolean }> | null>(null)

  const lista = data.data?.lista ?? []
  const get = (m: FreqRow) => local?.[m.matriculaId] ?? { presente: m.presente, justificada: m.justificada }
  function toggle(m: FreqRow) {
    const cur = get(m)
    setLocal((p) => ({ ...(p ?? Object.fromEntries(lista.map((x) => [x.matriculaId, { presente: x.presente, justificada: x.justificada }]))), [m.matriculaId]: { presente: !cur.presente, justificada: cur.justificada } }))
  }
  function toggleJust(m: FreqRow) {
    const cur = get(m)
    setLocal((p) => ({ ...(p ?? Object.fromEntries(lista.map((x) => [x.matriculaId, { presente: x.presente, justificada: x.justificada }]))), [m.matriculaId]: { presente: cur.presente, justificada: !cur.justificada } }))
  }
  function salvar() {
    const registros = lista.map((m) => ({ matriculaId: m.matriculaId, ...get(m) }))
    mut.salvarChamada.mutate({ aulaId, registros }, { onSuccess: () => { setLocal(null); onBack() } })
  }
  const presentes = lista.filter((m) => get(m).presente).length

  return (
    <Page title={data.data ? `Chamada · ${new Date(data.data.aula.data).toLocaleDateString('pt-BR')}` : 'Chamada'}
      actions={<Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>}>
      {!data.data ? <Skeleton class="h-40 w-full" /> : (
        <div class="space-y-3 max-w-2xl">
          <Card class="flex items-center gap-2">
            <span class="text-sm text-fg flex-1">{data.data.aula.conteudo}</span>
            <Badge tone="info">{presentes}/{lista.length} presentes</Badge>
          </Card>
          <Card class="divide-y divide-border p-0 overflow-hidden">
            {lista.map((m) => {
              const st = get(m)
              return (
                <div key={m.matriculaId} class="px-4 py-2.5 flex items-center gap-3">
                  <button class={`inline-flex items-center gap-1.5 text-sm ${st.presente ? 'text-success' : 'text-danger'}`} onClick={() => toggle(m)}>
                    {st.presente ? <CheckSquare size={16} /> : <Square size={16} />}
                    {st.presente ? 'Presente' : 'Falta'}
                  </button>
                  <span class="flex-1 truncate text-sm text-fg">{m.nome} <span class="text-xs text-fg-subtle">RA {m.ra}</span></span>
                  {!st.presente && (
                    <label class="text-xs text-fg-muted inline-flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={st.justificada} onChange={() => toggleJust(m)} /> justificada
                    </label>
                  )}
                </div>
              )
            })}
          </Card>
          <div class="flex justify-end">
            <Button variant="primary" size="sm" disabled={mut.salvarChamada.isPending} onClick={salvar}><Save size={14} /> {mut.salvarChamada.isPending ? 'Salvando…' : 'Salvar chamada'}</Button>
          </div>
        </div>
      )}
    </Page>
  )
}
