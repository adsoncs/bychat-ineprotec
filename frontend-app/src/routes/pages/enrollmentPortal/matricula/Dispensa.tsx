// Dispensar uma etapa ou um documento da inscrição: permissão própria e motivo.
import { useState } from 'preact/hooks'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useCan } from '@/hooks/usePermissions'
import { Ban } from '@/components/ui/icon-set'

export interface DadosDaDispensa { motivo: string; por: string; em: string }

export function invalidarInscricao(qc: ReturnType<typeof useQueryClient>, id: number) {
  void qc.invalidateQueries({ queryKey: ['registration-review', id] })
  void qc.invalidateQueries({ queryKey: ['registration-full', id] })
  void qc.invalidateQueries({ queryKey: ['registration-etapas', id] })
  void qc.invalidateQueries({ queryKey: ['inscricao-historico', id] })
  void qc.invalidateQueries({ queryKey: ['mi-financeiro', id] })
  void qc.invalidateQueries({ queryKey: ['mi-dados', id] })
}

export function BotaoDispensa({ registrationId, tipo, chave, nome, dispensa, aviso }: {
  registrationId: number
  tipo: 'etapa' | 'documento'
  chave: string
  nome: string
  dispensa?: DadosDaDispensa | null | undefined
  aviso?: string | undefined
}) {
  const pode = useCan('edu_dispensa_etapas', 'edit')
  const qc = useQueryClient()
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const salvar = useMutation({
    mutationFn: () => api.post(`/admin/matricula-interna/${registrationId}/dispensa`, { tipo, chave, motivo }),
    onSuccess: () => { toast(`${nome}: dispensado`, 'success'); invalidarInscricao(qc, registrationId); setAberto(false); setMotivo('') },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const desfazer = useMutation({
    mutationFn: () => api.delete(`/admin/matricula-interna/${registrationId}/dispensa?tipo=${tipo}&chave=${encodeURIComponent(chave)}`),
    onSuccess: () => { toast(`${nome}: voltou a ser exigido`, 'success'); invalidarInscricao(qc, registrationId) },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  if (!pode) return null
  if (dispensa) {
    return <Button size="sm" variant="ghost" disabled={desfazer.isPending} onClick={() => desfazer.mutate()}>Voltar a exigir</Button>
  }
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setAberto(true)}><Ban size={12} /> Dispensar</Button>
      {aberto && (
        <Modal open onOpenChange={(o) => { if (!o) setAberto(false) }} title={`Dispensar: ${nome}`} size="sm"
          description="Deixa de ser exigido nesta inscrição, inclusive na tela do aluno. Fica registrado em seu nome, e dá para voltar a exigir."
          footer={<>
            <Button size="sm" variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button size="sm" variant="primary" disabled={motivo.trim().length < 5 || salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Dispensar'}</Button>
          </>}>
          <div class="grid gap-2">
            {aviso && <p class="text-xs text-warning">{aviso}</p>}
            <Textarea label="Motivo" value={motivo} placeholder="Ex.: documento entregue em papel na secretaria" onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} />
          </div>
        </Modal>
      )}
    </>
  )
}

export function SeloDispensa({ dispensa }: { dispensa: DadosDaDispensa }) {
  return (
    <div class="text-2xs text-fg-muted">
      Dispensado por {dispensa.por} em {new Date(dispensa.em).toLocaleDateString('pt-BR')}: {dispensa.motivo}
    </div>
  )
}
