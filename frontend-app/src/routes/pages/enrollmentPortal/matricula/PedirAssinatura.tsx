// Aba Contrato: pedir a assinatura ou o aceite ao aluno. Nada é enviado sozinho:
// o agente copia o link ou leva o texto pronto para a conversa do lead.
import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { Copy, MessageSquare, Send } from '@/components/ui/icon-set'
import { pedirRascunho } from '@/lib/rascunhoDaConversa'
import { BASE_CONTRATOS_PORTAL } from '../../contratos/ContratoWord'
import { invalidarInscricao } from './Dispensa'

interface RespostaLink {
  url: string
  validadeDias: number
  lead: { id: number; nome: string | null; whatsapp: string | null } | null
  travadaPara: string | null
}
interface EstadoContrato { eletronica: boolean; conviteAutomatico: boolean; assinatura: unknown | null }

export function PedirAssinatura({ registrationId, whatsapp }: { registrationId: number; whatsapp: string | null | undefined }) {
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const [gerado, setGerado] = useState<RespostaLink | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const estado = useQuery({
    queryKey: ['ct-inscricao', registrationId],
    queryFn: () => api.get<EstadoContrato>(`${BASE_CONTRATOS_PORTAL}/inscricao/${registrationId}`),
    staleTime: 10_000,
  })
  const pedirLink = (via: 'copiar' | 'conversas') => api.post<RespostaLink>(`/admin/matricula-interna/${registrationId}/contrato/link`, { via })
  const copiar = useMutation({
    mutationFn: () => pedirLink('copiar'),
    onSuccess: (r) => {
      setGerado(r)
      invalidarInscricao(qc, registrationId)
      void navigator.clipboard?.writeText(r.url)
        .then(() => toast('Link copiado', 'success'))
        .catch(() => toast('Selecione o link na tela e copie', 'warning'))
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const conversas = useMutation({
    mutationFn: () => pedirLink('conversas'),
    onSuccess: (r) => {
      if (!r.lead) { toast('A inscrição não tem ficha de lead.', 'danger'); return }
      const nome = (r.lead.nome ?? '').trim().split(/\s+/)[0]
      pedirRascunho(r.lead.id, `Olá${nome ? `, ${nome}` : ''}! Segue o link para você ler e assinar o contrato da sua matrícula:\n${r.url}`)
      invalidarInscricao(qc, registrationId)
      navigate(`/conversations?leadId=${r.lead.id}`)
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const iniciar = useMutation({
    mutationFn: () => api.post(`/admin/matricula-interna/${registrationId}/contrato/iniciar`),
    onSuccess: () => { toast('Assinatura eletrônica iniciada', 'success'); setConfirmar(false); void qc.invalidateQueries({ queryKey: ['ct-inscricao', registrationId] }); invalidarInscricao(qc, registrationId) },
    onError: (e: unknown) => { toast((e as Error).message, 'danger'); setConfirmar(false) },
  })
  const e = estado.data
  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-1">Pedir a assinatura ao aluno</div>
      <div class="text-xs text-fg-muted mb-3">O link abre direto no contrato, sem login. Nada é enviado sozinho.</div>
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={copiar.isPending} onClick={() => copiar.mutate()}><Copy size={12} /> {copiar.isPending ? 'Gerando…' : 'Copiar link do contrato'}</Button>
        <Button size="sm" variant="secondary" disabled={conversas.isPending || !whatsapp} title={whatsapp ? undefined : 'O lead não tem WhatsApp na ficha'} onClick={() => conversas.mutate()}><MessageSquare size={12} /> {conversas.isPending ? 'Abrindo…' : 'Enviar pelo Conversas'}</Button>
        {e?.eletronica && !e.assinatura && (
          <Button size="sm" variant="secondary" disabled={iniciar.isPending} onClick={() => setConfirmar(true)}><Send size={12} /> Iniciar assinatura eletrônica</Button>
        )}
      </div>
      {gerado && (
        <div class="mt-3 rounded-md border border-border p-3 grid gap-1.5">
          <code class="text-2xs text-fg-muted break-all select-all">{gerado.url}</code>
          <div class="text-2xs text-fg-muted">Vale por {gerado.validadeDias} dia(s). Quem tiver este link entra na inscrição: mande só para o aluno.</div>
        </div>
      )}
      {gerado?.travadaPara && <div class="text-2xs text-warning mt-2">O aluno ainda não chega ao contrato: {gerado.travadaPara} O link abre na etapa que está antes.</div>}
      <ConfirmDialog open={confirmar} onOpenChange={setConfirmar} title="Iniciar assinatura eletrônica?"
        description={e?.conviteAutomatico
          ? 'O contrato é gerado com os dados atuais e o provedor manda o convite ao aluno na hora, por WhatsApp ou e-mail.'
          : 'O contrato é gerado com os dados atuais e o link de assinatura aparece aqui. Corrija o cadastro antes, se precisar.'}
        confirmLabel="Iniciar" loading={iniciar.isPending} onConfirm={() => iniciar.mutate()} />
    </Card>
  )
}
