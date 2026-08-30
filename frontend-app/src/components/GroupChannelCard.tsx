import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Lock, Smartphone } from '@/components/ui/icon-set'
import { api, ApiError } from '@/lib/apiClient'
import { Skeleton } from '@/components/ui/Skeleton'
import { useUserStore } from '@/stores/user'
import { corDoCanal } from '@/lib/channelColors'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

/**
 * O número a que uma conversa de GRUPO pertence.
 *
 * Grupo não escolhe por onde entra: o WhatsApp entrega cada mensagem a TODAS as
 * linhas da empresa que estão nele. Enquanto o canal da conversa saía da última
 * mensagem recebida, dois grupos diferentes apareciam sob o mesmo número — o
 * kobogo tinha um "Acesso Remoto" de cada linha e os dois exibiam a mesma, que
 * era simplesmente a que entregou por último. Aqui o número fica travado por
 * escolha, e a escolha vale para o rótulo da conversa, para o filtro por número
 * e para a linha por onde a resposta sai.
 *
 * Só aparecem as linhas que COMPROVADAMENTE estão no grupo (já trocaram
 * mensagem nele): apontar a conversa para um número de fora a deixaria presa a
 * uma linha que não recebe nada dali.
 */

interface Opcao {
  id: number
  instanceName: string
  label: string
  phone: string | null
  color: string | null
  mensagens: number
  ultimaEm: string | null
}

interface Resposta {
  isGroup: boolean
  titular: string | null
  opcoes: Opcao[]
}

export function GroupChannelCard({ leadId }: { leadId: number }) {
  const qc = useQueryClient()
  const role = useUserStore((s) => s.user?.role)
  const podeTrocar = role === 'SUPERADMIN' || role === 'ADMIN'

  const q = useQuery({
    queryKey: ['ticket-group-channel', leadId],
    queryFn: () => api.get<Resposta>(`/atendimento/tickets/${leadId}/canal-grupo`),
    enabled: !!leadId,
    staleTime: 60_000,
  })

  const trocar = useMutation({
    mutationFn: (instanceName: string) =>
      api.put<{ ok: true; titular: string | null }>(
        `/atendimento/tickets/${leadId}/canal-grupo`,
        { instanceName },
      ),
    onSuccess: (_r, instanceName) => {
      const nome = q.data?.opcoes.find((o) => o.instanceName === instanceName)?.label ?? instanceName
      toast(`O grupo passa a ser atendido por ${nome}`, 'success')
      void qc.invalidateQueries({ queryKey: ['ticket-group-channel', leadId] })
      // A troca muda o rótulo da lista, o filtro por número e o canal de envio.
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['sender-channels', leadId] })
    },
    onError: (e: unknown) => toast(e instanceof ApiError ? e.message : 'Não deu para trocar o número', 'danger'),
  })

  if (q.isLoading) {
    return (
      <section aria-busy="true">
        <Titulo />
        <Skeleton class="h-16 w-full rounded-md" />
      </section>
    )
  }
  if (q.isError || !q.data?.isGroup || !q.data.opcoes.length) return null

  const { titular, opcoes } = q.data
  // Uma linha só no grupo: não há o que escolher — o card vira informação.
  const umaSo = opcoes.length === 1

  return (
    <section>
      <Titulo />
      <div class="overflow-hidden rounded-md border border-border bg-surface">
        <ul class="divide-y divide-border">
          {opcoes.map((o) => {
            const atual = o.instanceName === titular
            const salvando = trocar.isPending && trocar.variables === o.instanceName
            const bloqueado = umaSo || !podeTrocar || atual || trocar.isPending
            return (
              <li key={o.instanceName}>
                <button
                  type="button"
                  disabled={bloqueado}
                  aria-current={atual ? 'true' : undefined}
                  title={
                    atual ? 'O grupo já é atendido por este número'
                      : !podeTrocar ? 'Só admin ou superadmin troca o número de um grupo'
                        : `Atender este grupo por ${o.label}`
                  }
                  onClick={() => trocar.mutate(o.instanceName)}
                  class={cn(
                    'flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors duration-200 sm:min-h-9',
                    atual && 'bg-accent/5',
                    !bloqueado && 'cursor-pointer hover:bg-surface-2',
                    bloqueado && !atual && 'cursor-not-allowed opacity-45',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                  )}
                >
                  {/* Marcador por forma E cor: o titular leva o certo, os demais
                      o círculo vazado — a cor sozinha não distingue para quem
                      não a enxerga. */}
                  <span class="grid size-4 shrink-0 place-items-center" aria-hidden="true">
                    {salvando ? (
                      <Loader2 size={12} class="animate-spin text-accent" />
                    ) : atual ? (
                      <Check size={12} style={{ color: corDoCanal(o.color, 'evolution') }} />
                    ) : (
                      <span class="size-2.5 rounded-full border-2 border-border" />
                    )}
                  </span>

                  <span class="min-w-0 flex-1">
                    <span class={cn('block truncate text-xs', atual ? 'font-medium text-fg' : 'text-fg-muted')}>
                      {o.label}
                    </span>
                    <span class="block truncate text-3xs text-fg-muted">
                      {o.phone ? `${o.phone} · ` : ''}
                      {o.mensagens} {o.mensagens === 1 ? 'mensagem' : 'mensagens'} neste grupo
                    </span>
                  </span>

                  {atual && (
                    <span class="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-3xs font-medium text-accent">
                      atende
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <p class="mt-1.5 flex items-start gap-1 text-2xs leading-relaxed text-fg-muted">
        {podeTrocar && !umaSo
          ? <><Smartphone size={10} class="mt-0.5 shrink-0" /> As duas linhas estão no grupo e recebem as mesmas mensagens. O número escolhido é o que aparece na lista e o que responde.</>
          : <><Lock size={10} class="mt-0.5 shrink-0" /> {umaSo ? 'Só este número da empresa está neste grupo.' : 'Só admin ou superadmin troca o número de um grupo.'}</>}
      </p>
    </section>
  )
}

function Titulo() {
  return <div class="mb-1 text-2xs uppercase tracking-wider text-fg-muted">Número do grupo</div>
}
