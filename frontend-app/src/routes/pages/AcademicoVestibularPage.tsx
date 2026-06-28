import { useState } from 'preact/hooks'
import { ClipboardList, Trophy, DoorOpen, Plus, Trash2, Save, Megaphone } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useProcessos, useCandidatos, useComponentesVest, useSalasVest, useVestibularMut, useGruposInsc, useMotivosCanc, useEmpresasInsc, useExtrasInsc, type Candidato } from '@/hooks/useAcaVestibular'

type Tab = 'notas' | 'classificacao' | 'ensalamento' | 'inscricao'
const ST_TONE: Record<string, any> = { inscrito: 'neutral', pago_taxa: 'info', classificado: 'success', convocado: 'accent', matriculado: 'success', desistente: 'neutral', reprovado: 'danger' }

export function AcademicoVestibularPage() {
  const procs = useProcessos()
  const [procId, setProcId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('notas')
  const processos = procs.data?.processos ?? []

  return (
    <Page title="Processo Seletivo" description="Componentes de nota, digitação, classificação, convocação e ensalamento.">
      <Select label="Processo seletivo" value={procId ?? ''} onChange={(e: any) => setProcId(e.currentTarget.value ? Number(e.currentTarget.value) : null)}>
        <option value="">Selecione…</option>
        {processos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.periodoLetivo ? ` · ${p.periodoLetivo}` : ''} ({p.candidatos} inscritos)</option>)}
      </Select>

      {procId === null ? <EmptyState icon={<ClipboardList size={28} />} title="Selecione um processo" description="Escolha um processo seletivo para gerenciar." /> : (
        <>
          <div class="flex gap-1 border-b border-border mt-3">
            {([['notas', 'Candidatos & notas'], ['classificacao', 'Classificação'], ['ensalamento', 'Ensalamento'], ['inscricao', 'Inscrição']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'notas' && <NotasTab procId={procId} />}
          {tab === 'classificacao' && <ClassificacaoTab procId={procId} />}
          {tab === 'ensalamento' && <EnsalamentoTab procId={procId} />}
          {tab === 'inscricao' && <InscricaoTab procId={procId} />}
        </>
      )}
    </Page>
  )
}

function NotasTab({ procId }: { procId: number }) {
  const comps = useComponentesVest(procId)
  const cand = useCandidatos(procId)
  const mut = useVestibularMut()
  const [novo, setNovo] = useState({ nome: '', peso: '1' })
  const [edits, setEdits] = useState<Record<string, string>>({})

  const componentes = comps.data?.componentes ?? []
  const candidatos = cand.data?.candidatos ?? []
  const key = (regId: number, compId: number) => `${regId}:${compId}`
  const valNota = (c: Candidato, compId: number) => edits[key(c.id, compId)] ?? (c.notas[compId] != null ? String(c.notas[compId]) : '')

  const salvar = () => {
    const notas = Object.entries(edits).filter(([, v]) => v !== '').map(([k, v]) => { const [r, comp] = k.split(':'); return { processRegistrationId: Number(r), componenteId: Number(comp), nota: Number(v) } })
    if (notas.length) mut.salvarNotas.mutate({ notas }, { onSuccess: () => setEdits({}) })
  }

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Componentes de avaliação</div>
        <div class="flex flex-wrap gap-2 items-end">
          <Input placeholder="Nome (ex: Objetiva)" value={novo.nome} onInput={(e: any) => setNovo({ ...novo, nome: e.currentTarget.value })} />
          <Input class="!w-24" type="number" step="0.5" placeholder="Peso" value={novo.peso} onInput={(e: any) => setNovo({ ...novo, peso: e.currentTarget.value })} />
          <Button size="sm" variant="secondary" disabled={!novo.nome || mut.criarComponente.isPending} onClick={() => mut.criarComponente.mutate({ selectionProcessId: procId, nome: novo.nome, peso: Number(novo.peso) || 1 }, { onSuccess: () => setNovo({ nome: '', peso: '1' }) })}><Plus size={14} /> Componente</Button>
        </div>
        <div class="flex flex-wrap gap-1">
          {componentes.map((c) => <span key={c.id} class="text-xs px-2 py-1 bg-surface-2 rounded flex items-center gap-1">{c.nome} (×{c.peso})<button class="text-fg-muted hover:text-danger" onClick={() => mut.delComponente.mutate(c.id)}><Trash2 size={11} /></button></span>)}
        </div>
      </Card>

      {comps.isLoading || cand.isLoading ? <Skeleton class="h-40 w-full" /> : componentes.length === 0 ? <p class="text-sm text-fg-muted">Crie ao menos um componente para digitar notas.</p> : candidatos.length === 0 ? <EmptyState icon={<ClipboardList size={24} />} title="Sem candidatos" description="Este processo ainda não tem inscritos." /> : (
        <Card class="p-0 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-xs text-fg-muted"><tr><th class="text-left p-2">Candidato</th>{componentes.map((c) => <th key={c.id} class="p-2 w-24">{c.nome}</th>)}<th class="p-2 w-20">Final</th></tr></thead>
            <tbody class="divide-y divide-border">
              {candidatos.map((c) => (
                <tr key={c.id}>
                  <td class="p-2">{c.nome}</td>
                  {componentes.map((comp) => (
                    <td key={comp.id} class="p-1 text-center">
                      <input type="number" step="0.1" class="w-16 px-1 py-1 border border-border rounded text-center bg-surface" value={valNota(c, comp.id)} onInput={(e: any) => setEdits({ ...edits, [key(c.id, comp.id)]: e.currentTarget.value })} />
                    </td>
                  ))}
                  <td class="p-2 text-center text-fg-muted">{c.notaFinal != null ? c.notaFinal.toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div class="flex justify-end"><Button variant="primary" disabled={Object.keys(edits).length === 0 || mut.salvarNotas.isPending} onClick={salvar}><Save size={14} /> Salvar notas ({Object.keys(edits).filter((k) => edits[k] !== '').length})</Button></div>
    </div>
  )
}

function ClassificacaoTab({ procId }: { procId: number }) {
  const comps = useComponentesVest(procId)
  const cand = useCandidatos(procId)
  const mut = useVestibularMut()
  const [criterio, setCriterio] = useState('inscricao')
  const [vagas, setVagas] = useState('')
  const [res, setRes] = useState<string | null>(null)

  const candidatos = cand.data?.candidatos ?? []
  const counts = cand.data?.counts ?? {}
  const classificados = candidatos.filter((c) => c.posicao != null).sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0))

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><Trophy size={16} /> Classificar</div>
        <div class="flex flex-wrap gap-2 items-end">
          <Select label="Critério de desempate" value={criterio} onChange={(e: any) => setCriterio(e.currentTarget.value)} class="!w-56">
            <option value="inscricao">Ordem de inscrição</option>
            {(comps.data?.componentes ?? []).map((c) => <option key={c.id} value={`componente:${c.id}`}>Maior nota em {c.nome}</option>)}
          </Select>
          <Button size="sm" variant="primary" loading={mut.classificar.isPending} onClick={() => mut.classificar.mutate({ selectionProcessId: procId, criterio }, { onSuccess: (d) => setRes(`${d.classificados} classificado(s), ${d.reprovados} reprovado(s).`) })}>Classificar</Button>
          {res && <span class="text-sm text-fg-muted">{res}</span>}
        </div>
        <div class="flex flex-wrap gap-2 items-end pt-2 border-t border-border">
          <Input class="!w-36" type="number" label="Vagas a convocar" value={vagas} onInput={(e: any) => setVagas(e.currentTarget.value)} />
          <Button size="sm" variant="secondary" disabled={!vagas || mut.convocar.isPending} onClick={() => mut.convocar.mutate({ selectionProcessId: procId, qtdVagas: Number(vagas) }, { onSuccess: (d) => { setRes(`${d.convocados} candidato(s) convocado(s).`); setVagas('') } })}><Megaphone size={14} /> Convocar</Button>
          <span class="text-xs text-fg-muted">Classificados: {counts.classificado ?? 0} · Convocados: {counts.convocado ?? 0} · Reprovados: {counts.reprovado ?? 0}</span>
        </div>
      </Card>

      {cand.isLoading ? <Skeleton class="h-40 w-full" /> : classificados.length === 0 ? <p class="text-sm text-fg-muted">Nenhum candidato classificado ainda. Digite as notas e clique em Classificar.</p> : (
        <Card class="p-0 overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-xs text-fg-muted"><tr><th class="text-left p-2 w-12">#</th><th class="text-left p-2">Candidato</th><th class="p-2 w-20">Nota</th><th class="text-center p-2 w-28">Situação</th></tr></thead>
            <tbody class="divide-y divide-border">
              {classificados.map((c) => (
                <tr key={c.id}><td class="p-2 font-medium">{c.posicao}º</td><td class="p-2">{c.nome}</td><td class="p-2 text-center">{c.notaFinal?.toFixed(2)}</td><td class="p-2 text-center"><Badge tone={ST_TONE[c.status]}>{c.statusLabel}</Badge></td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function EnsalamentoTab({ procId }: { procId: number }) {
  const salas = useSalasVest(procId)
  const cand = useCandidatos(procId)
  const mut = useVestibularMut()
  const [nova, setNova] = useState({ nome: '', local: '', capacidade: '30' })
  const [res, setRes] = useState<string | null>(null)

  const lista = salas.data?.salas ?? []
  const ensalados = (cand.data?.candidatos ?? []).filter((c) => c.sala)

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><DoorOpen size={16} /> Salas</div>
        <div class="flex flex-wrap gap-2 items-end">
          <Input placeholder="Nome da sala" value={nova.nome} onInput={(e: any) => setNova({ ...nova, nome: e.currentTarget.value })} />
          <Input placeholder="Local" value={nova.local} onInput={(e: any) => setNova({ ...nova, local: e.currentTarget.value })} />
          <Input class="!w-24" type="number" placeholder="Cap." value={nova.capacidade} onInput={(e: any) => setNova({ ...nova, capacidade: e.currentTarget.value })} />
          <Button size="sm" variant="secondary" disabled={!nova.nome || mut.criarSala.isPending} onClick={() => mut.criarSala.mutate({ selectionProcessId: procId, nome: nova.nome, local: nova.local || null, capacidade: Number(nova.capacidade) || 30 }, { onSuccess: () => setNova({ nome: '', local: '', capacidade: '30' }) })}><Plus size={14} /> Sala</Button>
          <Button size="sm" variant="primary" disabled={lista.length === 0 || mut.ensalar.isPending} onClick={() => mut.ensalar.mutate({ selectionProcessId: procId }, { onSuccess: (d) => setRes(`${d.alocados} alocado(s)${d.semSala ? `, ${d.semSala} sem sala` : ''}.`) })}>Ensalar</Button>
          {res && <span class="text-sm text-fg-muted">{res}</span>}
        </div>
        <div class="flex flex-wrap gap-1">
          {lista.map((s) => <span key={s.id} class="text-xs px-2 py-1 bg-surface-2 rounded flex items-center gap-1">{s.nome} (cap. {s.capacidade}){s.local ? ` · ${s.local}` : ''}<button class="text-fg-muted hover:text-danger" onClick={() => mut.delSala.mutate(s.id)}><Trash2 size={11} /></button></span>)}
        </div>
      </Card>

      {ensalados.length === 0 ? <p class="text-sm text-fg-muted">Ninguém ensalado ainda. Cadastre salas e clique em Ensalar.</p> : (
        <Card class="p-0 overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-xs text-fg-muted"><tr><th class="text-left p-2">Candidato</th><th class="text-left p-2">Sala</th><th class="p-2 w-20">Lugar</th></tr></thead>
            <tbody class="divide-y divide-border">
              {ensalados.map((c) => <tr key={c.id}><td class="p-2">{c.nome}</td><td class="p-2">{c.sala!.nome}</td><td class="p-2 text-center">{c.sala!.ordem}</td></tr>)}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function InscricaoTab({ procId }: { procId: number }) {
  const grupos = useGruposInsc(procId)
  const motivos = useMotivosCanc()
  const empresas = useEmpresasInsc()
  const cand = useCandidatos(procId)
  const extras = useExtrasInsc(procId)
  const mut = useVestibularMut()
  const [ng, setNg] = useState(''); const [nm, setNm] = useState(''); const [ne, setNe] = useState('')

  const listaGrupos = grupos.data?.grupos ?? []
  const listaEmpresas = empresas.data?.empresas ?? []
  const listaMotivos = motivos.data?.motivos ?? []
  const exMap = extras.data?.extras ?? {}
  const candidatos = (cand.data?.candidatos ?? []).filter((c) => c.status !== 'reprovado')

  return (
    <div class="space-y-3 mt-3">
      <div class="grid md:grid-cols-3 gap-3">
        <Card class="space-y-2">
          <div class="text-sm font-semibold text-fg">Grupos de inscrição</div>
          <div class="flex gap-1"><Input placeholder="Novo grupo" value={ng} onInput={(e: any) => setNg(e.currentTarget.value)} /><Button size="sm" variant="secondary" disabled={!ng} onClick={() => mut.criarGrupo.mutate({ selectionProcessId: procId, nome: ng }, { onSuccess: () => setNg('') })}><Plus size={14} /></Button></div>
          <div class="flex flex-wrap gap-1">{listaGrupos.map((g) => <span key={g.id} class="text-xs px-2 py-1 bg-surface-2 rounded flex items-center gap-1">{g.nome}<button class="text-fg-muted hover:text-danger" onClick={() => mut.delGrupo.mutate(g.id)}><Trash2 size={11} /></button></span>)}</div>
        </Card>
        <Card class="space-y-2">
          <div class="text-sm font-semibold text-fg">Motivos de cancelamento</div>
          <div class="flex gap-1"><Input placeholder="Novo motivo" value={nm} onInput={(e: any) => setNm(e.currentTarget.value)} /><Button size="sm" variant="secondary" disabled={!nm} onClick={() => mut.criarMotivo.mutate({ nome: nm }, { onSuccess: () => setNm('') })}><Plus size={14} /></Button></div>
          <div class="flex flex-wrap gap-1">{listaMotivos.map((m) => <span key={m.id} class="text-xs px-2 py-1 bg-surface-2 rounded">{m.nome}</span>)}</div>
        </Card>
        <Card class="space-y-2">
          <div class="text-sm font-semibold text-fg">Empresas (inscrição B2B)</div>
          <div class="flex gap-1"><Input placeholder="Nova empresa" value={ne} onInput={(e: any) => setNe(e.currentTarget.value)} /><Button size="sm" variant="secondary" disabled={!ne} onClick={() => mut.criarEmpresa.mutate({ nome: ne }, { onSuccess: () => setNe('') })}><Plus size={14} /></Button></div>
          <div class="flex flex-wrap gap-1">{listaEmpresas.map((e) => <span key={e.id} class="text-xs px-2 py-1 bg-surface-2 rounded">{e.nome}</span>)}</div>
        </Card>
      </div>

      {cand.isLoading ? <Skeleton class="h-40 w-full" /> : candidatos.length === 0 ? <p class="text-sm text-fg-muted">Sem candidatos.</p> : (
        <Card class="p-0 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-xs text-fg-muted"><tr><th class="text-left p-2">Candidato</th><th class="p-2">Grupo</th><th class="p-2">Empresa</th><th class="p-2 w-32"></th></tr></thead>
            <tbody class="divide-y divide-border">
              {candidatos.map((c) => {
                const ex = exMap[c.id]
                return (
                  <tr key={c.id}>
                    <td class="p-2">{c.nome}{c.status === 'desistente' && <Badge tone="danger" class="ml-1">cancelada</Badge>}</td>
                    <td class="p-1"><Select value={ex?.grupoId ?? ''} onChange={(e: any) => mut.setExtra.mutate({ regId: c.id, grupoId: e.currentTarget.value || null, empresaId: ex?.empresaId ?? null, comoConheceu: ex?.comoConheceu ?? null })} class="!py-1 text-xs"><option value="">—</option>{listaGrupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></td>
                    <td class="p-1"><Select value={ex?.empresaId ?? ''} onChange={(e: any) => mut.setExtra.mutate({ regId: c.id, empresaId: e.currentTarget.value || null, grupoId: ex?.grupoId ?? null, comoConheceu: ex?.comoConheceu ?? null })} class="!py-1 text-xs"><option value="">—</option>{listaEmpresas.map((em) => <option key={em.id} value={em.id}>{em.nome}</option>)}</Select></td>
                    <td class="p-1 text-right">{c.status !== 'desistente' && <CancelarInline regId={c.id} motivos={listaMotivos} onCancel={(motivoId) => mut.cancelarInscricao.mutate({ regId: c.id, motivoId })} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function CancelarInline({ motivos, onCancel }: { regId: number; motivos: Array<{ id: number; nome: string }>; onCancel: (motivoId?: number) => void }) {
  const [open, setOpen] = useState(false)
  const [mid, setMid] = useState('')
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Cancelar</Button>
  return (
    <div class="flex gap-1 items-center justify-end">
      <Select value={mid} onChange={(e: any) => setMid(e.currentTarget.value)} class="!py-1 text-xs !w-28"><option value="">Motivo…</option>{motivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select>
      <Button size="sm" variant="danger" onClick={() => { onCancel(mid ? Number(mid) : undefined); setOpen(false) }}>OK</Button>
    </div>
  )
}
