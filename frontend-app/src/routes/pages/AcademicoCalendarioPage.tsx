import { useState } from 'preact/hooks'
import { CalendarDays, Plus, Trash2, Pencil } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { usePeriodos } from '@/hooks/useAcaCatalogo'
import { useEventos, useEventoMut, EV_TIPOS, evEmoji, evLabel, type Evento } from '@/hooks/useAcaCalendario'

function mesAno(d: string) { return new Date(d).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) }

export function AcademicoCalendarioPage() {
  const periodos = usePeriodos()
  const [periodoId, setPeriodoId] = useState<number | null>(null)
  const [edit, setEdit] = useState<Partial<Evento> | null>(null)
  const data = useEventos(periodoId)
  const mut = useEventoMut()
  const eventos = data.data?.eventos ?? []

  // agrupa por mês
  const grupos: Record<string, Evento[]> = {}
  for (const e of eventos) { const k = mesAno(e.dataInicio); (grupos[k] ??= []).push(e) }

  return (
    <Page title="Calendário acadêmico" description="Datas letivas, provas, feriados e eventos." actions={
      <div class="flex gap-2 items-center">
        <div class="w-48"><Select value={periodoId ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setPeriodoId(v ? Number(v) : null) }}>
          <option value="">Todos os períodos</option>
          {(periodos.data?.periodos ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
        </Select></div>
        <Button variant="primary" size="sm" onClick={() => setEdit({ tipo: 'EVENTO', diaInteiro: true, periodoLetivoId: periodoId })}><Plus size={14} /> Novo evento</Button>
      </div>
    }>
      {data.isLoading ? <Skeleton class="h-48 w-full" /> : eventos.length === 0 ? (
        <Card class="text-center text-sm text-fg-muted py-10"><CalendarDays size={20} class="inline mr-1" /> Nenhum evento. Crie o primeiro.</Card>
      ) : (
        <div class="space-y-4">
          {Object.entries(grupos).map(([mes, evs]) => (
            <div key={mes}>
              <h2 class="text-xs font-semibold uppercase text-fg-muted mb-1 capitalize">{mes}</h2>
              <Card class="p-0 divide-y divide-border overflow-hidden">
                {evs.map((e) => (
                  <div key={e.id} class="px-4 py-2.5 flex items-center gap-3 hover:bg-surface-2">
                    <div class="text-center w-12 shrink-0">
                      <div class="text-lg font-semibold text-fg leading-none">{new Date(e.dataInicio).getDate()}</div>
                      <div class="text-[10px] text-fg-subtle uppercase">{new Date(e.dataInicio).toLocaleDateString('pt-BR', { weekday: 'short' })}</div>
                    </div>
                    <div class="flex-1">
                      <div class="text-sm text-fg">{evEmoji(e.tipo)} {e.titulo} {e.dataFim && <span class="text-xs text-fg-subtle">até {new Date(e.dataFim).toLocaleDateString('pt-BR')}</span>}</div>
                      {e.descricao && <div class="text-xs text-fg-muted">{e.descricao}</div>}
                      <div class="text-[11px] text-fg-subtle">{evLabel(e.tipo)}{e.periodoLetivoId ? '' : ' · global'}</div>
                    </div>
                    <button class="text-fg-muted hover:text-accent" onClick={() => setEdit(e)}><Pencil size={14} /></button>
                    <button class="text-fg-muted hover:text-danger" onClick={() => mut.excluir.mutate(e.id)}><Trash2 size={14} /></button>
                  </div>
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? 'Editar evento' : 'Novo evento'} size="md">
        {edit && <EventoForm ev={edit} periodos={periodos.data?.periodos ?? []} onClose={() => setEdit(null)} onSave={(b) => {
          if (edit.id) mut.atualizar.mutate({ id: edit.id, ...b }, { onSuccess: () => setEdit(null) })
          else mut.criar.mutate(b, { onSuccess: () => setEdit(null) })
        }} saving={mut.criar.isPending || mut.atualizar.isPending} />}
      </Modal>
    </Page>
  )
}

function EventoForm({ ev, periodos, onClose, onSave, saving }: { ev: Partial<Evento>; periodos: Array<{ id: number; codigo: string }>; onClose: () => void; onSave: (b: Partial<Evento>) => void; saving: boolean }) {
  const [f, setF] = useState<Partial<Evento>>({ ...ev })
  const set = (p: Partial<Evento>) => setF({ ...f, ...p })
  const dia = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '')
  return (
    <div class="space-y-3">
      <Input label="Título" value={f.titulo ?? ''} onInput={(e) => set({ titulo: (e.target as HTMLInputElement).value })} />
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1">Tipo</label>
          <Select value={f.tipo ?? 'EVENTO'} onChange={(e) => set({ tipo: (e.target as HTMLSelectElement).value })}>
            {EV_TIPOS.map((t) => <option key={t.key} value={t.key}>{t.emoji} {t.label}</option>)}
          </Select>
        </div>
        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1">Período</label>
          <Select value={f.periodoLetivoId ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; set({ periodoLetivoId: v ? Number(v) : null }) }}>
            <option value="">Global (instituição)</option>
            {periodos.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
          </Select>
        </div>
        <Input label="Data início" type="date" value={dia(f.dataInicio)} onInput={(e) => set({ dataInicio: (e.target as HTMLInputElement).value })} />
        <Input label="Data fim (opcional)" type="date" value={dia(f.dataFim)} onInput={(e) => set({ dataFim: (e.target as HTMLInputElement).value || null })} />
      </div>
      <Textarea rows={2} value={f.descricao ?? ''} onInput={(e) => set({ descricao: (e.target as HTMLTextAreaElement).value })} placeholder="Descrição (opcional)" />
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" size="sm" disabled={!f.titulo || !f.dataInicio || saving} onClick={() => onSave(f)}>Salvar</Button>
      </div>
    </div>
  )
}
