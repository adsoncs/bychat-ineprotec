import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageDown, Loader2 } from 'lucide-preact'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'

/**
 * Aviso de mídia pendente numa conversa importada do aparelho.
 *
 * A importação traz a mensagem com o tipo certo e sem o arquivo — baixar tudo
 * de antemão travaria a sincronização. Aqui o operador puxa as imagens da
 * conversa que ele está de fato lendo, em lotes.
 *
 * Some quando não há nada pendente, que é o caso da esmagadora maioria das
 * conversas (as que nasceram no painel já chegam com a mídia baixada).
 */
export function PendingMediaBar({ leadId }: { leadId: number }) {
  const qc = useQueryClient()

  const q = useQuery({
    queryKey: ['pending-media', leadId],
    queryFn: () => api.get<{ pendentes: number }>(`/atendimento/tickets/${leadId}/pending-media`),
    enabled: !!leadId,
    staleTime: 30_000,
  })

  const baixar = useMutation({
    mutationFn: () => api.post<{ baixadas: number; falharam: number; restantes: number }>(
      `/atendimento/tickets/${leadId}/fetch-media`, { limite: 15 },
    ),
    onSuccess: (r) => {
      if (r.baixadas) toast(`${r.baixadas} mídia(s) carregada(s)`, 'success')
      if (!r.baixadas && r.falharam) {
        // Arquivo expirado no servidor do WhatsApp é o caso comum — insistir
        // não resolve, e o operador precisa saber que não vai aparecer.
        toast('Não foi possível recuperar estas mídias — o WhatsApp já expirou os arquivos.', 'warning')
      }
      void qc.invalidateQueries({ queryKey: ['pending-media', leadId] })
      void qc.invalidateQueries({ queryKey: ['ticket-messages', leadId] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  const pendentes = q.data?.pendentes ?? 0
  if (!pendentes) return null

  return (
    <div class="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-xs">
      <ImageDown size={13} class="shrink-0 text-fg-muted" />
      <span class="flex-1 text-fg-muted">
        {pendentes} mídia(s) desta conversa ainda não foram carregadas do celular.
      </span>
      <button
        type="button"
        class="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-3 disabled:opacity-50"
        disabled={baixar.isPending}
        onClick={() => baixar.mutate()}
      >
        {baixar.isPending ? <Loader2 size={12} class="inline animate-spin" /> : null}
        {baixar.isPending ? ' Carregando…' : `Carregar ${Math.min(pendentes, 15)}`}
      </button>
    </div>
  )
}
