import { useState } from 'preact/hooks'
import { Building2, Cpu, CalendarClock, Plus, Trash2, AlertTriangle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useTiposAmbiente, useAmbientes, useTiposEquip, useEquipamentos, useReservas, useAlocacaoMut } from '@/hooks/useAcaAlocacao'

type Tab = 'ambientes' | 'equipamentos' | 'reservas'

export function AcademicoAlocacaoPage() {
  const [tab, setTab] = useState<Tab>('ambientes')
  return (
    <Page title="Alocação de Recursos" description="Ambientes físicos, equipamentos e reservas de espaço com detecção de conflito.">
      <div class="flex gap-1 border-b border-border">
        {([['ambientes', 'Ambientes'], ['equipamentos', 'Equipamentos'], ['reservas', 'Reservas']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'ambientes' && <AmbientesTab />}
      {tab === 'equipamentos' && <EquipamentosTab />}
      {tab === 'reservas' && <ReservasTab />}
    </Page>
  )
}

function AmbientesTab() {
  const tipos = useTiposAmbiente()
  const ambientes = useAmbientes()
  const mut = useAlocacaoMut()
  const [nt, setNt] = useState('')
  const [f, setF] = useState({ nome: '', tipoId: '', capacidade: '', localizacao: '' })

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Tipos de ambiente</div>
        <div class="flex flex-wrap gap-1 items-center">{(tipos.data?.tipos ?? []).map((t) => <span key={t.id} class="text-xs px-2 py-1 bg-surface-2 rounded">{t.nome}</span>)}</div>
        <div class="flex gap-1"><Input placeholder="Novo tipo (ex: Laboratório)" value={nt} onInput={(e: any) => setNt(e.currentTarget.value)} /><Button size="sm" variant="secondary" disabled={!nt} onClick={() => mut.criarTipoAmb.mutate({ nome: nt }, { onSuccess: () => setNt('') })}><Plus size={14} /></Button></div>
      </Card>

      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Novo ambiente</div>
        <div class="grid sm:grid-cols-4 gap-2">
          <Input placeholder="Nome (ex: Sala 101)" value={f.nome} onInput={(e: any) => setF({ ...f, nome: e.currentTarget.value })} />
          <Select value={f.tipoId} onChange={(e: any) => setF({ ...f, tipoId: e.currentTarget.value })}><option value="">Tipo…</option>{(tipos.data?.tipos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</Select>
          <Input type="number" placeholder="Capacidade" value={f.capacidade} onInput={(e: any) => setF({ ...f, capacidade: e.currentTarget.value })} />
          <Input placeholder="Localização" value={f.localizacao} onInput={(e: any) => setF({ ...f, localizacao: e.currentTarget.value })} />
        </div>
        <Button size="sm" variant="secondary" disabled={!f.nome || mut.criarAmbiente.isPending} onClick={() => mut.criarAmbiente.mutate({ nome: f.nome, tipoId: f.tipoId || null, capacidade: Number(f.capacidade) || 0, localizacao: f.localizacao || null }, { onSuccess: () => setF({ nome: '', tipoId: '', capacidade: '', localizacao: '' }) })}><Plus size={14} /> Adicionar</Button>
      </Card>

      {ambientes.isLoading ? <Skeleton class="h-32 w-full" /> : (ambientes.data?.ambientes ?? []).length === 0 ? <EmptyState icon={<Building2 size={28} />} title="Nenhum ambiente" description="Cadastre salas e laboratórios." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {(ambientes.data?.ambientes ?? []).map((a) => (
            <div key={a.id} class="px-4 py-3 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0"><span class="block truncate text-fg font-medium">{a.nome}{!a.ativo && <span class="text-xs text-danger ml-1">(inativo)</span>}</span><span class="block text-xs text-fg-muted">{a.tipoNome ? `${a.tipoNome} · ` : ''}cap. {a.capacidade}{a.localizacao ? ` · ${a.localizacao}` : ''} · {a.equipamentos} equip.</span></span>
              <Button size="sm" variant="ghost" onClick={() => mut.atualizarAmbiente.mutate({ id: a.id, ativo: !a.ativo })}>{a.ativo ? 'Inativar' : 'Ativar'}</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function EquipamentosTab() {
  const tipos = useTiposEquip()
  const ambientes = useAmbientes()
  const equip = useEquipamentos()
  const mut = useAlocacaoMut()
  const [nt, setNt] = useState('')
  const [f, setF] = useState({ nome: '', tipoId: '', ambienteId: '', patrimonio: '' })

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Tipos de equipamento</div>
        <div class="flex flex-wrap gap-1 items-center">{(tipos.data?.tipos ?? []).map((t) => <span key={t.id} class="text-xs px-2 py-1 bg-surface-2 rounded">{t.nome}</span>)}</div>
        <div class="flex gap-1"><Input placeholder="Novo tipo (ex: Projetor)" value={nt} onInput={(e: any) => setNt(e.currentTarget.value)} /><Button size="sm" variant="secondary" disabled={!nt} onClick={() => mut.criarTipoEquip.mutate({ nome: nt }, { onSuccess: () => setNt('') })}><Plus size={14} /></Button></div>
      </Card>

      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Novo equipamento</div>
        <div class="grid sm:grid-cols-4 gap-2">
          <Input placeholder="Nome" value={f.nome} onInput={(e: any) => setF({ ...f, nome: e.currentTarget.value })} />
          <Select value={f.tipoId} onChange={(e: any) => setF({ ...f, tipoId: e.currentTarget.value })}><option value="">Tipo…</option>{(tipos.data?.tipos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</Select>
          <Select value={f.ambienteId} onChange={(e: any) => setF({ ...f, ambienteId: e.currentTarget.value })}><option value="">Ambiente…</option>{(ambientes.data?.ambientes ?? []).map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</Select>
          <Input placeholder="Patrimônio" value={f.patrimonio} onInput={(e: any) => setF({ ...f, patrimonio: e.currentTarget.value })} />
        </div>
        <Button size="sm" variant="secondary" disabled={!f.nome || mut.criarEquipamento.isPending} onClick={() => mut.criarEquipamento.mutate({ nome: f.nome, tipoId: f.tipoId || null, ambienteId: f.ambienteId || null, patrimonio: f.patrimonio || null }, { onSuccess: () => setF({ nome: '', tipoId: '', ambienteId: '', patrimonio: '' }) })}><Plus size={14} /> Adicionar</Button>
      </Card>

      {equip.isLoading ? <Skeleton class="h-32 w-full" /> : (equip.data?.equipamentos ?? []).length === 0 ? <EmptyState icon={<Cpu size={28} />} title="Nenhum equipamento" description="Cadastre os equipamentos." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {(equip.data?.equipamentos ?? []).map((e) => (
            <div key={e.id} class="px-4 py-2 flex items-center gap-2 text-sm">
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{e.nome}</span><span class="block text-xs text-fg-muted">{e.tipoNome ? `${e.tipoNome} · ` : ''}{e.ambienteNome ? `em ${e.ambienteNome}` : 'sem ambiente'}{e.patrimonio ? ` · pat. ${e.patrimonio}` : ''}</span></span>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function ReservasTab() {
  const ambientes = useAmbientes()
  const mut = useAlocacaoMut()
  const [ambienteId, setAmbienteId] = useState<number | null>(null)
  const [data, setData] = useState(hojeISO())
  const reservas = useReservas(ambienteId, data)
  const [f, setF] = useState({ horaInicio: '', horaFim: '', finalidade: '', responsavel: '' })
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, setPendente] = useState<any>(null)

  const reservar = async (force = false) => {
    setErro(null)
    if (!ambienteId || !f.horaInicio || !f.horaFim) return
    try {
      await mut.criarReserva.mutateAsync({ ambienteId, data, ...f, force })
      setF({ horaInicio: '', horaFim: '', finalidade: '', responsavel: '' }); setPendente(null)
    } catch (e: any) {
      if ((e?.message || '').includes('Conflito')) { setErro('Conflito de horário com outra reserva.'); setPendente({ ...f }) }
      else setErro(e?.message || 'Falha ao reservar.')
    }
  }

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-3">
        <div class="grid sm:grid-cols-2 gap-2">
          <Select label="Ambiente" value={ambienteId ?? ''} onChange={(e: any) => setAmbienteId(e.currentTarget.value ? Number(e.currentTarget.value) : null)}><option value="">Selecione…</option>{(ambientes.data?.ambientes ?? []).filter((a) => a.ativo).map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</Select>
          <Input label="Data" type="date" value={data} onInput={(e: any) => setData(e.currentTarget.value)} />
        </div>
        {ambienteId && (
          <>
            <div class="grid sm:grid-cols-4 gap-2 items-end">
              <Input label="Início" type="time" value={f.horaInicio} onInput={(e: any) => setF({ ...f, horaInicio: e.currentTarget.value })} />
              <Input label="Fim" type="time" value={f.horaFim} onInput={(e: any) => setF({ ...f, horaFim: e.currentTarget.value })} />
              <Input label="Finalidade" value={f.finalidade} onInput={(e: any) => setF({ ...f, finalidade: e.currentTarget.value })} />
              <Button size="sm" variant="primary" disabled={!f.horaInicio || !f.horaFim || mut.criarReserva.isPending} onClick={() => reservar(false)}><Plus size={14} /> Reservar</Button>
            </div>
            {erro && <div class="text-sm text-danger flex items-center gap-2"><AlertTriangle size={14} /> {erro}{pendente && <Button size="sm" variant="danger" onClick={() => reservar(true)}>Reservar mesmo assim</Button>}</div>}
          </>
        )}
      </Card>

      {ambienteId === null ? <EmptyState icon={<CalendarClock size={26} />} title="Selecione um ambiente" description="Veja e crie reservas por dia." /> :
        reservas.isLoading ? <Skeleton class="h-24 w-full" /> : (reservas.data?.reservas ?? []).length === 0 ? <p class="text-sm text-fg-muted">Nenhuma reserva nesta data.</p> : (
          <Card class="p-0 overflow-hidden divide-y divide-border">
            {(reservas.data?.reservas ?? []).map((r) => (
              <div key={r.id} class="px-4 py-2 flex items-center gap-2 text-sm">
                <Badge tone="accent">{r.horaInicio}–{r.horaFim}</Badge>
                <span class="flex-1">{r.finalidade || 'Reserva'}{r.responsavel ? ` · ${r.responsavel}` : ''}</span>
                <Button size="sm" variant="ghost" onClick={() => mut.cancelarReserva.mutate(r.id)}><Trash2 size={13} /></Button>
              </div>
            ))}
          </Card>
        )}
    </div>
  )
}
