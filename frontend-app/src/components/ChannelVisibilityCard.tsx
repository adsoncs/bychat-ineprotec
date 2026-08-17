import { useState } from 'preact/hooks'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-preact'
import { api } from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { useUsers } from '@/hooks/useUsers'
import { useUserStore } from '@/stores/user'
import { cn } from '@/lib/cn'

/**
 * Quem enxerga as conversas de um número.
 *
 * A permissão do painel sempre foi do LEAD — quem é dono dele, ou o setor dele,
 * vê a conversa, não importa por qual linha ela aconteceu. Isso basta enquanto
 * todos os números são da empresa e deixa de bastar no instante em que alguém
 * conecta a linha PESSOAL: o histórico inteiro dela cai na visão de quem tem o
 * setor.
 *
 * Só SUPERADMIN vê este bloco: decidir quem acompanha uma linha inteira é do
 * dono da instalação, não do administrador de operação.
 */

export interface VisibilidadeCanal {
  visibility?: 'all' | 'restricted' | string
  viewers?: Array<{ userId: number; user?: { name: string | null; email: string | null } }>
  ownerUserId?: number | null
}

export function ChannelVisibilityCard({
  kind,
  channelId,
  channel,
  nomeDoCanal,
}: {
  kind: 'evolution' | 'cloud'
  channelId: number
  channel: VisibilidadeCanal
  nomeDoCanal: string
}) {
  const role = useUserStore((s) => s.user?.role)
  const qc = useQueryClient()
  const { data: usersData } = useUsers()

  const [modo, setModo] = useState<'all' | 'restricted'>(
    channel.visibility === 'restricted' ? 'restricted' : 'all',
  )
  const [escolhidos, setEscolhidos] = useState<number[]>(
    (channel.viewers ?? []).map((v) => v.userId),
  )

  const salvar = useMutation({
    mutationFn: (corpo: { visibility: string; viewerIds: number[] }) =>
      api.put<{ ok: true }>(
        kind === 'evolution'
          ? `/admin/instances/${channelId}/visibility`
          : `/cloud-api/connection/${channelId}/visibility`,
        corpo,
      ),
    onSuccess: () => {
      toast(
        modo === 'restricted'
          ? `Só quem você escolheu passa a ver as conversas de ${nomeDoCanal}`
          : `As conversas de ${nomeDoCanal} voltam a seguir a permissão normal`,
        'success',
      )
      void qc.invalidateQueries({ queryKey: ['instances'] })
      void qc.invalidateQueries({ queryKey: ['cloud-api-connection'] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  // Bloco de dono da instalação. Para os demais papéis ele nem existe — não
  // adianta mostrar desabilitado o que a pessoa nunca poderá usar.
  if (role !== 'SUPERADMIN') return null

  const usuarios = (usersData?.users ?? []).filter((u) => u.active)

  function alternar(id: number) {
    setEscolhidos((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]))
  }

  const mudou =
    modo !== (channel.visibility === 'restricted' ? 'restricted' : 'all') ||
    JSON.stringify([...escolhidos].sort()) !== JSON.stringify((channel.viewers ?? []).map((v) => v.userId).sort())

  return (
    <div class="rounded-md border border-border bg-surface-3/50 p-3">
      <div class="mb-2 flex items-center gap-2">
        <ShieldCheck size={13} class="shrink-0 text-accent" />
        <span class="text-xs font-medium text-fg">Quem vê as conversas deste número</span>
        <span class="rounded bg-accent/10 px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-wider text-accent">
          Só superadmin
        </span>
        {salvar.isPending && <Loader2 size={12} class="animate-spin text-fg-muted" />}
      </div>

      <div class="space-y-1.5">
        {([
          {
            v: 'all' as const,
            Icone: Eye,
            titulo: 'Como sempre foi',
            ajuda: 'Quem já enxerga a conversa pelo dono ou pelo setor continua enxergando.',
          },
          {
            v: 'restricted' as const,
            Icone: EyeOff,
            titulo: 'Reservado — só quem eu escolher',
            ajuda: 'Some da lista, dos contadores e do acesso direto para todos os outros, inclusive gerência. Serve para a linha pessoal conectada ao painel.',
          },
        ]).map((op) => (
          <label
            key={op.v}
            class={cn(
              'flex cursor-pointer gap-2.5 rounded-md border p-2.5 transition-colors duration-200',
              modo === op.v ? 'border-accent bg-accent/5' : 'border-border bg-surface hover:border-accent/60',
            )}
          >
            <input
              type="radio"
              name={`vis-${kind}-${channelId}`}
              class="mt-0.5 shrink-0"
              checked={modo === op.v}
              onChange={() => setModo(op.v)}
            />
            <span class="min-w-0">
              <span class="flex items-center gap-1.5 text-xs font-medium text-fg">
                <op.Icone size={12} /> {op.titulo}
              </span>
              <span class="mt-0.5 block text-[0.6875rem] leading-snug text-fg-subtle">{op.ajuda}</span>
            </span>
          </label>
        ))}
      </div>

      {modo === 'restricted' && (
        <div class="mt-2.5">
          <p class="mb-1.5 text-[0.6875rem] leading-relaxed text-fg-subtle">
            Marque quem pode acompanhar. Você (superadmin) e o agente dono do número entram sempre,
            sem precisar marcar.
          </p>
          <ul class="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border bg-surface p-1.5">
            {usuarios.map((u) => (
              <li key={u.id}>
                <label class="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={escolhidos.includes(u.id)}
                    onChange={() => alternar(u.id)}
                  />
                  <span class="min-w-0 flex-1 truncate text-fg">{u.name || u.email}</span>
                  <span class="shrink-0 text-[0.625rem] uppercase tracking-wider text-fg-subtle">{u.role}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div class="mt-2.5 flex items-center justify-between gap-2">
        <span class="text-[0.6875rem] text-fg-subtle">
          {modo === 'restricted'
            ? `${escolhidos.length} pessoa(s) marcada(s)`
            : 'Nenhuma restrição neste número'}
        </span>
        <Button
          variant="primary"
          size="sm"
          disabled={!mudou || salvar.isPending}
          onClick={() => salvar.mutate({ visibility: modo, viewerIds: escolhidos })}
        >
          Salvar acesso
        </Button>
      </div>
    </div>
  )
}
