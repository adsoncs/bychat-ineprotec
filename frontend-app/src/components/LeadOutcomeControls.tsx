import { useState } from 'preact/hooks'
import { Trophy, XCircle, RotateCcw, Settings as SettingsIcon } from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useAuth } from '@/hooks/useAuth'
import {
  useMarkLeadWon,
  useMarkLeadLost,
  useReopenLead,
  useLossReasons,
} from '@/hooks/useLeadOutcome'

interface Props {
  leadId: number
  outcome: 'won' | 'lost' | null | undefined
  outcomeAt?: string | null | undefined
  /** Quem classificou o desfecho (GET /leads/:id) */
  outcomeByUser?: { id: number; name: string | null } | null | undefined
  outcomeNote?: string | null | undefined
  lostReason?: { id: number; name: string; color: string | null } | null | undefined
  size?: 'sm' | 'md'
  /** Esconde botões quando lead já tem outcome (só mostra "Reabrir") */
  compact?: boolean
}

/** "16/07/2026 às 19:20" — data em que o negócio foi encerrado (Lead.outcomeAt). */
function fmtOutcomeMoment(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

export function LeadOutcomeControls({
  leadId, outcome, outcomeAt, outcomeByUser, outcomeNote, lostReason, size = 'sm',
}: Props) {
  const [wonOpen, setWonOpen] = useState(false)
  const [lostOpen, setLostOpen] = useState(false)
  const reopen = useReopenLead()

  if (outcome === 'won' || outcome === 'lost') {
    const closedAt = outcomeAt ? fmtOutcomeMoment(outcomeAt) : null
    const closedBy = outcomeByUser?.name?.trim() || null
    return (
      <div class="inline-flex items-center gap-2">
        <OutcomeBadge outcome={outcome} lostReason={lostReason} note={outcomeNote} />
        {closedAt && (
          <span
            class="text-[0.6875rem] text-fg-subtle whitespace-nowrap"
            title={`Data em que o negócio foi encerrado — é ela que define o período nos relatórios${closedBy ? ` · classificado por ${closedBy}` : ''}`}
          >
            em {closedAt}{closedBy ? <> · por {closedBy}</> : null}
          </span>
        )}
        <Button
          variant="ghost"
          size={size}
          onClick={() => {
            if (!confirm('Reabrir lead? O outcome será removido. Cadências NÃO serão retomadas automaticamente — você precisa enrollar manualmente se quiser.')) return
            reopen.mutate(leadId, {
              onSuccess: () => toast('Lead reaberto', 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })
          }}
          disabled={reopen.isPending}
        >
          <RotateCcw size={12} /> {reopen.isPending ? 'Reabrindo…' : 'Reabrir'}
        </Button>
      </div>
    )
  }

  return (
    <div class="inline-flex items-center gap-2">
      <Button variant="success" size={size} onClick={() => setWonOpen(true)}>
        <Trophy size={12} /> Ganho
      </Button>
      <Button variant="danger" size={size} onClick={() => setLostOpen(true)}>
        <XCircle size={12} /> Perdido
      </Button>
      <MarkWonModal open={wonOpen} onClose={() => setWonOpen(false)} leadId={leadId} />
      <MarkLostModal open={lostOpen} onClose={() => setLostOpen(false)} leadId={leadId} />
    </div>
  )
}

// ── Badge de outcome ─────────────────────────────────────

export function OutcomeBadge({
  outcome,
  lostReason,
  note,
}: {
  outcome: 'won' | 'lost' | null | undefined
  lostReason?: { id: number; name: string; color: string | null } | null | undefined
  note?: string | null | undefined
}) {
  if (outcome === 'won') {
    return (
      <span
        class="inline-flex items-center gap-1 px-2 h-5 rounded-md text-xs font-medium"
        style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'rgb(16, 185, 129)', border: '1px solid rgba(16, 185, 129, 0.4)' }}
        title={note || 'Lead marcado como Ganho'}
      >
        <Trophy size={10} /> Ganho
      </span>
    )
  }
  if (outcome === 'lost') {
    const label = lostReason?.name ? `Perdido · ${lostReason.name}` : 'Perdido'
    return (
      <span
        class="inline-flex items-center gap-1 px-2 h-5 rounded-md text-xs font-medium"
        style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'rgb(239, 68, 68)', border: '1px solid rgba(239, 68, 68, 0.4)' }}
        title={note || label}
      >
        <XCircle size={10} /> {label}
      </span>
    )
  }
  return null
}

// ── Modal: Marcar Ganho ──────────────────────────────────

export function MarkWonModal({
  open, onClose, leadId, ids,
}: {
  open: boolean
  onClose: () => void
  leadId?: number
  /** Modo bulk: passe ids[]; se ambos forem passados, ids prevalece */
  ids?: number[]
}) {
  const single = useMarkLeadWon()
  const [value, setValue] = useState<string>('')
  const [note, setNote] = useState<string>('')

  function handleConfirm() {
    const numericValue = value.trim() ? Number(value.replace(/\./g, '').replace(',', '.')) : null
    if (value.trim() && (numericValue == null || !Number.isFinite(numericValue) || numericValue < 0)) {
      toast('Valor inválido', 'danger')
      return
    }

    if (ids && ids.length > 0) {
      // Bulk handled by parent — neste componente single suficiente
      toast('Use BulkOutcomeBar para massa', 'danger')
      return
    }
    if (!leadId) return

    single.mutate({ id: leadId, value: numericValue, note: note.trim() || null }, {
      onSuccess: (r) => {
        toast(
          `Lead marcado como Ganho${r.cancelledActivities > 0 ? ` · ${r.cancelledActivities} atividade(s) pendente(s) cancelada(s)` : ''}`,
          'success',
        )
        setValue(''); setNote(''); onClose()
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Marcar como Ganho"
      description="Sinaliza ao sistema que o lead converteu. Cadências e atividades pendentes são canceladas."
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="success" size="sm" onClick={handleConfirm} disabled={single.isPending}>
            <Trophy size={12} /> {single.isPending ? 'Salvando…' : 'Confirmar Ganho'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-fg mb-1">Valor da venda <span class="text-fg-subtle">(opcional)</span></label>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="Ex: 1500,00"
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          />
          <p class="text-[0.6875rem] text-fg-subtle mt-1">
            Se informado, atualiza saleValue e marca venda como confirmada (DetectedSale).
          </p>
        </div>
        <div>
          <label class="block text-xs font-medium text-fg mb-1">Observação <span class="text-fg-subtle">(opcional)</span></label>
          <textarea
            class="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg resize-y min-h-[60px]"
            placeholder="Ex: Fechou plano Pro 12 meses"
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
        </div>
      </div>
    </Modal>
  )
}

// ── Modal: Marcar Perdido ────────────────────────────────

export function MarkLostModal({
  open, onClose, leadId,
}: {
  open: boolean
  onClose: () => void
  leadId?: number
}) {
  const { user } = useAuth()
  const canManage = user && (user.role === 'SUPERADMIN' || user.role === 'ADMIN' || user.role === 'MANAGER')
  const single = useMarkLeadLost()
  const reasons = useLossReasons()
  const [reasonId, setReasonId] = useState<number | null>(null)
  const [note, setNote] = useState<string>('')

  function handleConfirm() {
    if (!leadId) return
    single.mutate({ id: leadId, reasonId, note: note.trim() || null }, {
      onSuccess: (r) => {
        toast(
          `Lead marcado como Perdido${r.cancelledActivities > 0 ? ` · ${r.cancelledActivities} atividade(s) cancelada(s)` : ''}`,
          'success',
        )
        setReasonId(null); setNote(''); onClose()
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const items = reasons.data?.data ?? []

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Marcar como Perdido"
      description="Sinaliza ao sistema que o lead disse não ou não tem fit. Cadências e atividades pendentes são canceladas."
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" size="sm" onClick={handleConfirm} disabled={single.isPending}>
            <XCircle size={12} /> {single.isPending ? 'Salvando…' : 'Confirmar Perdido'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="text-xs font-medium text-fg">Objeção</label>
            {canManage && (
              <a
                href="/app/settings"
                target="_blank"
                rel="noreferrer"
                class="text-[0.6875rem] text-accent hover:underline inline-flex items-center gap-1"
                title="Abre Configurações > Objeções em nova aba"
              >
                <SettingsIcon size={10} /> Gerenciar objeções
              </a>
            )}
          </div>
          <select
            class="w-full h-9 rounded-md border border-border bg-surface px-2 text-sm text-fg"
            value={reasonId == null ? '' : String(reasonId)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              setReasonId(v ? parseInt(v) : null)
            }}
          >
            <option value="">Selecione uma objeção…</option>
            {items.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {items.length === 0 && !reasons.isLoading && (
            <p class="text-[0.6875rem] text-fg-subtle mt-1">
              {canManage
                ? <>Nenhuma objeção cadastrada. <a href="/app/settings" target="_blank" rel="noreferrer" class="text-accent hover:underline">Cadastre em Configurações → Objeções</a>.</>
                : <>Nenhuma objeção cadastrada. Peça ao administrador para configurar em <span class="font-mono">Configurações → Objeções</span>.</>}
            </p>
          )}
        </div>
        <div>
          <label class="block text-xs font-medium text-fg mb-1">Observação <span class="text-fg-subtle">(opcional)</span></label>
          <textarea
            class="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg resize-y min-h-[60px]"
            placeholder="Detalhes do que aconteceu"
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
        </div>
      </div>
    </Modal>
  )
}
