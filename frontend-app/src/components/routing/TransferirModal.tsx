// Janela única de transferência (Leads, Conversas e Contatos): transfere na
// hora pela rota /assign, que confere as permissões de Configurações › Equipes.
import { useEffect, useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Select, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { useDestinos } from '@/hooks/useDestinos'
import { useAssignTicket } from '@/hooks/useChat'
import { TransferenciaFunil, type EscolhaFunil } from '@/components/routing/TransferenciaFunil'

export function TransferirModal({
  leadId, currentTeamId, currentUserId, onClose,
}: {
  leadId: number
  currentTeamId: number | null
  currentUserId: number | null
  onClose: () => void
}) {
  // Lista do dia a dia (ver hooks/useDestinos): as de administração voltavam
  // 403 para o agente, e a janela só oferecia "fila geral" — e transferia
  // para lá sem querer.
  const destinosQ = useDestinos()
  const [teamId, setTeamId] = useState<number | ''>(currentTeamId ?? '')
  const [userId, setUserId] = useState<number | ''>(currentUserId ?? '')
  const [reason, setReason] = useState('')
  const [funil, setFunil] = useState<EscolhaFunil>({ acao: 'manter', funnelId: null, stageKey: null })

  const assign = useAssignTicket()
  const teams = destinosQ.data?.equipes ?? []
  const equipe = typeof teamId === 'number' ? teams.find((t) => t.id === teamId) : undefined
  const members = equipe?.members ?? []
  const semDestinos = destinosQ.isLoading || destinosQ.isError

  // Quando muda team, limpa user se ele não pertence à nova team.
  useEffect(() => {
    if (typeof userId === 'number' && members.length > 0) {
      const stillMember = members.some((m) => m.id === userId)
      if (!stillMember) setUserId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, members.length])

  function handleSubmit() {
    if (funil.acao !== 'manter' && !funil.funnelId) {
      toast('Escolha o funil de destino', 'danger')
      return
    }
    assign.mutate({
      leadId,
      teamId: teamId === '' ? null : teamId,
      userId: userId === '' ? null : userId,
      reason: reason.trim() || undefined,
      ...(funil.acao !== 'manter' && funil.funnelId
        ? { funilAcao: funil.acao, funnelId: funil.funnelId, ...(funil.stageKey ? { stageKey: funil.stageKey } : {}) }
        : {}),
    }, {
      onSuccess: (r) => {
        if (r.funil?.erro) toast(`Lead transferido, mas o funil não foi alterado: ${r.funil.erro}`, 'warning', 6000)
        else toast(funil.acao === 'mover' ? 'Lead transferido e movido de funil'
          : funil.acao === 'acompanhar' ? 'Lead transferido e aberto também no outro funil'
            : 'Lead transferido', 'success')
        onClose()
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Transferir lead"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={assign.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={assign.isPending || semDestinos}>
            {assign.isPending ? 'Transferindo…' : 'Transferir'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        {destinosQ.isError && (
          <p class="text-sm text-danger">Não foi possível carregar os destinos. Peça a um gestor para transferir esta conversa.</p>
        )}
        <Select
          label="Equipe destino"
          value={teamId === '' ? '' : String(teamId)}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            setTeamId(v ? Number(v) : '')
          }}
        >
          <option value="">Sem equipe (fila geral)</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.minha ? ' (sua equipe)' : ''}</option>)}
        </Select>
        <Select
          label="Operador destino"
          value={userId === '' ? '' : String(userId)}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            setUserId(v ? Number(v) : '')
          }}
          disabled={typeof teamId !== 'number' || !equipe?.membrosVisiveis}
          hint={typeof teamId !== 'number'
            ? 'Selecione uma equipe primeiro'
            : equipe && !equipe.membrosVisiveis
              ? 'A conversa vai para a fila desta equipe — quem é dela assume.'
              : 'Operador deve pertencer à equipe'}
        >
          <option value="">Deixar em fila (sem operador específico)</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}{m.isLeader ? ' (líder)' : ''}
            </option>
          ))}
        </Select>
        <TransferenciaFunil leadId={leadId} valor={funil} onChange={setFunil} />
        <Textarea
          label="Motivo (opcional, fica no histórico)"
          value={reason}
          onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
          rows={2}
        />
      </div>
    </Modal>
  )
}
