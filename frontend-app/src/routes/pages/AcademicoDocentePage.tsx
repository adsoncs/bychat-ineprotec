import { useState } from 'preact/hooks'
import { GraduationCap, Calculator, CheckSquare, Plus, Trash2, CheckCircle2, XCircle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import {
  useUsuariosDoc, useDocentes, useTiposAtividade, useAtividadesDoc, useAceitesDoc, useDocenteMut, REGIME_LABEL,
} from '@/hooks/useAcaDocente'

type Tab = 'docentes' | 'atividades' | 'aceites'
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function AcademicoDocentePage() {
  const [tab, setTab] = useState<Tab>('docentes')
  return (
    <Page title="Docente / RH Acadêmico" description="Cadastro de docentes, atividades docentes com cálculo de valores e aceite de disciplinas.">
      <div class="flex gap-1 border-b border-border">
        {([['docentes', 'Docentes'], ['atividades', 'Atividades & valores'], ['aceites', 'Aceite de disciplinas']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'docentes' && <DocentesTab />}
      {tab === 'atividades' && <AtividadesTab />}
      {tab === 'aceites' && <AceitesTab />}
    </Page>
  )
}

function DocentesTab() {
  const docentes = useDocentes()
  const [q, setQ] = useState('')
  const users = useUsuariosDoc(q)
  const mut = useDocenteMut()
  const [novo, setNovo] = useState({ userId: '', titulacao: '', regime: 'HORISTA', valorHora: '' })

  const add = () => {
    if (!novo.userId) return
    mut.criarDocente.mutate({ userId: Number(novo.userId), titulacao: novo.titulacao || null, regime: novo.regime, valorHoraCentavos: Math.round(parseFloat(novo.valorHora.replace(',', '.') || '0') * 100) }, { onSuccess: () => setNovo({ userId: '', titulacao: '', regime: 'HORISTA', valorHora: '' }) })
  }
  const lista = docentes.data?.docentes ?? []

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Novo docente</div>
        <SearchInput value={q} onChange={setQ} placeholder="Buscar usuário (professor)…" />
        <div class="grid sm:grid-cols-4 gap-2">
          <Select value={novo.userId} onChange={(e: any) => setNovo({ ...novo, userId: e.currentTarget.value })}>
            <option value="">Usuário…</option>
            {(users.data?.usuarios ?? []).filter((u) => !u.jaDocente).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Input placeholder="Titulação" value={novo.titulacao} onInput={(e: any) => setNovo({ ...novo, titulacao: e.currentTarget.value })} />
          <Select value={novo.regime} onChange={(e: any) => setNovo({ ...novo, regime: e.currentTarget.value })}>{Object.entries(REGIME_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Input placeholder="Valor/hora (R$)" value={novo.valorHora} onInput={(e: any) => setNovo({ ...novo, valorHora: e.currentTarget.value })} />
        </div>
        <Button size="sm" variant="secondary" disabled={!novo.userId || mut.criarDocente.isPending} onClick={add}><Plus size={14} /> Cadastrar docente</Button>
      </Card>

      {docentes.isLoading ? <Skeleton class="h-32 w-full" /> : lista.length === 0 ? <EmptyState icon={<GraduationCap size={28} />} title="Nenhum docente" description="Cadastre um docente a partir de um usuário." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {lista.map((d) => (
            <div key={d.id} class="px-4 py-3 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0"><span class="block truncate text-fg font-medium">{d.nome}{!d.ativo && <span class="text-xs text-danger ml-1">(inativo)</span>}</span><span class="block text-xs text-fg-muted">{d.titulacao ? `${d.titulacao} · ` : ''}{REGIME_LABEL[d.regime]} · {brl(d.valorHoraCentavos)}/h · {d.aceites} aceite(s)</span></span>
              <Button size="sm" variant="ghost" onClick={() => mut.atualizarDocente.mutate({ id: d.id, ativo: !d.ativo })}>{d.ativo ? 'Inativar' : 'Ativar'}</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

const competenciaAtual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

function AtividadesTab() {
  const docentes = useDocentes()
  const tipos = useTiposAtividade()
  const mut = useDocenteMut()
  const [comp, setComp] = useState(competenciaAtual())
  const [docenteId, setDocenteId] = useState('')
  const ativ = useAtividadesDoc(docenteId ? Number(docenteId) : undefined, comp)
  const [novoTipo, setNovoTipo] = useState({ nome: '', fator: '1' })
  const [nova, setNova] = useState({ tipoId: '', horas: '', descricao: '' })
  const [resumo, setResumo] = useState<any>(null)

  const lancar = () => {
    if (!docenteId || !nova.tipoId || !nova.horas) return
    mut.criarAtividade.mutate({ docenteId: Number(docenteId), tipoId: Number(nova.tipoId), competencia: comp, horas: Number(nova.horas), descricao: nova.descricao || null }, { onSuccess: () => setNova({ tipoId: '', horas: '', descricao: '' }) })
  }
  const atividades = ativ.data?.atividades ?? []

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Tipos de atividade (com fator)</div>
        <div class="flex flex-wrap gap-1 items-center">
          {(tipos.data?.tipos ?? []).map((t) => <span key={t.id} class="text-xs px-2 py-1 bg-surface-2 rounded">{t.nome} (×{t.fatorHora})</span>)}
        </div>
        <div class="flex gap-2 items-end">
          <Input placeholder="Novo tipo (ex: Correção)" value={novoTipo.nome} onInput={(e: any) => setNovoTipo({ ...novoTipo, nome: e.currentTarget.value })} />
          <Input class="!w-24" type="number" step="0.1" placeholder="Fator" value={novoTipo.fator} onInput={(e: any) => setNovoTipo({ ...novoTipo, fator: e.currentTarget.value })} />
          <Button size="sm" variant="secondary" disabled={!novoTipo.nome || mut.criarTipo.isPending} onClick={() => mut.criarTipo.mutate({ nome: novoTipo.nome, fatorHora: Number(novoTipo.fator) || 1 }, { onSuccess: () => setNovoTipo({ nome: '', fator: '1' }) })}><Plus size={14} /></Button>
        </div>
      </Card>

      <Card class="space-y-2">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="text-sm font-semibold text-fg">Lançar atividade</div>
          <div class="flex items-center gap-2">
            <Input type="month" value={comp} onInput={(e: any) => setComp(e.currentTarget.value)} class="!w-40" />
            <Button size="sm" variant="ghost" onClick={() => mut.calcular.mutate(comp, { onSuccess: (d) => setResumo(d) })}><Calculator size={14} /> Calcular mês</Button>
          </div>
        </div>
        <div class="grid sm:grid-cols-4 gap-2">
          <Select value={docenteId} onChange={(e: any) => setDocenteId(e.currentTarget.value)}><option value="">Docente…</option>{(docentes.data?.docentes ?? []).map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}</Select>
          <Select value={nova.tipoId} onChange={(e: any) => setNova({ ...nova, tipoId: e.currentTarget.value })}><option value="">Tipo…</option>{(tipos.data?.tipos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</Select>
          <Input type="number" step="0.5" placeholder="Horas" value={nova.horas} onInput={(e: any) => setNova({ ...nova, horas: e.currentTarget.value })} />
          <Button size="sm" variant="secondary" disabled={!docenteId || !nova.tipoId || !nova.horas || mut.criarAtividade.isPending} onClick={lancar}><Plus size={14} /> Lançar</Button>
        </div>
      </Card>

      {resumo && (
        <Card class="space-y-1">
          <div class="text-sm font-semibold text-fg">Resumo {resumo.competencia} — total {resumo.totalHoras}h · {brl(resumo.totalValorCentavos)}</div>
          <div class="divide-y divide-border text-sm">
            {resumo.docentes.map((d: any) => <div key={d.docenteId} class="py-1 flex gap-2"><span class="flex-1">{d.nome}</span><span class="text-fg-muted">{d.horas}h · {d.qtd} atividade(s)</span><b>{brl(d.valor)}</b></div>)}
          </div>
        </Card>
      )}

      {docenteId && (ativ.isLoading ? <Skeleton class="h-24 w-full" /> : atividades.length === 0 ? <p class="text-sm text-fg-muted">Sem atividades nesta competência.</p> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {atividades.map((a) => (
            <div key={a.id} class="px-4 py-2 flex items-center gap-2 text-sm">
              <span class="flex-1">{a.tipoNome} · {a.horas}h × {brl(a.valorHoraCentavos)} × {a.fatorHora}{a.descricao ? ` · ${a.descricao}` : ''}</span>
              <b>{brl(a.valorCentavos)}</b>
              <Badge tone={a.status === 'PAGA' ? 'success' : a.status === 'APROVADA' ? 'accent' : 'neutral'}>{a.status}</Badge>
              {a.status === 'LANCADA' && <Button size="sm" variant="ghost" onClick={() => mut.statusAtividade.mutate({ id: a.id, status: 'APROVADA' })}>Aprovar</Button>}
              <button class="text-fg-muted hover:text-danger" onClick={() => mut.delAtividade.mutate(a.id)}><Trash2 size={13} /></button>
            </div>
          ))}
        </Card>
      ))}
    </div>
  )
}

function AceitesTab() {
  const docentes = useDocentes()
  const mut = useDocenteMut()
  const [docenteId, setDocenteId] = useState<number | null>(null)
  const aceites = useAceitesDoc(docenteId)
  const lista = aceites.data?.aceites ?? []

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="flex items-end gap-2 flex-wrap">
          <Select label="Docente" value={docenteId ?? ''} onChange={(e: any) => setDocenteId(e.currentTarget.value ? Number(e.currentTarget.value) : null)} class="!w-64">
            <option value="">Selecione…</option>{(docentes.data?.docentes ?? []).map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </Select>
          {docenteId && <Button size="sm" variant="secondary" disabled={mut.gerarAceites.isPending} onClick={() => mut.gerarAceites.mutate(docenteId)}><CheckSquare size={14} /> Gerar pendências (diários do professor)</Button>}
        </div>
      </Card>

      {docenteId === null ? <EmptyState icon={<CheckSquare size={26} />} title="Selecione um docente" description="Veja e gerencie o aceite de disciplinas." /> :
        aceites.isLoading ? <Skeleton class="h-24 w-full" /> : lista.length === 0 ? <p class="text-sm text-fg-muted">Nenhuma disciplina para aceite. Clique em “Gerar pendências”.</p> : (
          <Card class="p-0 overflow-hidden divide-y divide-border">
            {lista.map((a) => (
              <div key={a.id} class="px-4 py-3 flex items-center gap-3 text-sm">
                <span class="flex-1 min-w-0"><span class="block truncate text-fg">{a.diario?.disciplina ?? '—'}</span><span class="block text-xs text-fg-muted">{a.diario?.turma ?? '—'}</span></span>
                <Badge tone={a.status === 'ACEITO' ? 'success' : a.status === 'RECUSADO' ? 'danger' : 'warning'}>{a.status}</Badge>
                {a.status === 'PENDENTE' && <>
                  <Button size="sm" variant="ghost" onClick={() => mut.decidirAceite.mutate({ id: a.id, status: 'RECUSADO' })}><XCircle size={14} /></Button>
                  <Button size="sm" variant="primary" onClick={() => mut.decidirAceite.mutate({ id: a.id, status: 'ACEITO' })}><CheckCircle2 size={14} /> Aceitar</Button>
                </>}
              </div>
            ))}
          </Card>
        )}
    </div>
  )
}
