import { useState } from 'preact/hooks'
import { Cloud, RefreshCw, Plus, GraduationCap, Settings } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEadConfig, useEadTurmas, useTurmasDisponiveisEad, useEadMatriculas, useEadNotas, useEadMut } from '@/hooks/useAcaEad'

type Tab = 'turmas' | 'notas' | 'config'

export function AcademicoEadPage() {
  const [tab, setTab] = useState<Tab>('turmas')
  const cfg = useEadConfig()
  const modo = cfg.data?.config?.modo ?? 'SIMULADO'
  return (
    <Page title="EAD / LMS" description="Ponte com o LMS próprio: turmas EAD, sincronização de matrículas, recebimento de médias e acessos.">
      <p class="text-xs text-fg-muted">⚠️ O LMS próprio é o ponto de integração. Modo atual: <b>{modo}</b> — em <b>SIMULADO</b> o fluxo roda local (para validar sem o LMS); em <b>AO_VIVO</b> a sincronização chamaria a API do LMS.</p>
      <div class="flex gap-1 border-b border-border">
        {([['turmas', 'Turmas EAD'], ['notas', 'Médias recebidas'], ['config', 'Configuração']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'turmas' && <TurmasTab />}
      {tab === 'notas' && <NotasTab />}
      {tab === 'config' && <ConfigTab />}
    </Page>
  )
}

function TurmasTab() {
  const turmas = useEadTurmas()
  const disp = useTurmasDisponiveisEad()
  const mut = useEadMut()
  const [f, setF] = useState({ turmaId: '', chEad: '' })
  const [sel, setSel] = useState<number | null>(null)
  const mats = useEadMatriculas(sel)

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><Cloud size={16} /> Marcar turma como EAD</div>
        <div class="flex flex-wrap gap-2 items-end">
          <Select value={f.turmaId} onChange={(e: any) => setF({ ...f, turmaId: e.currentTarget.value })} class="!w-64"><option value="">Turma…</option>{(disp.data?.turmas ?? []).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</Select>
          <Input class="!w-32" type="number" placeholder="CH EAD" value={f.chEad} onInput={(e: any) => setF({ ...f, chEad: e.currentTarget.value })} />
          <Button size="sm" variant="secondary" disabled={!f.turmaId || mut.marcarTurma.isPending} onClick={() => mut.marcarTurma.mutate({ turmaId: Number(f.turmaId), chEad: Number(f.chEad) || 0 }, { onSuccess: () => setF({ turmaId: '', chEad: '' }) })}><Plus size={14} /> Adicionar</Button>
        </div>
      </Card>

      {turmas.isLoading ? <Skeleton class="h-24 w-full" /> : (turmas.data?.turmas ?? []).length === 0 ? <EmptyState icon={<Cloud size={26} />} title="Nenhuma turma EAD" description="Marque uma turma como EAD acima." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {(turmas.data?.turmas ?? []).map((t) => (
            <div key={t.id} class="px-4 py-3 flex items-center gap-3 text-sm">
              <button class="flex-1 min-w-0 text-left" onClick={() => setSel(sel === t.id ? null : t.id)}><span class="block truncate text-fg font-medium">{t.turmaNome}</span><span class="block text-xs text-fg-muted">CH EAD {t.chEad}h · {t.sincronizadas} sincronizada(s){t.lmsRef ? ` · LMS ${t.lmsRef}` : ''}</span></button>
              <Button size="sm" variant="secondary" disabled={mut.sincronizar.isPending} onClick={() => mut.sincronizar.mutate(t.id)}><RefreshCw size={13} /> Sincronizar</Button>
            </div>
          ))}
        </Card>
      )}

      {sel !== null && (
        <Card class="space-y-1">
          <div class="text-sm font-semibold text-fg">Matrículas sincronizadas</div>
          {mats.isLoading ? <Skeleton class="h-16 w-full" /> : (mats.data?.matriculas ?? []).length === 0 ? <p class="text-sm text-fg-muted">Clique em “Sincronizar” na turma.</p> : (
            <div class="divide-y divide-border text-sm">
              {(mats.data?.matriculas ?? []).map((m) => <div key={m.id} class="py-1.5 flex items-center gap-2"><span class="flex-1">{m.alunoNome} <span class="text-xs text-fg-muted">RA {m.ra ?? '—'}</span></span><Badge tone={m.status === 'SINCRONIZADA' ? 'success' : 'warning'}>{m.status === 'SINCRONIZADA' ? 'Sincronizada' : 'Pendente'}</Badge></div>)}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function NotasTab() {
  const notas = useEadNotas()
  const mut = useEadMut()
  const [f, setF] = useState({ matriculaId: '', disciplina: '', nota: '' })
  const add = () => { if (!f.matriculaId || !f.disciplina || !f.nota) return; mut.receberNotas.mutate({ notas: [{ matriculaId: Number(f.matriculaId), disciplina: f.disciplina, nota: Number(f.nota) }], origem: 'MANUAL' }, { onSuccess: () => setF({ matriculaId: '', disciplina: '', nota: '' }) }) }

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><GraduationCap size={16} /> Lançar média (manual)</div>
        <p class="text-xs text-fg-muted">Em produção, o LMS envia as médias para o endpoint de recebimento automaticamente.</p>
        <div class="grid sm:grid-cols-[1fr_2fr_1fr_auto] gap-2">
          <Input type="number" placeholder="Matrícula ID" value={f.matriculaId} onInput={(e: any) => setF({ ...f, matriculaId: e.currentTarget.value })} />
          <Input placeholder="Disciplina" value={f.disciplina} onInput={(e: any) => setF({ ...f, disciplina: e.currentTarget.value })} />
          <Input type="number" step="0.1" placeholder="Nota" value={f.nota} onInput={(e: any) => setF({ ...f, nota: e.currentTarget.value })} />
          <Button size="sm" variant="secondary" disabled={!f.matriculaId || !f.disciplina || !f.nota || mut.receberNotas.isPending} onClick={add}><Plus size={14} /></Button>
        </div>
      </Card>
      {notas.isLoading ? <Skeleton class="h-24 w-full" /> : (notas.data?.notas ?? []).length === 0 ? <EmptyState icon={<GraduationCap size={26} />} title="Sem médias" description="As médias recebidas do LMS aparecem aqui." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {(notas.data?.notas ?? []).map((n) => (
            <div key={n.id} class="px-4 py-2 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{n.disciplina}</span><span class="block text-xs text-fg-muted">matrícula #{n.matriculaId} · {new Date(n.recebidaEm).toLocaleDateString('pt-BR')}</span></span>
              <Badge tone={n.origem === 'LMS' ? 'accent' : 'neutral'}>{n.origem}</Badge>
              <b>{n.nota}</b>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function ConfigTab() {
  const cfg = useEadConfig()
  const mut = useEadMut()
  const [form, setForm] = useState<any>(null)
  const c = cfg.data?.config
  const f = form ?? c ?? { lmsNome: '', lmsBaseUrl: '', modo: 'SIMULADO', ativo: false }
  const set = (k: string, v: any) => setForm({ ...f, [k]: v })
  return (
    <div class="mt-3">
      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><Settings size={16} /> Conexão com o LMS</div>
        {cfg.isLoading ? <Skeleton class="h-24 w-full" /> : (
          <>
            <div class="grid sm:grid-cols-2 gap-2">
              <Input label="Nome do LMS" value={f.lmsNome ?? ''} onInput={(e: any) => set('lmsNome', e.currentTarget.value)} />
              <Input label="URL base do LMS" value={f.lmsBaseUrl ?? ''} onInput={(e: any) => set('lmsBaseUrl', e.currentTarget.value)} placeholder="https://lms.ineprotec…" />
              <Select label="Modo" value={f.modo} onChange={(e: any) => set('modo', e.currentTarget.value)}><option value="SIMULADO">Simulado (sem LMS)</option><option value="AO_VIVO">Ao vivo (chama o LMS)</option></Select>
            </div>
            <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={!!f.ativo} onChange={(e: any) => set('ativo', e.currentTarget.checked)} /> Integração ativa</label>
            <p class="text-xs text-fg-muted">A credencial/token do LMS (segredo) será configurada no .env quando o LMS existir — aqui guardamos só a referência pública.</p>
            <div><Button variant="primary" loading={mut.salvarConfig.isPending} onClick={() => mut.salvarConfig.mutate(f, { onSuccess: () => setForm(null) })}>Salvar</Button></div>
          </>
        )}
      </Card>
    </div>
  )
}
