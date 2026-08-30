import { useMemo, useState } from 'preact/hooks'
import { FileSpreadsheet, FileText, FileCode, FileType, Loader2 } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { useModuleAccess } from '@/hooks/usePermissions'
import { useLeadExportSections, exportLeads, type ExportFormat, type ExportSection } from '@/hooks/useLeadExport'

const FORMATS: { id: ExportFormat; label: string; hint: string; icon: any }[] = [
  { id: 'xlsx', label: 'Excel', hint: 'Uma aba por tipo de dado', icon: FileSpreadsheet },
  { id: 'csv', label: 'CSV', hint: 'Tabela única (Excel/Sheets)', icon: FileText },
  { id: 'pdf', label: 'PDF', hint: 'Dossiê visual por lead', icon: FileType },
  { id: 'html', label: 'HTML', hint: 'Dossiê para abrir no navegador', icon: FileCode },
]

export function LeadExportModal({
  leadIds, open, onClose,
}: { leadIds: number[]; open: boolean; onClose: () => void }) {
  const { data, isLoading } = useLeadExportSections()
  const negAccess = useModuleAccess('negotiations')
  const meetAccess = useModuleAccess('meetings')

  // Filtra seções gated pelos módulos não liberados (espelha as abas do lead).
  const sections = useMemo<ExportSection[]>(() => {
    const all = data?.sections ?? []
    return all.filter(s => {
      if (s.module === 'negotiations') return negAccess.status === 'allowed'
      if (s.module === 'meetings') return meetAccess.status === 'allowed'
      return true
    })
  }, [data, negAccess.status, meetAccess.status])

  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [busy, setBusy] = useState(false)

  // Seleção efetiva: null = "tudo" (default). Recalcula ao abrir/carregar seções.
  const selected = picked ?? new Set(sections.map(s => s.id))
  const allOn = sections.length > 0 && sections.every(s => selected.has(s.id))

  function toggle(id: string) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setPicked(next)
  }
  function toggleAll() {
    setPicked(allOn ? new Set() : new Set(sections.map(s => s.id)))
  }

  async function run() {
    if (selected.size === 0) { toast('Selecione ao menos uma seção', 'danger'); return }
    setBusy(true)
    try {
      await exportLeads({ leadIds, sections: Array.from(selected), format })
      toast('Exportação gerada', 'success')
      onClose()
    } catch (e: any) {
      toast(e?.message || 'Falha ao exportar', 'danger')
    } finally {
      setBusy(false)
    }
  }

  const countLabel = leadIds.length === 1 ? '1 lead' : `${leadIds.length} leads`

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o && !busy) onClose() }}
      title="Exportar dados do lead"
      description={`${countLabel} · escolha os dados e o formato`}
      size="lg"
      footer={
        <div class="flex justify-between items-center w-full gap-2">
          <span class="text-xs text-fg-muted">{selected.size} seção(ões) selecionada(s)</span>
          <div class="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button onClick={run} disabled={busy || selected.size === 0}>
              {busy ? <><Loader2 size={14} class="animate-spin" /> Gerando…</> : <>Exportar {format.toUpperCase()}</>}
            </Button>
          </div>
        </div>
      }
    >
      <div class="space-y-4">
        {/* Formato */}
        <div>
          <div class="text-sm font-medium text-fg mb-2">Formato</div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FORMATS.map(f => {
              const Icon = f.icon
              const on = format === f.id
              return (
                <button
                  type="button"
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  class={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-surface-2'}`}
                >
                  <Icon size={18} class={on ? 'text-primary' : 'text-fg-muted'} />
                  <span class="text-sm font-medium text-fg">{f.label}</span>
                  <span class="text-2xs text-fg-muted leading-tight">{f.hint}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Seções de dados */}
        <div>
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm font-medium text-fg">Dados a exportar</div>
            <button type="button" onClick={toggleAll} class="text-xs text-primary hover:underline">
              {allOn ? 'Desmarcar todos' : 'Marcar todos'}
            </button>
          </div>
          {isLoading ? (
            <div class="text-sm text-fg-muted py-6 text-center">Carregando seções…</div>
          ) : (
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 max-h-[46vh] overflow-y-auto pr-1">
              {sections.map(s => (
                <label key={s.id} class="flex items-center gap-2 py-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    class="h-4 w-4 rounded border-border accent-[var(--color-primary)]"
                  />
                  <span class="text-sm text-fg">{s.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
