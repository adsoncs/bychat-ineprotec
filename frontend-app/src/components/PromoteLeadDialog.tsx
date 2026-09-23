import { useEffect, useMemo, useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useFunnels, useFunnel } from '@/hooks/useFunnels'
import { useTeams, useTeamMembers } from '@/hooks/useTeams'
import { useUsers } from '@/hooks/useUsers'
import { useQualifyLead, useBulkQualifyLeads, useLead, type BulkQualifyResult } from '@/hooks/useLeads'
import { toast } from '@/lib/toast'
import { Target, Users } from '@/components/ui/icon-set'
import { useUserStore } from '@/stores/user'

type Mode =
  | { kind: 'single'; leadId: number; leadName?: string | null | undefined }
  | { kind: 'bulk'; leadIds: number[] }

interface Props {
  open: boolean
  mode: Mode | null
  onOpenChange: (open: boolean) => void
  onDone?: (result: { qualified: number; alreadyQualified?: number; failed?: number }) => void
}

export function PromoteLeadDialog({ open, mode, onOpenChange, onDone }: Props) {
  const funnelsQ = useFunnels()
  const [funnelId, setFunnelId] = useState<number | null>(null)
  const [stageKey, setStageKey] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<number | null>(null)
  const [userId, setUserId] = useState<number | null>(null)
  // Responsável começa em quem está promovendo (qualquer papel). Se a pessoa
  // trocar ou limpar o campo, a escolha dela vale até fechar a janela.
  const euId = useUserStore((st) => (st.user?.id != null ? Number(st.user.id) : null))
  const [responsavelMexido, setResponsavelMexido] = useState(false)
  const funnelDetailQ = useFunnel(funnelId)
  const teamsQ = useTeams()
  const teamMembersQ = useTeamMembers(teamId)
  const usersQ = useUsers()
  const qualify = useQualifyLead()
  const bulkQualify = useBulkQualifyLeads()
  // Lead que já tinha um funil de antes (resquício do bug do card de funil,
  // ver LeadFunnelCard): mesmo escolhendo "Sem funil" aqui, o backend exige
  // responsável do mesmo jeito — sem isso o botão fica preso num erro sem ter
  // onde preencher o campo. Em lote, exige sempre: não dá pra saber sem
  // buscar cada lead se algum já está nessa situação.
  const leadAtualQ = useLead(mode?.kind === 'single' ? mode.leadId : null)
  const leadJaTemFunil = mode?.kind === 'single' && leadAtualQ.data?.funnelId != null

  // Pré-seleciona o funil padrão quando abre.
  useEffect(() => {
    if (!open) return
    const list = funnelsQ.data?.funnels ?? []
    if (list.length === 0) return
    if (funnelId && list.some((f) => f.id === funnelId)) return
    const def = list.find((f) => f.isDefault && f.active) ?? list.find((f) => f.active) ?? list[0]
    setFunnelId(def?.id ?? null)
  }, [open, funnelsQ.data, funnelId])

  // Pré-seleciona a primeira etapa do funil escolhido.
  useEffect(() => {
    if (!funnelDetailQ.data) return
    const stages = funnelDetailQ.data.stages.filter((s) => s.active)
    if (stages.length === 0) { setStageKey(null); return }
    if (stageKey && stages.some((s) => s.key === stageKey)) return
    setStageKey(stages[0]?.key ?? null)
  }, [funnelDetailQ.data, stageKey])

  // Reset quando fecha.
  useEffect(() => {
    if (!open) {
      setStageKey(null)
      setTeamId(null)
      setUserId(null)
      setResponsavelMexido(false)
    }
  }, [open])

  // Escolher "Sem funil" depois de já ter marcado responsável: limpa, EXCETO
  // quando o lead já tinha um funil de antes — aí o responsável continua
  // obrigatório mesmo com "Sem funil" selecionado (ver `precisaResponsavel`).
  useEffect(() => {
    if (funnelId === null && !leadJaTemFunil) { setTeamId(null); setUserId(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funnelId, leadJaTemFunil])

  // Operador só pode ser quem pertence à equipe escolhida — igual ao
  // TransferModal. Sem equipe, qualquer operador elegível (ativo, não-VIEWER)
  // vale, porque nem todo funil tem um setor dono. Troca de equipe descarta
  // um operador que não é mais válido na lista nova.
  const membrosDaEquipe = teamMembersQ.data?.members ?? []
  const todosElegiveis = (usersQ.data?.users ?? []).filter((u) => u.active && u.role !== 'VIEWER')
  const opcoesResponsavel = teamId !== null
    ? membrosDaEquipe.map((m) => ({ id: m.user.id, label: m.user.name ?? m.user.email, isLeader: m.isLeader }))
    : todosElegiveis.map((u) => ({ id: u.id, label: u.name ?? u.email, isLeader: false }))
  useEffect(() => {
    if (userId !== null && opcoesResponsavel.length > 0 && !opcoesResponsavel.some((o) => o.id === userId)) setUserId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, opcoesResponsavel.length])

  const stages = useMemo(() => (funnelDetailQ.data?.stages ?? []).filter((s) => s.active), [funnelDetailQ.data])
  const noFunnel = funnelId === null
  // Exige responsável quando: vai entrar num funil agora, OU o lead (single)
  // já tinha um de antes, OU é promoção em lote (não dá pra saber sem custo
  // se algum dos leads selecionados já está nessa situação).
  const precisaResponsavel = !noFunnel || leadJaTemFunil || mode?.kind === 'bulk'

  // Pré-seleciona quem está logado, desde que esteja entre as opções (numa
  // equipe da qual ele não faz parte, fica vazio para escolher).
  useEffect(() => {
    if (!open || !precisaResponsavel || responsavelMexido || userId !== null || euId == null) return
    if (opcoesResponsavel.some((o) => o.id === euId)) setUserId(euId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, precisaResponsavel, responsavelMexido, userId, euId, opcoesResponsavel.length, teamId])
  const faltaResponsavel = precisaResponsavel && !userId

  const submitting = qualify.isPending || bulkQualify.isPending
  const count = mode?.kind === 'bulk' ? mode.leadIds.length : 1

  async function handleSubmit() {
    if (!mode) return
    const targeting = {
      ...(!noFunnel && stageKey ? { funnelId: funnelId!, stageKey } : {}),
      ...(precisaResponsavel ? { assignedUserId: userId! } : {}),
      ...(precisaResponsavel && teamId ? { teamId } : {}),
    }

    if (mode.kind === 'single') {
      try {
        const r = await qualify.mutateAsync({ id: mode.leadId, ...targeting })
        if (r.qualified) {
          toast(!noFunnel || leadJaTemFunil ? 'Promovido a Lead e adicionado ao funil' : 'Promovido a Lead', 'success')
          onDone?.({ qualified: 1 })
        } else {
          toast('Lead já estava qualificado', 'info')
        }
        onOpenChange(false)
      } catch (e) {
        toast((e as Error).message, 'danger')
      }
      return
    }

    try {
      const r: BulkQualifyResult = await bulkQualify.mutateAsync({
        leadIds: mode.leadIds,
        ...targeting,
      })
      const parts: string[] = []
      if (r.qualified > 0) parts.push(`${r.qualified} promovido${r.qualified > 1 ? 's' : ''}`)
      if (r.alreadyQualified > 0) parts.push(`${r.alreadyQualified} já estava${r.alreadyQualified > 1 ? 'm' : ''} qualificado${r.alreadyQualified > 1 ? 's' : ''}`)
      if (r.failed > 0) parts.push(`${r.failed} falha${r.failed > 1 ? 's' : ''}`)
      toast(parts.join(' · ') || 'Nenhum lead alterado', r.failed > 0 ? 'warning' : 'success')
      onDone?.({ qualified: r.qualified, alreadyQualified: r.alreadyQualified, failed: r.failed })
      onOpenChange(false)
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  const title = mode?.kind === 'bulk'
    ? `Promover ${mode.leadIds.length} conversa${mode.leadIds.length > 1 ? 's' : ''} a Lead`
    : 'Promover a Lead'
  const description = mode?.kind === 'single' && mode.leadName
    ? `Confirma promover "${mode.leadName}"?`
    : 'Marca o registro como Lead qualificado e (opcional) adiciona a um funil.'

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting || (!noFunnel && !stageKey) || faltaResponsavel}>
            {mode?.kind === 'bulk' ? <><Users size={14} /> Promover {count}</> : <><Target size={14} /> Promover</>}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <div class="rounded-md border border-border bg-surface-3/40 p-3 text-xs text-fg-muted">
          <strong class="text-fg">O que acontece:</strong>
          <ul class="mt-1 list-disc pl-4 space-y-0.5">
            <li>O registro deixa de ser apenas "conversa" e passa a contar em métricas, kanban e relatórios.</li>
            <li>Se você escolher um funil, o lead já entra na etapa selecionada.</li>
            <li>Se preferir só qualificar (sem colocar em funil), escolha "Sem funil" abaixo.</li>
          </ul>
        </div>

        <div>
          <label class="block text-xs font-medium text-fg mb-1">Funil</label>
          {funnelsQ.isLoading ? (
            <Skeleton class="h-9 w-full" />
          ) : (
            <select
              class="w-full h-9 rounded-md border border-border bg-surface-2 px-2 text-sm"
              value={noFunnel ? '__none__' : String(funnelId)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setFunnelId(v === '__none__' ? null : parseInt(v, 10))
                setStageKey(null)
              }}
              disabled={submitting}
            >
              <option value="__none__">Sem funil (apenas qualificar)</option>
              {(funnelsQ.data?.funnels ?? []).filter((f) => f.active).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}{f.isDefault ? ' (padrão)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {!noFunnel && (
          <div>
            <label class="block text-xs font-medium text-fg mb-1">Etapa inicial</label>
            {funnelDetailQ.isLoading ? (
              <Skeleton class="h-9 w-full" />
            ) : stages.length === 0 ? (
              <p class="text-xs text-warning">Este funil não tem etapas ativas. Crie ao menos uma em Configurações &gt; Funis.</p>
            ) : (
              <div class="flex flex-wrap gap-1.5">
                {stages.map((s) => {
                  const active = s.key === stageKey
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setStageKey(s.key)}
                      disabled={submitting}
                      class={`px-2.5 h-7 rounded text-xs border inline-flex items-center gap-1.5 transition-colors ${
                        active
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-surface-2 text-fg-muted hover:bg-surface-3 hover:text-fg'
                      }`}
                    >
                      {s.color && <span class="size-2 rounded-full" style={{ background: s.color }} />}
                      {s.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {precisaResponsavel && (
          <div class="grid grid-cols-2 gap-2">
            {leadJaTemFunil && noFunnel && (
              <p class="col-span-2 text-2xs text-warning">
                Este contato já está num funil (de antes) — escolha um responsável para promovê-lo de verdade.
              </p>
            )}
            <div>
              <label class="block text-xs font-medium text-fg mb-1">Equipe (opcional)</label>
              <select
                class="w-full h-9 rounded-md border border-border bg-surface-2 px-2 text-sm"
                value={teamId === null ? '' : String(teamId)}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  setTeamId(v ? parseInt(v, 10) : null)
                }}
                disabled={submitting}
              >
                <option value="">Sem equipe</option>
                {(teamsQ.data?.teams ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-fg mb-1">Responsável *</label>
              {(teamId !== null && teamMembersQ.isLoading) || (teamId === null && usersQ.isLoading) ? (
                <Skeleton class="h-9 w-full" />
              ) : (
                <select
                  class="w-full h-9 rounded-md border border-border bg-surface-2 px-2 text-sm"
                  value={userId === null ? '' : String(userId)}
                  onChange={(e) => {
                    const v = (e.target as HTMLSelectElement).value
                    setResponsavelMexido(true)
                    setUserId(v ? parseInt(v, 10) : null)
                  }}
                  disabled={submitting}
                >
                  <option value="">Selecione…</option>
                  {opcoesResponsavel.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}{o.isLeader ? ' (líder)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        {mode?.kind === 'bulk' && (
          <p class="text-xs text-fg-muted">
            Conversas selecionadas: <strong class="text-fg">{mode.leadIds.length}</strong>. Já qualificadas serão ignoradas.
          </p>
        )}
      </div>
    </Modal>
  )
}
