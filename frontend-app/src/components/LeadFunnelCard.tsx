import { useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Loader2, Target, Lock, History } from 'lucide-preact'
import { api, ApiError } from '@/lib/apiClient'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

/**
 * O funil do lead, dentro da conversa.
 *
 * Mover etapa exigia sair do atendimento, abrir o Kanban, achar o card no meio
 * de centenas e voltar — caminho que ninguém percorre no meio de uma conversa,
 * e é por isso que a etapa vivia desatualizada. Aqui a trilha inteira fica à
 * vista e um toque move.
 *
 * A trilha é vertical porque o painel tem 320px: uma esteira horizontal com 7
 * etapas viraria rolagem lateral, que é justamente o que não se faz em painel
 * estreito. Cada etapa diz o que é por três sinais — posição, ícone e rótulo —
 * e não só pela cor, que sozinha não serve a quem não a distingue.
 */

interface Etapa {
  key: string
  name: string
  color: string | null
  position: number
  terminalKind: string | null
}

interface Funil {
  id: number
  name: string
  isDefault: boolean
  stages: Etapa[]
}

interface Passagem {
  funnelId: number
  nome: string
  etapaKey: string | null
  etapaNome: string | null
  em: string
}

interface Resposta {
  funilAtual: Funil | null
  etapaAtual: string | null
  qualificado: boolean
  funis: Funil[]
  passagens: Passagem[]
  permissoes: { podeAvancar: boolean; podeRetroceder: boolean }
}

export function LeadFunnelCard({ leadId }: { leadId: number }) {
  const qc = useQueryClient()
  const [trocaAberta, setTrocaAberta] = useState(false)
  const [movendo, setMovendo] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['ticket-funnel', leadId],
    queryFn: () => api.get<Resposta>(`/atendimento/tickets/${leadId}/funnel`),
    enabled: !!leadId,
    staleTime: 30_000,
  })

  const mover = useMutation({
    mutationFn: (v: { status: string; funnelId?: number }) =>
      api.put<{ ok: true }>(`/bychat/leads/${leadId}/status`, v),
    onSuccess: (_r, v) => {
      // Lê do cache, não da variável do render: o nome precisa sair do funil de
      // DESTINO quando a mudança foi de funil.
      const dados = qc.getQueryData<Resposta>(['ticket-funnel', leadId])
      const escopo = v.funnelId
        ? dados?.funis.find((f) => f.id === v.funnelId)?.stages
        : dados?.funilAtual?.stages
      const nome = escopo?.find((e) => e.key === v.status)?.name ?? v.status
      toast(v.funnelId ? `Movido para ${nome}, em outro funil` : `Movido para ${nome}`, 'success')
      setTrocaAberta(false)
      void qc.invalidateQueries({ queryKey: ['ticket-funnel', leadId] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', leadId] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    },
    // 403 aqui é regra de negócio (permissão do Kanban), não falha técnica: a
    // frase do servidor já explica o que faltou.
    onError: (e: unknown) => toast((e as ApiError).message, 'danger'),
    onSettled: () => setMovendo(null),
  })

  if (q.isLoading) {
    return (
      <section aria-busy="true">
        <TituloSecao />
        <Skeleton class="h-28 w-full rounded-md" />
      </section>
    )
  }
  if (q.isError || !q.data) return null

  const { funilAtual, etapaAtual, funis, passagens, permissoes } = q.data
  const etapas = funilAtual?.stages ?? []
  const atual = etapas.find((e) => e.key === etapaAtual) ?? null
  const posAtual = atual?.position ?? -1
  const outrosFunis = funis.filter((f) => f.id !== funilAtual?.id)

  function acionar(etapa: Etapa, funnelId?: number) {
    if (mover.isPending) return
    setMovendo(etapa.key)
    mover.mutate(funnelId ? { status: etapa.key, funnelId } : { status: etapa.key })
  }

  // ── Sem funil: o contato existe, mas ainda não entrou em nenhum processo ──
  if (!funilAtual) {
    return (
      <section>
        <TituloSecao />
        <div class="rounded-md border border-dashed border-border bg-surface p-3">
          <p class="text-xs leading-relaxed text-fg-muted">
            Este contato ainda não está em um funil. Escolha um para começar a acompanhar a negociação.
          </p>
          {funis.length > 0 && (
            <div class="mt-2.5 space-y-1.5">
              {funis.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={!permissoes.podeAvancar || mover.isPending}
                  onClick={() => f.stages[0] && acionar(f.stages[0], f.id)}
                  class={cn(
                    'flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border',
                    'bg-surface-2 px-2.5 py-2 text-left text-xs text-fg transition-colors duration-200',
                    'hover:border-accent/60 hover:bg-surface-3 focus-visible:outline focus-visible:outline-2',
                    'focus-visible:outline-offset-2 focus-visible:outline-accent',
                    'disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9',
                  )}
                >
                  <span class="min-w-0 truncate font-medium">{f.name}</span>
                  <span class="shrink-0 text-[0.6875rem] text-fg-subtle">
                    {movendo === f.stages[0]?.key && mover.isPending
                      ? <Loader2 size={11} class="animate-spin" />
                      : `entrar em ${f.stages[0]?.name ?? '—'}`}
                  </span>
                </button>
              ))}
            </div>
          )}
          {!permissoes.podeAvancar && (
            <p class="mt-2 flex items-center gap-1 text-[0.6875rem] text-fg-subtle">
              <Lock size={10} /> Seu perfil não move leads de etapa.
            </p>
          )}
        </div>
      </section>
    )
  }

  return (
    <section>
      <div class="mb-1 flex items-center justify-between gap-2">
        <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">Funil</div>
        {outrosFunis.length > 0 && (
          <button
            type="button"
            class={cn(
              'inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem]',
              'text-fg-muted transition-colors duration-200 hover:bg-surface-3 hover:text-fg',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
            )}
            aria-expanded={trocaAberta}
            onClick={() => setTrocaAberta((v) => !v)}
          >
            Trocar de funil
            <ChevronDown size={11} class={cn('transition-transform duration-200', trocaAberta && 'rotate-180')} />
          </button>
        )}
      </div>

      <div class="overflow-hidden rounded-md border border-border bg-surface">
        {/* Cabeçalho: em que processo o lead está e onde ele parou. */}
        <div class="flex items-center gap-2 border-b border-border px-2.5 py-2">
          <Target size={12} class="shrink-0 text-fg-subtle" />
          <span class="min-w-0 flex-1 truncate text-xs font-medium text-fg" title={funilAtual.name}>
            {funilAtual.name}
          </span>
          <span class="shrink-0 text-[0.6875rem] tabular-nums text-fg-subtle">
            {posAtual >= 0 ? `${posAtual + 1}/${etapas.length}` : `—/${etapas.length}`}
          </span>
        </div>

        {/* Trilha. Cada etapa é um alvo de toque; a atual não é clicável. */}
        <ul class="divide-y divide-border">
          {etapas.map((e) => {
            const ehAtual = e.key === etapaAtual
            const passou = posAtual >= 0 && e.position < posAtual
            const recuo = posAtual >= 0 && e.position < posAtual
            const bloqueado = ehAtual
              ? false
              : recuo ? !permissoes.podeRetroceder : !permissoes.podeAvancar
            const carregando = mover.isPending && movendo === e.key
            const cor = e.color || 'var(--color-accent)'

            return (
              <li key={e.key}>
                <button
                  type="button"
                  disabled={ehAtual || bloqueado || mover.isPending}
                  aria-current={ehAtual ? 'step' : undefined}
                  title={
                    ehAtual ? 'Etapa atual'
                      : bloqueado ? (recuo ? 'Seu perfil não retrocede etapas' : 'Seu perfil não avança etapas')
                        : `Mover para ${e.name}`
                  }
                  onClick={() => acionar(e)}
                  class={cn(
                    'flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors duration-200 sm:min-h-9',
                    ehAtual && 'bg-accent/5',
                    !ehAtual && !bloqueado && 'cursor-pointer hover:bg-surface-2',
                    bloqueado && !ehAtual && 'cursor-not-allowed opacity-45',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                  )}
                >
                  {/* Marcador: cor + forma. Quem já passou leva o certo, a atual
                      leva o anel cheio, as futuras ficam vazadas. */}
                  <span class="grid size-4 shrink-0 place-items-center" aria-hidden="true">
                    {carregando ? (
                      <Loader2 size={12} class="animate-spin text-accent" />
                    ) : passou ? (
                      <Check size={12} style={{ color: cor }} />
                    ) : ehAtual ? (
                      <span class="size-2.5 rounded-full ring-2 ring-offset-1 ring-offset-surface" style={{ background: cor, '--tw-ring-color': cor } as any} />
                    ) : (
                      <span class="size-2.5 rounded-full border-2 border-border" />
                    )}
                  </span>

                  <span class={cn('min-w-0 flex-1 truncate text-xs', ehAtual ? 'font-medium text-fg' : 'text-fg-muted')}>
                    {e.name}
                  </span>

                  {ehAtual && (
                    <span class="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-accent">
                      atual
                    </span>
                  )}
                  {!ehAtual && e.terminalKind && (
                    <span
                      class={cn(
                        'shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem]',
                        e.terminalKind === 'won' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
                      )}
                    >
                      {e.terminalKind === 'won' ? 'ganho' : 'perdido'}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        {/* Trocar de funil: some por padrão porque é a exceção, não o dia a dia. */}
        {trocaAberta && outrosFunis.length > 0 && (
          <div class="border-t border-border bg-surface-2 p-2.5">
            <p class="mb-1.5 text-[0.6875rem] leading-relaxed text-fg-subtle">
              O lead sai de <strong class="font-medium text-fg-muted">{funilAtual.name}</strong> e entra na
              primeira etapa do funil escolhido. O histórico fica registrado.
            </p>
            <div class="space-y-1.5">
              {outrosFunis.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={!permissoes.podeAvancar || mover.isPending || !f.stages.length}
                  onClick={() => f.stages[0] && acionar(f.stages[0], f.id)}
                  class={cn(
                    'flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border',
                    'bg-surface px-2.5 py-2 text-left text-xs text-fg transition-colors duration-200',
                    'hover:border-accent/60 hover:bg-surface-3 focus-visible:outline focus-visible:outline-2',
                    'focus-visible:outline-offset-2 focus-visible:outline-accent',
                    'disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9',
                  )}
                >
                  <span class="min-w-0 truncate">{f.name}</span>
                  <span class="shrink-0 text-[0.6875rem] text-fg-subtle">
                    {mover.isPending && movendo === f.stages[0]?.key
                      ? <Loader2 size={11} class="animate-spin" />
                      : f.stages[0]?.name ?? 'sem etapas'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Por onde já passou: responde "esse contato já esteve em outro funil?" */}
      {passagens.length > 0 && (
        <ul class="mt-1.5 space-y-1">
          {passagens.slice(0, 3).map((p) => (
            <li key={p.funnelId} class="flex items-start gap-1.5 text-[0.6875rem] text-fg-subtle">
              <History size={10} class="mt-0.5 shrink-0" />
              <span class="min-w-0">
                Já passou por <span class="text-fg-muted">{p.nome}</span>
                {p.etapaNome ? ` · ${p.etapaNome}` : ''}
                {' · '}
                {new Date(p.em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!permissoes.podeAvancar && !permissoes.podeRetroceder && (
        <p class="mt-1.5 flex items-center gap-1 text-[0.6875rem] text-fg-subtle">
          <Lock size={10} /> Seu perfil só consulta o funil.
        </p>
      )}
    </section>
  )
}

function TituloSecao() {
  return <div class="mb-1 text-[0.6875rem] uppercase tracking-wider text-fg-subtle">Funil</div>
}
