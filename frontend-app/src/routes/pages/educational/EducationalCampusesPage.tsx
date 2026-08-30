import { useState, useMemo } from 'preact/hooks'
import { MapPin, Plus, Pencil, Trash2, Mail, Phone } from '@/components/ui/icon-set'
import {
  useCampuses,
  useCreateCampus,
  useUpdateCampus,
  useDeleteCampus,
  useEducationalUnits,
  type Campus,
  type CampusInput,
} from '@/hooks/useEducational'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EduListHero, EduCountPill } from '@/components/educational/EduListHero'
import { EduSearchBar } from '@/components/educational/EduSearchBar'
import { ApiError } from '@/lib/apiClient'
import { toast } from '@/lib/toast'

const ESTADOS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]

export function EducationalCampusesPage() {
  const { data: campusesData, isLoading } = useCampuses()
  const { data: unitsData, isLoading: loadingUnits } = useEducationalUnits()
  const [editing, setEditing] = useState<Campus | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Campus | null>(null)
  const [search, setSearch] = useState('')

  const campuses = useMemo(() => campusesData?.campuses ?? [], [campusesData])
  const units = unitsData?.units ?? []
  const noUnits = !loadingUnits && units.length === 0

  const totals = useMemo(() => ({
    active: campuses.filter((c) => c.active !== false).length,
    cities: new Set(campuses.map((c) => (c.cidade ?? '').trim()).filter(Boolean)).size,
    offerings: campuses.reduce((a, c) => a + (c._count?.offerings ?? 0), 0),
  }), [campuses])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return campuses
    return campuses.filter((c) =>
      [
        c.nome, c.codigo, c.cidade, c.estado, c.bairro, c.endereco,
        c.unit?.nome, c.email, c.telefone,
      ].some((s) => (s ?? '').toLowerCase().includes(q)),
    )
  }, [campuses, search])

  return (
    <Page
      title="Locais de Oferta (Campus)"
      description="Locais físicos ou polos EAD de cada unidade"
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={noUnits}>
          <Plus size={14} /> Novo campus
        </Button>
      }
    >
      <EduListHero
        icon={<MapPin size={26} />}
        title="Visão geral"
        summary={`${campuses.length} local(is) · ${totals.active} ativo(s)`}
        kpis={[
          { value: totals.cities, label: 'Cidades', tone: 'accent' },
          { value: units.length, label: 'Unidades', tone: 'success' },
          { value: totals.offerings, label: 'Ofertas', tone: 'warning' },
        ]}
      />

      {noUnits && (
        <Card>
          <div class="text-sm text-fg-muted">
            Cadastre uma <a href="/app/educational/units" class="text-accent hover:underline">unidade</a> antes
            de adicionar um campus.
          </div>
        </Card>
      )}

      {isLoading && (
        <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-20 w-full" />)}
        </div>
      )}

      {!isLoading && !noUnits && campuses.length === 0 && (
        <EmptyState
          icon={<MapPin size={24} />}
          title="Nenhum local de oferta cadastrado"
          description="Crie o primeiro local de oferta para vincular às ofertas de curso"
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Novo campus
            </Button>
          }
        />
      )}

      {!isLoading && campuses.length > 0 && (
        <>
          <EduSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, código, cidade, endereço..."
            total={campuses.length}
            filteredCount={filtered.length}
            itemNoun="local(is)"
          />

          {filtered.length === 0 ? (
            <Card>
              <div class="text-xs text-fg-muted italic text-center py-8">
                Nenhum resultado para "{search}"
              </div>
            </Card>
          ) : (
            <div class="grid gap-2 grid-cols-1 lg:grid-cols-2">
              {filtered.map((c) => (
                <Card key={c.id}>
                  <div class="flex items-start gap-3">
                    <span class="size-10 rounded-md bg-accent/15 text-accent grid place-items-center shrink-0">
                      <MapPin size={16} />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-medium text-fg truncate">{c.nome}</span>
                        {c.codigo && (
                          <code class="bg-surface-3 px-1.5 py-0.5 rounded text-3xs text-fg-muted font-mono">
                            {c.codigo}
                          </code>
                        )}
                        <span
                          class={
                            'text-3xs font-semibold px-2 py-0.5 rounded-full tabular-nums ' +
                            (c.active !== false
                              ? 'bg-accent text-fg-on-brand'
                              : 'bg-surface-3 text-fg-muted')
                          }
                        >
                          {c.active !== false ? '● Ativo' : '○ Inativo'}
                        </span>
                      </div>
                      {c.unit && (
                        <div class="text-xs text-fg-muted mt-0.5">{c.unit.nome}</div>
                      )}
                      <CampusAddress c={c} />
                      <CampusContacts c={c} />
                      {c._count && (
                        <div class="mt-2">
                          <EduCountPill label="Ofertas" n={c._count.offerings} />
                        </div>
                      )}
                    </div>
                    <div class="flex gap-0.5 shrink-0">
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-accent bg-accent/10 hover:bg-accent/20"
                        onClick={() => setEditing(c)}
                        aria-label="Editar"
                        title="Editar"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-danger bg-danger/10 hover:bg-danger/20"
                        onClick={() => setDeleting(c)}
                        aria-label="Excluir"
                        title="Excluir"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {(creating || editing) && (
        <CampusFormModal
          campus={editing}
          units={units}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteCampusDialog
          campus={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  )
}

function CampusAddress({ c }: { c: Campus }) {
  const parts: string[] = []
  if (c.endereco) parts.push(c.numero ? `${c.endereco}, ${c.numero}` : c.endereco)
  if (c.bairro) parts.push(c.bairro)
  if (c.cidade && c.estado) parts.push(`${c.cidade}/${c.estado}`)
  else if (c.cidade) parts.push(c.cidade)
  if (c.cep) parts.push(`CEP ${c.cep}`)
  if (parts.length === 0) return null
  return <div class="text-xs text-fg-muted truncate mt-0.5">{parts.join(' · ')}</div>
}

function CampusContacts({ c }: { c: Campus }) {
  if (!c.telefone && !c.email) return null
  return (
    <div class="flex flex-wrap items-center gap-3 text-xs text-fg-muted mt-1">
      {c.telefone && (
        <span class="inline-flex items-center gap-1">
          <Phone size={11} /> {c.telefone}
        </span>
      )}
      {c.email && (
        <span class="inline-flex items-center gap-1">
          <Mail size={11} /> {c.email}
        </span>
      )}
    </div>
  )
}

function CampusFormModal({
  campus, units, onClose,
}: {
  campus: Campus | null
  units: { id: number; nome: string }[]
  onClose: () => void
}) {
  const isEdit = !!campus
  const initialUnitId = useMemo(() => {
    if (campus) return campus.unitId
    return units[0]?.id ?? 0
  }, [campus, units])

  const [unitId, setUnitId] = useState(initialUnitId)
  const [nome, setNome] = useState(campus?.nome ?? '')
  const [codigo, setCodigo] = useState(campus?.codigo ?? '')
  const [descricao, setDescricao] = useState(campus?.descricao ?? '')
  const [telefone, setTelefone] = useState(campus?.telefone ?? '')
  const [email, setEmail] = useState(campus?.email ?? '')
  const [endereco, setEndereco] = useState(campus?.endereco ?? '')
  const [numero, setNumero] = useState(campus?.numero ?? '')
  const [bairro, setBairro] = useState(campus?.bairro ?? '')
  const [cep, setCep] = useState(campus?.cep ?? '')
  const [cidade, setCidade] = useState(campus?.cidade ?? '')
  const [estado, setEstado] = useState(campus?.estado ?? '')
  const [active, setActive] = useState(campus?.active ?? true)
  const create = useCreateCampus()
  const update = useUpdateCampus()
  const loading = create.isPending || update.isPending

  function handleSubmit() {
    if (!nome.trim()) { toast('Nome é obrigatório', 'danger'); return }
    if (!unitId) { toast('Selecione uma unidade', 'danger'); return }
    const payload: CampusInput = {
      unitId,
      nome: nome.trim(),
      codigo: codigo.trim() || null,
      descricao: descricao.trim() || null,
      telefone: telefone.trim() || null,
      email: email.trim() || null,
      endereco: endereco.trim() || null,
      numero: numero.trim() || null,
      bairro: bairro.trim() || null,
      cep: cep.trim() || null,
      cidade: cidade.trim() || null,
      estado: estado.trim() || null,
      active,
    }
    if (isEdit) {
      update.mutate({ id: campus.id, ...payload }, {
        onSuccess: () => { toast('Campus atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Campus criado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar Campus' : 'Novo Campus'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Nome *"
          value={nome}
          onInput={(e) => setNome((e.target as HTMLInputElement).value)}
          placeholder="Ex: Campus Centro"
        />
        <Select
          label="Unidade *"
          value={String(unitId)}
          onChange={(e) => setUnitId(Number((e.target as HTMLSelectElement).value))}
        >
          <option value="">— Selecione —</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Código"
            value={codigo ?? ''}
            onInput={(e) => setCodigo((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Telefone"
            value={telefone ?? ''}
            onInput={(e) => setTelefone((e.target as HTMLInputElement).value)}
          />
        </div>
        <Input
          label="E-mail"
          type="email"
          value={email ?? ''}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        />
        <div class="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-3">
          <Input
            label="Endereço"
            value={endereco ?? ''}
            onInput={(e) => setEndereco((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Número"
            value={numero ?? ''}
            onInput={(e) => setNumero((e.target as HTMLInputElement).value)}
          />
          <Input
            label="CEP"
            value={cep ?? ''}
            onInput={(e) => setCep((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-3">
          <Input
            label="Bairro"
            value={bairro ?? ''}
            onInput={(e) => setBairro((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Cidade"
            value={cidade ?? ''}
            onInput={(e) => setCidade((e.target as HTMLInputElement).value)}
          />
          <Select
            label="UF"
            value={estado ?? ''}
            onChange={(e) => setEstado((e.target as HTMLSelectElement).value)}
          >
            <option value="">—</option>
            {ESTADOS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </Select>
        </div>
        <Textarea
          label="Descrição"
          value={descricao ?? ''}
          rows={2}
          onInput={(e) => setDescricao((e.target as HTMLTextAreaElement).value)}
        />
        <label class="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
          Ativo
        </label>
      </div>
    </Modal>
  )
}

function DeleteCampusDialog({ campus, onClose }: { campus: Campus; onClose: () => void }) {
  const del = useDeleteCampus()
  const offerings = campus._count?.offerings ?? 0
  const hasDeps = offerings > 0

  if (hasDeps) {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Não é possível excluir "${campus.nome}"`}
        size="sm"
        footer={<Button variant="primary" size="sm" onClick={onClose}>Entendi</Button>}
      >
        <div class="space-y-3">
          <p class="text-xs text-fg-muted">
            Existem ofertas vinculadas a este campus. Mova-as ou desative-as primeiro,
            ou apenas <strong>desative o campus</strong> para mantê-lo no histórico.
          </p>
          <ul class="space-y-1.5">
            <li class="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-surface border border-border">
              <span class="text-fg">Ofertas</span>
              <span class="text-fg-muted tabular-nums">{offerings.toLocaleString('pt-BR')}</span>
            </li>
          </ul>
        </div>
      </Modal>
    )
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${campus.nome}"`}
      description="O campus vai para a lixeira e pode ser restaurado em até 90 dias."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => {
        del.mutate(campus.id, {
          onSuccess: () => { toast('Campus movido para a lixeira', 'success'); onClose() },
          onError: (e: unknown) => {
            if (e instanceof ApiError && (e.payload as { dependencies?: unknown })?.dependencies) {
              toast('Há dependências bloqueando a exclusão', 'danger')
            } else {
              toast((e as Error).message, 'danger')
            }
          },
        })
      }}
    />
  )
}
