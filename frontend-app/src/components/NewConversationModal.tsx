import { useState } from 'preact/hooks'
import { MessageSquarePlus, AlertTriangle } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { nomeDoCanal } from '@/lib/channelColors'
import { api } from '@/lib/apiClient'
import { useSenderChannels } from '@/hooks/useChat'
import { mascaraTelefone } from '@/lib/telefone'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Abre a conversa criada/encontrada. */
  onAberta: (leadId: number) => void
}

export function NewConversationModal({ open, onOpenChange, onAberta }: Props) {
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [canal, setCanal] = useState('')
  const [salvando, setSalvando] = useState(false)
  // Sem lead ainda: pede os canais gerais, sem trava de conversa.
  const { data: sc } = useSenderChannels(null, false)
  const canais = sc?.channels ?? []

  async function criar(ignorarChecagem = false) {
    // O "+" vai junto de propósito: é ele que diz ao servidor que o país foi
    // declarado por quem digitou. Sem ele, "+1 689 206-4057" chegaria como
    // 11 dígitos soltos e teria de ser adivinhado.
    const internacional = telefone.trim().startsWith('+')
    const digitos = telefone.replace(/\D/g, '')
    const valor = internacional ? '+' + digitos : digitos
    if (internacional ? digitos.length < 8 : digitos.length < 10) {
      toast(internacional ? 'Informe o número internacional completo' : 'Informe o número com DDD', 'warning')
      return
    }
    setSalvando(true)
    try {
      const r = await api.post<{ leadId: number; criado: boolean; jaTinhaConversa: boolean }>(
        '/atendimento/conversations',
        { nome: nome.trim(), telefone: valor, channelId: canal || undefined, ignorarChecagem },
      )
      toast(
        r.criado ? 'Conversa criada' : r.jaTinhaConversa ? 'Este contato já tinha conversa — abrindo' : 'Contato já existia — conversa aberta',
        'success',
      )
      onAberta(r.leadId)
      onOpenChange(false)
      setNome(''); setTelefone(''); setCanal('')
    } catch (e) {
      const msg = (e as Error).message || ''
      // Número sem WhatsApp: o operador pode saber de um caso legítimo (número
      // internacional, portabilidade recente) — oferece seguir mesmo assim.
      if (msg.includes('não tem WhatsApp')) {
        toast(msg, 'danger')
      } else {
        toast(msg, 'danger')
      }
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Nova conversa"
      description="Abre uma conversa com um número que ainda não está no painel."
      size="md"
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="primary" size="md" onClick={() => criar()} disabled={salvando}>
            <MessageSquarePlus size={14} />
            {salvando ? 'Abrindo…' : 'Abrir conversa'}
          </Button>
        </div>
      }
    >
      <div class="space-y-3">
        <Input
          label="Nome"
          value={nome}
          placeholder="Como o contato será identificado"
          onInput={(e) => setNome((e.target as HTMLInputElement).value)}
        />
        <Input
          label="WhatsApp *"
          value={telefone}
          placeholder="(62) 99999-9999 · de fora, comece com +"
          onInput={(e) => setTelefone(mascaraTelefone((e.target as HTMLInputElement).value))}
        />

        {canais.length > 1 && (
          <div>
            <label class="mb-1 block text-sm font-medium">Enviar pelo número</label>
            <Select value={canal} onChange={(e) => setCanal((e.target as HTMLSelectElement).value)}>
                <option value="">Escolher na hora de enviar</option>
                {canais.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nomeDoCanal(c)}{c.number && nomeDoCanal(c) !== c.number ? ` — ${c.number}` : ''}
                  </option>
                ))}
            </Select>
          </div>
        )}

        <div class="flex gap-2 rounded-md border border-border bg-surface-2 p-3 text-xs text-fg-muted">
          <AlertTriangle size={14} class="mt-0.5 shrink-0" />
          <span>
            Se este número já estiver no sistema, abrimos a conversa existente em vez de criar um
            contato repetido. O número é conferido no WhatsApp antes de abrir.
          </span>
        </div>
      </div>
    </Modal>
  )
}
