import { useEffect, useRef, useState } from 'preact/hooks'
import { Trophy, XCircle, RotateCcw, Settings as SettingsIcon } from '@/components/ui/icon-set'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useAuth } from '@/hooks/useAuth'
import { useModuleAccess } from '@/hooks/usePermissions'
import { useNegotiations, type Negotiation } from '@/hooks/useNegotiations'
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
            class="text-2xs text-fg-muted whitespace-nowrap"
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

/** "R$ 3.000,00" — o mesmo formato que a aba Negociação mostra. */
function formatarReais(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

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
  // Data do ganho (yyyy-mm-dd). Vazio = hoje, decidido no backend.
  const [dataGanho, setDataGanho] = useState<string>('')
  // Proposta escolhida: id da negociação, ou 0 para "nenhuma agora".
  const [negId, setNegId] = useState<number | null>(null)
  // O valor só é preenchido sozinho enquanto o operador não digitou nada: a
  // proposta sugere, quem fecha decide.
  const valorTocado = useRef(false)
  // Valor e observação ficam recolhidos: nem todo ganho é venda — em muitos
  // nichos o desfecho é só o desfecho —, e quando há proposta o valor já vem
  // dela. Quem precisa dos dois abre em um clique.
  const [maisOpcoes, setMaisOpcoes] = useState(false)

  // Propostas em aberto do lead. Só com o módulo Negociações ligado — sem ele a
  // rota responde 403 e a seção nem existe.
  const moduloNegociacoes = useModuleAccess('negotiations').status === 'allowed'
  const negQ = useNegotiations(leadId ?? 0, { enabled: open && moduloNegociacoes && !!leadId && !(ids && ids.length > 0) })
  const abertas: Negotiation[] = (negQ.data?.negotiations ?? []).filter((n) => !n.resultado)
  const precisaEscolher = abertas.length > 0 && negId === null

  // Uma proposta só: já vem marcada — não há o que escolher, e o operador
  // ainda pode trocar para "nenhuma".
  useEffect(() => {
    if (!open) return
    if (abertas.length === 1 && negId === null) setNegId(abertas[0]!.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, abertas.length])

  // Fechou o modal: tudo volta ao estado inicial (o componente não desmonta).
  useEffect(() => {
    if (open) return
    setValue(''); setNote(''); setDataGanho(''); setNegId(null); setMaisOpcoes(false)
    valorTocado.current = false
  }, [open])

  function escolherProposta(n: Negotiation | null) {
    setNegId(n ? n.id : 0)
    if (!valorTocado.current) {
      const v = n && n.valorFinal != null ? Number(n.valorFinal) : null
      setValue(v != null && Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '')
    }
  }

  const hojeISO = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  // Valor que será gravado sem ninguém digitar: o da proposta escolhida.
  const propostaEscolhida = negId ? abertas.find((n) => n.id === negId) ?? null : null
  const valorDaProposta = propostaEscolhida?.valorFinal != null && Number.isFinite(Number(propostaEscolhida.valorFinal))
    ? Number(propostaEscolhida.valorFinal)
    : null

  /** yyyy-mm-dd → ISO. Dia de hoje usa a hora corrente; dia passado, meio-dia
   *  local — assim a data não escorrega para a véspera por fuso horário. */
  function isoDoGanho(): string | null | 'invalida' {
    if (!dataGanho) return null
    const [a, m, d] = dataGanho.split('-').map((n) => parseInt(n, 10))
    if (!a || !m || !d) return 'invalida'
    const agora = new Date()
    const ehHoje = a === agora.getFullYear() && m === agora.getMonth() + 1 && d === agora.getDate()
    const dt = ehHoje ? agora : new Date(a, m - 1, d, 12, 0, 0, 0)
    if (Number.isNaN(dt.getTime())) return 'invalida'
    if (dt.getTime() > agora.getTime()) return 'invalida'
    return dt.toISOString()
  }

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

    if (precisaEscolher) {
      toast('Escolha qual proposta foi aceita', 'danger')
      return
    }
    const iso = isoDoGanho()
    if (iso === 'invalida') {
      toast('A data do ganho não pode ser no futuro', 'danger')
      return
    }

    const escolhida = propostaEscolhida
    single.mutate(
      { id: leadId, value: numericValue, note: note.trim() || null, outcomeAt: iso, negotiationId: escolhida?.id ?? null },
      {
        onSuccess: (r) => {
          const partes = ['Lead marcado como Ganho']
          if (escolhida) partes.push(`proposta "${escolhida.titulo}" fechada`)
          if (dataGanho && dataGanho !== hojeISO) partes.push(`em ${dataGanho.split('-').reverse().join('/')}`)
          if (r.cancelledActivities > 0) partes.push(`${r.cancelledActivities} atividade(s) pendente(s) cancelada(s)`)
          toast(partes.join(' · '), 'success')
          setValue(''); setNote(''); setDataGanho(''); setNegId(null); setMaisOpcoes(false)
          valorTocado.current = false
          onClose()
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
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
          <Button variant="success" size="sm" onClick={handleConfirm} disabled={single.isPending || precisaEscolher}>
            <Trophy size={12} /> {single.isPending ? 'Salvando…' : 'Confirmar Ganho'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        {abertas.length > 0 && (
          <div>
            <label class="block text-xs font-medium text-fg mb-1">
              Qual proposta foi aceita? <span class="text-danger">*</span>
            </label>
            <div class="rounded-md border border-border divide-y divide-border">
              {abertas.map((n) => {
                const total = n.valorFinal != null ? Number(n.valorFinal) : null
                const mrr = n.valorRecorrente != null ? Number(n.valorRecorrente) : null
                return (
                  <label key={n.id} class="flex items-start gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-surface-3">
                    <input
                      type="radio"
                      name="proposta-ganha"
                      class="mt-0.5"
                      checked={negId === n.id}
                      onChange={() => escolherProposta(n)}
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block text-fg truncate">{n.titulo}</span>
                      <span class="block text-2xs text-fg-muted">
                        {total != null ? `R$ ${total.toFixed(2).replace('.', ',')}` : 'sem valor'}
                        {mrr && mrr > 0 ? ` · mensalidade R$ ${mrr.toFixed(2).replace('.', ',')}` : ''}
                        {` · ${n.status.replace(/_/g, ' ')}`}
                      </span>
                    </span>
                  </label>
                )
              })}
              <label class="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-surface-3">
                <input
                  type="radio"
                  name="proposta-ganha"
                  checked={negId === 0}
                  onChange={() => escolherProposta(null)}
                />
                <span class="text-fg-muted">Nenhuma — fecho depois na aba Negociação</span>
              </label>
            </div>
            <p class="text-2xs text-fg-muted mt-1">
              A proposta escolhida é marcada como ganha com a mesma data; as outras continuam em aberto.
            </p>
          </div>
        )}
        <div>
          <label class="block text-xs font-medium text-fg mb-1">Data do ganho <span class="text-fg-muted">(opcional)</span></label>
          <Input
            type="date"
            max={hojeISO}
            value={dataGanho}
            onInput={(e) => setDataGanho((e.target as HTMLInputElement).value)}
          />
          <p class="text-2xs text-fg-muted mt-1">
            Em branco, vale hoje. A data escolhida é a que conta nos relatórios, nas metas e na comissão.
          </p>
        </div>
        {!maisOpcoes && valorDaProposta != null && (
          <p class="text-xs text-fg">
            Valor: <span class="font-medium">{formatarReais(valorDaProposta)}</span>
            <span class="text-fg-muted"> — da proposta</span>
          </p>
        )}
        {!maisOpcoes ? (
          <button
            type="button"
            class="text-2xs text-accent hover:underline"
            onClick={() => setMaisOpcoes(true)}
          >
            + Valor e observação
          </button>
        ) : (
          <>
            <div>
              <label class="block text-xs font-medium text-fg mb-1">Valor da venda <span class="text-fg-muted">(opcional)</span></label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="Ex: 1500,00"
                value={value}
                onInput={(e) => { valorTocado.current = true; setValue((e.target as HTMLInputElement).value) }}
              />
              <p class="text-2xs text-fg-muted mt-1">
                Entra como valor da venda do lead e alimenta a receita nos relatórios. Em branco, o ganho é só o desfecho.
              </p>
            </div>
            <div>
              <label class="block text-xs font-medium text-fg mb-1">Observação <span class="text-fg-muted">(opcional)</span></label>
              <textarea
                class="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg resize-y min-h-[60px]"
                placeholder="Ex: Fechou plano Pro 12 meses"
                value={note}
                onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
              />
            </div>
          </>
        )}
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
  leadId?: number | undefined
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
                class="text-2xs text-accent hover:underline inline-flex items-center gap-1"
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
            <p class="text-2xs text-fg-muted mt-1">
              {canManage
                ? <>Nenhuma objeção cadastrada. <a href="/app/settings" target="_blank" rel="noreferrer" class="text-accent hover:underline">Cadastre em Configurações → Objeções</a>.</>
                : <>Nenhuma objeção cadastrada. Peça ao administrador para configurar em <span class="font-mono">Configurações → Objeções</span>.</>}
            </p>
          )}
        </div>
        <div>
          <label class="block text-xs font-medium text-fg mb-1">Observação <span class="text-fg-muted">(opcional)</span></label>
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
